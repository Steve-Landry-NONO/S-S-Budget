#!/usr/bin/env python3
"""Qualification du rollback de la 006 révisée candidate (environnement PostgreSQL jetable uniquement).
RB1 ×3 : up puis down sur base vide → catalogue identique à 001→005.
RB2    : down refusé dès qu'une donnée financière existe ; schéma inchangé.
RB3    : down refusé si un duo a des paramètres hors valeurs par défaut (perte d'information sinon).
RB4    : up → down → up → catalogue identique à r006.
RB5    : duo aux paramètres par défaut, sans écriture : down accepté.
Usage : python3 qualify_rollback.py  -> results/rollback/rollback_summary.json"""
import subprocess, hashlib, json, pathlib
H = pathlib.Path(__file__).resolve().parent
import os
UP = pathlib.Path(os.environ.get("UP_SQL", H / "../../../../supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql"))
DOWN = pathlib.Path(os.environ.get("DOWN_SQL", H / "../../../../supabase/rollback/20261126120000_duo_v3_financial_model_r1.down.sql"))
TAG = os.environ.get("RB_TAG", "")
CAT = H / "sql/catalog_dump.sql"
OUT = H / ("results/rollback" + TAG); OUT.mkdir(parents=True, exist_ok=True)
PS = ["psql", "-h", "/tmp", "-p", "54317"]
def adm(sql): subprocess.run(PS + ["-U", "supabase_admin", "-d", "postgres", "-qc", sql], check=True, capture_output=True)
def fresh(db, tpl): adm(f'drop database if exists "{db}" with (force)'); adm(f'create database "{db}" template "{tpl}" owner postgres')
def run(db, f=None, c=None, user="postgres"):
    a = PS + ["-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt"] + (["-f", str(f)] if f else ["-c", c])
    p = subprocess.run(a, capture_output=True, text=True); return p.returncode, p.stdout, p.stderr
def catalog(db):
    rc, out, err = run(db, f=CAT, user="supabase_admin"); assert rc == 0, err; return out
def h(s): return hashlib.sha256(s.encode()).hexdigest()[:16]
S = {}
ref005 = catalog("b005"); (H / "results/catalogs").mkdir(exist_ok=True); (H / "results/catalogs/catalog_b005.txt").write_text(ref005)
fresh("rb_ref", "b005"); assert run("rb_ref", f=UP)[0] == 0; ref006 = catalog("rb_ref"); (H / f"results/catalogs/catalog_r006{TAG}.txt").write_text(ref006)
S["catalog_b005"], S["catalog_r006"] = h(ref005), h(ref006)
for i in (1, 2, 3):
    fresh("rb_t", "b005"); run("rb_t", f=UP); rc, _, err = run("rb_t", f=DOWN); (OUT / f"rb1_run{i}.err").write_text(err)
    c = catalog("rb_t"); (OUT / f"catalog_after_down_run{i}.txt").write_text(c)
    S[f"RB1_run{i}"] = dict(down_rc=rc, catalog=h(c), identique_005=(c == ref005))
run("rb_t", f=UP); c = catalog("rb_t"); (OUT / "catalog_after_reup.txt").write_text(c)
S["RB4"] = dict(catalog=h(c), identique_r006=(c == ref006))
U = "10000000-0000-4000-8000-000000000001"; HH = "20000000-0000-4000-8000-000000000001"
SEED = (f"insert into auth.users(id,aud,role,email,is_anonymous) values ('{U}','authenticated','authenticated','a@example.invalid',false);"
        f"insert into public.duo_v3_households(id,currency,cycle_start_day,time_zone) values ('{HH}',%s);"
        f"insert into public.duo_v3_members(household_id,user_id,role) values ('{HH}','{U}','owner');")
for tag, params, write, expect_ok in (("RB2", "'EUR',1,'Europe/Paris'", True, False), ("RB3", "'XAF',15,'Africa/Douala'", False, False),
                                      ("RB5", "'EUR',1,'Europe/Paris'", False, True)):
    fresh("rb_t", "rb_ref"); before = catalog("rb_t")
    sql = SEED % params + (f"select duo_v3_private.bootstrap_household('{HH}');"
          f"select duo_v3_private.post_system('{HH}', (select id from public.duo_v3_periods where household_id='{HH}'),'allocation','seed',"
          f"duo_v3_private.account_of('{HH}','budget_source'), duo_v3_private.account_of('{HH}','reserve'), 100, current_date);" if write else "")
    rc0, _, e0 = run("rb_t", c=sql); assert rc0 == 0, e0
    rc, _, err = run("rb_t", f=DOWN); (OUT / f"{tag.lower()}.err").write_text(err)
    after = catalog("rb_t")
    S[tag] = dict(down_rc=rc, attendu="accepté" if expect_ok else "refusé (55000)", message=next((l.split("ERROR:",1)[1].strip() for l in err.splitlines() if "ERROR:" in l), ""),
                  schema_inchange=(after == before), conforme=(rc == 0) == expect_ok and (expect_ok or after == before))
for d in ("rb_t",): adm(f'drop database if exists "{d}" with (force)')
adm('drop database if exists "rb_ref" with (force)')
S["verdict"] = all(v["identique_005"] for k, v in S.items() if k.startswith("RB1")) and S["RB4"]["identique_r006"] and all(S[k]["conforme"] for k in ("RB2", "RB3", "RB5"))
(OUT / "rollback_summary.json").write_text(json.dumps(S, indent=1, ensure_ascii=False)); print(json.dumps(S, ensure_ascii=False))
