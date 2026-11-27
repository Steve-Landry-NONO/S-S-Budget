#!/usr/bin/env python3
"""Exercices de récupération sur base JETABLE (26/11/2026) — lot 3 et fonds réels (M2), sans pg_dump 17.

R1  Échec en cours de migration (fonds réels, puis lot 3) : instruction fautive injectée juste avant le COMMIT.
    Attendu : transaction entière annulée, catalogue ET données identiques à l'état initial.
R2  Sauvegarde / restauration par copie physique de base (CREATE DATABASE … TEMPLATE), équivalent local d'une restauration
    à un instant donné : empreinte comptable, invariants et lectures identiques ; la base restaurée accepte de nouvelles écritures.
R3  Export / import LOGIQUE (COPY table par table, séquences recalées) vers un schéma vierge identique :
    même empreinte ; rejeu idempotent d'une clé déjà utilisée = même transaction ; nouvelle écriture acceptée.
R4  006r1 : la procédure de retour arrière est couverte par qualify_rollback.py (006r1/), non dupliquée ici.

Usage : python3 recovery_drill.py <gabarit s1> <gabarit s2> <gabarit s3> <label>   (s1 = 001→006r1 ; s2 = s1 + lot 3 ; s3 = s2 + fonds réels)"""
import json, sys, uuid, hashlib, pathlib, subprocess, tempfile
import psycopg

H = pathlib.Path(__file__).resolve().parent; ROOT = H.parents[3]
S1, S2, S3, LABEL = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
HOST, PORT = "/tmp", "54317"
LOT3 = ROOT / "supabase/migrations/20261126130000_duo_v3_membership_lifecycle.sql"
FUNDS = ROOT / "supabase/migrations/20261126140000_duo_v3_funds_ledger.sql"
CAT = ROOT / "v3/database/qualification/006r1/sql/catalog_dump.sql"
RESULTS = []
def record(sid, rule, expected, observed, ok):
    s = "Réussi" if ok else "Échoué"; RESULTS.append(dict(id=sid, regle=rule, attendu=expected, observe=observed, statut=s)); print(f"{sid:6} {s:7} {observed[:150]}", flush=True)
def adm(sql, db="postgres"):
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c: return c.execute(sql)
def clone(dst, src): adm(f'drop database if exists "{dst}" with (force)'); adm(f'create database "{dst}" template "{src}" owner postgres')
def ac(db): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=db, autocommit=True)
def psql(db, f): return subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(f)], capture_output=True, text=True)
def catalog(db):
    out = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "supabase_admin", "-d", db, "-X", "-qAt", "-f", str(CAT)], capture_output=True, text=True).stdout
    return hashlib.sha256(out.encode()).hexdigest()[:16]
def call(db, sub, sql, args=()):
    with psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=db) as c:
        with c.cursor() as cur:
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "authenticated", "sub": sub, "aud": "authenticated", "is_anonymous": False}),))
            cur.execute("set local role authenticated"); cur.execute(sql, args); v = cur.fetchone()[0] if cur.description else None
        c.commit(); return v

TABLES = None
def tables(db):
    with ac(db) as c:
        return [r[0] for r in c.execute("""select format('%I.%I', table_schema, table_name) from information_schema.tables
            where table_type='BASE TABLE' and (table_schema='public' and table_name like 'duo\\_v3\\_%' or (table_schema, table_name) = ('auth','users')) order by 1""").fetchall()]
def fingerprint(db, households):
    """Empreinte : contenu de chaque table (trié), somme de contrôle du grand livre, invariants et lectures par duo."""
    fp = {}
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c:
        for t in tables(db):
            rows = c.execute(f"select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) , count(*) from {t} x").fetchone()
            fp[t] = f"{rows[1]}:{rows[0][:12]}"
        fp["ledger"] = c.execute("select md5(coalesce(string_agg(id::text||':'||account_id::text||':'||amount_minor::text, ',' order by id), '')) from public.duo_v3_entries").fetchone()[0][:16]
        fp["unbalanced_tx"] = c.execute("select count(*) from (select transaction_id from public.duo_v3_entries group by transaction_id having sum(amount_minor) <> 0) z").fetchone()[0]
    for h in households:
        s = call(db, hs_envs[h][1], "select public.duo_v3_get_funds_snapshot(%s)", (h,)); s.pop("asOf", None)
        fp[f"snap:{h[:8]}"] = hashlib.sha256(json.dumps(s, sort_keys=True).encode()).hexdigest()[:12]
        fp[f"inv:{h[:8]}"] = s["household"]["invariantHolds"] if s.get("household") else None
    return fp

def populate(db):
    """Deux duos indépendants (EUR, XAF), chacun avec ses deux comptes fictifs (un compte = un duo actif, CF-05)."""
    hs = []
    with ac(db) as c:
        funds = db_has_funds(c)
        for i, cur_code in enumerate(("EUR", "XAF")):
            ua, ub = f"20000000-0000-4000-8000-0000000000{i}a", f"20000000-0000-4000-8000-0000000000{i}b"
            c.execute("insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values (%s,'authenticated','authenticated',%s,now(),false),(%s,'authenticated','authenticated',%s,now(),false)",
                      (ua, f"r{i}a@example.invalid", ub, f"r{i}b@example.invalid"))
            h = str(uuid.uuid4()); hs.append(h)
            c.execute("insert into public.duo_v3_households(id,currency) values (%s,%s)", (h, cur_code))
            c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner'),(%s,%s,'partner')", (h, ua, h, ub))
            c.execute("select duo_v3_private.bootstrap_household(%s)", (h,))
            pid, starts = c.execute("select id, starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()
            envs = []
            for name, tgt in (("Courses", 40000), ("Vacances", 30000)):
                e = str(c.execute("select duo_v3_private.create_envelope(%s,%s,true)", (h, name)).fetchone()[0]); envs.append(e)
                c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, tgt, starts))
            c.execute("select duo_v3_private.post_period_allocations(%s,%s)", (h, pid))
            if funds: c.execute("select duo_v3_private.activate_funds(%s)", (h,))
            hs_envs[h] = (envs, ua, ub)
    return hs
hs_envs = {}
def db_has_funds(c): return c.execute("select exists(select 1 from pg_proc where proname='activate_funds')").fetchone()[0]
def activity(db, h, funds=True):
    (c1, c2), UA, UB = hs_envs[h]
    if funds:
        call(db, UA, "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,%s::jsonb)", (h, 90000, f"rk-{h}-1", json.dumps([{"envelopeId": c1, "amount": 30000}])))
        call(db, UB, "select public.duo_v3_move_funds(%s,%s,%s,%s,%s)", (h, None, c2, 20000, f"rk-{h}-2"))
        x = call(db, UA, "select public.duo_v3_post_expense(%s,%s,%s,current_date,%s)", (h, c1, 12345, f"rk-{h}-3"))
        call(db, UB, "select public.duo_v3_cancel_transaction(%s,%s,%s)", (h, x, f"rk-{h}-4"))
        call(db, UB, "select public.duo_v3_set_envelope_protection(%s,%s,true)", (h, c2))
        call(db, UA, "select public.duo_v3_set_envelope_protection(%s,%s,false)", (h, c2))          # levée en attente (lift_pending)
    else:
        call(db, UA, "select public.duo_v3_post_contribution(%s,%s,current_date,%s)", (h, 90000, f"rk-{h}-1"))
        call(db, UA, "select public.duo_v3_post_expense(%s,%s,%s,current_date,%s)", (h, c1, 12345, f"rk-{h}-3"))

def inject_failure(src, dst):
    body = src.read_text(); i = body.rstrip().rfind("commit;"); assert i > 0
    dst.write_text(body[:i] + "select 1/0;   -- panne injectée (exercice R1)\n" + body[i:])

def run():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="recovery_"))
    # ---------------------------------------------------------------- R1 : panne pendant la migration des fonds réels, puis du lot 3
    clone("rc_live", S2); hs = populate("rc_live")
    for h in hs: activity("rc_live", h, funds=False)
    fp0, c0 = fingerprint_nofunds("rc_live", hs), catalog("rc_live")
    bad = tmp / "funds_fail.sql"; inject_failure(FUNDS, bad); r = psql("rc_live", bad)
    fp1, c1 = fingerprint_nofunds("rc_live", hs), catalog("rc_live")
    record("R1-a", "Panne injectée avant le COMMIT de la migration fonds réels : rien n'est appliqué", "échec 22012 ; catalogue et données identiques",
           f"rc={r.returncode} division_by_zero={'division by zero' in r.stderr} catalogue {c0}→{c1} données_identiques={fp0 == fp1}", r.returncode != 0 and c0 == c1 and fp0 == fp1)
    r = psql("rc_live", FUNDS); c2 = catalog("rc_live")
    record("R1-b", "Reprise : la migration saine s'applique ensuite sur la même base (aucun état intermédiaire résiduel)", "rc 0 ; catalogue = gabarit s3",
           f"rc={r.returncode} catalogue {c2} (s3 {catalog(S3)})", r.returncode == 0 and c2 == catalog(S3))
    clone("rc_l3", S1)
    adm("alter table auth.users add column if not exists email_confirmed_at timestamptz", "rc_l3")
    cl0 = catalog("rc_l3"); bad3 = tmp / "lot3_fail.sql"; inject_failure(LOT3, bad3); r = psql("rc_l3", bad3); cl1 = catalog("rc_l3")
    record("R1-c", "Panne injectée avant le COMMIT du lot 3 : rien n'est appliqué", "échec ; catalogue identique", f"rc={r.returncode} catalogue {cl0}→{cl1}", r.returncode != 0 and cl0 == cl1)
    adm('drop database if exists "rc_l3" with (force)')
    # ---------------------------------------------------------------- R2 : sauvegarde physique (copie de base) puis restauration
    clone("rc_live", S3); hs_envs.clear(); hs = populate("rc_live")
    for h in hs: activity("rc_live", h)
    ref = fingerprint("rc_live", hs)
    clone("rc_backup", "rc_live")                                            # sauvegarde
    call("rc_live", hs_envs[hs[0]][1], "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,'[]'::jsonb)", (hs[0], 777, "rk-after-backup"))   # incident : écriture postérieure
    lost = fingerprint("rc_live", hs) != ref
    clone("rc_live", "rc_backup")                                            # restauration
    got = fingerprint("rc_live", hs)
    new = call("rc_live", hs_envs[hs[1]][2], "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,'[]'::jsonb)::text", (hs[1], 500, "rk-post-restore"))
    inv = call("rc_live", hs_envs[hs[1]][1], "select public.duo_v3_get_funds_snapshot(%s)", (hs[1],))["household"]["invariantHolds"]
    record("R2", "Restauration depuis la copie : retour exact à l'état sauvegardé ; écritures possibles ensuite ; invariants tenus",
           "empreinte identique (tables, grand livre, lectures) ; nouvelle écriture acceptée ; invariant vrai",
           f"divergence_avant={lost} identique={got == ref} grand_livre={got['ledger']} non_équilibrées={got['unbalanced_tx']} nouvelle={bool(new)} invariant={inv}",
           lost and got == ref and got["unbalanced_tx"] == 0 and bool(new) and inv is True)
    # ---------------------------------------------------------------- R3 : export / import logique vers un schéma vierge
    clone("rc_live", "rc_backup"); clone("rc_target", S3)
    exported = {}
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="rc_live") as src:
        for t in tables("rc_live"):
            f = tmp / f"{t}.copy"
            with src.cursor() as cur, cur.copy(f"copy {t} to stdout") as cp, open(f, "wb") as out:
                for chunk in cp: out.write(chunk)
            exported[t] = f
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="rc_target") as dst:
        with dst.cursor() as cur:
            cur.execute("set session_replication_role = replica")            # déclencheurs d'immutabilité et de garde non rejoués pendant l'import
            for t, f in exported.items():
                with cur.copy(f"copy {t} from stdin") as cp, open(f, "rb") as inp:
                    cp.write(inp.read())
            cur.execute("set session_replication_role = origin")
            seqs = cur.execute("""select format('%I.%I', n.nspname, c.relname), format('%I.%I', tn.nspname, t.relname), a.attname
                from pg_depend d join pg_class c on c.oid = d.objid and c.relkind = 'S' join pg_namespace n on n.oid = c.relnamespace
                join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
                join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid where tn.nspname in ('public','auth')""").fetchall()
            for s, t, col in seqs: cur.execute(f"select setval('{s}', coalesce((select max({col}) from {t}), 1))")
            fk = cur.execute("""select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace""").fetchone()[0]
        dst.commit()
    # contrôle d'intégrité référentielle après import sans déclencheurs : revalidation de chaque clé étrangère
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="rc_target", autocommit=True) as c:
        bad_fk = []
        for (name, tbl) in c.execute("select conname, conrelid::regclass::text from pg_constraint where contype='f' and connamespace='public'::regnamespace").fetchall():
            try:
                d = c.execute("select pg_get_constraintdef(oid) from pg_constraint where conname=%s and conrelid=%s::regclass", (name, tbl)).fetchone()[0]
                c.execute("begin"); c.execute(f'alter table {tbl} drop constraint "{name}"'); c.execute(f'alter table {tbl} add constraint "{name}" {d}'); c.execute("rollback")
            except psycopg.Error as e:
                c.execute("rollback"); bad_fk.append(f"{name}:{e.sqlstate}")
    got = fingerprint("rc_target", hs)
    rep = call("rc_target", hs_envs[hs[0]][1], "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,%s::jsonb)::text",
               (hs[0], 90000, f"rk-{hs[0]}-1", json.dumps([{"envelopeId": hs_envs[hs[0]][0][0], "amount": 30000}])))
    orig = call("rc_live", hs_envs[hs[0]][1], "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,%s::jsonb)::text",
                (hs[0], 90000, f"rk-{hs[0]}-1", json.dumps([{"envelopeId": hs_envs[hs[0]][0][0], "amount": 30000}])))
    new = call("rc_target", hs_envs[hs[1]][2], "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,'[]'::jsonb)::text", (hs[1], 500, "rk-post-import"))
    diff = sorted(k for k in ref if ref[k] != got.get(k))
    record("R3", "Export / import logique (COPY) : même empreinte ; clés étrangères revalidées ; rejeu idempotent = même transaction ; nouvelle écriture acceptée",
           "0 différence ; 0 clé étrangère invalide ; rejeu = transaction d'origine ; écriture acceptée",
           f"tables={len(exported)} différences={diff} fk_revalidées={fk} fk_invalides={bad_fk} rejeu_identique={rep == orig} nouvelle={bool(new)}",
           diff == [] and bad_fk == [] and rep == orig and bool(new))
    for d in ("rc_live", "rc_backup", "rc_target"): adm(f'drop database if exists "{d}" with (force)')

def fingerprint_nofunds(db, hs):
    fp = {}
    with psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname=db, autocommit=True) as c:
        for t in tables(db):
            r = c.execute(f"select md5(coalesce(string_agg(x::text, '|' order by x::text), '')), count(*) from {t} x").fetchone(); fp[t] = f"{r[1]}:{r[0][:12]}"
    for h in hs:
        s = call(db, hs_envs[h][1], "select public.duo_v3_get_envelope_snapshot(%s)", (h,)); s.pop("asOf", None)
        fp[f"snap:{h[:8]}"] = hashlib.sha256(json.dumps(s, sort_keys=True).encode()).hexdigest()[:12]
    return fp

if __name__ == "__main__":
    try: run()
    except Exception as e:
        import traceback; record("ERR", "Exécution", "aucune erreur", f"{type(e).__name__}: {e} {traceback.format_exc()[-500:]}", False)
    s = {}
    for r in RESULTS: s[r["statut"]] = s.get(r["statut"], 0) + 1
    (H / "results").mkdir(exist_ok=True)
    (H / "results" / f"{LABEL}.json").write_text(json.dumps(dict(label=LABEL, gabarits=[S1, S2, S3], bilan=s, resultats=RESULTS), indent=1, ensure_ascii=False))
    print(json.dumps(s, ensure_ascii=False))
