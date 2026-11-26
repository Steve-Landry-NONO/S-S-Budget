#!/usr/bin/env python3
"""Duo Budget V3 — suite indépendante du 25/11 ADAPTÉE au modèle 006 (deux livres, périodes, enveloppes).

Même méthode que evidence/scripts/qualify.py (rôles Supabase réels, JWT simulé, copies jetables,
COMMIT réels pour les déclencheurs différés et la concurrence). Les identifiants de 005 sont conservés.
Chaque contrôle porte `attendu_005` lorsque 006 change volontairement le contrat ; l'attente 006 vient
de la documentation du lot 2 (§ transition du contrat RPC) ou des arbitrages du 21/11, jamais du résultat.
Usage : python3 qualify006.py <template_db> <label>   ->  results/<label>.json
"""
import os, json, sys, time, uuid, threading, datetime, decimal, os
import psycopg

HOST, PORT = "/tmp", 54317
TEMPLATE, LABEL = sys.argv[1], sys.argv[2]
RUN_DB = f"q6_{LABEL}"
UA, UB, UC, UZ = (f"10000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3, 9))
H1, H2, H3, H4 = (f"20000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3, 4))
FIXTURE = f"""
insert into auth.users(id,aud,role,email,is_anonymous) values
 ('{UA}','authenticated','authenticated','a@example.invalid',false),('{UB}','authenticated','authenticated','b@example.invalid',false),
 ('{UC}','authenticated','authenticated','c@example.invalid',false),('{UZ}','authenticated','authenticated',null,true);
insert into public.duo_v3_households(id,currency,cycle_start_day,time_zone) values
 ('{H1}','EUR',1,'Europe/Paris'),('{H2}','XAF',1,'Africa/Douala'),('{H3}','EUR',1,'Europe/Paris'),('{H4}','EUR',1,'Europe/Paris');
insert into public.duo_v3_members(household_id,user_id,role) values ('{H1}','{UA}','owner'),('{H1}','{UB}','partner'),('{H2}','{UC}','owner'),('{H3}','{UC}','owner'),('{H4}','{UC}','owner');
select duo_v3_private.bootstrap_household('{H1}'), duo_v3_private.bootstrap_household('{H2}');
select duo_v3_private.bootstrap_household('{H3}', now() - interval '70 days');      -- duo dont 2 périodes sont échues (C06)
select duo_v3_private.bootstrap_household('{H4}', date_trunc('month', now()) - interval '10 days');   -- une seule période échue (C06b)
select duo_v3_private.create_envelope('{H1}','Courses',true), duo_v3_private.create_envelope('{H1}','Vacances',false),
       duo_v3_private.create_envelope('{H1}','Tampon',true), duo_v3_private.create_envelope('{H1}','Ancienne',true),
       duo_v3_private.create_envelope('{H2}','Loyer',true), duo_v3_private.create_envelope('{H3}','Courses H3',false),
       duo_v3_private.create_envelope('{H4}','Courses H4',false);
select duo_v3_private.set_allocation(e.id, case e.name when 'Courses' then 40000 when 'Vacances' then 20000 when 'Loyer' then 300000 when 'Courses H3' then 10000 when 'Courses H4' then 10000 else 0 end, p.starts_on)
  from public.duo_v3_envelopes e join public.duo_v3_periods p on p.household_id=e.household_id and p.state='open';
select duo_v3_private.post_period_allocations(p.household_id, p.id) from public.duo_v3_periods p where p.state='open';
select duo_v3_private.archive_envelope(id) from public.duo_v3_envelopes where name='Ancienne';
"""

def admin(): return psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="postgres", autocommit=True)
def conn(user="postgres", autocommit=False): return psycopg.connect(host=HOST, port=PORT, user=user, dbname=RUN_DB, autocommit=autocommit)
def sqlstate(e): return getattr(e, "sqlstate", None) or "?"
def as_role(cur, role, sub=None, anonymous=False):
    claims = {"role": role}
    if sub: claims.update(sub=sub, aud="authenticated", is_anonymous=anonymous)
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
    cur.execute(f"set local role {role}")

ID = {}
def fresh_db():
    with admin() as c:
        c.execute(f'drop database if exists "{RUN_DB}" with (force)')
        c.execute(f'create database "{RUN_DB}" template "{TEMPLATE}" owner postgres')
    with conn(autocommit=True) as c:
        c.execute(FIXTURE)
        for h, tag in ((H1, '1'), (H2, '2'), (H3, '3'), (H4, '4')):
            for kind in ('cash', 'clearing', 'reserve', 'budget_source', 'budget_spent'):
                ID[f"{kind}{tag}"] = str(c.execute("select duo_v3_private.account_of(%s,%s)", (h, kind)).fetchone()[0])
            ID[f"period{tag}"] = str(c.execute("select id from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()[0])
        for name, k in (('Courses', 'ENV1'), ('Vacances', 'ENV2'), ('Tampon', 'ENVT'), ('Ancienne', 'ENVX'), ('Loyer', 'ENV2A'), ('Courses H3', 'ENV3'), ('Courses H4', 'ENV4')):
            eid, acc = c.execute("select id, account_id from public.duo_v3_envelopes where name=%s", (name,)).fetchone()
            ID[k], ID[k + "_acc"] = str(eid), str(acc)
    # Versements réels par la RPC (chemin applicatif), puis réserve alimentée par un report système
    with conn() as c:
        with c.cursor() as cur:
            as_role(cur, "authenticated", UA); cur.execute("select public.duo_v3_post_contribution(%s,100000,current_date,'seed-contrib-1')", (H1,))
        c.commit()
        with c.cursor() as cur:
            as_role(cur, "authenticated", UC); cur.execute("select public.duo_v3_post_contribution(%s,500000,current_date,'seed-contrib-2')", (H2,))
        c.commit()
    with conn(autocommit=True) as c:
        c.execute("select duo_v3_private.post_system(%s,%s,'carry','seed-reserve',%s,%s,5000,current_date)",
                  (H1, ID['period1'], ID['ENV2_acc'], ID['reserve1']))
        ID['INC1'] = str(c.execute("select id from public.duo_v3_transactions where idempotency_key='seed-contrib-1'").fetchone()[0])

RESULTS = []
def record(sid, family, rule, data, action, expected, auth_expected, observed, ok, proof, status=None, note="", attendu_005=None, adaptation=None):
    st = status or ("Réussi" if ok else "Échoué")
    RESULTS.append(dict(id=sid, famille=family, regle=rule, donnees=data, action=action, attendu=expected, attendu_005=attendu_005,
                        adaptation=adaptation, autorisation=auth_expected, observe=observed, preuve=proof, statut=st, note=note))
    print(f"{sid:6} {st:9} {observed[:110]}")
def attempt(fn):
    with conn() as c:
        try:
            with c.cursor() as cur: v = fn(cur)
            c.rollback(); return True, v
        except psycopg.Error as e:
            c.rollback(); return False, f"{sqlstate(e)} {str(e).splitlines()[0]}"
def attempt_commit(fn, user="postgres"):
    with conn(user) as c:
        try:
            with c.cursor() as cur: v = fn(cur)
            c.commit(); return True, v
        except psycopg.Error as e:
            try: c.rollback()
            except Exception: pass
            return False, f"{sqlstate(e)} {str(e).splitlines()[0]}"
def expect_err(ok, v, code): return (not ok) and str(v).startswith(code)
def transfer(cur, sub, frm, to, amount, cc="EUR", key=None, h=None, anonymous=False, role="authenticated"):
    as_role(cur, role, sub, anonymous)
    cur.execute("select public.duo_v3_post_transfer(%s,%s,%s,%s,%s,%s)", (h or H1, frm, to, amount, cc, key or f"k-{uuid.uuid4()}"))
    return str(cur.fetchone()[0])
def expense(cur, sub, env, amount, key=None, day="current_date", h=None):
    as_role(cur, "authenticated", sub)
    cur.execute(f"select public.duo_v3_post_expense(%s,%s,%s,{day},%s)", (h or H1, env, amount, key or f"e-{uuid.uuid4()}"))
    return str(cur.fetchone()[0])
def contribution(cur, sub, amount, key=None, h=None):
    as_role(cur, "authenticated", sub)
    cur.execute("select public.duo_v3_post_contribution(%s,%s,current_date,%s)", (h or H1, amount, key or f"c-{uuid.uuid4()}"))
    return str(cur.fetchone()[0])
def bal(account):
    with conn(autocommit=True) as c:
        return int(c.execute("select coalesce(sum(amount_minor),0) from public.duo_v3_entries where account_id=%s", (account,)).fetchone()[0])
def post(cur, lines, kind="transfer", h=None, cc="EUR", rev=None, key=None, period=None, created_by=UA):
    h = h or H1; tid = str(uuid.uuid4())
    cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,reverses_transaction_id,period_id,occurred_on) values (%s,%s,%s,%s,%s,%s,%s,%s,current_date)",
                (tid, h, cc, key or f"l-{uuid.uuid4()}", kind, created_by, rev, period if period is not None else (ID['period1'] if h == H1 else ID['period2'])))
    for acc, amt in lines:
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,%s,%s)", (tid, h, acc, cc, amt))
    return tid

# =====================================================================================
def ledger_tests():
    F = "Grand livre (006)"
    E1, RS = ID['ENV1_acc'], ID['reserve1']
    ok, v = attempt_commit(lambda c: post(c, [(E1, -2500), (RS, 2500)]))
    record("L01", F, "Écriture équilibrée dans le livre budget, imputée à la période ouverte", "Courses 400 €", "INSERT -25/+25 (enveloppe→réserve), COMMIT", "accepté", "postgres", f"ok={ok} {v}", ok, "COMMIT réel",
           adaptation="Ajout de period_id et choix de comptes du même livre (exigences 006)")
    ok, v = attempt_commit(lambda c: post(c, [(E1, -2500)]))
    record("L02", F, "Une seule ligne refusée", "—", "1 ligne", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    ok, v = attempt_commit(lambda c: post(c, [(E1, -2500), (RS, 2499)]))
    record("L03", F, "Écriture déséquilibrée refusée", "—", "-25,00/+24,99", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    ok, v = attempt_commit(lambda c: post(c, [(ID['cash1'], -2500), (E1, 2500)]))
    record("L03b", F, "006 : équilibre PAR LIVRE (trésorerie ≠ budget)", "—", "trésorerie -25 / enveloppe +25 (somme nulle)", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel",
           note="Nouveau contrôle 006 : empêche de « créer » du budget avec de l'argent réel ou l'inverse.")
    ok, v = attempt_commit(lambda c: post(c, []))
    record("L04", F, "Transaction sans ligne refusée", "—", "en-tête seul", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    def no_period(c):
        tid = str(uuid.uuid4())
        c.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by) values (%s,%s,'EUR',%s,'transfer',%s)", (tid, H1, f"np-{tid}", UA))
        c.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',-1),(%s,%s,%s,'EUR',1)", (tid, H1, E1, tid, H1, RS))
    ok, v = attempt_commit(no_period)
    record("L04b", F, "006 : imputation obligatoire à une période", "—", "transaction sans period_id", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    ok, v = attempt_commit(lambda c: post(c, [(E1, -100), (ID['reserve2'], 100)]))
    record("L05", F, "Compte d'un autre duo refusé", "—", "ligne duo 1 → réserve duo 2", "23503", "postgres", str(v), expect_err(ok, v, "23503"), "COMMIT réel")
    def dup(c):
        post(c, [(E1, -1), (RS, 1)], key="dup-key"); post(c, [(E1, -1), (RS, 1)], key="dup-key")
    ok, v = attempt_commit(dup)
    record("L06", F, "Clé d'idempotence unique par duo", "—", "2 transactions même clé", "23505", "postgres", str(v), expect_err(ok, v, "23505"), "COMMIT réel")
    for sid, stmt in (("L07a", f"update public.duo_v3_entries set amount_minor=1 where transaction_id='{ID['INC1']}'"),
                      ("L07b", f"delete from public.duo_v3_transactions where id='{ID['INC1']}'"),
                      ("L07c", f"delete from public.duo_v3_periods where id='{ID['period1']}'"),
                      ("L07d", f"update public.duo_v3_allocation_versions set amount_minor=0")):
        ok, v = attempt(lambda c, s=stmt: c.execute(s))
        record(sid, F, "Historique immuable", "—", stmt[:70], "23514", "postgres refusé", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    for sid, tbl in (("L08", "duo_v3_entries"), ("L08b", "duo_v3_periods"), ("L08c", "duo_v3_envelopes")):
        ok, v = attempt(lambda c, t=tbl: c.execute(f"truncate public.{t} cascade"))
        record(sid, F, f"TRUNCATE {tbl} par le propriétaire", "—", "TRUNCATE CASCADE", "23514", "postgres", f"ok={ok} {v}", expect_err(ok, v, "23514"), "transaction annulée")
    def reversal(c):
        t = post(c, [(E1, -3000), (RS, 3000)]); post(c, [(E1, 3000), (RS, -3000)], kind="reversal", rev=t)
    ok, v = attempt_commit(reversal)
    record("L09", F, "Contre-passation exacte", "—", "transfert + reversal", "accepté", "postgres", f"ok={ok} {v}", ok, "COMMIT réel")
    def rev_twice(c):
        t = post(c, [(E1, -3000), (RS, 3000)]); post(c, [(E1, 3000), (RS, -3000)], kind="reversal", rev=t); post(c, [(E1, 3000), (RS, -3000)], kind="reversal", rev=t)
    ok, v = attempt_commit(rev_twice)
    record("L10", F, "Double contre-passation refusée", "—", "2 reversals", "23505", "postgres", str(v), expect_err(ok, v, "23505"), "COMMIT réel")
    ok, v = attempt_commit(lambda c: post(c, [(ID['ENV2A_acc'], -1), (ID['reserve2'], 1)], kind="reversal", h=H2, cc="XAF", rev=ID['INC1'], created_by=UC))
    record("L11", F, "Contre-passation d'un autre duo refusée", "—", "reversal duo 2 → original duo 1", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    def rev_partial(c):
        t = post(c, [(E1, -3000), (RS, 3000)]); post(c, [(E1, 2000), (RS, -2000)], kind="reversal", rev=t)
    ok, v = attempt_commit(rev_partial)
    record("L12", F, "Contre-passation partielle refusée", "—", "reversal 20 € sur 30 €", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "COMMIT réel")
    def frac(c):
        t = post(c, [(E1, decimal.Decimal("-1.5")), (RS, decimal.Decimal("1.5"))])
        return str(c.execute("select array_agg(amount_minor order by amount_minor) from public.duo_v3_entries where transaction_id=%s", (t,)).fetchone()[0])
    ok, v = attempt_commit(frac)
    record("L13", F, "P01 — fraction d'unité mineure sur écriture privilégiée", "—", "INSERT ±1.5", "refus explicite", "postgres",
           f"ok={ok} stocké={v}", not ok, "COMMIT réel", status="Constat" if ok else None, note="Inchangé par 006 : numeric(38,0) arrondit avant toute contrainte ou déclencheur. Voir revue P01.")
    # L14 — devise du duo (D-005)
    usd1, usd2 = str(uuid.uuid4()), str(uuid.uuid4())
    def usd_accounts(c):
        c.execute("insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values (%s,%s,'USD orphelin 1','envelope','USD'),(%s,%s,'USD orphelin 2','envelope','USD')", (usd1, H1, usd2, H1))
        return "2 comptes 'envelope' USD créés dans un duo EUR"
    ok, v = attempt_commit(usd_accounts)
    ID['usd_ok'] = ok
    record("L14", F, "D-005 — aucun compte d'une autre devise dans le duo", "Duo 1 EUR (households.currency)", "INSERT de comptes USD (postgres)",
           "refus", "postgres", f"ok={ok} {v}", not ok, "COMMIT réel", status="Constat" if ok else None,
           note="006 ajoute households.currency et contrôle les enveloppes, mais pas la table des comptes.")
    def env_on_usd(c):
        c.execute("insert into public.duo_v3_envelopes(household_id,account_id,currency,name) values (%s,%s,'USD','USD')", (H1, usd1))
    ok, v = attempt(env_on_usd)
    record("L14b", F, "D-005 — enveloppe liée à un compte d'une autre devise", "Compte USD", "INSERT enveloppe", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    ok, v = attempt(lambda c: c.execute(f"update public.duo_v3_households set currency='USD' where id='{H1}'"))
    record("L14c", F, "D-005 — devise figée dès la 1re période", "Période ouverte", "UPDATE currency", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    def usd_transfer(c):
        c.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'USD','fund-usd','transfer',%s,%s,current_date)", (str(uuid.UUID(int=7)), H1, UA, ID['period1']))
        c.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'USD',-500),(%s,%s,%s,'USD',500)", (str(uuid.UUID(int=7)), H1, usd2, str(uuid.UUID(int=7)), H1, usd1))
        return transfer(c, UA, usd1, usd2, 100, cc="USD")
    if ID.get('usd_ok') is False:
        record("L14d", F, "D-005 — RPC sur des comptes d'une autre devise", "—", "—", "—", "—", "sans objet : comptes USD refusés en L14", True, "—", status="Sans objet")
    ok, v = attempt(usd_transfer) if ID.get('usd_ok') is not False else (False, 'n/a')
    if ID.get('usd_ok') is not False: record("L14d", F, "D-005 — RPC sur des comptes d'une autre devise", "Comptes USD (L14) approvisionnés par écriture privilégiée", "A : transfert USD 1,00", "23503 (compte non éligible)",
           "authenticated", f"ok={ok} {v}", expect_err(ok, v, "23503"), "transaction annulée", status=None if expect_err(ok, v, "23503") else "Constat",
           note="La RPC vérifie que les comptes ont la devise demandée, pas celle du duo.")
    # CF-11 : devise modifiable avant la première opération, figée ensuite
    H6 = "20000000-0000-4000-8000-000000000006"
    with conn(autocommit=True) as c:
        c.execute(f"insert into public.duo_v3_households(id) values ('{H6}')")
        c.execute(f"insert into public.duo_v3_members(household_id,user_id,role) values ('{H6}','10000000-0000-4000-8000-000000000003','partner')") if False else None
        c.execute(f"select duo_v3_private.bootstrap_household('{H6}')")
        c.execute(f"select duo_v3_private.create_envelope('{H6}','Courses H6',true)")
    def change(c):
        c.execute(f"update public.duo_v3_households set currency='XAF' where id='{H6}'")
        return c.execute(f"select array_agg(distinct currency order by currency) from public.duo_v3_accounts where household_id='{H6}'").fetchone()[0] + \
               c.execute(f"select array_agg(distinct currency) from public.duo_v3_envelopes where household_id='{H6}'").fetchone()[0]
    ok, v = attempt_commit(change)
    record("L14e", F, "CF-11 — devise modifiable avant la première opération", "Duo 6 : période ouverte, 1 enveloppe, aucune opération ni allocation", "EUR → XAF",
           "accepté ; comptes et enveloppe en XAF", "postgres", f"ok={ok} {v}", ok and v == ['XAF', 'XAF'], "COMMIT réel", status=None if ok else "Écart CF-11",
           note="006 fige la devise dès la création de la première période (bootstrap), donc avant toute opération.")
    with conn(autocommit=True) as c:
        cur_h6 = c.execute(f"select currency from public.duo_v3_households where id='{H6}'").fetchone()[0]
        c.execute("select duo_v3_private.post_system(%s,(select id from public.duo_v3_periods where household_id=%s and state='open'),'allocation','h6-alloc',duo_v3_private.account_of(%s,'budget_source'),(select account_id from public.duo_v3_envelopes where household_id=%s),100,current_date)", (H6, H6, H6, H6))
    ok, v = attempt(lambda c: c.execute(f"update public.duo_v3_households set currency='{'EUR' if cur_h6 == 'XAF' else 'XAF'}' where id='{H6}'"))
    record("L14f", F, "CF-11 — devise figée après la première opération", "Duo 6 avec une écriture", "changement de devise", "23514", "postgres", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    def append_old(c):
        for acc, amt in ((ID['cash1'], 777), (ID['clearing1'], -777)):
            c.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',%s)", (ID['INC1'], H1, acc, amt))
        return "2 lignes ajoutées au versement initial déjà validé"
    ok, v = attempt(append_old)
    record("L15", F, "Immuabilité : ajout de lignes à une transaction validée", "Versement initial validé", "INSERT +7,77/-7,77 (postgres)", "refus", "postgres",
           f"ok={ok} {v}", not ok, "transaction annulée", status="Constat" if ok else None, note="Inchangé par 006. Voir revue L15.")

# =====================================================================================
def rpc_tests():
    F = "RPC (006)"
    E1, E2, RS, ET, EX = ID['ENV1_acc'], ID['ENV2_acc'], ID['reserve1'], ID['ENVT_acc'], ID['ENVX_acc']
    ok, v = attempt(lambda c: transfer(c, UA, ID['cash1'], E1, 4000))
    record("T01", F, "Transfert trésorerie → enveloppe", "Trésorerie 1 000 €", "A : trésorerie → Courses 40 €", "23503 (contrat 006)", "authenticated",
           str(v), expect_err(ok, v, "23503"), "transaction annulée", attendu_005="uuid (accepté)",
           adaptation="Changement de contrat documenté (doc lot 2, « transition du contrat RPC », test R21) : un transfert ne touche jamais la trésorerie")
    ok, v = attempt(lambda c: transfer(c, UA, RS, E1, 3000))
    record("T01b", F, "Réserve → enveloppe (D-015)", "Réserve 50 €", "A : réserve → Courses 30 €", "uuid", "authenticated", f"ok={ok} {v}", ok, "transaction annulée")
    def replay(c):
        a = transfer(c, UA, E1, E2, 500, key="replay-1"); b = transfer(c, UA, E1, E2, 500, key="replay-1")
        c.execute("reset role"); return (a == b, c.execute("select count(*) from public.duo_v3_transactions where idempotency_key='replay-1'").fetchone()[0])
    ok, v = attempt(replay)
    record("T02", F, "Rejeu identique", "—", "même clé ×2", "même uuid, 1 transaction", "authenticated", f"{v}", ok and v == (True, 1), "transaction annulée")
    ok, v = attempt(lambda c: (transfer(c, UA, E1, E2, 500, key="replay-2"), transfer(c, UA, E1, E2, 600, key="replay-2")))
    record("T03", F, "Clé réutilisée, montant différent", "—", "5 € puis 6 €", "23505", "authenticated", str(v), expect_err(ok, v, "23505"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, E2, 500, key="replay-3") == transfer(c, UB, E1, E2, 500, key="replay-3"))
    record("T04", F, "Transfert : même clé utilisée par le partenaire", "—", "A puis B", "CF-06 : deux opérations distinctes (clé par auteur)", "authenticated",
           f"ok={ok} B obtient la transaction de A={v}", ok and v is False, "transaction annulée", status=None if (ok and v is False) else "Écart CF-06",
           attendu_005="décision requise (constat)", adaptation="Attente issue de CF-06 (25/11), le test 005 n'avait pas d'attente")
    ok, v = attempt(lambda c: expense(c, UA, ID['ENV1'], 1200, key="rp-exp") == expense(c, UB, ID['ENV1'], 1200, key="rp-exp"))
    record("T04b", F, "Dépense : même clé utilisée par le partenaire", "—", "A puis B", "CF-06 : deux opérations distinctes", "authenticated",
           f"ok={ok} B obtient la dépense de A={v}", ok and v is False, "transaction annulée", status=None if (ok and v is False) else "Écart CF-06",
           attendu_005="décision requise (constat)", adaptation="Attente issue de CF-06")
    ok, v = attempt(lambda c: (contribution(c, UA, 1000, key="rp-con"), contribution(c, UB, 1000, key="rp-con")))
    record("T04c", F, "Versement : même clé utilisée par le partenaire", "—", "A puis B", "CF-06 : deux opérations distinctes", "authenticated",
           f"ok={ok} {v}", ok, "transaction annulée", status=None if ok else "Écart CF-06",
           note="006 : post_contribution refuse (23505) car il vérifie l'auteur mais la clé reste unique par duo ; incohérent avec transfert et dépense.")
    ok, v = attempt(lambda c: transfer(c, UC, E1, E2, 100))
    record("T05", F, "Non-membre refusé", "—", "C dans duo 1", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, ID['ENV2A_acc'], 100))
    record("T06", F, "Compte d'un autre duo refusé", "—", "duo 1 → duo 2", "23503", "refus", str(v), expect_err(ok, v, "23503"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, ID['clearing1'], E1, 100000))
    record("T07", F, "Compte clearing refusé", "—", "extérieur → Courses", "23503", "refus", str(v), expect_err(ok, v, "23503"), "transaction annulée")
    for sid, amt, lab in (("T08a", 0, "zéro"), ("T08b", -100, "négatif"), ("T08c", decimal.Decimal("1.5"), "fractionnaire"), ("T08d", 10**38, "10^38")):
        ok, v = attempt(lambda c, a=amt: transfer(c, UA, E1, E2, a))
        record(sid, F, f"Montant {lab} refusé", "—", f"{amt}", "22023", "refus", str(v), expect_err(ok, v, "22023"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, E1, 100))
    record("T09", F, "Source = destination", "—", "Courses → Courses", "22023", "refus", str(v), expect_err(ok, v, "22023"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, E2, 100, cc="USD"))
    record("T10", F, "Devise différente", "—", "déclaré USD", "23503", "refus", str(v), expect_err(ok, v, "23503"), "transaction annulée")
    def anon_member(c):
        c.execute(f"insert into public.duo_v3_members(household_id,user_id,role) values ('{H2}','{UZ}','partner')")
        return transfer(c, UZ, ID['ENV2A_acc'], ID['reserve2'], 100, cc="XAF", h=H2, anonymous=True)
    ok, v = attempt(anon_member)
    record("T11", F, "Session anonyme refusée", "—", "Z is_anonymous", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, None, E1, E2, 100, role="anon"))
    record("T12", F, "Rôle anon refusé", "—", "anon : RPC", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, None, E1, E2, 100, role="service_role"))
    record("T13", F, "service_role sans sujet", "—", "service_role", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, E2, 40001))
    record("T14", F, "Arbitrage 21/11 : un transfert ne rend jamais une enveloppe négative", "Courses 400,00 €", "A : 400,01 € → Vacances", "23514",
           "authenticated", str(v), expect_err(ok, v, "23514"), "transaction annulée", attendu_005="23514 (échoué sur 005 : -70 € accepté)")
    rs = bal(RS)
    ok, v = attempt(lambda c: transfer(c, UA, RS, E1, rs + 1))
    record("T15", F, "Réserve insuffisante (D-015)", f"Réserve {rs/100:.2f} €", "solde + 0,01 €", "23514", "authenticated", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    ok, v = attempt(lambda c: transfer(c, UA, E1, EX, 100))
    record("T16", F, "Enveloppe archivée exclue des transferts", "« Ancienne » archivée", "Courses → Ancienne", "23503", "authenticated", str(v), expect_err(ok, v, "23503"), "transaction annulée")
    ok, v = attempt(lambda c: expense(c, UA, ID['ENVX'], 100))
    record("T17", F, "Dépense sur enveloppe archivée : refus explicite", "—", "dépense 1 €", "23503 + hint", "authenticated", str(v), expect_err(ok, v, "23503"), "transaction annulée")
    def overspend(c):
        expense(c, UA, ID['ENVT'], 2500); c.execute("reset role")
        return int(c.execute("select balance_minor from public.duo_v3_envelope_balances where envelope_id=%s", (ID['ENVT'],)).fetchone()[0])
    ok, v = attempt(overspend)
    record("T18", F, "D-016 : la dépense peut créer un dépassement", "Tampon 0 €", "dépense 25 €", "accepté, solde -25 €", "authenticated", f"ok={ok} solde={v}", ok and v == -2500, "transaction annulée")
    ok, v = attempt(lambda c: expense(c, UA, ID['ENV1'], 100, day="current_date + 2"))
    record("T19", F, "Dépense réalisée datée dans le futur", "—", "J+2", "22023", "authenticated", str(v), expect_err(ok, v, "22023"), "transaction annulée")
    def from_negative(c):
        expense(c, UA, ID['ENVT'], 2500); return transfer(c, UA, ET, E1, 1)
    ok, v = attempt(from_negative)
    record("T20", F, "Transfert depuis une enveloppe déjà négative", "Tampon -25 €", "1 centime", "23514", "authenticated", str(v), expect_err(ok, v, "23514"), "transaction annulée")
    for sid, fn in (("T21a", "duo_v3_private.ensure_current_period(%s)"), ("T21b", "duo_v3_private.bootstrap_household(%s)"), ("T21c", "duo_v3_private.create_envelope(%s,'x',true)")):
        ok, v = attempt(lambda c, f=fn: (as_role(c, "authenticated", UA), c.execute("select " + f, (H1,))))
        record(sid, F, "Fonctions serveur non exécutables par les clients", "—", f"A : {fn.split('(')[0]}", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")

def squat_test():
    F = "Sécurité clés système"
    H5 = "20000000-0000-4000-8000-000000000005"
    with conn(autocommit=True) as c:
        c.execute(f"insert into public.duo_v3_households(id) values ('{H5}')")
        c.execute("insert into auth.users(id,aud,role,email) values ('10000000-0000-4000-8000-000000000005','authenticated','authenticated','e@example.invalid')")
        c.execute(f"insert into public.duo_v3_members(household_id,user_id,role) values ('{H5}','10000000-0000-4000-8000-000000000005','owner')")
        p5 = str(c.execute(f"select duo_v3_private.bootstrap_household('{H5}')").fetchone()[0])
        e5 = str(c.execute(f"select duo_v3_private.create_envelope('{H5}','Loisirs H5',false)").fetchone()[0])
        e6 = str(c.execute(f"select duo_v3_private.create_envelope('{H5}','Autre H5',true)").fetchone()[0])
        c.execute("select duo_v3_private.set_allocation(%s,5000,(select starts_on from public.duo_v3_periods where id=%s))", (e5, p5))
        c.execute("select duo_v3_private.set_allocation(%s,1000,(select starts_on from public.duo_v3_periods where id=%s))", (e6, p5))
        c.execute("select duo_v3_private.post_period_allocations(%s,%s)", (H5, p5))
        a5, a6 = (str(c.execute("select account_id from public.duo_v3_envelopes where id=%s", (x,)).fetchone()[0]) for x in (e5, e6))
        ends = c.execute("select ends_at from public.duo_v3_periods where id=%s", (p5,)).fetchone()[0]
    key = f"carry:{p5}:{e5}"     # clé prévisible : identifiants lisibles par le membre (RLS)
    okm, vm = attempt_commit(lambda cur: transfer(cur, "10000000-0000-4000-8000-000000000005", a6, a5, 1, key=key, h=H5))
    okc, vc = attempt_commit(lambda cur: (cur.execute("select duo_v3_private.close_period(%s,%s,%s)", (H5, p5, ends)), cur.fetchone()[0])[-1])
    with conn(autocommit=True) as c:
        snap = c.execute("select to_reserve_minor, transaction_id::text from public.duo_v3_period_envelope_closes where period_id=%s and envelope_id=%s", (p5, e5)).fetchone()
        res = c.execute("select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e where e.account_id=duo_v3_private.account_of(%s,'reserve')", (H5,)).fetchone()[0]
        kind = c.execute("select kind, origin from public.duo_v3_transactions where id=%s", (snap[1],)).fetchone() if snap and snap[1] else None
    consistent = snap is not None and int(res) == int(snap[0]) and kind == ('carry', 'system')
    record("S01", F, "Une clé d'idempotence membre ne peut pas préempter une écriture système (report D-014)",
           "duo 5 : Loisirs 50 € sans report", "E (seul membre du duo 5) poste un transfert de 0,01 € avec la clé « carry:<période>:<enveloppe> », puis clôture",
           "report de 50,01 € vers la réserve, instantané cohérent", "authenticated puis système",
           f"transfert membre={okm} clôture={okc} instantané to_reserve={snap and snap[0]} tx={kind} réserve réelle={res}", consistent, "COMMIT réel",
           note="Si non cohérent : le report n'est pas écrit mais l'instantané de clôture l'annonce (écart grand livre / instantané).")

# =====================================================================================
def rls_tests():
    F = "RLS / privilèges (006)"
    with conn(autocommit=True) as c0:
        n1 = c0.execute(f"select count(*) from public.duo_v3_entries where household_id='{H1}'").fetchone()[0]
        nall = c0.execute("select count(*) from public.duo_v3_entries").fetchone()[0]
    def count(c, role, sub, table, where=""):
        as_role(c, role, sub); c.execute(f"select count(*) from public.{table} {where}"); return c.fetchone()[0]
    ok, v = attempt(lambda c: (count(c, "authenticated", UA, "duo_v3_entries"), count(c, "authenticated", UA, "duo_v3_households")))
    record("R01", F, "A lit son duo uniquement", f"duo 1 : {n1} lignes", "SELECT", f"({n1}, 1)", "lecture membre", f"{v}", ok and v == (n1, 1), "transaction annulée")
    ok, v = attempt(lambda c: count(c, "authenticated", UB, "duo_v3_entries"))
    record("R02", F, "B lit le grand livre commun", "—", "SELECT", f"{n1}", "lecture membre", f"{v}", ok and v == n1, "transaction annulée")
    for sid, tbl in (("R03", "duo_v3_entries"), ("R03b", "duo_v3_periods"), ("R03c", "duo_v3_envelopes"), ("R03d", "duo_v3_envelope_balances"), ("R03e", "duo_v3_household_position"), ("R03f", "duo_v3_allocation_versions")):
        ok, v = attempt(lambda c, t=tbl: count(c, "authenticated", UC, t, f"where household_id='{H1}'"))
        record(sid, F, f"Isolation inter-duos : {tbl}", "C membre des duos 2 et 3", "SELECT duo 1", "0", "aucune ligne", f"{v}", ok and v == 0, "transaction annulée")
    ok, v = attempt(lambda c: count(c, "authenticated", str(uuid.uuid4()), "duo_v3_envelope_balances"))
    record("R04", F, "Utilisateur sans duo", "—", "SELECT vue soldes", "0", "aucune ligne", f"{v}", ok and v == 0, "transaction annulée")
    for sid, tbl in (("R05", "duo_v3_entries"), ("R05b", "duo_v3_envelope_balances"), ("R05c", "duo_v3_periods")):
        ok, v = attempt(lambda c, t=tbl: count(c, "anon", None, t))
        record(sid, F, f"anon : {tbl}", "—", "SELECT", "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    for sid, stmt in (("R06a", f"insert into public.duo_v3_households(id) values ('{uuid.uuid4()}')"),
                      ("R06b", f"update public.duo_v3_accounts set label='x' where id='{ID['cash1']}'"),
                      ("R06c", f"delete from public.duo_v3_members where user_id='{UB}'"),
                      ("R06d", f"insert into public.duo_v3_members(household_id,user_id,role) values ('{H2}','{UA}','partner')"),
                      ("R06e", f"update public.duo_v3_envelopes set name='x' where id='{ID['ENV1']}'"),
                      ("R06f", f"insert into public.duo_v3_allocation_versions(household_id,envelope_id,amount_minor,effective_from) values ('{H1}','{ID['ENV1']}',1,current_date)")):
        ok, v = attempt(lambda c, s=stmt: (as_role(c, "authenticated", UA), c.execute(s)))
        record(sid, F, "Aucune écriture directe client", "—", stmt[:60], "42501", "refus", str(v), expect_err(ok, v, "42501"), "transaction annulée")
    for sid, role, sub in (("R07a", "authenticated", UC), ("R07b", "anon", None)):
        ok, v = attempt(lambda c, r=role, s=sub: (as_role(c, r, s), c.execute("truncate public.duo_v3_entries, public.duo_v3_transactions")))
        record(sid, F, f"TRUNCATE par {role}", "—", "TRUNCATE", "42501", "refus", f"ok={ok} {v}", not ok, "transaction annulée")
    ok, v = attempt(lambda c: (as_role(c, "authenticated", UC), c.execute("select duo_v3_private.is_member(%s,%s)", (H1, UA)), c.fetchone()[0])[-1])
    record("R08", F, "Oracle is_member fermé", "—", "C : is_member(duo1, A)", "42501", "refus", f"ok={ok} {v}", not ok, "transaction annulée")
    ok, v = attempt(lambda c: (as_role(c, "authenticated", UA), c.execute("select household_id::text, currency from public.duo_v3_household_position order by 2"), c.fetchall())[-1])
    record("R10", F, "Position : uniquement le duo du membre", "—", "A : SELECT position", "lignes du duo 1 seulement", "lecture membre", f"{v}",
           ok and len(v) >= 1 and all(h == H1 for h, _ in v), "transaction annulée", note="Une ligne par devise : la ligne USD vient des comptes créés en L14.")
    def svc(c):
        c.execute("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)"); c.execute("set local role service_role")
        return c.execute("select count(*) from public.duo_v3_entries").fetchone()[0]
    ok, v = attempt(svc)
    record("R11", F, "service_role contourne RLS", "—", "SELECT", f"{nall}", "réservé serveur", f"{v}", ok and v == nall, "transaction annulée", status="Constat")

# =====================================================================================
def membership_tests():
    F = "Membres"
    def third(c):
        u = str(uuid.uuid4()); c.execute("insert into auth.users(id) values (%s)", (u,))
        c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'partner')", (H1, u))
        return c.execute(f"select count(*) from public.duo_v3_members where household_id='{H1}'").fetchone()[0]
    ok, v = attempt(third)
    record("M01", F, "D-001 — 2 membres max", "A, B", "3e membre", "refus", "postgres", f"ok={ok} membres={v}", not ok, "transaction annulée", status="Constat" if ok else None, note="Lot 3")
    ok, v = attempt(lambda c: c.execute(f"insert into public.duo_v3_members(household_id,user_id,role) values ('{H2}','{UA}','owner')"))
    record("M02", F, "Un seul owner par duo", "—", "2e owner", "23505", "postgres", str(v), expect_err(ok, v, "23505"), "transaction annulée")
    ok, v = attempt(lambda c: c.execute(f"delete from public.duo_v3_members where user_id='{UA}' and household_id='{H1}'"))
    record("M03", F, "S11c — départ d'un membre ayant écrit", "—", "DELETE membre A", "statut 'left' (lot 3)", "—", str(v), False, "transaction annulée", status="Constat")
    ok, v = attempt(lambda c: c.execute(f"delete from auth.users where id='{UB}'"))
    record("M04", F, "Suppression du compte Auth d'un membre", "B", "DELETE auth.users", "parcours défini", "—", f"ok={ok} {v}", False, "transaction annulée", status="Constat")

# =====================================================================================
def concurrency_tests():
    F = "Concurrence (sessions réelles, COMMIT)"
    def run_parallel(n, fn, user="postgres"):
        out = [None] * n; barrier = threading.Barrier(n)
        def worker(i):
            with conn(user) as c:
                try:
                    with c.cursor() as cur:
                        barrier.wait(); out[i] = ("ok", fn(cur, i))
                    c.commit()
                except psycopg.Error as e:
                    c.rollback(); out[i] = ("err", sqlstate(e))
        ts = [threading.Thread(target=worker, args=(i,)) for i in range(n)]; [t.start() for t in ts]; [t.join() for t in ts]; return out
    E1, E2 = ID['ENV1_acc'], ID['ENV2_acc']
    key = f"conc-{uuid.uuid4()}"
    out = run_parallel(8, lambda cur, i: transfer(cur, UA if i % 2 else UB, E1, E2, 100, key=key))
    with conn(autocommit=True) as c: n = c.execute("select count(*) from public.duo_v3_transactions where idempotency_key=%s", (key,)).fetchone()[0]
    ids = {v for s, v in out if s == "ok"}
    record("C01", F, "8 rejeux simultanés du même transfert (A et B)", "—", "8 sessions", "1 transaction, même uuid", "authenticated",
           f"{[s for s,_ in out]} uuids={len(ids)} lignes={n}", len(ids) == 1 and n == 1 and all(s == "ok" for s, _ in out), "COMMIT réel")
    before = bal(E2)
    out = run_parallel(10, lambda cur, i: transfer(cur, UA, E1, E2, 100))
    record("C02", F, "10 transferts simultanés, clés distinctes, fonds suffisants", "—", "10 × 1 €", "+10 €", "authenticated", f"ok={sum(s=='ok' for s,_ in out)} Δ={bal(E2)-before}", bal(E2) - before == 1000, "COMMIT réel")
    with conn(autocommit=True) as c:
        c.execute("select duo_v3_private.post_system(%s,%s,'allocation','seed-c05',%s,%s,10000,current_date)", (H1, ID['period1'], ID['budget_source1'], ID['ENVT_acc']))
    start = bal(ID['ENVT_acc'])
    out = run_parallel(10, lambda cur, i: transfer(cur, UA if i % 2 else UB, ID['ENVT_acc'], E2, 3000))
    okc = sum(s == "ok" for s, _ in out); errs = sorted({v for s, v in out if s == "err"}); end = bal(ID['ENVT_acc'])
    record("C05", F, "Transferts simultanés avec fonds insuffisants", f"Tampon {start/100:.2f} €", "10 sessions × 30 €",
           "3 réussites, 7 × 23514, solde 10 € ≥ 0", "authenticated", f"réussites={okc} erreurs={errs} solde_final={end}",
           okc == 3 and errs == ["23514"] and end == 1000, "COMMIT réel")
    with conn(autocommit=True) as c:
        t = c.execute("select id from public.duo_v3_transactions where idempotency_key=%s", (key,)).fetchone()[0]
    def rev(cur, i):
        cur.execute("insert into public.duo_v3_transactions(household_id,currency,idempotency_key,kind,created_by,reverses_transaction_id,period_id,occurred_on) values (%s,'EUR',%s,'reversal',%s,%s,%s,current_date) returning id",
                    (H1, f"rev-{i}", UA, t, ID['period1']))
        rid = cur.fetchone()[0]
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',100),(%s,%s,%s,'EUR',-100)", (rid, H1, E1, rid, H1, E2))
        return str(rid)
    out = run_parallel(4, rev)
    record("C03", F, "4 annulations simultanées du même transfert", "—", "4 reversals", "1 seule", "écrivain privilégié", f"{[s+':'+(v if s=='err' else 'ok') for s,v in out]}", sum(s == "ok" for s, _ in out) == 1, "COMMIT réel")
    # C06 — clôtures concurrentes (duo 3 : 3 périodes à rattraper) : 4 rattrapages + 4 dépenses tardives simultanés
    with conn(autocommit=True) as c:
        before_p = c.execute("select count(*) from public.duo_v3_periods where household_id=%s", (H3,)).fetchone()[0]
    def mixed(cur, i):
        if i < 4:
            cur.execute("select duo_v3_private.ensure_current_period(%s)", (H3,)); return str(cur.fetchone()[0])
        return expense(cur, UC, ID['ENV3'], 100 + i, key=f"late-{i}", day="current_date - 65", h=H3)
    out = run_parallel(8, mixed)
    with conn(autocommit=True) as c:
        periods = c.execute("select starts_on, ends_on, state from public.duo_v3_periods where household_id=%s order by starts_on", (H3,)).fetchall()
        closes = c.execute("select count(*), count(distinct period_id) from public.duo_v3_period_closes where household_id=%s", (H3,)).fetchone()
        carries = c.execute("select count(*), count(distinct idempotency_key) from public.duo_v3_transactions where household_id=%s and kind in ('carry','allocation')", (H3,)).fetchone()
        late = c.execute("select count(*), bool_and(late_imputation), count(distinct period_id) from public.duo_v3_transactions where household_id=%s and kind='expense'", (H3,)).fetchone()
        opened = c.execute("select id from public.duo_v3_periods where household_id=%s and state='open'", (H3,)).fetchall()
        contiguous = all(periods[i][1] == periods[i + 1][0] for i in range(len(periods) - 1))
        late_open = c.execute("select bool_and(t.period_id = p.id) from public.duo_v3_transactions t, public.duo_v3_periods p where t.household_id=%s and t.kind='expense' and p.household_id=%s and p.state='open'", (H3, H3)).fetchone()[0]
    ok6 = all(s == "ok" for s, _ in out) and len(opened) == 1 and contiguous and closes[0] == closes[1] == len(periods) - 1 and carries[0] == carries[1] and late[0] == 4 and late[1] and late_open
    record("C06", F, "Clôtures concurrentes + opérations tardives (D-029)", f"duo 3 : {before_p} période(s), créé il y a 70 jours",
           "4 rattrapages + 4 dépenses datées J-65, simultanés", "1 clôture par période échue, 1 période ouverte, aucun double report, dépenses tardives au cycle ouvert",
           "postgres + authenticated", f"périodes={len(periods)} ouvertes={len(opened)} contiguës={contiguous} clôtures={closes} reports/allocations(n, clés distinctes)={carries} tardives={late} au_cycle_ouvert={late_open} résultats={[s for s,_ in out]}",
           ok6, "COMMIT réel", note=f"erreurs={sorted({v for s_, v in out if s_ == 'err'})}")
    with conn(autocommit=True) as c:
        p4 = c.execute("select count(*) from public.duo_v3_periods where household_id=%s", (H4,)).fetchone()[0]
    def mixed4(cur, i):
        if i < 4:
            cur.execute("select duo_v3_private.ensure_current_period(%s)", (H4,)); return str(cur.fetchone()[0])
        return expense(cur, UC, ID['ENV4'], 100 + i, key=f"late4-{i}", day="current_date - 20", h=H4)
    out = run_parallel(8, mixed4)
    with conn(autocommit=True) as c:
        periods = c.execute("select starts_on, ends_on, state from public.duo_v3_periods where household_id=%s order by starts_on", (H4,)).fetchall()
        closes = c.execute("select count(*) from public.duo_v3_period_closes where household_id=%s", (H4,)).fetchone()[0]
        sysn = c.execute("select count(*), count(distinct idempotency_key) from public.duo_v3_transactions where household_id=%s and kind in ('carry','allocation')", (H4,)).fetchone()
        late = c.execute("select count(*), bool_and(late_imputation) from public.duo_v3_transactions where household_id=%s and kind='expense'", (H4,)).fetchone()
    ok6b = all(s_ == "ok" for s_, _ in out) and len(periods) == p4 + 1 and closes == 1 and sysn[0] == sysn[1] and late[0] == 4
    record("C06b", F, "Clôture concurrente d'UNE période échue + dépenses tardives", f"duo 4 : {p4} période échue", "4 rattrapages + 4 dépenses J-20 simultanés",
           "1 clôture, aucun doublon, 4 dépenses imputées au cycle ouvert", "postgres + authenticated",
           f"périodes={len(periods)} clôtures={closes} système(n, clés)={sysn} dépenses(n, tardives)={late} résultats={[s_ for s_,_ in out]}", ok6b, "COMMIT réel",
           note=f"erreurs={sorted({v for s_, v in out if s_ == 'err'})}")
    key2 = f"conc-cf06-{uuid.uuid4()}"
    out = run_parallel(8, lambda cur, i: transfer(cur, UA if i % 2 else UB, E1, E2, 100, key=key2))
    with conn(autocommit=True) as c:
        rows = c.execute("select created_by::text, count(*) from public.duo_v3_transactions where idempotency_key=%s group by 1 order by 1", (key2,)).fetchall()
    record("C01-CF06", F, "CF-06 : 8 envois simultanés, même clé, A (×4) et B (×4)", "—", "8 sessions",
           "1 transaction par auteur (2 au total), chaque auteur rejoue la sienne", "authenticated", f"{[s_ for s_,_ in out]} par_auteur={rows}",
           all(s_ == "ok" for s_, _ in out) and len(rows) == 2 and all(n_ == 1 for _, n_ in rows), "COMMIT réel", status=None if (len(rows) == 2 and all(n_ == 1 for _, n_ in rows)) else "Écart CF-06",
           adaptation="Nouvelle attente CF-06 ; C01 (attente historique « 1 transaction pour A et B ») est conservé tel quel")
    for sid, fn, lab in (("C07a", lambda cur, i: expense(cur, UA if i % 2 else UB, ID['ENV1'], 777, key="conc-exp"), "dépense (A et B)"),
                         ("C07b", lambda cur, i: contribution(cur, UA, 888, key="conc-con"), "versement (A)")):
        out = run_parallel(8, fn)
        k = "conc-exp" if sid == "C07a" else "conc-con"
        with conn(autocommit=True) as c: n = c.execute("select count(*) from public.duo_v3_transactions where idempotency_key=%s", (k,)).fetchone()[0]
        record(sid, F, f"8 rejeux simultanés : {lab}", "—", "8 sessions même clé", "1 transaction", "authenticated", f"{[s for s,_ in out]} lignes={n}",
               n == 1 and all(s == "ok" for s, _ in out), "COMMIT réel")
    key3 = f"conc-cf06-exp-{uuid.uuid4()}"
    out = run_parallel(8, lambda cur, i: expense(cur, UA if i % 2 else UB, ID['ENV1'], 555, key=key3))
    with conn(autocommit=True) as c:
        rows = c.execute("select created_by::text, count(*) from public.duo_v3_transactions where idempotency_key=%s group by 1 order by 1", (key3,)).fetchall()
    ok7 = all(s_ == "ok" for s_, _ in out) and len(rows) == 2 and all(n_ == 1 for _, n_ in rows)
    record("C07a-CF06", F, "VARIANTE CF-06 de C07a : 8 dépenses simultanées, même clé, A (×4) et B (×4)", "—", "8 sessions",
           "1 dépense par auteur (2 au total)", "authenticated", f"{[s_ for s_,_ in out]} par_auteur={rows}", ok7, "COMMIT réel",
           status=None if ok7 else "Écart CF-06", adaptation="Variante documentée (POST006-07) ; C07a conserve son attente historique")
    # C04b — instantané atomique par RPC (correctif F6), pendant des écritures
    with conn(autocommit=True) as c:
        has_f6 = c.execute("select count(*) from pg_proc where proname='duo_v3_get_envelope_snapshot'").fetchone()[0] == 1
    if not has_f6:
        record("C04b", F, "Instantané atomique par RPC (F6)", "—", "—", "—", "—", "sans objet : fonction absente de 006", True, "—", status="Sans objet")
    else:
        stop = threading.Event(); r2 = {"reads": 0, "bad": 0, "werr": 0}
        def w2():
            with conn() as c:
                while not stop.is_set():
                    try:
                        with c.cursor() as cur: transfer(cur, UA, E1, E2, 1)
                        c.commit()
                    except psycopg.Error: c.rollback(); r2["werr"] += 1
        def rd():
            with conn() as c:
                with c.cursor() as cur:
                    as_role(cur, "authenticated", UB)
                    while not stop.is_set():
                        snap = cur.execute("select public.duo_v3_get_envelope_snapshot(%s)", (H1,)).fetchone()[0]
                        envs = {e["envelopeId"]: e for e in snap["envelopes"]}
                        kb = "budgetBalance" if "budgetBalance" in envs[ID['ENV1']] else "actualBalance"   # 26/11 : champ renommé (POST006-04), valeur identique
                        tot = int(envs[ID['ENV1']][kb]) + int(envs[ID['ENV2']][kb])
                        r2["reads"] += 1; r2["bad"] += tot != base2
                c.rollback()
        with conn(autocommit=True) as c:
            base2 = c.execute(f"select sum(balance_minor) from public.duo_v3_envelope_balances where envelope_id in ('{ID['ENV1']}','{ID['ENV2']}')").fetchone()[0]
        ts = [threading.Thread(target=w2) for _ in range(3)] + [threading.Thread(target=rd)]
        [t.start() for t in ts]; time.sleep(4); stop.set(); [t.join() for t in ts]
        okc, vc = attempt(lambda c: (as_role(c, "authenticated", UC), c.execute("select public.duo_v3_get_envelope_snapshot(%s)", (H1,)), c.fetchone()[0])[-1])
        record("C04b", F, "Instantané atomique par RPC (F6) et isolation", "Somme Courses+Vacances constante", "3 écrivains + B lit l'instantané ; C lit le duo 1",
               "0 incohérence ; C : aucune enveloppe ni position", "lecture membre", f"lectures={r2['reads']} incohérences={r2['bad']} ; C → enveloppes={len(vc['envelopes']) if okc else vc} position={vc.get('position') if okc else ''}",
               r2["bad"] == 0 and r2["reads"] > 0 and okc and vc["envelopes"] == [] and vc["position"] is None, "COMMIT réel")
    # C04 — lecture : la vue de position (un énoncé) reste cohérente pendant des transferts Courses → Vacances
    stop = threading.Event(); res = {"single": 0, "split": 0, "reads": 0, "werr": 0}
    def writer():
        with conn() as c:
            while not stop.is_set():
                try:
                    with c.cursor() as cur: transfer(cur, UA, E1, E2, 1)
                    c.commit()
                except psycopg.Error:
                    c.rollback(); res["werr"] += 1
    with conn(autocommit=True) as c:
        base = c.execute(f"select sum(balance_minor) from public.duo_v3_envelope_balances where envelope_id in ('{ID['ENV1']}','{ID['ENV2']}')").fetchone()[0]
    def reader():
        with conn(autocommit=True) as c:
            while not stop.is_set():
                one = c.execute(f"select sum(balance_minor) from public.duo_v3_envelope_balances where envelope_id in ('{ID['ENV1']}','{ID['ENV2']}')").fetchone()[0]
                a = c.execute(f"select balance_minor from public.duo_v3_envelope_balances where envelope_id='{ID['ENV1']}'").fetchone()[0]
                b = c.execute(f"select balance_minor from public.duo_v3_envelope_balances where envelope_id='{ID['ENV2']}'").fetchone()[0]
                res["reads"] += 1; res["single"] += one != base; res["split"] += (a + b) != base
    ts = [threading.Thread(target=writer) for _ in range(3)] + [threading.Thread(target=reader)]
    [t.start() for t in ts]; time.sleep(4); stop.set(); [t.join() for t in ts]
    record("C04", F, "Lecture cohérente (vue duo_v3_envelope_balances)", "Somme Courses+Vacances constante", "3 écrivains + 1 lecteur, 4 s",
           "0 incohérence en un énoncé", "lecture", f"lectures={res['reads']} incohérences 1 énoncé={res['single']} / 2 énoncés={res['split']} erreurs écrivains={res['werr']}",
           res["single"] == 0, "COMMIT réel", note="Les vues 006 sont lues en un énoncé ; deux requêtes successives restent incohérentes. Voir revue C04.")

# =====================================================================================
def invariants():
    F = "Invariants 006"
    with conn(autocommit=True) as c:
        per_book = c.execute("select count(*) from (select e.transaction_id, a.book from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id group by 1,2 having sum(e.amount_minor)<>0) s").fetchone()[0]
        per_duo = c.execute("select a.household_id::text, a.book, sum(e.amount_minor) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id group by 1,2 order by 1,2").fetchall()
        no_period = c.execute("select count(*) from public.duo_v3_transactions where period_id is null").fetchone()[0]
        view_vs_ledger = c.execute("select count(*) from public.duo_v3_envelope_balances b join public.duo_v3_envelopes e on e.id=b.envelope_id where b.balance_minor <> (select coalesce(sum(amount_minor),0) from public.duo_v3_entries x where x.account_id=e.account_id)").fetchone()[0]
        pos = c.execute("select cash_minor, envelopes_minor, reserve_minor, allocated_minor, spent_minor, funding_gap_minor, funding_alert from public.duo_v3_household_position where household_id=%s", (H1,)).fetchone()
        flows = c.execute("""select coalesce(sum(e.amount_minor) filter (where t.kind='contribution'),0), coalesce(sum(-e.amount_minor) filter (where t.kind='expense'),0)
                             from public.duo_v3_entries e join public.duo_v3_transactions t on t.id=e.transaction_id where e.account_id=%s""", (ID['cash1'],)).fetchone()
        alloc_cash = c.execute("select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_transactions t on t.id=e.transaction_id join public.duo_v3_accounts a on a.id=e.account_id where t.kind in ('allocation','carry','transfer') and a.book='cash'").fetchone()[0]
    record("I01", F, "Chaque transaction équilibrée dans chaque livre", "après campagne", "contrôle global", "0", "—", f"{per_book}", per_book == 0, "requête")
    record("I02", F, "Somme nulle par duo et par livre", "—", "Σ", "0 partout", "—", f"{per_duo}", all(int(s) == 0 for *_, s in per_duo), "requête")
    record("I03", F, "Toute transaction imputée à une période", "—", "period_id null", "0", "—", f"{no_period}", no_period == 0, "requête")
    record("I04", F, "Vue des soldes = grand livre", "—", "comparaison", "0 écart", "—", f"{view_vs_ledger}", view_vs_ledger == 0, "requête")
    record("I05", F, "Budget distinct de l'argent réel", "Versements, allocations, transferts, dépenses",
           "allocations/reports/transferts sans ligne trésorerie ; trésorerie = versements − dépenses ; écart = trésorerie − (enveloppes + réserve)", "0 ligne trésorerie ; identités vérifiées", "—",
           f"lignes trésorerie des allocations/reports/transferts={alloc_cash} ; trésorerie={pos[0]} = versements {flows[0]} − dépenses {flows[1]} ; enveloppes={pos[1]} réserve={pos[2]} écart={pos[5]} alerte={pos[6]}",
           alloc_cash == 0 and pos[0] == flows[0] - flows[1] and pos[5] == pos[0] - pos[1] - pos[2], "requête", attendu_005="constat (un seul livre)")

if __name__ == "__main__":
    t0 = time.time(); fresh_db()
    with conn(autocommit=True) as c: server = c.execute("select version()").fetchone()[0]
    ledger_tests(); rpc_tests(); squat_test(); rls_tests(); membership_tests(); concurrency_tests(); invariants()
    summary = {}
    for r in RESULTS: summary[r["statut"]] = summary.get(r["statut"], 0) + 1
    out = dict(label=LABEL, template=TEMPLATE, serveur=server, horodatage=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
               duree_s=round(time.time() - t0, 1), bilan=summary, resultats=RESULTS)
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"), exist_ok=True)
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", f"{LABEL}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))
