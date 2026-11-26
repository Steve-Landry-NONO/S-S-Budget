#!/usr/bin/env python3
"""Duo Budget V3 — approfondissements du lot A (26/11) sur la 006 révisée candidate.

Familles : RAT (rattrapage multi-cycles), CLE (isolation des clés système / membres), SCE (scellement
posting_xid, sous-transactions comprises), AUT (autorisation revérifiée sous verrou, course départ/écriture),
UNI (unités monétaires sur toutes les colonnes stockées), DEV (verrouillage de la devise, CF-11),
CON (compatibilité concurrente), LEC (cohérence de lecture pendant un rattrapage).

Les attentes viennent des règles (POST006-01, F1–F7, CF-06, CF-11, D-013/D-014/D-017/D-018) et d'un
oracle Python indépendant pour les reports — jamais du résultat observé. Le même script tourne sur la
006 originale (b006) pour mesurer l'écart : sur b006, les échecs attendus sont ceux des défauts D6-01,
D6-02, F4, F5, F7 ; ils ne sont pas masqués.
Usage : python3 deep006r1.py <template_db> <label>   ->  results/<label>.json
"""
import json, sys, uuid, threading, time
import psycopg

HOST, PORT = "/tmp", 54317
TEMPLATE, LABEL = sys.argv[1], sys.argv[2]
DB = f"dp_{LABEL}"
UA, UB, UC = (f"10000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))

def admin(): return psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="postgres", autocommit=True)
def conn(user="postgres", autocommit=False): return psycopg.connect(host=HOST, port=PORT, user=user, dbname=DB, autocommit=autocommit)
def st(e): return getattr(e, "sqlstate", None) or "?"
def as_user(cur, sub):
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "authenticated", "sub": sub, "aud": "authenticated", "is_anonymous": False}),))
    cur.execute("set local role authenticated")
def q(sql, args=()):
    with conn(autocommit=True) as c: return c.execute(sql, args).fetchall()
def q1(sql, args=()): return q(sql, args)[0][0]

RESULTS = []
def record(sid, fam, rule, action, expected, observed, ok, note="", status=None):
    s = status or ("Réussi" if ok else "Échoué")
    RESULTS.append(dict(id=sid, famille=fam, regle=rule, action=action, attendu=expected, observe=observed, statut=s, note=note))
    print(f"{sid:8} {s:8} {observed[:120]}", flush=True)

def fresh():
    with admin() as c:
        c.execute(f'drop database if exists "{DB}" with (force)')
        c.execute(f'create database "{DB}" template "{TEMPLATE}" owner postgres')
    with conn(autocommit=True) as c:
        c.execute(f"""insert into auth.users(id,aud,role,email,is_anonymous) values
          ('{UA}','authenticated','authenticated','a@example.invalid',false),('{UB}','authenticated','authenticated','b@example.invalid',false),
          ('{UC}','authenticated','authenticated','c@example.invalid',false)""")
IS_REV1 = None
def detect_rev1():
    return bool(q1("select count(*) from pg_attribute where attrelid='public.duo_v3_transactions'::regclass and attname='posting_xid'"))

ENVS = (("Plus", 10000, True, 0), ("VersReserve", 5000, False, 0), ("Deficit", 1000, False, 3000))
def make_duo(months_late, members=(UA, UB), envs=ENVS, cur_tz="Europe/Paris"):
    """Duo amorcé `months_late` cycles dans le passé ; dépense privilégiée dans la 1re période (déficit)."""
    h = str(uuid.uuid4())
    with conn(autocommit=True) as c:
        c.execute("insert into public.duo_v3_households(id,currency,cycle_start_day,time_zone) values (%s,'EUR',1,%s)", (h, cur_tz))
        for i, u in enumerate(members):
            c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,%s)", (h, u, 'owner' if i == 0 else 'partner'))
        c.execute("select duo_v3_private.bootstrap_household(%s, ((date_trunc('month', now() at time zone %s) - make_interval(months => %s) + interval '10 days') at time zone %s))",
                  (h, cur_tz, months_late, cur_tz))
        pid, starts = c.execute("select id, starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()
        ids = {}
        for name, alloc, carry, exp in envs:
            e = c.execute("select duo_v3_private.create_envelope(%s,%s,%s)", (h, name, carry)).fetchone()[0]
            c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, alloc, starts)); ids[name] = str(e)
        c.execute("select duo_v3_private.post_period_allocations(%s,%s)", (h, pid))
    with conn() as c:
        with c.cursor() as cur:
            for name, alloc, carry, exp in envs:
                if not exp: continue
                tid = str(uuid.uuid4())
                cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR',%s,'expense',%s,%s,%s)",
                            (tid, h, f"seed-exp-{name}", members[0], pid, starts))
                acc = q1("select account_id from public.duo_v3_envelopes where id=%s", (ids[name],))
                for kind_or_acc, amt in (("cash", -exp), ("clearing", exp), (acc, -exp), ("budget_spent", exp)):
                    a = kind_or_acc if kind_or_acc == acc else q1("select duo_v3_private.account_of(%s,%s)", (h, kind_or_acc))
                    cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',%s)", (tid, h, a, amt))
        c.commit()
    return h, str(pid), ids

def oracle(n_closes, envs=ENVS):
    """Règles D-013/D-014/D-017/D-018 : solde cumulatif ; positif non reportable → réserve ; jamais un déficit vers la réserve."""
    bal = {name: alloc - exp for name, alloc, carry, exp in envs}; reserve = 0
    for _ in range(n_closes):
        for name, alloc, carry, exp in envs:
            r = bal[name] if bal[name] > 0 and not carry else 0
            bal[name] -= r; reserve += r
        for name, alloc, carry, exp in envs: bal[name] += alloc
    return bal, reserve

def contribution(cur, sub, h, amount=100, key=None):
    as_user(cur, sub); cur.execute("select public.duo_v3_post_contribution(%s,%s,current_date,%s)", (h, amount, key or f"c-{uuid.uuid4()}")); return str(cur.fetchone()[0])
def expense(cur, sub, h, env, amount=100, key=None):
    as_user(cur, sub); cur.execute("select public.duo_v3_post_expense(%s,%s,%s,current_date,%s)", (h, env, amount, key or f"e-{uuid.uuid4()}")); return str(cur.fetchone()[0])
def commit_call(fn, user="postgres"):
    with conn(user) as c:
        try:
            with c.cursor() as cur: v = fn(cur)
            c.commit(); return True, v
        except psycopg.Error as e:
            try: c.rollback()
            except Exception: pass
            return False, f"{st(e)} {str(e).splitlines()[0]}"
def parallel(n, fn):
    out = [None] * n; bar = threading.Barrier(n)
    def w(i):
        with conn() as c:
            try:
                with c.cursor() as cur: bar.wait(); v = fn(cur, i)
                c.commit(); out[i] = ("ok", v)
            except psycopg.Error as e:
                c.rollback(); out[i] = ("err", st(e))
    ts = [threading.Thread(target=w, args=(i,)) for i in range(n)]; [t.start() for t in ts]; [t.join() for t in ts]; return out

def state(h, ids):
    per = q("select id::text, starts_on, ends_on, state from public.duo_v3_periods where household_id=%s order by starts_on", (h,))
    contig = all(per[i][2] == per[i + 1][1] for i in range(len(per) - 1))
    bals = {n: int(q1("select coalesce(sum(x.amount_minor),0) from public.duo_v3_entries x join public.duo_v3_envelopes e on e.account_id=x.account_id where e.id=%s", (i,))) for n, i in ids.items()}
    reserve = int(q1("select coalesce(sum(amount_minor),0) from public.duo_v3_entries where account_id=duo_v3_private.account_of(%s,'reserve')", (h,)))
    sysdup = q1("select count(*) - count(distinct idempotency_key) from public.duo_v3_transactions where household_id=%s and origin='system'", (h,))
    closes = q1("select count(*) from public.duo_v3_period_closes where household_id=%s", (h,))
    eclose = q1("select count(*) from public.duo_v3_period_envelope_closes where household_id=%s", (h,))
    ntx = q1("select count(*) from public.duo_v3_transactions where household_id=%s", (h,))
    return dict(periodes=len(per), ouvertes=sum(1 for p in per if p[3] == 'open'), contigues=contig, soldes=bals, reserve=reserve,
                doublons_systeme=sysdup, clotures=closes, clotures_env=eclose, transactions=ntx)

# ================================================================================ RAT
def catchup_tests():
    F = "RAT — rattrapage multi-cycles"
    for n in (1, 2, 3, 13):
        h, pid, ids = make_duo(n)
        ok, v = commit_call(lambda cur: contribution(cur, UA, h))
        s = state(h, ids); exp_bal, exp_res = oracle(n)
        good = ok and s["periodes"] == n + 1 and s["ouvertes"] == 1 and s["contigues"] and s["clotures"] == n and s["clotures_env"] == 3 * n \
               and s["soldes"] == exp_bal and s["reserve"] == exp_res and s["doublons_systeme"] == 0
        record(f"RAT-{n:02d}", F, f"Écriture membre après {n} cycle(s) échu(s) : rattrapage complet dans la même transaction (D6-01 / F1)",
               f"contribution RPC (A), COMMIT ; duo amorcé il y a {n} cycle(s)",
               f"ok ; {n + 1} périodes contiguës, 1 ouverte, {n} clôtures ; soldes {exp_bal} ; réserve {exp_res}",
               f"ok={ok} {'' if ok else v} {s}", good)
        if n == 13:
            before = s["transactions"]
            with conn(autocommit=True) as c: c.execute("select duo_v3_private.ensure_current_period(%s)", (h,))
            s2 = state(h, ids)
            record("RAT-13b", F, "Rattrapage rejoué : idempotent (aucune ligne supplémentaire)", "ensure_current_period rejoué",
                   f"transactions={before}, état inchangé", f"transactions={s2['transactions']} {s2 == s}", ok and s2 == s)
    # Reports positifs et négatifs dans une même clôture, enveloppe reportable en déficit
    envs = (("PlusDef", 1000, True, 2500), ("NonRepPos", 4000, False, 0), ("NonRepDef", 500, False, 2000))
    h, pid, ids = make_duo(3, envs=envs)
    ok, v = commit_call(lambda cur: contribution(cur, UB, h))
    s = state(h, ids); eb, er = oracle(3, envs)
    neg = q("select e.name, c.closing_balance_minor, c.to_reserve_minor, c.carried_minor from public.duo_v3_period_envelope_closes c join public.duo_v3_envelopes e on e.id=c.envelope_id where c.household_id=%s and c.closing_balance_minor < 0 order by 1,2", (h,))
    good = ok and s["soldes"] == eb and s["reserve"] == er and all(r[2] == 0 and r[3] == r[1] for r in neg) and len(neg) >= 2
    record("RAT-NEG", F, "Reports négatifs conservés dans l'enveloppe, jamais imputés à la réserve (D-017) ; positifs non reportables → réserve (D-014)",
           "3 cycles, enveloppes en déficit reportable / non reportable", f"soldes {eb}, réserve {er}, déficits : to_reserve=0, carried=closing",
           f"ok={ok} soldes={s['soldes']} réserve={s['reserve']} déficits={[(r[0], int(r[1]), int(r[2])) for r in neg]}", good)
    # Rattrapage concurrent : 8 écrivains simultanés (A et B) sur un duo en retard de 13 cycles
    h, pid, ids = make_duo(13)
    out = parallel(8, lambda cur, i: contribution(cur, UA if i % 2 else UB, h, 100 + i))
    s = state(h, ids); eb, er = oracle(13)
    good = all(o[0] == "ok" for o in out) and s["periodes"] == 14 and s["clotures"] == 13 and s["soldes"] == eb and s["reserve"] == er and s["doublons_systeme"] == 0
    record("RAT-CONC", F, "8 écritures simultanées déclenchant le même rattrapage de 13 cycles : un seul rattrapage, aucune double clôture",
           "8 sessions, COMMIT réels", "8 ok ; 14 périodes ; 13 clôtures ; oracle respecté", f"{[o[0] for o in out]} {s}", good)
    # Lecture pendant un rattrapage : instantané jamais intermédiaire
    h, pid, ids = make_duo(13)
    stop = threading.Event(); seen = []
    def reader():
        while not stop.is_set():
            with conn() as c:
                with c.cursor() as cur:
                    as_user(cur, UB)
                    try:
                        cur.execute("select (select count(*) from public.duo_v3_periods where household_id=%s and state='open'), "
                                    "(select count(*) from public.duo_v3_periods where household_id=%s), "
                                    "(select count(*) from public.duo_v3_period_closes where household_id=%s)", (h, h, h))
                        seen.append(cur.fetchone())
                    except psycopg.Error as e: seen.append(("err", st(e)))
                c.rollback()
    t = threading.Thread(target=reader); t.start(); time.sleep(0.2)
    ok, v = commit_call(lambda cur: contribution(cur, UA, h)); time.sleep(0.2); stop.set(); t.join()
    bad = [x for x in seen if x[0] == "err" or x[0] != 1 or x[1] != x[2] + 1 or x[1] not in (1, 14)]
    record("LEC-RAT", "LEC — cohérence de lecture", "Un lecteur (B, RLS) ne voit jamais un état intermédiaire du rattrapage",
           "lectures en boucle pendant le rattrapage de 13 cycles", "toujours (1 ouverte, 1 ou 14 périodes, clôtures = périodes − 1)",
           f"ok={ok} lectures={len(seen)} états={sorted(set(x for x in seen if x[0] != 'err'))[:4]} incohérences={len(bad)}", ok and not bad and len(seen) > 0)

# ================================================================================ CLE
def key_tests():
    F = "CLE — isolation des clés"
    h, pid, ids = make_duo(0)
    sq_key = f"carry:{pid}:{ids['VersReserve']}"
    ok1, v1 = commit_call(lambda cur: contribution(cur, UA, h, 100, key=sq_key))
    with conn(autocommit=True) as c:
        c.execute("select duo_v3_private.ensure_current_period(%s, now() + interval '40 days')", (h,))
    rows = q("select origin, kind, count(*) from public.duo_v3_transactions where household_id=%s and idempotency_key=%s group by 1,2 order by 1", (h, sq_key))
    carry_ok = any(r[0] == 'system' and r[1] == 'carry' for r in rows)
    record("CLE-01", F, "D6-02 : un membre réserve la clé d'un futur report système ; le report a quand même lieu",
           "A : contribution avec la clé carry:<période>:<enveloppe>, puis clôture", "contribution acceptée ; report système créé ; écriture membre intacte",
           f"membre ok={ok1} lignes={rows}", ok1 and carry_ok and any(r[0] == 'member' for r in rows))
    h, pid, ids = make_duo(0)
    a = commit_call(lambda cur: contribution(cur, UA, h, 100, key="meme-cle")); b = commit_call(lambda cur: contribution(cur, UB, h, 250, key="meme-cle"))
    a2 = commit_call(lambda cur: contribution(cur, UA, h, 100, key="meme-cle")); a3 = commit_call(lambda cur: contribution(cur, UA, h, 999, key="meme-cle"))
    n = q1("select count(*) from public.duo_v3_transactions where household_id=%s and idempotency_key='meme-cle'", (h,))
    good = a[0] and b[0] and a2[0] and a2[1] == a[1] and (not a3[0]) and str(a3[1]).startswith("23505") and n == 2
    record("CLE-02", F, "CF-06 : clé par (duo, auteur) ; rejeu identique = même uuid ; charge différente = 23505",
           "A(100,k) ; B(250,k) ; A(100,k) ; A(999,k)", "ok, ok, même uuid, 23505 ; 2 transactions",
           f"A={a[0]} B={b[0]} rejeu_même={a2[1] == a[1]} A999={a3[1]} n={n}", good)
    with conn(autocommit=True) as c:
        t1 = c.execute("select duo_v3_private.post_system(%s,%s,'allocation','sys-k',duo_v3_private.account_of(%s,'budget_source'),duo_v3_private.account_of(%s,'reserve'),10,current_date)", (h, pid, h, h)).fetchone()[0]
        t2 = c.execute("select duo_v3_private.post_system(%s,%s,'allocation','sys-k',duo_v3_private.account_of(%s,'budget_source'),duo_v3_private.account_of(%s,'reserve'),10,current_date)", (h, pid, h, h)).fetchone()[0]
    m = commit_call(lambda cur: contribution(cur, UA, h, 100, key="sys-k"))
    rows = q("select origin, count(*) from public.duo_v3_transactions where household_id=%s and idempotency_key='sys-k' group by 1 order by 1", (h,))
    record("CLE-03", F, "Écriture système idempotente ; une clé système n'empêche pas un membre (et inversement)",
           "post_system ×2 (sys-k), puis A : contribution sys-k", "même uuid système ; contribution acceptée ; 1 système + 1 membre",
           f"même={t1 == t2} membre={m[0]} {'' if m[0] else m[1]} lignes={rows}", t1 == t2 and m[0] and rows == [('member', 1), ('system', 1)])
    # La clé membre reste isolée entre duos
    h2, pid2, ids2 = make_duo(0, members=(UC,))
    c1 = commit_call(lambda cur: contribution(cur, UC, h2, 100, key="meme-cle"))
    record("CLE-04", F, "Même clé dans un autre duo : indépendante", "C (duo 2) : contribution meme-cle", "acceptée", f"ok={c1[0]} {'' if c1[0] else c1[1]}", c1[0])

# ================================================================================ SCE
def seal_tests():
    F = "SCE — scellement des écritures validées"
    h, pid, ids = make_duo(0)
    ok, tid = commit_call(lambda cur: contribution(cur, UA, h, 700))
    cash, clr = q1("select duo_v3_private.account_of(%s,'cash')", (h,)), q1("select duo_v3_private.account_of(%s,'clearing')", (h,))
    def add_pair(cur):
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',50),(%s,%s,%s,'EUR',-50)", (tid, h, cash, tid, h, clr))
    r = commit_call(add_pair)
    nl = q1("select count(*) from public.duo_v3_entries where transaction_id=%s", (tid,))
    record("SCE-01", F, "F5 : une écriture validée ne reçoit plus de lignes, même équilibrées (postgres)",
           "transaction ultérieure : +50/−50 sur la contribution validée", "23514 ; 2 lignes", f"{r[1] if not r[0] else 'accepté'} lignes={nl}",
           (not r[0]) and str(r[1]).startswith("23514") and nl == 2)
    def in_savepoint(cur):
        t = str(uuid.uuid4())
        cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR',%s,'contribution',%s,%s,current_date)", (t, h, f"sp-{t}", UA, pid))
        cur.execute("savepoint s1")
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',30),(%s,%s,%s,'EUR',-30)", (t, h, cash, t, h, clr))
        cur.execute("release savepoint s1"); return t
    r = commit_call(in_savepoint)
    nl = q1("select count(*) from public.duo_v3_entries where transaction_id=%s", (r[1],)) if r[0] else None
    record("SCE-02", F, "Lignes ajoutées dans une sous-transaction (SAVEPOINT) de la même transaction : acceptées", "en-tête puis lignes sous SAVEPOINT, COMMIT",
           "accepté ; 2 lignes", f"ok={r[0]} lignes={nl} {'' if r[0] else r[1]}", r[0] and nl == 2)
    def sp_rollback(cur):
        t = str(uuid.uuid4())
        cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR',%s,'contribution',%s,%s,current_date)", (t, h, f"sp-{t}", UA, pid))
        cur.execute("savepoint s1")
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',99),(%s,%s,%s,'EUR',-99)", (t, h, cash, t, h, clr))
        cur.execute("rollback to savepoint s1")
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',40),(%s,%s,%s,'EUR',-40)", (t, h, cash, t, h, clr)); return t
    r = commit_call(sp_rollback)
    lines = sorted(int(x[0]) for x in q("select amount_minor from public.duo_v3_entries where transaction_id=%s", (r[1],))) if r[0] else None
    record("SCE-03", F, "SAVEPOINT annulé puis lignes réécrites : seules les lignes conservées comptent", "lignes ±99 annulées, ±40 écrites",
           "accepté ; lignes [-40, 40]", f"ok={r[0]} lignes={lines}", r[0] and lines == [-40, 40])
    def forged(cur):
        t = str(uuid.uuid4())
        cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on,posting_xid) values (%s,%s,'EUR',%s,'contribution',%s,%s,current_date,'1')", (t, h, f"fx-{t}", UA, pid))
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',5),(%s,%s,%s,'EUR',-5)", (t, h, cash, t, h, clr))
        return str(cur.execute("select posting_xid = pg_current_xact_id() from public.duo_v3_transactions where id=%s", (t,)).fetchone()[0])
    if IS_REV1:
        r = commit_call(forged)
        record("SCE-04", F, "posting_xid fourni par l'appelant : remplacé par le serveur", "INSERT avec posting_xid='1'", "accepté ; posting_xid = transaction courante",
               f"ok={r[0]} {r[1]}", r[0] and r[1] == "True")
        r = commit_call(lambda cur: cur.execute("update public.duo_v3_transactions set posting_xid=pg_current_xact_id() where id=%s", (tid,)))
        record("SCE-05", F, "Descellement par mise à jour de posting_xid : refusé", "UPDATE posting_xid := xid courant", "23514", str(r[1]), (not r[0]) and str(r[1]).startswith("23514"))
    else:
        record("SCE-04", F, "posting_xid fourni par l'appelant", "—", "—", "sans objet : colonne absente de la 006 originale", True, status="Sans objet")
        record("SCE-05", F, "Descellement par mise à jour", "—", "—", "sans objet : colonne absente de la 006 originale", True, status="Sans objet")

# ================================================================================ AUT
def auth_race_tests():
    F = "AUT — autorisation sous verrou"
    for sid, kind in (("AUT-01", "contribution"), ("AUT-02", "dépense")):
        h, pid, ids = make_duo(0)
        hold = threading.Event(); res = {}
        def leaver():
            try:
                with conn() as c:
                    with c.cursor() as cur:
                        cur.execute("select 1 from public.duo_v3_households where id=%s for update", (h,))
                        cur.execute("delete from public.duo_v3_members where household_id=%s and user_id=%s", (h, UB))
                        hold.set(); time.sleep(0.8)
                    c.commit()
            finally: hold.set()
        def writer():
            hold.wait()
            res["w"] = commit_call(lambda cur: contribution(cur, UB, h, 100) if kind == "contribution" else expense(cur, UB, h, ids["Plus"], 100))
        t1, t2 = threading.Thread(target=leaver), threading.Thread(target=writer); t1.start(); t2.start(); t1.join(); t2.join()
        n = q1("select count(*) from public.duo_v3_transactions where household_id=%s and created_by=%s", (h, UB))
        w = res["w"]
        record(sid, F, f"F7 : départ de B validé pendant que sa {kind} attend le verrou du duo → refus 42501, aucune écriture",
               "session 1 : verrou du duo + retrait de B, COMMIT après 0,8 s ; session 2 : RPC de B (contrôle initial passé)",
               "42501 ; 0 transaction de B", f"{w[1] if not w[0] else 'ACCEPTÉ'} ; transactions de B={n}",
               (not w[0]) and str(w[1]).startswith("42501") and n == 0,
               note="Sur la 006 originale, l'appartenance n'est vérifiée qu'avant le verrou : le refus éventuel provient d'une clé étrangère (23503), pas de l'autorisation.")

# ================================================================================ UNI
def unit_tests():
    F = "UNI — unités monétaires"
    cols = q("""select c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
                from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relkind='r' and c.relname like 'duo_v3_%%' and a.attnum>0 and not a.attisdropped
                  and a.attname like '%%minor%%' order by 1,2""")
    bad = [f"{r[0]}.{r[1]}:{r[2]}" for r in cols if r[2] != "duo_v3_private.minor_units"]
    record("UNI-01", F, "F4 étendu : toutes les colonnes monétaires stockées utilisent le domaine sans échelle",
           "catalogue : colonnes *minor* des tables duo_v3_*", f"{len(cols)} colonnes, toutes duo_v3_private.minor_units",
           f"{len(cols)} colonnes ; hors domaine={bad}", len(cols) > 0 and not bad)
    h, pid, ids = make_duo(0)
    r = commit_call(lambda cur: cur.execute("select duo_v3_private.set_allocation(%s, 10.5, current_date)", (ids["Plus"],)))
    record("UNI-02", F, "Allocation fractionnaire refusée", "set_allocation(10.5)", "22023", str(r[1]) if not r[0] else "accepté", (not r[0]) and str(r[1]).startswith("22023"))
    cash, clr = q1("select duo_v3_private.account_of(%s,'cash')", (h,)), q1("select duo_v3_private.account_of(%s,'clearing')", (h,))
    def frac(cur):
        t = str(uuid.uuid4())
        cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR',%s,'contribution',%s,%s,current_date)", (t, h, f"fr-{t}", UA, pid))
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,%s,'EUR',100.6),(%s,%s,%s,'EUR',-100.6)", (t, h, cash, t, h, clr))
    r = commit_call(frac)
    record("UNI-03", F, "Écriture privilégiée 100,6 centimes : refusée avant tout arrondi", "INSERT ±100.6 (postgres)", "23514 (domaine)",
           str(r[1]) if not r[0] else "accepté (arrondi silencieux)", (not r[0]) and str(r[1]).startswith("23514"))
    for amt in ("1.5", "0", "-5", "1e40"):
        r = commit_call(lambda cur, a=amt: (as_user(cur, UA), cur.execute(f"select public.duo_v3_post_contribution(%s,{a}::numeric,current_date,%s)", (h, f"u-{a}"))))
        record(f"UNI-04{'abcd'['1.5 0 -5 1e40'.split().index(amt)]}", F, "RPC : montant non entier, nul, négatif ou hors bornes refusé", f"contribution {amt}", "22023",
               str(r[1]) if not r[0] else "accepté", (not r[0]) and str(r[1]).startswith("22023"))

# ================================================================================ DEV
def currency_tests():
    F = "DEV — verrouillage de la devise (CF-11)"
    def blank_duo(with_alloc=0):
        h = str(uuid.uuid4())
        with conn(autocommit=True) as c:
            c.execute("insert into public.duo_v3_households(id,currency,cycle_start_day,time_zone) values (%s,'EUR',1,'Europe/Paris')", (h,))
            c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner'),(%s,%s,'partner')", (h, UA, h, UB))
            c.execute("select duo_v3_private.bootstrap_household(%s)", (h,))
            e = c.execute("select duo_v3_private.create_envelope(%s,'Courses',true)", (h,)).fetchone()[0]
            if with_alloc: c.execute("select duo_v3_private.set_allocation(%s,%s,(select starts_on from public.duo_v3_periods where household_id=%s))", (e, with_alloc, h))
        return h
    h = blank_duo()
    r = commit_call(lambda cur: cur.execute("update public.duo_v3_households set currency='XAF' where id=%s", (h,)))
    cur_ = q("select distinct currency from public.duo_v3_accounts where household_id=%s union select distinct currency from public.duo_v3_envelopes where household_id=%s", (h, h))
    record("DEV-01", F, "Devise modifiable avant toute opération ; comptes et enveloppes suivent (aucune conversion)",
           "UPDATE currency EUR→XAF, duo amorcé sans écriture", "accepté ; comptes et enveloppes en XAF", f"ok={r[0]} {'' if r[0] else r[1]} devises={cur_}",
           r[0] and cur_ == [('XAF',)], note="Sur la 006 originale : refus dès la 1re période (L14c) — écart CF-11 documenté.")
    commit_call(lambda cur: contribution(cur, UA, h, 100))
    r = commit_call(lambda cur: cur.execute("update public.duo_v3_households set currency='EUR' where id=%s", (h,)))
    record("DEV-02", F, "Devise figée dès la première opération", "contribution puis UPDATE currency", "23514", str(r[1]) if not r[0] else "accepté",
           (not r[0]) and str(r[1]).startswith("23514"))
    h = blank_duo(with_alloc=5000)
    r = commit_call(lambda cur: cur.execute("update public.duo_v3_households set currency='XAF' where id=%s", (h,)))
    record("DEV-03", F, "Devise figée dès qu'une allocation non nulle existe", "allocation 50,00 puis UPDATE currency", "23514", str(r[1]) if not r[0] else "accepté",
           (not r[0]) and str(r[1]).startswith("23514"))
    h = blank_duo()
    r = commit_call(lambda cur: cur.execute("insert into public.duo_v3_accounts(household_id,label,kind,currency) values (%s,'USD','envelope','USD')", (h,)))
    record("DEV-04", F, "F3 : compte d'une autre devise refusé à la création", "INSERT compte USD dans un duo EUR", "23503", str(r[1]) if not r[0] else "accepté",
           (not r[0]) and str(r[1]).startswith("23503"))
    # Concurrence : changement de devise (verrou de ligne) contre première écriture
    h = blank_duo(); res = {}; go = threading.Event()
    def changer():
        try:
            with conn() as c:
                with c.cursor() as cur:
                    cur.execute("update public.duo_v3_households set currency='XAF' where id=%s", (h,)); go.set(); time.sleep(0.6)
                c.commit()
        except psycopg.Error as e: res["chg"] = f"{st(e)} {str(e).splitlines()[0]}"
        finally: go.set()
    def writer(): go.wait(); res["w"] = commit_call(lambda cur: contribution(cur, UA, h, 100))
    t1, t2 = threading.Thread(target=changer), threading.Thread(target=writer); t1.start(); t2.start(); t1.join(); t2.join()
    cc = q("select distinct currency from public.duo_v3_entries where household_id=%s", (h,)); hc = q1("select currency from public.duo_v3_households where id=%s", (h,))
    record("DEV-05", F, "Changement de devise concurrent d'une première écriture : l'écriture attend et utilise la nouvelle devise",
           "session 1 : UPDATE XAF (0,6 s) ; session 2 : contribution", "écriture acceptée en XAF ; duo XAF", f"changement={res.get('chg', 'ok')} écriture={res['w'][0]} devises_lignes={cc} duo={hc}",
           res["w"][0] and cc == [('XAF',)] and hc == 'XAF')
    h = blank_duo(); res = {}; go = threading.Event()
    def writer_first():
        try:
            with conn() as c:
                with c.cursor() as cur: contribution(cur, UA, h, 100); go.set(); time.sleep(0.6)
                c.commit()
        finally: go.set()
    def changer_after(): go.wait(); res["c"] = commit_call(lambda cur: cur.execute("update public.duo_v3_households set currency='XAF' where id=%s", (h,)))
    t1, t2 = threading.Thread(target=writer_first), threading.Thread(target=changer_after); t1.start(); t2.start(); t1.join(); t2.join()
    record("DEV-06", F, "Première écriture concurrente d'un changement de devise : le changement attend puis est refusé",
           "session 1 : contribution (0,6 s) ; session 2 : UPDATE XAF", "23514 ; duo EUR", f"{res['c'][1] if not res['c'][0] else 'accepté'} duo={q1('select currency from public.duo_v3_households where id=%s', (h,))}",
           (not res["c"][0]) and str(res["c"][1]).startswith("23514"))

# ================================================================================ CON
def concurrency_tests():
    F = "CON — compatibilité concurrente"
    h, pid, ids = make_duo(0)
    out = parallel(12, lambda cur, i: (expense(cur, UA if i % 2 else UB, h, ids["Plus"], 10, key=f"k{i % 3}") if i % 4 else contribution(cur, UA if i % 2 else UB, h, 10, key=f"c{i % 3}")))
    by = q("select created_by::text, kind, idempotency_key, count(*) from public.duo_v3_transactions where household_id=%s and origin='member' and idempotency_key ~ '^[kc][0-2]$' group by 1,2,3", (h,))
    errs = [o for o in out if o[0] == "err"]
    dup = [r for r in by if r[3] > 1]
    record("CON-01", F, "12 écritures mêlées (dépenses/contributions, A et B, clés partagées) : aucune double écriture par (auteur, clé)",
           "12 sessions simultanées", "aucune ligne en double ; rejeux de même charge = même uuid ; charge différente sous même clé = 23505",
           f"résultats={[o[0] if o[0]=='ok' else o[1] for o in out]} doublons={dup}", not dup and all(o[1] in (None, "23505") or o[0] == "ok" for o in out))
    inv = q("select a.book, sum(x.amount_minor) from public.duo_v3_entries x join public.duo_v3_accounts a on a.id=x.account_id where x.household_id=%s group by 1", (h,))
    record("CON-02", F, "Invariant après concurrence : chaque livre est équilibré", "somme par livre", "0 pour cash et budget", str(inv), all(int(r[1]) == 0 for r in inv))


# ================================================================================ ORD / RA2 (registre du 26/11)
def order_tests():
    F = "ORD — ordre sous verrou (R-A3)"
    has = bool(q1("select count(*) from pg_attribute where attrelid='public.duo_v3_transactions'::regclass and attname='posted_at'"))
    if not has:
        for sid in ("ORD-01", "ORD-02", "RA2-01", "RA2-02"):
            record(sid, F if sid.startswith("ORD") else "RA2 — plafond et récupération", "R-A3 / R-A2", "—", "—", "sans objet : colonne posted_at / fonction admin_catch_up absentes", True, status="Sans objet")
        return
    h, pid, ids = make_duo(0)
    holder_ready, release = threading.Event(), threading.Event(); res = {}
    def holder():
        with conn() as c:
            with c.cursor() as cur:
                contribution(cur, UA, h, 111, key="ord-first")          # prend le verrou du duo et l'inscrit
                holder_ready.set(); release.wait(5)
            c.commit()
    def waiter():
        with conn() as c:
            with c.cursor() as cur:
                cur.execute("select now()"); res["t0"] = cur.fetchone()[0]   # la transaction commence AVANT
                holder_ready.wait(5); threading.Timer(0.4, release.set).start()
                contribution(cur, UB, h, 222, key="ord-second")           # attend le verrou
            c.commit()
    t1, t2 = threading.Thread(target=holder), threading.Thread(target=waiter); t2.start(); time.sleep(0.15); t1.start(); t1.join(); t2.join()
    rows = q("select idempotency_key, created_at, posted_at, ledger_seq from public.duo_v3_transactions where household_id=%s and idempotency_key in ('ord-first','ord-second') order by ledger_seq", (h,))
    keys = [r[0] for r in rows]; first, second = rows[0], rows[1]
    ok = keys == ["ord-first", "ord-second"] and second[1] < first[1] and second[2] > first[2]
    record("ORD-01", F, "Une écriture commencée avant une autre mais inscrite après (attente du verrou) : posted_at et ledger_seq suivent l'ordre d'inscription, created_at garde la réception",
           "B commence sa transaction, A prend le verrou et inscrit ; B inscrit après", "ordre ledger_seq [A, B] ; created_at(B) < created_at(A) ; posted_at(B) > posted_at(A)",
           f"ordre={keys} created_B<created_A={second[1] < first[1]} posted_B>posted_A={second[2] > first[2]}", ok)
    def forged(cur):
        t = str(uuid.uuid4())
        cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on,posted_at) values (%s,%s,'EUR','forge','contribution',%s,%s,current_date,'2000-01-01')", (t, h, UA, pid))
        cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,duo_v3_private.account_of(%s,'cash'),'EUR',5),(%s,%s,duo_v3_private.account_of(%s,'clearing'),'EUR',-5)", (t, h, h, t, h, h))
        return t
    r = commit_call(forged)
    pa = q1("select posted_at > now() - interval '5 minutes' from public.duo_v3_transactions where id=%s", (r[1],)) if r[0] else None
    record("ORD-02", F, "posted_at fourni par l'appelant (écriture privilégiée) : remplacé par l'horloge serveur", "INSERT avec posted_at = 2000-01-01",
           "accepté ; posted_at récent", f"ok={r[0]} posted_at_récent={pa}", r[0] and pa is True)
    F = "RA2 — plafond et récupération (R-A2)"
    h, pid, ids = make_duo(130, envs=(("Plus", 100, True, 0),))
    r = commit_call(lambda cur: contribution(cur, UA, h, 100))
    with conn(autocommit=True) as c:
        try: c.execute("select duo_v3_private.admin_catch_up(%s, 121)", (h,)); bad = "accepté"
        except psycopg.Error as e: bad = f"{st(e)}"
    with conn() as c:
        try:
            with c.cursor() as cur: as_user(cur, UA); cur.execute("select duo_v3_private.admin_catch_up(%s, 10)", (h,))
            c.commit(); cli = "accepté"
        except psycopg.Error as e: c.rollback(); cli = f"{st(e)}"
    record("RA2-01", F, "Au-delà de 120 cycles : refus 55000 avec indice ; récupération réservée aux rôles serveur", "RPC sur un duo en retard de 130 cycles ; admin_catch_up(121) ; admin_catch_up par authenticated",
           "55000 (hint admin_catch_up_required) ; 22023 ; 42501", f"rpc={r[1][:5] if not r[0] else 'accepté'} p_max121={bad} client={cli}",
           (not r[0]) and str(r[1]).startswith("55000") and bad == "22023" and cli == "42501")
    with conn(autocommit=True) as c:
        n1 = c.execute("select duo_v3_private.admin_catch_up(%s, 100)", (h,)).fetchone()[0]
    r2 = commit_call(lambda cur: contribution(cur, UA, h, 100))
    with conn(autocommit=True) as c:
        n2 = c.execute("select duo_v3_private.admin_catch_up(%s, 100)", (h,)).fetchone()[0]
    s = state(h, ids); eb, er = oracle(130, (("Plus", 100, True, 0),))
    record("RA2-02", F, "Récupération par lots puis reprise de l'écriture membre ; idempotente ; reports conformes", "admin_catch_up(100) ; contribution ; admin_catch_up(100)",
           "100 clôtures ; contribution acceptée (30 restantes rattrapées) ; 0 ; 131 périodes ; oracle", f"lot1={n1} rpc={r2[0]} lot2={n2} périodes={s['periodes']} soldes={s['soldes']} attendu={eb}",
           n1 == 100 and r2[0] and n2 == 0 and s["periodes"] == 131 and s["soldes"] == eb and s["clotures"] == 130)

if __name__ == "__main__":
    fresh(); IS_REV1 = detect_rev1()
    for fn in (catchup_tests, key_tests, seal_tests, auth_race_tests, unit_tests, currency_tests, concurrency_tests, order_tests):
        try: fn()
        except Exception as e:
            record(f"ERR-{fn.__name__}", "Exécution", "Erreur du banc", fn.__name__, "aucune", f"{type(e).__name__}: {e}", False)
    with admin() as c: c.execute(f'drop database if exists "{DB}" with (force)')
    summ = {}
    for r in RESULTS: summ[r["statut"]] = summ.get(r["statut"], 0) + 1
    out = dict(label=LABEL, template=TEMPLATE, revision1=IS_REV1, resume=summ, resultats=RESULTS)
    import pathlib; p = pathlib.Path(__file__).resolve().parent / "results" / f"{LABEL}.json"
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False, default=str)); print(json.dumps(summ, ensure_ascii=False))
