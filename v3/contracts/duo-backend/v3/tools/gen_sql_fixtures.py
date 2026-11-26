#!/usr/bin/env python3
"""Lot D — génère les fixtures du contrat mobile À PARTIR DU PROTOTYPE (gabarit s3 = 006 r1 + lot 3 + fonds réels, migrations candidates finales) :
chaque fichier est la réponse JSON réelle de duo_v3_get_funds_snapshot (ou de duo_v3_get_envelope_snapshot pour la
variante 006 seule), lue sous le rôle authenticated. Aucune valeur n'est écrite à la main dans ces fichiers.
Usage : python3 gen_sql_fixtures.py   -> ../mobile-contract/fixtures/sql_*.json"""
import json, uuid, pathlib, datetime
import psycopg
HOST, PORT, DB = "/tmp", 54317, "lotd_fixtures"
OUT = pathlib.Path(__file__).resolve().parent.parent / "fixtures"; OUT.mkdir(exist_ok=True)
E = lambda euros: int(round(euros * 100))
def adm(sql, db="postgres"):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c: c.execute(sql)
def ac(): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=DB, autocommit=True)
def call(sub, sql, args=()):
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=DB) as c:
        with c.cursor() as cur:
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "authenticated", "sub": sub, "aud": "authenticated", "is_anonymous": False}),))
            cur.execute("set local role authenticated"); cur.execute(sql, args); v = cur.fetchone()[0] if cur.description else None
        c.commit(); return v
def user():
    u = str(uuid.uuid4())
    with ac() as c: c.execute("insert into auth.users(id,aud,role,email,email_confirmed_at) values (%s,'authenticated','authenticated',%s,now())", (u, f"{u[:8]}@example.invalid"))
    return u
def duo(envs, kind="duo", activate=True):
    a, b = user(), user(); h = str(uuid.uuid4())
    with ac() as c:
        c.execute("insert into public.duo_v3_households(id,kind) values (%s,%s)", (h, kind))
        c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner')", (h, a))
        if kind == "duo": c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'partner')", (h, b))
        c.execute("select duo_v3_private.bootstrap_household(%s)", (h,))
        pid, starts = c.execute("select id, starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()
        ids = {}
        for name, target, carry in envs:
            e = c.execute("select duo_v3_private.create_envelope(%s,%s,%s)", (h, name, carry)).fetchone()[0]
            c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, target, starts)); ids[name] = str(e)
        c.execute("select duo_v3_private.post_period_allocations(%s,%s)", (h, pid))
        if activate: c.execute("select duo_v3_private.activate_funds(%s)", (h,))
    return a, b, h, ids
K = lambda: f"k-{uuid.uuid4()}"
def contrib(u, h, amt, assign=()): return call(u, "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,%s::jsonb)::text", (h, amt, K(), json.dumps([{"envelopeId": e, "amount": x} for e, x in assign])))
def move(u, h, f, t, amt): return call(u, "select public.duo_v3_move_funds(%s,%s,%s,%s,%s)::text", (h, f, t, amt, K()))
def spend(u, h, e, amt): return call(u, "select public.duo_v3_post_expense(%s,%s,%s,current_date,%s)::text", (h, e, amt, K()))
def snap(u, h, fn="duo_v3_get_funds_snapshot"): return call(u, f"select public.{fn}(%s)", (h,))
def save(name, payload): (OUT / f"sql_{name}.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False, sort_keys=True))

adm(f'drop database if exists "{DB}" with (force)'); adm(f'create database "{DB}" template s3 owner postgres')
F = {}
a, b, h, i = duo([("Courses", E(500), True)]); F["target_no_funding"] = snap(b, h)
a, b, h, i = duo([("Courses", E(525), True)]); contrib(a, h, E(1000)); move(b, h, None, i["Courses"], E(325)); spend(a, h, i["Courses"], E(275)); F["partial_funding"] = snap(a, h)
a, b, h, i = duo([("Loyer", E(400), True)]); contrib(a, h, E(400), ((i["Loyer"], E(400)),)); spend(b, h, i["Loyer"], E(100)); F["full_funding"] = snap(a, h)
a, b, h, i = duo([("Sorties", E(100), True)]); contrib(a, h, E(50), ((i["Sorties"], E(50)),)); spend(a, h, i["Sorties"], E(80)); F["real_deficit"] = snap(a, h)
a, b, h, i = duo([("Cadeaux", E(100), True)]); contrib(a, h, E(200), ((i["Cadeaux"], E(200)),)); spend(a, h, i["Cadeaux"], E(150)); F["budget_overrun"] = snap(a, h)
a, b, h, i = duo([("Courses", E(300), True)]); contrib(a, h, E(1000)); move(a, h, None, i["Courses"], E(300)); F["unassigned_real_reserve"] = snap(a, h)
a, b, h, i = duo([("Reportable", E(100), True), ("Deficit", E(50), True)])
contrib(a, h, E(200)); move(a, h, None, i["Reportable"], E(80)); move(a, h, None, i["Deficit"], E(10)); spend(a, h, i["Deficit"], E(40))
with ac() as c: c.execute("select duo_v3_private.ensure_current_period(%s, (date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month 1 day') at time zone 'Europe/Paris')", (h,))
F["carry_positive_negative"] = snap(a, h)
a, b, h, i = duo([("Courses", E(200), True), ("Loisirs", E(100), True)]); contrib(a, h, E(300), ((i["Courses"], E(200)), (i["Loisirs"], E(100)))); move(b, h, i["Courses"], i["Loisirs"], E(20)); F["internal_transfer"] = snap(a, h)
a, b, h, i = duo([("Vacances", E(300), True), ("Courses", E(100), True)]); contrib(a, h, E(250), ((i["Vacances"], E(150)), (i["Courses"], E(100))))
call(b, "select public.duo_v3_set_envelope_protection(%s,%s,true)", (h, i["Vacances"])); F["protected_envelope"] = snap(a, h)
pa, pb, hp, pi = duo([("Lecture", E(60), True)], kind="personal"); contrib(pa, hp, E(50), ((pi["Lecture"], E(50)),)); spend(pa, hp, pi["Lecture"], E(15))
F["personal_envelope_owner"] = snap(pa, hp); F["personal_envelope_other_user"] = snap(pb, hp)
a, b, h, i = duo([("Courses", E(400), True)]); contrib(a, h, E(300), ((i["Courses"], E(300)),))
sp = call(a, "select public.duo_v3_propose_contribution_split(%s,%s::jsonb,'{}'::jsonb)::text", (h, json.dumps({a: 5000, b: 5000}))); call(b, "select public.duo_v3_accept_contribution_split(%s,%s)::text", (h, sp))
F["future_operations"] = snap(a, h)
a, b, h, i = duo([("Courses", E(100), True)]); contrib(a, h, E(100), ((i["Courses"], E(100)),)); x = spend(a, h, i["Courses"], E(30))
F["cancellation_step0_expense"] = snap(a, h); rv = call(b, "select public.duo_v3_cancel_transaction(%s,%s,%s)::text", (h, x, K()))
F["cancellation_step1_cancelled"] = snap(a, h); call(a, "select public.duo_v3_restore_transaction(%s,%s,%s)::text", (h, rv, K()))
F["cancellation_step2_restored"] = snap(a, h)
a, b, h, i = duo([("Courses", E(400), True)], activate=False); contrib(a, h, E(300)); spend(a, h, i["Courses"], E(120))
F["budget_only_006"] = snap(a, h, "duo_v3_get_envelope_snapshot")
for k, v in F.items(): save(k, v)
adm(f'drop database if exists "{DB}" with (force)')
print(len(F), "fixtures écrites dans", OUT)
