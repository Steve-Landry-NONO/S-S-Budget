#!/usr/bin/env python3
"""Essai à blanc d'une migration « begin; … commit; » — BASE JETABLE CRÉÉE PAR L'OUTIL (REV-08, R2-03, R3-04, 27/11/2026).

Pourquoi : un ROLLBACK n'annule pas tout (séquences, dblink, fichiers serveur, verrous de session). Un essai à blanc sur DEV ou
production pourrait laisser des traces même annulé. L'outil n'accepte donc AUCUNE chaîne de connexion : il crée lui-même une base
jetable au nom aléatoire, par socket Unix local, à partir d'un gabarit, y exécute l'essai, puis la détruit.

Isolation (R3-04), vérifiée AVANT toute exécution du fichier :
  * pas de chaîne de connexion ni d'URI : interface à paramètres fermés (répertoire de socket, port, gabarit, rôles) ;
  * répertoire de socket : chemin absolu existant, sans virgule, espace, « = » ni guillemet (pas d'hôtes multiples ni d'options
    libpq injectées), contenant le fichier de socket `.s.PGSQL.<port>` ; port numérique ; noms de rôles et de gabarit [a-z0-9_] ;
  * environnement libpq neutralisé : toutes les variables PG* (PGHOST, PGHOSTADDR, PGSERVICE, PGSERVICEFILE, PGOPTIONS,
    PGDATABASE, PGSSL*…) sont retirées des processus lancés ; psql lancé avec -X (pas de psqlrc) ;
  * après connexion : serveur joint par socket (inet_server_addr nul), rôle d'administration SUPERUTILISATEUR (jamais accordé
    sur Supabase hébergé : indice fort d'une grappe locale), gabarit non système et sans connexion ;
  * le marqueur « duo-v3-disposable » est posé sur la base créée (traçabilité) ; il n'est PAS une preuve d'isolation.

Garanties, par ordre de force :
  1. AVANT exécution (garantie) : analyse lexicale complète (chaînes, identifiants entre guillemets, commentaires imbriqués,
     chaînes dollar) ; exactement une transaction de premier niveau (BEGIN en tête, COMMIT en fin) ; refus de toute autre
     commande de contrôle transactionnel, de toute méta-commande ou interpolation psql, des commandes non transactionnelles et
     des fonctions qui s'échappent de la transaction.
  2. PENDANT exécution (garantie) : BEGIN et ROLLBACK générés par l'outil ; garde « même transaction » juste avant le ROLLBACK.
  3. APRÈS exécution (détection seulement, JAMAIS une garantie) : catalogue, types et domaines, versions, séquences.

Usage : dry_run_migration.py <migration.sql> --template <gabarit> [--socket-dir /tmp] [--port 5432] [--admin-user supabase_admin]
                             [--user postgres] [--catalog fichier.sql] [--json rapport.json] [--keep]
Codes : 0 OK ; 2 refus avant exécution ; 3 transaction rompue ; 4 modification persistante détectée ; 5 la migration échoue
(annulée) ; 6 erreur de l'outil. La base jetable est détruite dans tous les cas, sauf --keep (inspection par la suite adverse)."""
import hashlib, json, os, pathlib, re, secrets, stat, subprocess, sys

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
SAFE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
SAFE_DIR = re.compile(r"^/[A-Za-z0-9_./-]*$")
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.upper().startswith("PG")}   # aucune variable libpq transmise

def validate_params(a):
    """Contrôles TEXTUELS, sans connexion. Lève Refusal."""
    if not SAFE_DIR.match(a.socket_dir) or "//" in a.socket_dir or "/../" in a.socket_dir + "/":
        raise Refusal(f"répertoire de socket « {a.socket_dir} » refusé : chemin absolu simple exigé (pas d'hôte, de virgule, d'espace ni d'option)")
    if not os.path.isdir(a.socket_dir): raise Refusal(f"répertoire de socket « {a.socket_dir} » inexistant")
    if not re.fullmatch(r"[0-9]{1,5}", a.port) or not (0 < int(a.port) < 65536): raise Refusal(f"port « {a.port} » refusé")
    sock = os.path.join(a.socket_dir, f".s.PGSQL.{a.port}")
    try: is_sock = stat.S_ISSOCK(os.stat(sock).st_mode)
    except OSError: is_sock = False
    if not is_sock: raise Refusal(f"aucun socket Unix PostgreSQL local {sock}")
    for what, v in (("gabarit", a.template), ("rôle d'administration", a.admin_user), ("rôle d'exécution", a.user)):
        if not SAFE_NAME.match(v): raise Refusal(f"{what} « {v} » refusé ([a-z0-9_] uniquement)")
    if a.template in ("postgres", "template0", "template1"): raise Refusal(f"gabarit système « {a.template} » refusé")

def conn_args(a, user, db):
    return ["-h", a.socket_dir, "-p", a.port, "-U", user, "-d", db]

def psql(a, user, db, *args, sql=None):
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", *conn_args(a, user, db), *args]
    return subprocess.run(cmd, input=sql, capture_output=True, text=True, env=CLEAN_ENV)

def create_disposable(a):
    """Contrôles après connexion, puis création de la base jetable. Renvoie (nom, faits)."""
    q = ("select coalesce(host(inet_server_addr()), 'socket'), (select rolsuper from pg_roles where rolname = current_user),"
         " current_setting('server_version'), current_setting('listen_addresses'),"
         " (select count(*) from pg_database where datname = %s), (select count(*) from pg_stat_activity where datname = %s)")
    lit = "'" + a.template + "'"                                     # nom déjà validé par SAFE_NAME
    r = psql(a, a.admin_user, "postgres", "-At", "-F", "\t", "-c", q.replace("%s", lit))
    if r.returncode: raise Refusal(f"connexion locale impossible : {r.stderr.strip()[:200]}")
    addr, superuser, ver, listen, tpl_exists, tpl_conns = r.stdout.strip().split("\t")
    if addr != "socket": raise Refusal(f"serveur joint via {addr} et non par socket Unix : refus")
    if superuser != "t": raise Refusal(f"le rôle « {a.admin_user} » n'est pas superutilisateur : grappe non contrôlée par le harnais, refus")
    if tpl_exists != "1": raise Refusal(f"gabarit « {a.template} » introuvable")
    if tpl_conns != "0": raise Refusal(f"gabarit « {a.template} » en cours d'utilisation ({tpl_conns} connexion(s))")
    name = f"dryrun_{secrets.token_hex(6)}"
    r = psql(a, a.admin_user, "postgres", "-c", f'create database "{name}" template "{a.template}" owner "{a.user}"',
             "-c", f"comment on database \"{name}\" is '{MARKER}'")
    if r.returncode: raise Refusal(f"création de la base jetable impossible : {r.stderr.strip()[:200]}")
    return name, dict(adresse=addr, superutilisateur=True, version_serveur=ver, listen_addresses=listen, base_jetable=name, gabarit=a.template)

def drop_disposable(a, name):
    psql(a, a.admin_user, "postgres", "-c", f'drop database if exists "{name}" with (force)')
    r = psql(a, a.admin_user, "postgres", "-At", "-c", f"select count(*) from pg_database where datname = '{name}'")
    return r.stdout.strip() == "0"

def observe(a, db, cat):
    r = psql(a, a.admin_user, db, "-At", "-f", str(cat)); cat_h = hashlib.sha256(r.stdout.encode()).hexdigest()[:16] if r.returncode == 0 else "erreur"
    v = psql(a, a.user, db, "-At", "-c", "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")
    s = psql(a, a.user, db, "-At", "-c", "select coalesce(string_agg(schemaname||'.'||sequencename||'='||coalesce(last_value::text,'null'), ',' order by 1), '') from pg_sequences")
    # CAT-01 : catalog_dump.sql n'inclut ni les types ni les contraintes de domaine ; relevé complémentaire.
    d = psql(a, a.user, db, "-At", "-c", "select coalesce(string_agg(n.nspname||'.'||t.typname||'|'||t.typtype::text||'|'||coalesce(pg_get_constraintdef(c.oid),''), ',' order by 1), '')"
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
    if argv and ("=" in argv[0] or "://" in argv[0]):
        print("REFUS (code 2) : chaîne de connexion refusée — l'outil crée lui-même sa base jetable (voir --template)"); return 2
    ap = argparse.ArgumentParser(add_help=True); ap.add_argument("migration")
    ap.add_argument("--template", required=True); ap.add_argument("--socket-dir", default="/tmp"); ap.add_argument("--port", default="5432")
    ap.add_argument("--admin-user", default="supabase_admin"); ap.add_argument("--user", default="postgres")
    ap.add_argument("--catalog", default=str(DEFAULT_CAT)); ap.add_argument("--json"); ap.add_argument("--keep", action="store_true")
    try: a = ap.parse_args(argv)
    except SystemExit:
        print("REFUS (code 2) : paramètres invalides"); return 2
    rep = dict(outil="dry_run_migration.py", migration=a.migration, statut=None)
    def done(code, statut, **kw):
        rep.update(statut=statut, code=code, **kw)
        if a.json: pathlib.Path(a.json).write_text(json.dumps(rep, indent=1, ensure_ascii=False))
        print(f"{statut} (code {code})" + (f" : {kw.get('motif')}" if kw.get("motif") else "")); return code
    try:
        text = pathlib.Path(a.migration).read_text(encoding="utf-8"); rep["sha256"] = hashlib.sha256(text.encode()).hexdigest()
        validate_params(a)                                            # avant toute connexion
        skip = os.environ.get("DRY_RUN_TEST_ONLY_SKIP_LEXER") == "1"   # réservé à la suite adverse (test du garde)
        body = check(text) if not skip else [s[0] for s in lex(text)][1:-1]
        db, facts = create_disposable(a); rep["cible"] = facts
    except Refusal as e:
        return done(2, "REFUS", motif=str(e))
    except (OSError, UnicodeError) as e:
        return done(6, "ERREUR OUTIL", motif=str(e))
    try:
        before = observe(a, db, a.catalog)
        script = "begin;\n" + GUARD_SET + "\n" + "\n".join(body) + "\n" + GUARD_CHECK + "\nrollback;\n"
        r = psql(a, a.user, db, sql=script)
        after = observe(a, db, a.catalog)
    finally:
        rep["base_detruite"] = None if a.keep else drop_disposable(a, db)
    rep.update(avant=before, apres=after, stderr=r.stderr[-2000:])
    seq_changed = before["sequences"] != after["sequences"]
    if "DRY_RUN_TRANSACTION_BROKEN" in r.stderr:
        return done(3, "TRANSACTION ROMPUE", motif="le corps a quitté la transaction de l'essai : des effets ont pu être validés (base jetable détruite)")
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
