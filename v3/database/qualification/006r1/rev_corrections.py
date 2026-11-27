#!/usr/bin/env python3
"""Tests de reproduction et de correction — REV-01, REV-08, G13, états intermédiaires (26/11/2026).

Chaque anomalie a un test de REPRODUCTION (qui montre le défaut sur la version publiée, ou sur le geste fautif)
et un test de CORRECTION (sur la version corrigée). Réplique PostgreSQL jetable uniquement.

Usage : python3 rev_corrections.py <gabarit_publié s1> <gabarit_corrigé c1> <label>
  - s1 : 001→005 + 006r1 telle que publiée (90e2274)
  - c1 : 001→005 + 006r1 corrigée (ce commit)
Les migrations sont lues depuis le dépôt (chemins relatifs à ce fichier)."""
import json, sys, uuid, subprocess, pathlib, os
import psycopg

H = pathlib.Path(__file__).resolve().parent; ROOT = H.parents[3]
PUB, COR, LABEL = sys.argv[1], sys.argv[2], sys.argv[3]
MIG = ROOT / "supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql"
LOT3 = ROOT / "supabase/migrations/20261126130000_duo_v3_membership_lifecycle.sql"
FUNDS = ROOT / "supabase/migrations/20261126140000_duo_v3_funds_ledger.sql"
CAT = H / "sql/catalog_dump.sql"; TOOL = ROOT / "v3/database/tools/dry_run_migration.sh"
HOST, PORT = "/tmp", "54317"
RESULTS = []
def record(sid, kind, rule, expected, observed, ok):
    s = "Réussi" if ok else "Échoué"
    RESULTS.append(dict(id=sid, nature=kind, regle=rule, attendu=expected, observe=observed, statut=s)); print(f"{sid:9} {s:7} {observed[:140]}", flush=True)
def adm(sql):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="postgres", autocommit=True) as c: c.execute(sql)
def fresh(db, tpl): adm(f'drop database if exists "{db}" with (force)'); adm(f'create database "{db}" template "{tpl}" owner postgres')
def psql(db, *args, user="postgres"):
    return subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", user, "-d", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", *args], capture_output=True, text=True)
def catalog(db): return __import__("hashlib").sha256(psql(db, "-At", "-f", str(CAT), user="supabase_admin").stdout.encode()).hexdigest()[:16]
def conn(db): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=db)
def claims(cur, sub):
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "authenticated", "sub": sub, "aud": "authenticated", "is_anonymous": False}),))
    cur.execute("set local role authenticated")

def duo(db, currency="EUR"):
    u = str(uuid.uuid4()); h = str(uuid.uuid4())
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=db, autocommit=True) as c:
        c.execute("insert into auth.users(id,aud,role,email,is_anonymous) values (%s,'authenticated','authenticated',%s,false)", (u, f"{u[:8]}@example.invalid"))
        c.execute("insert into public.duo_v3_households(id,currency) values (%s,%s)", (h, currency))
        c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner')", (h, u))
        c.execute("select duo_v3_private.bootstrap_household(%s)", (h,))
        starts = c.execute("select starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()[0]
        e = str(c.execute("select duo_v3_private.create_envelope(%s,'Big',true)", (h,)).fetchone()[0])
        c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, 100, starts))
        c.execute("select duo_v3_private.post_period_allocations(%s,(select id from public.duo_v3_periods where household_id=%s and state='open'))", (h, h))
    return u, h, e

def snapshot_raw(db, u, h):
    """Texte JSON brut tel que transporté par PostgREST (jsonb → texte)."""
    with conn(db) as c:
        with c.cursor() as cur:
            claims(cur, u); cur.execute("select public.duo_v3_get_envelope_snapshot(%s)::text", (h,)); return cur.fetchone()[0]

def numbers_in(txt):
    found = []
    json.loads(txt, parse_int=lambda s: found.append(s) or int(s), parse_float=lambda s: found.append(s) or float(s))
    return found

def run():
    BIG = 9007199254740993            # 2^53 + 1 : non représentable exactement en double IEEE 754 (JavaScript Number)
    # ------------------------------------------------------------------------------------------ REV-01
    for db, kind in ((PUB, "reproduction"), (COR, "correction")):
        fresh("rev_t", db)
        for cur_code in ("EUR", "XAF", "USD"):
            u, h, e = duo("rev_t", cur_code)
            with conn("rev_t") as c:
                with c.cursor() as cur:
                    claims(cur, u)
                    cur.execute("select public.duo_v3_post_contribution(%s,%s,current_date,'big')", (h, 2 * BIG + 1))   # trésorerie finale = BIG + 2 (impair > 2^53)
                    cur.execute("select public.duo_v3_post_expense(%s,%s,%s,current_date,'neg')", (h, e, BIG - 1))   # solde budgétaire très négatif
                c.commit()
            txt = snapshot_raw("rev_t", u, h); nums = numbers_in(txt); j = json.loads(txt)
            cash = j["position"]["cash_minor"]; bb = j["envelopes"][0]["budgetBalance"]
            if kind == "reproduction":
                lost = int(float(BIG + 2)) != BIG + 2 and not isinstance(cash, str)   # la valeur exacte ne survit pas à un double
                record(f"REV01-R-{cur_code}", kind, "REV-01 : la position et ledgerVersion sont des NOMBRES JSON dans la version publiée",
                       "nombres JSON présents ; 2^53+1 non représentable en double", f"nombres={nums[:4]} cash={cash!r} (attendu {BIG + 2}) perte_en_double={lost}",
                       len(nums) > 0 and not isinstance(cash, str) and cash == BIG + 2 and lost)
            else:
                exp_bb = str(100 - (BIG - 1))
                record(f"REV01-C-{cur_code}", kind, "REV-01 : aucun nombre JSON ; montants et compteurs en chaînes d'entiers exactes (positifs, négatifs)",
                       f"0 nombre ; cash='{BIG + 2}' ; budgetBalance='{exp_bb}' ; ledgerVersion chaîne", f"nombres={nums} cash={cash!r} budgetBalance={bb!r} ledgerVersion={j['ledgerVersion']!r}",
                       nums == [] and cash == str(BIG + 2) and bb == exp_bb and isinstance(j["ledgerVersion"], str) and j["ledgerVersion"].isdigit())
    # ------------------------------------------------------------------------------------------ REV-08
    fresh("rev_t", "b005"); before = catalog("rev_t")
    naive = pathlib.Path("/tmp/rev08_naive.sql"); naive.write_text(f"begin;\n\\i {MIG}\nrollback;\n")
    r = psql("rev_t", "-f", str(naive)); after = catalog("rev_t")
    present = psql("rev_t", "-At", "-c", "select count(*) from pg_tables where tablename='duo_v3_periods'").stdout.strip()
    record("REV08-R", "reproduction", "REV-08 : « begin; \\i migration; rollback; » NE l'annule PAS (le COMMIT du fichier valide)",
           "catalogue modifié ; tables 006 présentes", f"rc={r.returncode} catalogue {before}→{after} duo_v3_periods={present} avertissement={'no transaction in progress' in r.stderr}",
           before != after and present == "1")
    fresh("rev_t", "b005"); before = catalog("rev_t")
    adm("comment on database rev_t is 'duo-v3-disposable'")          # R2-03 : l'outil n'accepte qu'une base jetable marquée
    t = subprocess.run(["sh", str(TOOL), f"host={HOST} port={PORT} user=postgres dbname=rev_t", str(MIG), "--catalog", str(CAT)], capture_output=True, text=True)
    after = catalog("rev_t"); present = psql("rev_t", "-At", "-c", "select count(*) from pg_tables where tablename='duo_v3_periods'").stdout.strip()
    record("REV08-C", "correction", "REV-08 : dry_run_migration.sh exécute le corps puis ROLLBACK ; catalogue et versions inchangés",
           "rc 0 ; « ESSAI À BLANC OK » ; catalogue identique ; aucune table 006", f"rc={t.returncode} {t.stdout.strip().splitlines()[-1] if t.stdout.strip() else t.stderr[-120:]} catalogue {before}→{after} duo_v3_periods={present}",
           t.returncode == 0 and before == after and present == "0" and "ESSAI À BLANC OK" in t.stdout)
    bad = pathlib.Path("/tmp/rev08_two_commits.sql"); bad.write_text("begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;\n")
    t2 = subprocess.run(["sh", str(TOOL), f"host={HOST} port={PORT} user=postgres dbname=rev_t", str(bad), "--catalog", str(CAT)], capture_output=True, text=True)
    record("REV08-C2", "correction", "REV-08 : fichier à plusieurs transactions refusé avant toute exécution", "rc 2 ; REFUS", f"rc={t2.returncode} {t2.stdout.strip()[:90]}",
           t2.returncode == 2 and "REFUS" in t2.stdout)
    # ------------------------------------------------------------------------------------------ NUM-01 (27/11)
    # Simulation SQL du passage des arguments RPC (corps JSON → json_to_record → numeric), comme PostgREST pour une RPC en POST.
    def via_json(db, u, h, raw_amount):
        body = '{"p_household":"%s","p_amount_minor":%s,"p_occurred_on":"2026-11-27","p_idempotency_key":"%s"}' % (h, raw_amount, uuid.uuid4())
        with conn(db) as c:
            try:
                with c.cursor() as cur:
                    claims(cur, u); cur.execute("""select public.duo_v3_post_contribution(a.p_household, a.p_amount_minor, a.p_occurred_on, a.p_idempotency_key)
                        from json_to_record(%s::json) as a(p_household uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text)""", (body,))
                c.commit(); return "OK"
            except psycopg.Error as e: c.rollback(); return e.sqlstate
    for db, kind in ((PUB, "reproduction"), (COR, "correction")):
        fresh("rev_t", db); u, h, e = duo("rev_t", "EUR")
        st = {k: via_json("rev_t", u, h, v) for k, v in (("100.0", '"100.0"'), ("1.5", '"1.5"'), ("chaîne 2^53+1", f'"{BIG}"'), ("nombre 2^53+1", str(BIG)), ("1e3", '"1e3"'))}
        cash = json.loads(snapshot_raw("rev_t", u, h))["position"]["cash_minor"]
        canon = isinstance(cash, str) and bool(__import__("re").fullmatch(r"-?(0|[1-9][0-9]*)", cash))
        if kind == "reproduction":
            record("NUM01-R", kind, "NUM-01 : « 100.0 » accepté (entier à échelle non nulle) → montant relu non canonique, instantané refusé par le contrat",
                   "100.0 accepté ; trésorerie relue non canonique", f"{st} trésorerie={cash!r} canonique={canon}", st["100.0"] == "OK" and not canon)
        else:
            exp = str(2 * BIG + 1000)
            record("NUM01-C", kind, "NUM-01 : échelle non nulle refusée ; chaînes et nombres JSON au-delà de 2^53 exacts ; 1e3 normalisé ; relecture canonique",
                   f"100.0 refusé (23514) ; 1.5 refusé ; trésorerie '{exp}'", f"{st} trésorerie={cash!r} canonique={canon}",
                   st["100.0"] == "23514" and st["1.5"] != "OK" and st["chaîne 2^53+1"] == "OK" and st["nombre 2^53+1"] == "OK" and cash == exp and canon)
    # ------------------------------------------------------------------------------------------ G13
    fresh("rev_t", COR)
    ua = str(uuid.uuid4()); hA = "11111111-1111-4111-8111-111111111111"
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname="rev_t", autocommit=True) as c:
        c.execute("insert into auth.users(id,aud,role,email,is_anonymous) values (%s,'authenticated','authenticated','e2e@example.invalid',false)", (ua,))
        legacy = (ROOT / "v3/database/qualification/legacy-e2e/ORIGINAL_fixtures.template.sql").read_text().replace("REPLACE_WITH_REAL_AUTH_USER_A_UUID", ua).replace("REPLACE_WITH_REAL_AUTH_USER_B_UUID", ua)
        legacy = "\n".join(l for l in legacy.splitlines() if not l.strip().lower() in ("begin;", "commit;"))
        try: c.execute(legacy); fx = "fixture installée"
        except psycopg.Error as e: fx = f"fixture refusée {e.sqlstate}"
    with conn("rev_t") as c:
        try:
            with c.cursor() as cur:
                claims(cur, ua); cur.execute("select public.duo_v3_post_transfer(%s,%s,%s,100,'EUR',%s)", (hA, "11111111-aaaa-4111-8111-111111111111", "11111111-bbbb-4111-8111-111111111111", str(uuid.uuid4())))
            c.commit(); tr = "accepté"
        except psycopg.Error as e: c.rollback(); tr = f"{e.sqlstate} {str(e).splitlines()[0][:70]}"
    record("G13-R", "reproduction", "G13 : le scénario du harnais historique (cash → envelope, duo sans période) est refusé par la 006r1",
           "transfert refusé (55000 ou 23503)", f"{fx} ; transfert={tr}", tr.startswith(("55000", "23503")))
    wf = (ROOT / ".github/workflows/v3-finance-auth-e2e-dev.yml").read_text()
    nd = subprocess.run(["node", str(ROOT / "scripts/v3-finance-e2e-dev.cjs")], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "DUO_V3_SUPABASE_URL": "https://example.invalid"})
    fxq = psql("rev_t", "-f", str(ROOT / "scripts/v3-finance-e2e-fixtures.template.sql"))
    record("G13-C", "correction", "G13 / A-05 : workflow sans environnement ni secret ; script arrêté au démarrage (code 3) ; fixture s'arrête avant tout SQL",
           "0 « secrets. » ; 0 « environment: » ; script rc=3 ; fixture sans effet", f"secrets={wf.count('secrets.')} environment={wf.count('environment:')} script_rc={nd.returncode} fixture_rc={fxq.returncode} sortie={fxq.stdout.strip()[:40]!r}",
           wf.count("secrets.") == 0 and wf.count("environment:") == 0 and nd.returncode == 3 and fxq.returncode == 0)
    # ------------------------------------------------------------------------------------------ états intermédiaires
    LIFT = "select count(*) from pg_tables where tablename='duo_v3_protection_lift_requests'"
    if FUNDS.exists():
        fresh("rev_t", COR); r = psql("rev_t", "-f", str(FUNDS)); n = psql("rev_t", "-At", "-c", LIFT).stdout.strip()
        last = r.stderr.strip().splitlines()[-1][:110] if r.stderr.strip() else ""
        record("INT-01", "état intermédiaire", "Fonds réels sans lot 3 : migration refusée (garde 55000), rien n'est créé",
               "échec « lot 3 … requise » ; aucune table funds", f"rc={r.returncode} {last} tables={n}", r.returncode != 0 and "lot 3" in r.stderr and n == "0")
    else:
        record("INT-01", "état intermédiaire", "Fonds réels sans lot 3", "—", "sans objet sur cette branche (migration fonds absente)", True)
    if not LOT3.exists():
        record("INT-02", "état intermédiaire", "Lot 3 sans 006r1", "—", "sans objet sur cette branche (migration lot 3 absente)", True)
    if LOT3.exists():
      fresh("rev_t", "b005"); before = catalog("rev_t"); r = psql("rev_t", "-f", str(LOT3)); after = catalog("rev_t")
      record("INT-02", "état intermédiaire", "Lot 3 sans 006r1 : échec atomique, catalogue inchangé", "échec ; catalogue identique", f"rc={r.returncode} catalogue {before}→{after}",
           r.returncode != 0 and before == after)
    fresh("rev_t", COR); before = catalog("rev_t"); r = psql("rev_t", "-f", str(MIG)); after = catalog("rev_t")
    record("INT-03", "état intermédiaire", "006r1 rejouée sur une base qui l'a déjà : échec atomique, catalogue inchangé", "échec ; catalogue identique",
           f"rc={r.returncode} catalogue {before}→{after}", r.returncode != 0 and before == after)
    adm('drop database if exists "rev_t" with (force)')

if __name__ == "__main__":
    run()
    s = {}
    for r in RESULTS: s[r["statut"]] = s.get(r["statut"], 0) + 1
    (H / "results").mkdir(exist_ok=True)
    (H / "results" / f"{LABEL}.json").write_text(json.dumps(dict(label=LABEL, publie=PUB, corrige=COR, bilan=s, resultats=RESULTS), indent=1, ensure_ascii=False))
    print(json.dumps(s, ensure_ascii=False))
