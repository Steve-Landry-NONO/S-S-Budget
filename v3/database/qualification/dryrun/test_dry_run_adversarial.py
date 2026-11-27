#!/usr/bin/env python3
"""Suite adverse de l'essai à blanc (R2-03, 27/11/2026). Bases PostgreSQL JETABLES locales uniquement.

Chaque cas est EXÉCUTÉ : fichier hostile → code de sortie attendu de dry_run_migration.py, puis vérification, sur la base
jetable, de ce qui a réellement persisté (table témoin, catalogue). Aucune connexion distante n'est tentée : les cibles
distantes sont refusées par analyse textuelle de la chaîne de connexion (durée mesurée).

Usage : python3 test_dry_run_adversarial.py <gabarit b005> <label>"""
import json, os, pathlib, subprocess, sys, time
import psycopg

H = pathlib.Path(__file__).resolve().parent; ROOT = H.parents[3]
TOOL = ROOT / "v3/database/tools/dry_run_migration.py"; MIG = ROOT / "supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql"
TPL, LABEL = sys.argv[1], sys.argv[2]
HOST, PORT, DB = "/tmp", "54317", "dryrun_adv"
CONN = f"host={HOST} port={PORT} user=postgres dbname={DB}"
RESULTS = []; TMP = pathlib.Path("/tmp/dryrun_adv"); TMP.mkdir(exist_ok=True)

def adm(sql, db="postgres"):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c: c.execute(sql)
def fresh(marker=True, name=DB):
    adm(f'drop database if exists "{name}" with (force)'); adm(f'create database "{name}" template "{TPL}" owner postgres')
    if marker: adm(f"comment on database \"{name}\" is 'duo-v3-disposable'")
def exists(rel, name=DB):
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=name) as c: return c.execute("select to_regclass(%s) is not null", (rel,)).fetchone()[0]
def seq(name=DB):
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=name) as c: return c.execute("select coalesce(last_value, 0) from pg_sequences where sequencename = 'adv_seq'").fetchone()
def tool(sql_text, conn=CONN, env_extra=None, path=None):
    f = path or (TMP / "case.sql")
    if path is None: f.write_text(sql_text)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}; env.update(env_extra or {})
    t0 = time.monotonic(); r = subprocess.run([sys.executable, str(TOOL), conn, str(f), "--json", str(TMP / "rep.json")], capture_output=True, text=True, env=env)
    rep = json.loads((TMP / "rep.json").read_text()) if (TMP / "rep.json").exists() else {}
    (TMP / "rep.json").unlink(missing_ok=True)
    return r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else "", time.monotonic() - t0, rep
def record(cid, title, expected, code, out, ok, extra=""):
    s = "Réussi" if ok else "Échoué"; RESULTS.append(dict(id=cid, cas=title, attendu=expected, code=code, sortie=out[:220], complement=extra, statut=s))
    print(f"{cid:5} {s:7} code={code} {out[:110]} {extra}", flush=True)

W = "create table public.adv_witness(x int);"          # table témoin : si elle persiste, l'essai n'a pas été annulé
def case(cid, title, sql, exp_code, expect_witness=False, **kw):
    fresh(); code, out, dt, rep = tool(sql, **kw)
    w = exists("public.adv_witness")
    record(cid, title, f"code {exp_code} ; témoin {'présent' if expect_witness else 'absent'}", code, out, code == exp_code and w == expect_witness, f"témoin={'présent' if w else 'absent'}")

def run():
    # ------------------------------------------------------------------ référence
    fresh(); code, out, dt, rep = tool(None, path=MIG)
    record("D00", "006r1 réelle sur base jetable b005 marquée", "code 0 ; catalogue inchangé ; aucune table 006", code, out,
           code == 0 and not exists("public.duo_v3_periods") and rep.get("avant", {}).get("catalogue") == rep.get("apres", {}).get("catalogue"))
    for cid, tpl, f, prep in (("D00b", "s1", "20261126130000_duo_v3_membership_lifecycle.sql", "alter table auth.users add column if not exists email_confirmed_at timestamptz"),
                              ("D00c", "s2", "20261126140000_duo_v3_funds_ledger.sql", None)):
        if not (ROOT / "supabase/migrations" / f).exists():
            record(cid, f"{f} sur base jetable {tpl}", "—", "-", "sans objet sur cette branche (migration absente)", True); RESULTS[-1]["statut"] = "Sans objet"; continue
        adm(f'drop database if exists "{DB}" with (force)'); adm(f'create database "{DB}" template "{tpl}" owner postgres'); adm(f"comment on database \"{DB}\" is 'duo-v3-disposable'")
        if prep: adm(prep, DB)
        code, out, dt, rep = tool(None, path=ROOT / "supabase/migrations" / f)
        record(cid, f"{f.split('_', 1)[1][:40]} réelle sur base jetable {tpl} marquée", "code 0 ; catalogue inchangé", code, out,
               code == 0 and rep.get("avant", {}).get("catalogue") == rep.get("apres", {}).get("catalogue"))
    # ------------------------------------------------------------------ contrôle transactionnel caché ou déguisé
    case("D01", "END; de premier niveau (synonyme de COMMIT)", f"begin;\n{W}\nend;\nselect 1;\ncommit;\n", 2)
    case("D02", "END TRANSACTION / END WORK", f"begin;\n{W}\nEND WORK;\ncommit;\n", 2)
    case("D03", "COMMIT AND CHAIN en fin de fichier", f"begin;\n{W}\ncommit and chain;\n", 2)
    case("D04", "CoMmIt ; en casse mixte au milieu puis nouvelle transaction", f"begin;\n{W}\n  CoMmIt  ;\nbegin;\ncommit;\n", 2)
    case("D05", "Deux transactions", f"begin;\n{W}\ncommit;\nbegin;\nselect 1;\ncommit;\n", 2)
    case("D06", "Instruction après le COMMIT final", f"begin;\nselect 1;\ncommit;\n{W}\n", 2)
    case("D07", "BEGIN absent", f"{W}\ncommit;\n", 2)
    case("D08", "ROLLBACK / SAVEPOINT / RELEASE / PREPARE TRANSACTION au premier niveau", f"begin;\nsavepoint a;\n{W}\nrelease a;\ncommit;\n", 2)
    case("D09", "PREPARE TRANSACTION", f"begin;\n{W}\nprepare transaction 'x';\ncommit;\n", 2)
    case("D10", "COMMIT dans un bloc DO", f"begin;\ndo $$ begin commit; end $$;\ncommit;\n", 2)
    # ------------------------------------------------------------------ psql
    case("D11", "Inclusion psql « \\i » (geste naïf REV-08)", f"begin;\n\\i {MIG}\ncommit;\n", 2)
    case("D12", "Méta-commande shell « \\! » et « \\gexec »", f"begin;\nselect 'commit' \\gexec\ncommit;\n", 2)
    case("D13", "Interpolation de variable psql :DBNAME", "begin;\nselect :'DBNAME';\ncommit;\n", 2)
    # ------------------------------------------------------------------ non transactionnel / échappement
    case("D14", "dblink_exec (écriture sur une autre connexion)", "begin;\nselect dblink_exec('dbname=postgres', 'create table t()');\ncommit;\n", 2)
    case("D15", "CREATE DATABASE", "begin;\ncreate database adv_x;\ncommit;\n", 2)
    case("D16", "VACUUM / ALTER SYSTEM / CREATE INDEX CONCURRENTLY", "begin;\nalter system set work_mem = '64MB';\ncommit;\n", 2)
    case("D17", "COPY … TO PROGRAM", "begin;\ncopy (select 1) to program 'true';\ncommit;\n", 2)
    case("D18", "nextval / setval exécutés au premier niveau", "begin;\nselect nextval('x');\ncommit;\n", 2)
    case("D19", "dblink caché dans un bloc DO", "begin;\ndo $b$ begin perform dblink_exec('dbname=postgres','select 1'); end $b$;\ncommit;\n", 2)
    # ------------------------------------------------------------------ absence de faux positifs
    case("D20", "« commit; » dans une chaîne, un identifiant, des commentaires et une chaîne dollar : accepté",
         "begin;\n-- commit;\n/* commit; /* imbriqué end; */ rollback; */\ncreate table public.adv_ok(\"commit;\" text default 'commit; end;');\n"
         "create function public.adv_f() returns int language plpgsql as $f$ begin return 1; end; $f$;\n"
         "select E'it\\'s commit;' as a, $q$end;$q$ as b;\ncommit;\n", 0)
    # ------------------------------------------------------------------ cibles persistantes : refus SANS connexion
    for cid, conn, why in (("D21", "host=db.abcdefghij.supabase.co port=5432 user=postgres dbname=postgres", "hôte Supabase"),
                           ("D22", "postgresql://postgres@aws-0-eu-west-3.pooler.supabase.com:6543/postgres", "pooler Supabase (URI)"),
                           ("D23", "host=203.0.113.10 port=5432 dbname=prod", "adresse distante"),
                           ("D24", "port=5432 dbname=duo", "hôte implicite (PGHOST)")):
        code, out, dt, rep = tool("begin;\nselect 1;\ncommit;\n", conn=conn, env_extra={"PGHOST": "db.example.supabase.co"} if cid == "D24" else None)
        record(cid, f"Cible persistante refusée avant connexion : {why}", "code 2 ; < 1 s ; aucune connexion", code, out, code == 2 and dt < 1.0 and "cible" not in rep, f"durée={dt:.2f}s")
    fresh(marker=False); code, out, dt, rep = tool("begin;\nselect 1;\ncommit;\n")
    record("D25", "Base locale SANS marqueur « duo-v3-disposable »", "code 2", code, out, code == 2)
    code, out, dt, rep = tool("begin;\nselect 1;\ncommit;\n", conn=f"host={HOST} port={PORT} user=postgres dbname=postgres")
    record("D26", "Base système « postgres »", "code 2", code, out, code == 2)
    code, out, dt, rep = tool("begin;\nselect 1;\ncommit;\n", conn=f"host={HOST} port={PORT} user=postgres dbname={DB}", env_extra={"PGSERVICE": "dev"})
    record("D27", "PGSERVICE défini (cible implicite)", "code 2", code, out, code == 2)
    # ------------------------------------------------------------------ garde de transaction (analyse lexicale volontairement contournée)
    fresh(); code, out, dt, rep = tool(f"begin;\n{W}\nend;\nselect 1;\ncommit;\n", env_extra={"DRY_RUN_TEST_ONLY_SKIP_LEXER": "1"})
    w = exists("public.adv_witness")
    record("D28", "Analyse lexicale contournée (test) : END; valide la table témoin ; le GARDE le détecte",
           "code 3 « TRANSACTION ROMPUE » ; témoin PRÉSENT (preuve que la détection a posteriori n'est pas une garantie)", code, out, code == 3 and w, f"témoin={'présent' if w else 'absent'}")
    # ------------------------------------------------------------------ effets non transactionnels non visibles lexicalement
    fresh(); adm("create sequence public.adv_seq; create table public.adv_ident(id bigint default nextval('public.adv_seq'), v int); grant all on public.adv_seq, public.adv_ident to postgres", DB)
    s0 = seq(); code, out, dt, rep = tool("begin;\ninsert into public.adv_ident(v) values (1), (2), (3);\ncommit;\n"); s1 = seq()
    record("D29", "Séquence avancée par un INSERT (non visible lexicalement) : annulé mais séquence NON restaurée",
           "code 0 avec réserve « effet non transactionnel » ; last_value avancée (raison du refus des bases persistantes)", code, out,
           code == 0 and "NON TRANSACTIONNEL" in out and s1 != s0, f"séquence {s0}→{s1}")
    # ------------------------------------------------------------------ défense côté serveur
    case("D30", "Migration en échec au milieu (division par zéro)", f"begin;\n{W}\nselect 1/0;\ncommit;\n", 5)
    fresh(); adm("create procedure public.adv_p() language plpgsql as $$ begin create table public.adv_witness(x int); commit; end $$; grant execute on procedure public.adv_p() to postgres", DB)
    code, out, dt, rep = tool("begin;\ncall public.adv_p();\ncommit;\n"); w = exists("public.adv_witness")
    record("D31", "CALL d'une procédure qui fait COMMIT : refusé par le serveur dans la transaction de l'essai",
           "code 5 « invalid transaction termination » ; témoin absent", code, out, code == 5 and not w and "transaction termination" in json.dumps(rep), f"témoin={'présent' if w else 'absent'}")
    adm(f'drop database if exists "{DB}" with (force)')

if __name__ == "__main__":
    try: run()
    except Exception as e:
        import traceback; record("ERR", "exécution", "aucune erreur", -1, f"{type(e).__name__}: {e}", False, traceback.format_exc()[-400:])
    s = {}
    for r in RESULTS: s[r["statut"]] = s.get(r["statut"], 0) + 1
    (H / "results").mkdir(exist_ok=True)
    (H / "results" / f"{LABEL}.json").write_text(json.dumps(dict(label=LABEL, gabarit=TPL, outil_sha256=__import__("hashlib").sha256(TOOL.read_bytes()).hexdigest(), bilan=s, resultats=RESULTS), indent=1, ensure_ascii=False))
    print(json.dumps(s, ensure_ascii=False))
