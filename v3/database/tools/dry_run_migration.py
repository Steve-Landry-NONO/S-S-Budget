#!/usr/bin/env python3
"""Essai à blanc d'une migration « begin; … commit; » — BASES JETABLES UNIQUEMENT (REV-08, R2-03, 27/11/2026).

Pourquoi « jetables uniquement » : un ROLLBACK n'annule pas tout. Les séquences (nextval, colonnes d'identité), les appels
dblink, les écritures de fichiers serveur, certains réglages et les verrous consultatifs de session survivent à l'annulation.
Un essai à blanc sur DEV ou production pourrait donc laisser des traces, même parfaitement annulé. L'outil refuse tout
environnement persistant AVANT de s'y connecter.

Garanties, par ordre de force :
  1. AVANT exécution (garantie) : analyse lexicale complète (chaînes, identifiants entre guillemets, commentaires imbriqués,
     chaînes dollar) ; exactement une transaction de premier niveau (BEGIN en tête, COMMIT en fin) ; refus de toute autre
     commande de contrôle transactionnel (END, COMMIT AND CHAIN, ROLLBACK, SAVEPOINT, PREPARE TRANSACTION…), de toute
     méta-commande ou interpolation psql, des commandes non transactionnelles et des fonctions qui s'échappent de la transaction.
  2. PENDANT exécution (garantie) : le corps est exécuté entre BEGIN et ROLLBACK générés par l'outil ; un garde vérifie, juste
     avant le ROLLBACK, que l'on est toujours dans LA MÊME transaction (identifiant de transaction et réglage local). Si ce n'est
     pas le cas, des effets ont pu être validés : arrêt, code 3, base à détruire.
  3. APRÈS exécution (détection seulement, JAMAIS une garantie) : comparaison du catalogue, des versions de migration et des
     séquences. Elle peut révéler un effet persistant, elle ne peut pas prouver son absence (données, fichiers, autres bases).

Cible acceptée : socket Unix (hôte = chemin absolu) ou boucle locale (localhost, 127.0.0.1, ::1), base dont le commentaire
est exactement « duo-v3-disposable », hors bases système. Aucun contournement n'est prévu pour un hôte distant.

Usage : dry_run_migration.py "<conninfo>" <migration.sql> [--catalog fichier.sql] [--json rapport.json]
Codes : 0 OK ; 2 refus avant exécution ; 3 transaction rompue (effets possiblement validés) ; 4 modification persistante
détectée ; 5 la migration échoue (annulée) ; 6 erreur de l'outil."""
import hashlib, json, os, pathlib, re, subprocess, sys

MARKER = "duo-v3-disposable"
HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_CAT = HERE.parent / "qualification/006r1/sql/catalog_dump.sql"

class Refusal(Exception):
    pass

# ------------------------------------------------------------------------------------------------ analyse lexicale
def lex(text):
    """Découpe en instructions de premier niveau. Renvoie [(texte, ligne, code_hors_littéraux)].
    code_hors_littéraux = le texte où chaînes, identifiants entre guillemets, commentaires et chaînes dollar sont remplacés
    par des blancs (les retours à la ligne sont conservés)."""
    n = len(text); i = 0; out = []; start = 0; code = []
    ident = re.compile(r"[A-Za-z0-9_\u0080-\uffff]")
    def blank(seg): return "".join("\n" if ch == "\n" else " " for ch in seg)
    def lineno(off): return text.count("\n", 0, off) + 1
    while i < n:
        c = text[i]; nxt = text[i + 1] if i + 1 < n else ""
        prev_ident = bool(code) and bool(ident.match(code[-1]))
        if c == "-" and nxt == "-":
            j = text.find("\n", i); j = n if j < 0 else j
        elif c == "/" and nxt == "*":
            depth, j = 1, i + 2
            while j < n and depth:
                if text.startswith("/*", j): depth += 1; j += 2
                elif text.startswith("*/", j): depth -= 1; j += 2
                else: j += 1
            if depth: raise Refusal(f"ligne {lineno(i)} : commentaire /* non fermé")
        elif c == "'" or (c in "eE" and nxt == "'" and not prev_ident):
            esc = c in "eE"; j = i + (2 if esc else 1)
            while j < n:
                if esc and text[j] == "\\": j += 2; continue
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'": j += 2; continue
                    break
                j += 1
            if j >= n: raise Refusal(f"ligne {lineno(i)} : chaîne non fermée")
            j += 1
        elif c == '"':
            j = i + 1
            while j < n:
                if text[j] == '"':
                    if j + 1 < n and text[j + 1] == '"': j += 2; continue
                    break
                j += 1
            if j >= n: raise Refusal(f"ligne {lineno(i)} : identifiant non fermé")
            j += 1
        elif c == "$" and not prev_ident and re.match(r"\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$", text[i:]):
            tag = re.match(r"\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$", text[i:]).group(0)
            k = text.find(tag, i + len(tag))
            if k < 0: raise Refusal(f"ligne {lineno(i)} : chaîne dollar {tag} non fermée")
            j = k + len(tag)
        else:
            code.append(c); i += 1
            if c == ";":
                out.append((text[start:i], lineno(start + (len(text[start:i]) - len(text[start:i].lstrip()))), "".join(code)))
                start = i; code = []
            continue
        code.append(blank(text[i:j])); i = j
    if "".join(code).strip():
        out.append((text[start:], lineno(start + (len(text[start:]) - len(text[start:].lstrip()))), "".join(code)))
    return out

CONTROL = re.compile(r"^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b", re.I)
NON_TX = [
    (r"^\s*CREATE\s+DATABASE\b|^\s*DROP\s+DATABASE\b|^\s*ALTER\s+DATABASE\b", "commande de base de données"),
    (r"^\s*(CREATE|DROP|ALTER)\s+TABLESPACE\b", "tablespace"),
    (r"^\s*ALTER\s+SYSTEM\b", "ALTER SYSTEM"),
    (r"^\s*(VACUUM|CHECKPOINT|LOAD|DISCARD|LISTEN|UNLISTEN)\b", "commande non transactionnelle ou de session"),
    (r"^\s*CLUSTER\s*;|^\s*REINDEX\s+(DATABASE|SYSTEM)\b|\bCONCURRENTLY\b", "commande non transactionnelle"),
    (r"^\s*(CREATE|ALTER|DROP)\s+SUBSCRIPTION\b", "abonnement logique"),
    (r"^\s*COPY\b[^;]*\b(PROGRAM|TO\s+'|FROM\s+')", "COPY vers ou depuis un fichier ou un programme serveur"),
]
ESCAPES = re.compile(r"\b(dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|lo_import|lo_export|"
                     r"pg_file_write|pg_advisory_lock|pg_advisory_lock_shared|nextval|setval|pg_notify|pg_logical_emit_message)\s*\(", re.I)

def check(text):
    """Contrôles AVANT exécution. Renvoie le corps (instructions entre BEGIN et COMMIT) ; lève Refusal sinon."""
    stmts = [s for s in lex(text) if s[2].strip(" \n\t;")]
    if not stmts: raise Refusal("fichier vide")
    for raw, ln, code in stmts:
        if "\\" in code: raise Refusal(f"ligne {ln} : méta-commande psql (barre oblique inverse hors littéral)")
        for k, ch in enumerate(code):                                 # code et texte brut sont alignés caractère par caractère
            if ch == ":" and (k == 0 or code[k - 1] != ":") and (k + 1 >= len(code) or code[k + 1] != ":"):
                nxt = raw[k + 1] if k + 1 < len(raw) else ""
                if nxt in "'\"" or nxt.isalpha() or nxt == "_": raise Refusal(f"ligne {ln} : interpolation de variable psql")
    first, last = stmts[0], stmts[-1]
    if not re.fullmatch(r"\s*BEGIN(\s+(TRANSACTION|WORK))?\s*;?\s*", first[2], re.I):
        raise Refusal(f"ligne {first[1]} : la première instruction doit être « begin; »")
    if not re.fullmatch(r"\s*COMMIT(\s+(TRANSACTION|WORK))?\s*;?\s*", last[2], re.I):
        raise Refusal(f"ligne {last[1]} : la dernière instruction doit être « commit; » (sans AND CHAIN), rien après")
    body = stmts[1:-1]
    for raw, ln, code in body:
        m = CONTROL.match(code)
        if m: raise Refusal(f"ligne {ln} : contrôle transactionnel de premier niveau interdit ({m.group(1).upper()})")
        for pat, why in NON_TX:
            if re.search(pat, code, re.I): raise Refusal(f"ligne {ln} : {why} interdit(e)")
        executes = re.match(r"\s*(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CALL|VALUES|TABLE|EXECUTE|CREATE\s+(TABLE|MATERIALIZED\s+VIEW)\b[^;]*\bAS\b)", code, re.I)
        is_do = re.match(r"\s*DO\b", code, re.I)
        e = ESCAPES.search(raw if is_do else code) if (executes or is_do) else None
        if e: raise Refusal(f"ligne {ln} : appel non annulable par ROLLBACK interdit dans une instruction exécutée ({e.group(1)})")
        if is_do and re.search(r"\b(COMMIT|ROLLBACK)\b", raw, re.I):
            raise Refusal(f"ligne {ln} : contrôle transactionnel dans un bloc DO")
    return [raw for raw, _, _ in body]

# ------------------------------------------------------------------------------------------------ cible jetable
def parse_target(conninfo):
    """Contrôle TEXTUEL, sans connexion : hôte explicite, socket Unix ou boucle locale."""
    if os.environ.get("PGSERVICE") or os.environ.get("PGSERVICEFILE"):
        raise Refusal("PGSERVICE défini : cible implicite refusée")
    if re.match(r"^postgres(ql)?://", conninfo):
        m = re.match(r"^postgres(?:ql)?://(?:[^@/]*@)?(\[[^\]]+\]|[^:/?]*)", conninfo); host = (m.group(1) if m else "").strip("[]")
        q = re.search(r"[?&]host=([^&]+)", conninfo)
        if q: host = q.group(1).replace("%2F", "/").replace("%2f", "/")
    else:
        kv = dict(re.findall(r"(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)", conninfo)); host = kv.get("host", "").strip("'")
        if "hostaddr" in kv: raise Refusal("hostaddr refusé : utiliser host")
    if not host: raise Refusal("hôte absent de la chaîne de connexion (PGHOST implicite refusé)")
    hosts = host.split(",")
    for h in hosts:
        if not (h.startswith("/") or h in ("localhost", "127.0.0.1", "::1")):
            raise Refusal(f"hôte « {h} » refusé : seules les bases jetables locales sont acceptées (socket Unix ou boucle locale)")
    return host

def psql(conn, *args, sql=None):
    cmd = ["psql", conn, "-X", "-q", "-v", "ON_ERROR_STOP=1", *args]
    return subprocess.run(cmd, input=sql, capture_output=True, text=True)

def target_facts(conn):
    q = ("select coalesce(host(inet_server_addr()), 'socket'), current_database(), coalesce(shobj_description(d.oid, 'pg_database'), ''),"
         " d.datistemplate, current_setting('server_version') from pg_database d where d.datname = current_database()")
    r = psql(conn, "-At", "-F", "\t", "-c", q)
    if r.returncode: raise Refusal(f"connexion impossible : {r.stderr.strip()[:200]}")
    addr, db, comment, istpl, ver = r.stdout.strip().split("\t")
    if addr not in ("socket", "127.0.0.1", "::1"): raise Refusal(f"serveur joint via {addr} : refus")
    if db in ("postgres", "template0", "template1") or istpl == "t": raise Refusal(f"base système ou gabarit « {db} » refusée")
    if comment != MARKER: raise Refusal(f"base « {db} » sans marqueur « {MARKER} » (COMMENT ON DATABASE) : refus")
    return dict(adresse=addr, base=db, version_serveur=ver)

def observe(conn, cat):
    r = psql(conn, "-At", "-f", str(cat)); cat_h = hashlib.sha256(r.stdout.encode()).hexdigest()[:16] if r.returncode == 0 else "erreur"
    v = psql(conn, "-At", "-c", "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")
    s = psql(conn, "-At", "-c", "select coalesce(string_agg(schemaname||'.'||sequencename||'='||coalesce(last_value::text,'null'), ',' order by 1), '') from pg_sequences")
    # CAT-01 : catalog_dump.sql n'inclut ni les types ni les contraintes de domaine ; relevé complémentaire.
    d = psql(conn, "-At", "-c", "select coalesce(string_agg(n.nspname||'.'||t.typname||'|'||t.typtype::text||'|'||coalesce(pg_get_constraintdef(c.oid),''), ',' order by 1), '')"
             " from pg_type t join pg_namespace n on n.oid = t.typnamespace left join pg_constraint c on c.contypid = t.oid"
             " where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%' and t.typtype in ('d','e','c','r') and not exists (select 1 from pg_class r where r.reltype = t.oid)")
    dom_h = hashlib.sha256(d.stdout.encode()).hexdigest()[:16] if d.returncode == 0 else "erreur"
    return dict(catalogue=cat_h, types_domaines=dom_h, versions=v.stdout.strip() if v.returncode == 0 else "absent", sequences=s.stdout.strip())

GUARD_SET = "select pg_catalog.set_config('duo_v3.dry_run_xact', pg_catalog.pg_current_xact_id()::text, true);"
GUARD_CHECK = ("do $dry_run_guard$ begin if coalesce(pg_catalog.current_setting('duo_v3.dry_run_xact', true), '') "
               "is distinct from pg_catalog.pg_current_xact_id()::text then raise exception 'DRY_RUN_TRANSACTION_BROKEN' using errcode = 'P0001'; "
               "end if; end $dry_run_guard$;")

def main(argv):
    import argparse
    ap = argparse.ArgumentParser(add_help=True); ap.add_argument("conninfo"); ap.add_argument("migration")
    ap.add_argument("--catalog", default=str(DEFAULT_CAT)); ap.add_argument("--json")
    a = ap.parse_args(argv)
    rep = dict(outil="dry_run_migration.py", migration=a.migration, statut=None)
    def done(code, statut, **kw):
        rep.update(statut=statut, code=code, **kw)
        if a.json: pathlib.Path(a.json).write_text(json.dumps(rep, indent=1, ensure_ascii=False))
        print(f"{statut} (code {code})" + (f" : {kw.get('motif')}" if kw.get("motif") else "")); return code
    try:
        text = pathlib.Path(a.migration).read_text(encoding="utf-8"); rep["sha256"] = hashlib.sha256(text.encode()).hexdigest()
        parse_target(a.conninfo)                                      # avant toute connexion
        skip = os.environ.get("DRY_RUN_TEST_ONLY_SKIP_LEXER") == "1"   # réservé à la suite adverse (test du garde) ; cible jetable exigée quand même
        body = check(text) if not skip else [s[0] for s in lex(text)][1:-1]
        rep["cible"] = target_facts(a.conninfo)
    except Refusal as e:
        return done(2, "REFUS", motif=str(e))
    except (OSError, UnicodeError) as e:
        return done(6, "ERREUR OUTIL", motif=str(e))
    before = observe(a.conninfo, a.catalog)
    script = "begin;\n" + GUARD_SET + "\n" + "\n".join(body) + "\n" + GUARD_CHECK + "\nrollback;\n"
    r = psql(a.conninfo, sql=script)
    after = observe(a.conninfo, a.catalog)
    rep.update(avant=before, apres=after, stderr=r.stderr[-2000:])
    seq_changed = before["sequences"] != after["sequences"]
    if "DRY_RUN_TRANSACTION_BROKEN" in r.stderr:
        return done(3, "TRANSACTION ROMPUE", motif="le corps a quitté la transaction de l'essai : des effets ont pu être validés ; détruire la base jetable")
    if before["catalogue"] != after["catalogue"] or before["versions"] != after["versions"] or before["types_domaines"] != after["types_domaines"]:
        return done(4, "MODIFICATION PERSISTANTE DÉTECTÉE", motif="catalogue, types et domaines ou versions différents après l'essai")
    if r.returncode:
        last = [l for l in r.stderr.splitlines() if "ERROR" in l or "ERREUR" in l]
        return done(5, "MIGRATION EN ÉCHEC (ANNULÉE)", motif=(last[-1] if last else r.stderr.strip()[-200:]),
                    effets_non_transactionnels=(["séquences"] if seq_changed else []))
    return done(0, "ESSAI À BLANC OK" + (" — AVEC EFFET NON TRANSACTIONNEL (séquences avancées)" if seq_changed else ""),
                motif="détection a posteriori : catalogue, types et domaines, versions inchangés (ce n'est pas une preuve d'absence d'effet)",
                effets_non_transactionnels=(["séquences"] if seq_changed else []))

if __name__ == "__main__":
    try: sys.exit(main(sys.argv[1:]))
    except Exception as e:                                            # jamais silencieux
        print(f"ERREUR OUTIL (code 6) : {type(e).__name__}: {e}"); sys.exit(6)
