#!/usr/bin/env python3
"""Suite adverse de l'essai à blanc (R2-03, R3-04, 27/11/2026). Réplique PostgreSQL locale uniquement.

Chaque cas est EXÉCUTÉ : fichier ou paramètres hostiles → code de sortie attendu de dry_run_migration.py, puis vérification sur la
base jetable CRÉÉE PAR L'OUTIL (conservée avec --keep pour inspection, puis détruite ici) de ce qui a réellement persisté.
Les identifiants D00–D31 sont ceux de la suite r3 (34 cas) ; D21–D27 sont réécrits pour la nouvelle interface sans chaîne de
connexion (même intention : cible persistante ou implicite refusée) ; D32–D41 et D99 sont ajoutés pour R3-04.

Usage : python3 test_dry_run_adversarial.py <gabarit b005> <label>
        DRYRUN_EXTRA_MIGRATIONS=<dossier contenant lot 3 et M2> pour exercer D00b/D00c depuis la branche 006r1."""
import json, os, pathlib, subprocess, sys, time
import psycopg

H = pathlib.Path(__file__).resolve().parent; ROOT = H.parents[3]
TOOL = ROOT / "v3/database/tools/dry_run_migration.py"; MIG = ROOT / "supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql"
EXTRA = pathlib.Path(os.environ.get("DRYRUN_EXTRA_MIGRATIONS", ROOT / "supabase/migrations"))
TPL, LABEL = sys.argv[1], sys.argv[2]
HOST, PORT = "/tmp", "54317"
RESULTS = []; TMP = pathlib.Path("/tmp/dryrun_adv"); TMP.mkdir(exist_ok=True)

def adm(sql, db="postgres"):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c: c.execute(sql)
def q(sql, db, args=()):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db) as c: return c.execute(sql, args).fetchone()
def leftovers(): return q("select count(*) from pg_database where datname like 'dryrun\\_%%'", "postgres")[0]
def tool(sql_text, path=None, args=None, env_extra=None, keep=True):
    f = path or (TMP / "case.sql")
    if path is None and sql_text is not None: f.write_text(sql_text)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}; env.update(env_extra or {})
    base = args if args is not None else [str(f), "--template", TPL, "--socket-dir", HOST, "--port", PORT]
    cmd = [sys.executable, str(TOOL), *base, "--json", str(TMP / "rep.json")] + (["--keep"] if keep and args is None else [])
    (TMP / "rep.json").unlink(missing_ok=True)
    t0 = time.monotonic(); r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    rep = json.loads((TMP / "rep.json").read_text()) if (TMP / "rep.json").exists() else {}
    out = (r.stdout + r.stderr).strip().splitlines()
    return r.returncode, out[-1] if out else "", time.monotonic() - t0, rep
def inspect_and_drop(rep, rel="public.adv_witness"):
    db = (rep.get("cible") or {}).get("base_jetable")
    if not db: return None
    try: present = q("select to_regclass(%s) is not null", db, (rel,))[0]
    except psycopg.Error: present = None
    adm(f'drop database if exists "{db}" with (force)'); return present
def record(cid, title, expected, code, out, ok, extra=""):
    s = "Réussi" if ok else "Échoué"; RESULTS.append(dict(id=cid, cas=title, attendu=expected, code=code, sortie=out[:220], complement=extra, statut=s))
    print(f"{cid:5} {s:7} code={code} {out[:110]} {extra}", flush=True)

W = "create table public.adv_witness(x int);"
def case(cid, title, sql, exp_code, expect_witness=False, **kw):
    code, out, dt, rep = tool(sql, **kw); w = bool(inspect_and_drop(rep))
    record(cid, title, f"code {exp_code} ; témoin {'présent' if expect_witness else 'absent'}", code, out, code == exp_code and w == expect_witness, f"témoin={'présent' if w else 'absent'}")

def run():
    # ------------------------------------------------------------------ référence (migrations réelles)
    code, out, dt, rep = tool(None, path=MIG); inspect_and_drop(rep)
    record("D00", "006r1 réelle, base jetable créée depuis b005", "code 0 ; catalogue inchangé", code, out,
           code == 0 and rep.get("avant", {}).get("catalogue") == rep.get("apres", {}).get("catalogue"))
    for cid, tpl, f, prep in (("D00b", "s1", "20261126130000_duo_v3_membership_lifecycle.sql", "alter table auth.users add column if not exists email_confirmed_at timestamptz"),
                              ("D00c", "s2", "20261126140000_duo_v3_funds_ledger.sql", None)):
        mf = EXTRA / f
        if not mf.exists():
            record(cid, f"{f} sur gabarit {tpl}", "—", "-", "sans objet (migration absente)", True); RESULTS[-1]["statut"] = "Sans objet"; continue
        gt = f"adv_tpl_{cid.lower()}"; adm(f'drop database if exists "{gt}" with (force)'); adm(f'create database "{gt}" template "{tpl}" owner postgres')
        if prep: adm(prep, gt)
        code, out, dt, rep = tool(None, args=[str(mf), "--template", gt, "--socket-dir", HOST, "--port", PORT, "--keep"]); inspect_and_drop(rep)
        adm(f'drop database if exists "{gt}" with (force)')
        record(cid, f"{f.split('_', 1)[1][:40]} réelle (gabarit {tpl})", "code 0 ; catalogue inchangé", code, out,
               code == 0 and rep.get("avant", {}).get("catalogue") == rep.get("apres", {}).get("catalogue"))
    # ------------------------------------------------------------------ contrôle transactionnel caché ou déguisé
    case("D01", "END; de premier niveau", f"begin;\n{W}\nend;\nselect 1;\ncommit;\n", 2)
    case("D02", "END WORK", f"begin;\n{W}\nEND WORK;\ncommit;\n", 2)
    case("D03", "COMMIT AND CHAIN en fin", f"begin;\n{W}\ncommit and chain;\n", 2)
    case("D04", "CoMmIt ; casse mixte puis nouvelle transaction", f"begin;\n{W}\n  CoMmIt  ;\nbegin;\ncommit;\n", 2)
    case("D05", "Deux transactions", f"begin;\n{W}\ncommit;\nbegin;\nselect 1;\ncommit;\n", 2)
    case("D06", "Instruction après le COMMIT final", f"begin;\nselect 1;\ncommit;\n{W}\n", 2)
    case("D07", "BEGIN absent", f"{W}\ncommit;\n", 2)
    case("D08", "SAVEPOINT / RELEASE", f"begin;\nsavepoint a;\n{W}\nrelease a;\ncommit;\n", 2)
    case("D09", "PREPARE TRANSACTION", f"begin;\n{W}\nprepare transaction 'x';\ncommit;\n", 2)
    case("D10", "COMMIT dans un bloc DO", "begin;\ndo $$ begin commit; end $$;\ncommit;\n", 2)
    case("D11", "Inclusion psql « \\i » (geste naïf REV-08)", f"begin;\n\\i {MIG}\ncommit;\n", 2)
    case("D12", "Méta-commande « \\gexec »", "begin;\nselect 'commit' \\gexec\ncommit;\n", 2)
    case("D13", "Interpolation psql :'DBNAME'", "begin;\nselect :'DBNAME';\ncommit;\n", 2)
    case("D14", "dblink_exec", "begin;\nselect dblink_exec('dbname=postgres', 'create table t()');\ncommit;\n", 2)
    case("D15", "CREATE DATABASE", "begin;\ncreate database adv_x;\ncommit;\n", 2)
    case("D16", "ALTER SYSTEM", "begin;\nalter system set work_mem = '64MB';\ncommit;\n", 2)
    case("D17", "COPY … TO PROGRAM", "begin;\ncopy (select 1) to program 'true';\ncommit;\n", 2)
    case("D18", "nextval au premier niveau", "begin;\nselect nextval('x');\ncommit;\n", 2)
    case("D19", "dblink caché dans un bloc DO", "begin;\ndo $b$ begin perform dblink_exec('dbname=postgres','select 1'); end $b$;\ncommit;\n", 2)
    case("D20", "« commit; » dans chaînes, identifiants, commentaires imbriqués, chaînes dollar : accepté",
         "begin;\n-- commit;\n/* commit; /* imbriqué end; */ rollback; */\ncreate table public.adv_ok(\"commit;\" text default 'commit; end;');\n"
         "create function public.adv_f() returns int language plpgsql as $f$ begin return 1; end; $f$;\n"
         "select E'it\\'s commit;' as a, $q$end;$q$ as b;\ncommit;\n", 0)
    # ------------------------------------------------------------------ R3-04 : cibles persistantes, implicites ou injectées (refus SANS connexion)
    ok_sql = TMP / "ok.sql"; ok_sql.write_text("begin;\nselect 1;\ncommit;\n")
    for cid, args, why in (
        ("D21", ["host=db.abcdefghij.supabase.co port=5432 user=postgres dbname=postgres", str(ok_sql)], "chaîne de connexion Supabase en position 1"),
        ("D22", ["postgresql://postgres@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?hostaddr=203.0.113.10", str(ok_sql)], "URI pooler avec hostaddr"),
        ("D23", [str(ok_sql), "--template", TPL, "--socket-dir", "db.abcdefghij.supabase.co", "--port", PORT], "répertoire de socket = nom d'hôte"),
        ("D25", [str(ok_sql), "--template", TPL, "--socket-dir", "/tmp,db.abcdefghij.supabase.co", "--port", PORT], "hôtes multiples (virgule)"),
        ("D26", [str(ok_sql), "--template", "postgres", "--socket-dir", HOST, "--port", PORT], "gabarit système postgres"),
        ("D27", [str(ok_sql), "--template", TPL, "--socket-dir", "/nonexistent", "--port", PORT], "répertoire de socket inexistant"),
        ("D32", [str(ok_sql), "--template", TPL, "--socket-dir", "/tmp host=db.abcdefghij.supabase.co", "--port", PORT], "injection d'option libpq par espace"),
        ("D33", [str(ok_sql), "--template", TPL, "--socket-dir", HOST, "--port", "54317 hostaddr=203.0.113.10"], "injection hostaddr dans le port"),
        ("D34", [str(ok_sql), "--template", "b005' dbname=dev", "--socket-dir", HOST, "--port", PORT], "injection dans le nom de gabarit"),
        ("D35", [str(ok_sql), "--template", TPL, "--socket-dir", "/var", "--port", PORT], "répertoire sans socket PostgreSQL"),
        ("D36", [str(ok_sql), "--template", "template0", "--socket-dir", HOST, "--port", PORT], "gabarit template0"),
        ("D37", [str(ok_sql), "--template", TPL, "--socket-dir", HOST, "--port", PORT, "--admin-user", "postgres"], "rôle d'administration non superutilisateur (grappe non contrôlée)"),
        ("D38", ["host=/tmp dbname=b005", str(ok_sql)], "chaîne de connexion locale (refusée aussi : l'outil crée sa base)"),
    ):
        n0 = leftovers(); code, out, dt, rep = tool(None, args=args)
        record(cid, f"Cible refusée : {why}", "code 2 ; aucune base créée", code, out, code == 2 and "cible" not in rep and leftovers() == n0, f"durée={dt:.2f}s")
    # ------------------------------------------------------------------ R3-04 : environnement libpq hostile IGNORÉ
    svc = TMP / "pg_service.conf"; svc.write_text("[dev]\nhost=203.0.113.10\nport=5432\ndbname=postgres\n")
    hostile = {"PGHOST": "db.abcdefghij.supabase.co", "PGHOSTADDR": "203.0.113.10", "PGPORT": "6543", "PGDATABASE": "prod", "PGUSER": "dev",
               "PGSERVICE": "dev", "PGSERVICEFILE": str(svc), "PGOPTIONS": "-c default_transaction_read_only=on", "PGSSLMODE": "require",
               "PGTARGETSESSIONATTRS": "read-write", "PGCONNECT_TIMEOUT": "30"}
    code, out, dt, rep = tool(f"begin;\n{W}\ncommit;\n", env_extra=hostile); w = inspect_and_drop(rep)
    record("D24", "Variables libpq hostiles (PGHOST, PGHOSTADDR, PGSERVICE/PGSERVICEFILE, PGOPTIONS lecture seule, PGSSLMODE…) : ignorées",
           "code 0 via socket local en < 10 s ; aucune connexion distante ; témoin absent", code, out,
           code == 0 and (rep.get("cible") or {}).get("adresse") == "socket" and dt < 10 and not w, f"durée={dt:.2f}s adresse={(rep.get('cible') or {}).get('adresse')}")
    # ------------------------------------------------------------------ cycle de vie de la base jetable
    n0 = leftovers()
    for sql in (f"begin;\n{W}\ncommit;\n", f"begin;\n{W}\nselect 1/0;\ncommit;\n"): tool(sql, keep=False)
    n1 = leftovers()
    record("D39", "Base jetable détruite après succès et après échec (sans --keep)", "0 base dryrun_* restante", "-", f"avant={n0} après={n1}", n1 == n0 == 0)
    code, out, dt, rep = tool("begin;\nselect 1;\ncommit;\n"); db = (rep.get("cible") or {}).get("base_jetable")
    comment = q("select shobj_description(oid, 'pg_database') from pg_database where datname = %s", "postgres", (db,))[0] if db else None
    inspect_and_drop(rep)
    record("D40", "Base créée par l'outil : nom aléatoire, marqueur de traçabilité posé (non utilisé comme preuve)", "dryrun_<hex> ; marqueur",
           code, f"base={db} marqueur={comment!r}", code == 0 and bool(db) and db.startswith("dryrun_") and comment == "duo-v3-disposable")
    adm("drop database if exists adv_busy with (force)"); adm(f'create database adv_busy template "{TPL}" owner postgres')
    holder = psycopg.connect(host=HOST, port=PORT, user="postgres", dbname="adv_busy")
    try: code, out, dt, rep = tool(None, args=[str(ok_sql), "--template", "adv_busy", "--socket-dir", HOST, "--port", PORT])
    finally: holder.close(); adm("drop database if exists adv_busy with (force)")
    record("D41", "Gabarit en cours d'utilisation (connexion ouverte)", "code 2", code, out, code == 2)
    # ------------------------------------------------------------------ garde de transaction (analyse lexicale volontairement contournée)
    code, out, dt, rep = tool(f"begin;\n{W}\nend;\nselect 1;\ncommit;\n", env_extra={"DRY_RUN_TEST_ONLY_SKIP_LEXER": "1"}); w = inspect_and_drop(rep)
    record("D28", "Analyse lexicale contournée (test) : END; valide la table témoin ; le GARDE le détecte",
           "code 3 ; témoin PRÉSENT (la détection a posteriori ne garantit rien)", code, out, code == 3 and bool(w), f"témoin={'présent' if w else 'absent'}")
    # ------------------------------------------------------------------ effets non transactionnels non visibles lexicalement
    adm("drop database if exists adv_tpl_seq with (force)"); adm(f'create database adv_tpl_seq template "{TPL}" owner postgres')
    adm("create sequence public.adv_seq; create table public.adv_ident(id bigint default nextval('public.adv_seq'), v int); grant all on public.adv_seq, public.adv_ident to postgres", "adv_tpl_seq")
    f = TMP / "seq.sql"; f.write_text("begin;\ninsert into public.adv_ident(v) values (1), (2), (3);\ncommit;\n")
    code, out, dt, rep = tool(None, args=[str(f), "--template", "adv_tpl_seq", "--socket-dir", HOST, "--port", PORT, "--keep"])
    db = (rep.get("cible") or {}).get("base_jetable"); s1 = q("select coalesce(last_value, 0) from pg_sequences where sequencename = 'adv_seq'", db)[0] if db else None
    inspect_and_drop(rep); adm("drop database if exists adv_tpl_seq with (force)")
    record("D29", "Séquence avancée par un INSERT (non visible lexicalement) : annulé mais séquence NON restaurée",
           "code 0 avec réserve « effet non transactionnel » ; last_value avancée", code, out, code == 0 and "NON TRANSACTIONNEL" in out and s1 == 3, f"séquence 0→{s1}")
    # ------------------------------------------------------------------ défense côté serveur
    case("D30", "Migration en échec au milieu (division par zéro)", f"begin;\n{W}\nselect 1/0;\ncommit;\n", 5)
    adm("drop database if exists adv_tpl_proc with (force)"); adm(f'create database adv_tpl_proc template "{TPL}" owner postgres')
    adm("create procedure public.adv_p() language plpgsql as $$ begin create table public.adv_witness(x int); commit; end $$; grant execute on procedure public.adv_p() to postgres", "adv_tpl_proc")
    f = TMP / "call.sql"; f.write_text("begin;\ncall public.adv_p();\ncommit;\n")
    code, out, dt, rep = tool(None, args=[str(f), "--template", "adv_tpl_proc", "--socket-dir", HOST, "--port", PORT, "--keep"]); w = inspect_and_drop(rep)
    adm("drop database if exists adv_tpl_proc with (force)")
    record("D31", "CALL d'une procédure qui fait COMMIT : refusé par le serveur dans la transaction de l'essai",
           "code 5 « invalid transaction termination » ; témoin absent", code, out, code == 5 and not w and "transaction termination" in json.dumps(rep), f"témoin={'présent' if w else 'absent'}")
    record("D99", "Aucune base jetable résiduelle en fin de suite", "0", "-", f"restantes={leftovers()}", leftovers() == 0)

if __name__ == "__main__":
    try: run()
    except Exception as e:
        import traceback; record("ERR", "exécution", "aucune erreur", -1, f"{type(e).__name__}: {e}", False, traceback.format_exc()[-400:])
    s = {}
    for r in RESULTS: s[r["statut"]] = s.get(r["statut"], 0) + 1
    (H / "results").mkdir(exist_ok=True)
    (H / "results" / f"{LABEL}.json").write_text(json.dumps(dict(label=LABEL, gabarit=TPL, outil_sha256=__import__("hashlib").sha256(TOOL.read_bytes()).hexdigest(), bilan=s, resultats=RESULTS), indent=1, ensure_ascii=False))
    print(json.dumps(s, ensure_ascii=False))
