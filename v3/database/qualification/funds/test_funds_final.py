#!/usr/bin/env python3
"""Migration candidate « fonds réels » (M2) — banc final, décisions R-B0 à R-B6 appliquées (PR #20).
Écarts explicites avec le banc du prototype (26/11 matin) : FB-10 (R-B6), FB-11b (R-B5), FB-13 (R-B1), FB-19 (R-B4), FB-20 (R-B3).
Ancien titre : banc du prototype 007 « fonds réels affectés » (PostgreSQL jetable, rôles Supabase réels).

Attentes tirées des règles POST006-03/04 et des fixtures des PR #17 et #19 — jamais du résultat.
Usage : python3 test_funds_final.py <gabarit s3> <label>   ->  ../results/<label>.json
"""
import json, sys, uuid, threading, sqlite3, tempfile, os, pathlib
import psycopg
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from v2_to_v3_plan import plan as v2_plan

HOST, PORT = "/tmp", 54317
TEMPLATE, LABEL = sys.argv[1], sys.argv[2]
DB = f"fb_{LABEL}"
UA, UB, UC = (f"10000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))
E = lambda euros: int(round(euros * 100))

def admin(): return psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="postgres", autocommit=True)
def conn(): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=DB)
def ac(): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=DB, autocommit=True)
def st(e): return getattr(e, "sqlstate", None) or "?"
def as_user(cur, sub, role="authenticated"):
    cl = {"role": role} if sub is None else {"role": role, "sub": sub, "aud": "authenticated", "is_anonymous": False}
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(cl),)); cur.execute(f"set local role {role}")
def q1(sql, a=()):
    with ac() as c: return c.execute(sql, a).fetchone()[0]

def call(sub, sql, args=(), role="authenticated"):
    with conn() as c:
        try:
            with c.cursor() as cur:
                as_user(cur, sub, role); cur.execute(sql, args); v = cur.fetchone()[0] if cur.description else None
            c.commit(); return True, v
        except psycopg.Error as e:
            c.rollback(); return False, f"{st(e)} {str(e).splitlines()[0]}"
def contrib(sub, h, amount, assign=(), key=None):
    return call(sub, "select public.duo_v3_post_contribution_assigned(%s,%s,current_date,%s,%s::jsonb)",
                (h, amount, key or f"c-{uuid.uuid4()}", json.dumps([{"envelopeId": e, "amount": a} for e, a in assign])))
def move(sub, h, frm, to, amount, key=None):
    return call(sub, "select public.duo_v3_move_funds(%s,%s,%s,%s,%s)", (h, frm, to, amount, key or f"m-{uuid.uuid4()}"))
def expense(sub, h, env, amount, key=None):
    return call(sub, "select public.duo_v3_post_expense(%s,%s,%s,current_date,%s)", (h, env, amount, key or f"e-{uuid.uuid4()}"))
def cancel(sub, h, tx, key=None): return call(sub, "select public.duo_v3_cancel_transaction(%s,%s,%s)", (h, tx, key or f"x-{uuid.uuid4()}"))
def restore(sub, h, rv, key=None): return call(sub, "select public.duo_v3_restore_transaction(%s,%s,%s)", (h, rv, key or f"r-{uuid.uuid4()}"))
def protect(sub, h, env, on):
    r = call(sub, "select public.duo_v3_set_envelope_protection(%s,%s,%s)", (h, env, on)); return r
def snap(sub, h):
    ok, v = call(sub, "select public.duo_v3_get_funds_snapshot(%s)", (h,)); assert ok, v; return v
def env_of(s, eid): return next(e for e in s["envelopes"] if e["envelopeId"] == eid)

RESULTS = []
def record(sid, fam, rule, action, expected, observed, ok, note=""):
    s = "Réussi" if ok else "Échoué"
    RESULTS.append(dict(id=sid, famille=fam, regle=rule, action=action, attendu=expected, observe=observed, statut=s, note=note))
    print(f"{sid:7} {s:7} {observed[:130]}", flush=True)

def fresh():
    with admin() as c:
        c.execute(f'drop database if exists "{DB}" with (force)'); c.execute(f'create database "{DB}" template "{TEMPLATE}" owner postgres')
    with ac() as c:
        c.execute(f"""insert into auth.users(id,aud,role,email,is_anonymous) values
          ('{UA}','authenticated','authenticated','a@example.invalid',false),('{UB}','authenticated','authenticated','b@example.invalid',false),
          ('{UC}','authenticated','authenticated','c@example.invalid',false)""")

def duo(envs, members=(UA, UB), months_late=0, activate=True, seed_cash=0):
    """envs : [(nom, cible_minor, carry_positive)] ; renvoie (h, {nom: id})."""
    h = str(uuid.uuid4())
    with ac() as c:
        # CF-05 (lot 3) : un seul duo actif par compte. Le banc réutilise A et B : leurs duos précédents passent « left ».
        c.execute("update public.duo_v3_members set status='left', left_at=clock_timestamp() where user_id = any(%s::uuid[]) and status='active' and space='duo'", (list(members),))
        c.execute("insert into public.duo_v3_households(id,currency,cycle_start_day,time_zone) values (%s,'EUR',1,'Europe/Paris')", (h,))
        for i, u in enumerate(members): c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,%s)", (h, u, 'owner' if i == 0 else 'partner'))
        c.execute("select duo_v3_private.bootstrap_household(%s, ((date_trunc('month', now() at time zone 'Europe/Paris') - make_interval(months => %s) + interval '10 days') at time zone 'Europe/Paris'))", (h, months_late))
        pid, starts = c.execute("select id, starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()
        ids = {}
        for name, target, carry in envs:
            e = c.execute("select duo_v3_private.create_envelope(%s,%s,%s)", (h, name, carry)).fetchone()[0]
            c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, target, starts)); ids[name] = str(e)
        c.execute("select duo_v3_private.post_period_allocations(%s,%s)", (h, pid))
    if seed_cash:
        ok, v = call(members[0], "select public.duo_v3_post_contribution(%s,%s,current_date,'seed-before-activation')", (h, seed_cash)); assert ok, v
    if activate:
        with ac() as c: c.execute("select duo_v3_private.activate_funds(%s)", (h,))
    return h, ids

def invariant(h):
    with ac() as c:
        r = c.execute("""select coalesce(sum(x.amount_minor) filter (where a.kind='cash'),0),
                                coalesce(sum(x.amount_minor) filter (where a.kind in ('funds_unassigned','funds_envelope')),0),
                                coalesce(sum(x.amount_minor) filter (where a.book='funds'),0),
                                coalesce(sum(x.amount_minor) filter (where a.kind='funds_unassigned'),0)
                         from public.duo_v3_entries x join public.duo_v3_accounts a on a.id=x.account_id where x.household_id=%s""", (h,)).fetchone()
    return dict(cash=int(r[0]), fonds=int(r[1]), livre_funds=int(r[2]), non_affectes=int(r[3]), ok=r[0] == r[1] and r[2] == 0 and r[3] >= 0)

def run():
    F = "Activation et invariants"
    h, ids = duo([("Courses", E(100), True)], activate=False, seed_cash=E(1000))
    with ac() as c: c.execute("select duo_v3_private.activate_funds(%s)", (h,)); c.execute("select duo_v3_private.activate_funds(%s)", (h,))
    s = snap(UA, h); inv = invariant(h)
    record("FB-01", F, "Activation d'un duo 006 existant : la trésorerie existante devient fonds réels NON affectés ; idempotente",
           "contribution 1000 € avant activation ; activate_funds ×2", "trésorerie 1000 ; non affectés 1000 ; affectés 0 ; 1 ouverture",
           f"{s['household']['realTreasury']}/{s['household']['unassignedRealFunds']}/{s['household']['assignedRealFunds']} ouvertures={q1('select count(*) from public.duo_v3_transactions where household_id=%s and kind=%s', (h, 'funds_opening'))} inv={inv}",
           s['household']['realTreasury'] == str(E(1000)) and s['household']['unassignedRealFunds'] == str(E(1000)) and inv["ok"]
           and q1('select count(*) from public.duo_v3_transactions where household_id=%s and kind=%s', (h, 'funds_opening')) == 1)

    F = "Fixtures PR #19 (financement explicite)"
    for sid, (t, f_, sp, real, rem, unf) in (("FB-02", (525, 325, 275, 50, 250, 200)), ("FB-03", (400, 300, 185, 115, 215, 100))):
        h, ids = duo([("Env", E(t), True)]); env = ids["Env"]
        a = contrib(UA, h, E(1000)); b = move(UB, h, None, env, E(f_)); c_ = expense(UA, h, env, E(sp))
        e = env_of(snap(UB, h), env)
        good = a[0] and b[0] and c_[0] and e["target"] == str(E(t)) and e["assignedRealFunds"] == str(E(f_)) and e["realAvailable"] == str(E(real)) \
               and e["remainingBudget"] == str(E(rem)) and e["unfundedTarget"] == str(E(unf)) and "unfunded_target" in e["flags"]
        record(sid, F, f"Cible {t}, financé {f_}, dépensé {sp} → réel {real}, reste budgétaire {rem}, non financé {unf}",
               "contribution 1000 ; affectation ; dépense", f"réel {real} ; reste {rem} ; non financé {unf} ; drapeau unfunded_target",
               f"réel={e['realAvailable']} reste={e['remainingBudget']} non_financé={e['unfundedTarget']} flags={e['flags']}", good)

    F = "Affectation : jamais une recette"
    h, ids = duo([("A", E(100), True), ("B", E(100), True)])
    contrib(UA, h, E(100)); s0 = snap(UA, h)
    clr0 = q1("select coalesce(sum(amount_minor),0) from public.duo_v3_entries where account_id=duo_v3_private.account_of(%s,'clearing')", (h,))
    m1 = move(UA, h, None, ids["A"], E(60)); m2 = move(UA, h, ids["A"], ids["B"], E(20)); m3 = move(UB, h, None, ids["B"], E(41))
    s1 = snap(UA, h); clr1 = q1("select coalesce(sum(amount_minor),0) from public.duo_v3_entries where account_id=duo_v3_private.account_of(%s,'clearing')", (h,))
    good = m1[0] and m2[0] and (not m3[0]) and str(m3[1]).startswith("23514") and s1["household"]["realTreasury"] == s0["household"]["realTreasury"] \
           and clr0 == clr1 and s1["household"]["realizedContributions"] == s0["household"]["realizedContributions"] \
           and s1["household"]["unassignedRealFunds"] == str(E(40)) and env_of(s1, ids["A"])["realAvailable"] == str(E(40)) and env_of(s1, ids["B"])["realAvailable"] == str(E(20))
    record("FB-04", F, "Affecter / transférer des fonds ne modifie ni la trésorerie, ni le monde extérieur, ni les contributions ; affecter plus que le non-affecté est refusé",
           "contribution 100 ; affecter 60 → A ; A → B 20 ; affecter 41 (reste 40)", "trésorerie, clearing et contributions inchangés ; 23514 pour 41 ; A 40, B 20, non affecté 40",
           f"m1={m1[0]} m2={m2[0]} m3={m3[1] if not m3[0] else 'accepté'} trésorerie={s1['household']['realTreasury']} non_affectés={s1['household']['unassignedRealFunds']} clearing {clr0}→{clr1}", good)
    r = contrib(UA, h, E(50), assign=((ids["A"], E(30)), (ids["B"], E(30))))
    r2 = contrib(UB, h, E(50), assign=((ids["A"], E(30)),)); s2 = snap(UA, h)
    record("FB-05", F, "Contribution affectée dès la saisie : la somme affectée ne peut dépasser le montant versé",
           "contribution 50 affectée 30+30 ; puis 50 affectée 30", "23514 puis accepté (20 non affectés de plus)",
           f"r1={r[1] if not r[0] else 'accepté'} r2={r2[0]} non_affectés={s2['household']['unassignedRealFunds']}",
           (not r[0]) and str(r[1]).startswith("23514") and r2[0] and s2["household"]["unassignedRealFunds"] == str(E(60)))
    r = move(UA, h, ids["A"], None, E(10)); s3 = snap(UA, h)
    record("FB-05b", F, "Désaffectation : les fonds reviennent au non-affecté", "A → non affecté 10", "A 60, non affecté 70",
           f"ok={r[0]} A={env_of(s3, ids['A'])['realAvailable']} non_affectés={s3['household']['unassignedRealFunds']}",
           r[0] and env_of(s3, ids["A"])["realAvailable"] == str(E(60)) and s3["household"]["unassignedRealFunds"] == str(E(70)))

    F = "Concurrence"
    h, ids = duo([("A", E(100), True)]); contrib(UA, h, E(100))
    out = [None] * 8; bar = threading.Barrier(8)
    def w(i):
        bar.wait(); out[i] = move(UA if i % 2 else UB, h, None, ids["A"], E(30))
    ts = [threading.Thread(target=w, args=(i,)) for i in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
    oks = sum(1 for o in out if o[0]); errs = sorted({o[1][:5] for o in out if not o[0]}); inv = invariant(h)
    record("FB-06", F, "8 affectations simultanées de 30 sur 100 non affectés : exactement 3 réussissent, jamais de non-affecté négatif",
           "8 sessions A/B", "3 ok ; 5 × 23514 ; non affecté 10", f"ok={oks} erreurs={errs} inv={inv}", oks == 3 and errs == ["23514"] and inv["non_affectes"] == E(10) and inv["ok"])
    out = [None] * 8; bar = threading.Barrier(8)
    def w2(i):
        bar.wait(); out[i] = expense(UA if i % 2 else UB, h, ids["A"], E(20)) if i % 2 else move(UB, h, ids["A"], None, E(20))
    ts = [threading.Thread(target=w2, args=(i,)) for i in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
    inv = invariant(h); real = int(env_of(snap(UA, h), ids["A"])["realAvailable"])
    nexp = sum(1 for i, o in enumerate(out) if i % 2 and o[0]); nmov = sum(1 for i, o in enumerate(out) if not i % 2 and o[0])
    record("FB-06b", F, "Dépenses et désaffectations simultanées : les dépenses passent toujours ; une désaffectation ne crée jamais de déficit",
           "4 dépenses de 20 et 4 désaffectations de 20 sur une enveloppe à 90", "4 dépenses acceptées ; réel = 90 − 20 × (dépenses + désaffectations acceptées) ; invariant",
           f"dépenses={nexp} désaffectations={nmov} réel={real} inv={inv['ok']}", nexp == 4 and real == E(90) - E(20) * (nexp + nmov) and inv["ok"])

    F = "Déficit réel, dépassement budgétaire, réserve non affectée"
    h, ids = duo([("A", E(100), True), ("B", E(100), True)]); contrib(UA, h, E(200)); move(UA, h, None, ids["A"], E(50))
    x = expense(UB, h, ids["A"], E(80)); s = snap(UA, h); a = env_of(s, ids["A"])
    m = move(UA, h, ids["A"], ids["B"], E(1)); inv = invariant(h)
    record("FB-07", F, "Dépense au-delà du réel : acceptée (fait réel), déficit réel visible ; aucun mouvement interne depuis l'enveloppe en déficit",
           "A financée 50, dépense 80, puis A → B 1", "dépense acceptée ; réel −30, drapeau real_deficit ; 23514 ; invariant",
           f"dépense={x[0]} réel={a['realAvailable']} flags={a['flags']} move={m[1] if not m[0] else 'accepté'} inv={inv['ok']}",
           x[0] and a["realAvailable"] == str(-E(30)) and "real_deficit" in a["flags"] and (not m[0]) and str(m[1]).startswith("23514") and inv["ok"])
    x = expense(UA, h, ids["B"], E(150)); b = env_of(snap(UA, h), ids["B"])
    record("FB-08", F, "Dépassement budgétaire distinct du déficit réel", "B cible 100, non financée, dépense 150", "reste −50 (budget_overrun) ; réel −150 (real_deficit)",
           f"reste={b['remainingBudget']} réel={b['realAvailable']} flags={b['flags']}", b["remainingBudget"] == str(-E(50)) and b["realAvailable"] == str(-E(150))
           and {"budget_overrun", "real_deficit"} <= set(b["flags"]))
    s = snap(UA, h)
    record("FB-09", F, "Réserve réelle non affectée ≠ réserve budgétaire : deux notions distinctes", "lecture", "fonds non affectés 150 ; réserve budgétaire 0 ; trésorerie −30",
           f"non_affectés={s['household']['unassignedRealFunds']} réserve_budget={s['household']['budgetReserve']} trésorerie={s['household']['realTreasury']} inv={s['household']['invariantHolds']}",
           s["household"]["unassignedRealFunds"] == str(E(150)) and s["household"]["budgetReserve"] == "0" and s["household"]["realTreasury"] == str(-E(30)) and s["household"]["invariantHolds"])

    F = "Protection (R-B6)"
    h, ids = duo([("Vacances", E(300), True), ("Courses", E(100), True)]); contrib(UA, h, E(400)); move(UA, h, None, ids["Vacances"], E(150))
    p1 = protect(UB, h, ids["Vacances"], True); m = move(UA, h, ids["Vacances"], ids["Courses"], E(10)); u = move(UA, h, ids["Vacances"], None, E(10))
    t = move(UA, h, None, ids["Vacances"], E(10)); x = expense(UA, h, ids["Vacances"], E(5))
    l1 = protect(UA, h, ids["Vacances"], False); l2 = protect(UA, h, ids["Vacances"], False); m1 = move(UA, h, ids["Vacances"], ids["Courses"], E(10))
    l3 = protect(UB, h, ids["Vacances"], False); m2 = move(UA, h, ids["Vacances"], ids["Courses"], E(10))
    ev = q1("select count(*) from public.duo_v3_envelope_protection_events where household_id=%s", (h,))
    rq = q1("select string_agg(status || ':' || (requested_by = %s)::text || ':' || (decided_by = %s)::text, ',') from public.duo_v3_protection_lift_requests where household_id=%s", (UA, UB, h))
    v = env_of(snap(UA, h), ids["Vacances"])
    good = p1 == (True, "protected") and (not m[0]) and str(m[1]).startswith("23514") and (not u[0]) and t[0] and x[0] \
           and l1 == (True, "lift_pending") and l2 == (True, "lift_pending") and (not m1[0]) and l3 == (True, "none") and m2[0] and ev == 2 \
           and rq == "approved:true:true" and v["realAvailable"] == str(E(145))
    record("FB-10", F, "Espace commun : protéger = immédiat ; lever = double accord (le demandeur ne s'approuve pas) ; journalisé",
           "B protège ; transfert / désaffectation ; alimentation, dépense ; A demande ×2 ; transfert ; B approuve ; transfert",
           "protected ; 23514 ×2 ; ok ×2 ; lift_pending ×2 ; 23514 ; none ; ok ; 2 évènements ; demande approved (A→B) ; réel 145",
           f"{p1[1]} {m[1][:5] if not m[0] else 'ok'} {u[1][:5] if not u[0] else 'ok'} {t[0]} {x[0]} {l1[1]} {l2[1]} {m1[1][:5] if not m1[0] else 'ok'} {l3[1]} {m2[0]} évènements={ev} demande={rq} réel={v['realAvailable']}", good,
           note="Écart explicite avec le prototype : la levée par un seul membre (ancien FB-10) est désormais refusée (R-B6).")
    okp, hp = call(UC, "select public.duo_v3_create_personal_space('EUR')::text")
    with ac() as c:
        c.execute("select duo_v3_private.activate_funds(%s)", (hp,))
        pe = str(c.execute("select duo_v3_private.create_envelope(%s,'Épargne perso',true)", (hp,)).fetchone()[0])
    contrib(UC, hp, E(50), ((pe, E(50)),)); pp = protect(UC, hp, pe, True); pl = protect(UC, hp, pe, False); pm = move(UC, hp, pe, None, E(10))
    record("FB-10b", F, "Espace personnel : protection posée et levée par son propriétaire seul", "C protège puis lève ; désaffectation",
           "protected ; none ; ok", f"{pp[1]} {pl[1]} {pm[0]}", okp and pp == (True, "protected") and pl == (True, "none") and pm[0])

    F = "Annulation réversible et restauration"
    h, ids = duo([("A", E(100), True)]); c1 = contrib(UA, h, E(100)); a1 = move(UA, h, None, ids["A"], E(70))
    x1 = cancel(UB, h, a1[1]); s = snap(UA, h); x1b = cancel(UB, h, a1[1])
    r1 = restore(UA, h, x1[1]); s2 = snap(UA, h); r1b = restore(UA, h, x1[1])
    good = x1[0] and s["household"]["unassignedRealFunds"] == str(E(100)) and env_of(s, ids["A"])["realAvailable"] == "0" and (not x1b[0]) and str(x1b[1]).startswith("23505") \
           and r1[0] and env_of(s2, ids["A"])["realAvailable"] == str(E(70)) and (not r1b[0]) and str(r1b[1]).startswith("23505")
    record("FB-11", F, "Annuler une affectation la contre-passe exactement ; double annulation refusée ; restauration = nouvelle écriture, unique",
           "affecter 70 ; annuler ; annuler ; restaurer ; restaurer", "non affecté 100 / A 0 ; 23505 ; A 70 ; 23505",
           f"annul={x1[0]} non_aff={s['household']['unassignedRealFunds']} A={env_of(s, ids['A'])['realAvailable']} 2e={x1b[1][:5] if not x1b[0] else 'ok'} restaur={r1[0]} A={env_of(s2, ids['A'])['realAvailable']} 2e={r1b[1][:5] if not r1b[0] else 'ok'}", good)
    x2 = cancel(UA, h, c1[1]); inv = invariant(h)
    plan = call(UA, "select public.duo_v3_contribution_release_plan(%s,%s)", (h, c1[1]))[1]
    mv_ = move(UA, h, ids["A"], None, E(70)); plan2 = call(UA, "select public.duo_v3_contribution_release_plan(%s,%s)", (h, c1[1]))[1]
    x2b = cancel(UA, h, c1[1]); inv2 = invariant(h)
    items = [(i["account"], i["required"], i["available"], i["toRelease"]) for i in plan["items"]]
    record("FB-11b", F, "R-B5 : annulation d'une contribution affectée refusée tant que les fonds ne sont pas libérés ; parcours guidé ; puis annulation acceptée",
           "annuler (70 affectés) ; plan ; désaffecter 70 ; plan ; annuler", "23514 hint release_funds_first ; à libérer 70 ; annulable ; accepté ; invariant",
           f"{x2[1][:5] if not x2[0] else 'accepté'} plan={items} annulable={plan['cancellable']}→{plan2['cancellable']} désaff={mv_[0]} annulation={x2b[0]} inv={inv2['ok']}",
           (not x2[0]) and str(x2[1]).startswith("23514") and items == [("unassigned", str(E(100)), str(E(30)), str(E(70)))] and plan["cancellable"] is False
           and mv_[0] and plan2["cancellable"] is True and x2b[0] and inv["ok"] and inv2["ok"])
    contrib(UA, h, E(200)); move(UA, h, None, ids["A"], E(70))                     # rétablit des fonds pour la suite
    e1 = expense(UA, h, ids["A"], E(90)); s = snap(UA, h); x3 = cancel(UB, h, e1[1]); s3 = snap(UA, h); r3 = restore(UB, h, x3[1]); s4 = snap(UA, h); inv = invariant(h)
    good = e1[0] and env_of(s, ids["A"])["realAvailable"] == str(-E(20)) and x3[0] and env_of(s3, ids["A"])["realAvailable"] == str(E(70)) \
           and env_of(s3, ids["A"])["realizedExpenses"] == "0" and r3[0] and env_of(s4, ids["A"])["realAvailable"] == str(-E(20)) and env_of(s4, ids["A"])["realizedExpenses"] == str(E(90)) and inv["ok"]
    record("FB-12", F, "Annuler puis restaurer une dépense : réel et dépenses réalisées suivent ; la restauration peut recréer un déficit réel",
           "dépense 90 (réel 70) ; annuler ; restaurer", "réel −20 → 70 (dépenses 0) → −20 (dépenses 90) ; invariant",
           f"{env_of(s, ids['A'])['realAvailable']} → {env_of(s3, ids['A'])['realAvailable']} ({env_of(s3, ids['A'])['realizedExpenses']}) → {env_of(s4, ids['A'])['realAvailable']} ({env_of(s4, ids['A'])['realizedExpenses']}) inv={inv['ok']}", good)
    h2, ids2 = duo([("P", E(100), True)]); c2 = contrib(UA, h2, E(100), assign=((ids2["P"], E(100)),)); protect(UA, h2, ids2["P"], True); x4 = cancel(UA, h2, c2[1])
    pl4 = call(UA, "select public.duo_v3_contribution_release_plan(%s,%s)", (h2, c2[1]))[1]
    record("FB-12b", F, "Annuler une contribution affectée à une enveloppe protégée : refusé ; le plan signale la protection",
           "contribution 100 → P ; protéger P ; annuler ; plan", "23514 ; plan non annulable, protected=true", f"{x4[1][:5] if not x4[0] else 'accepté'} plan={[(i['account'], i['protected']) for i in pl4['items']]} annulable={pl4['cancellable']}",
           (not x4[0]) and str(x4[1]).startswith("23514") and pl4["cancellable"] is False and pl4["items"][0]["protected"] is True)

    F = "Reports"
    h, ids = duo([("Rep", E(100), True), ("NonRep", E(100), False), ("Def", E(50), True)], months_late=2)
    # La 1re RPC rattrape les 2 cycles échus ; les opérations portent sur la période courante, puis on la clôt.
    contrib(UA, h, E(300)); move(UA, h, None, ids["Rep"], E(80)); move(UA, h, None, ids["NonRep"], E(60)); move(UA, h, None, ids["Def"], E(10)); expense(UA, h, ids["Def"], E(40))
    with ac() as c: c.execute("select duo_v3_private.ensure_current_period(%s, (date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month 1 day') at time zone 'Europe/Paris')", (h,))   # franchit exactement une borne
    s = snap(UA, h); rep, non, de = env_of(s, ids["Rep"]), env_of(s, ids["NonRep"]), env_of(s, ids["Def"])
    # budget : 3 allocations (2 rattrapées + courante) puis clôture courante ; Rep : 4×100 ; NonRep : la clôture envoie le positif en réserve, puis +100
    sweep = q1("select count(*) from public.duo_v3_transactions where household_id=%s and kind='funds_sweep'", (h,))
    good = rep["realAvailable"] == str(E(80)) and rep["realCarryOver"] == str(E(80)) and non["realAvailable"] == "0" and de["realAvailable"] == str(-E(30)) \
           and de["realCarryOver"] == str(-E(30)) and rep["assignedRealFunds"] == "0" and non["budgetBalance"] == str(E(100)) and int(rep["carryOver"]) == E(300) \
           and s["household"]["unassignedRealFunds"] == str(E(300 - 80 - 10)) and sweep == 1 and s["household"]["invariantHolds"]
    record("FB-13", F, "Clôture : reliquat réel positif sans report → non affecté (R-B1) ; reports réels conservés ailleurs ; déficits conservés",
           "rattrapage de 2 cycles ; opérations ; clôture de la période courante", "R-B1 : NonRep réel 60 balayé vers le non-affecté (1 écriture funds_sweep) ; Rep 80 conservé ; déficit Def −30 conservé ; non affecté 210",
           f"Rep réel={rep['realAvailable']} reporté={rep['realCarryOver']} | NonRep réel={non['realAvailable']} budget={non['budgetBalance']} | Def réel={de['realAvailable']} | non_affectés={s['household']['unassignedRealFunds']} balayages={sweep}",
           good, note="Écart explicite avec le prototype (aucun balayage) : R-B1 appliqué.")

    F = "Contournements et isolation"
    h, ids = duo([("A", E(100), True)])
    with conn() as c:
        try:
            with c.cursor() as cur:
                t = str(uuid.uuid4()); pid = q1("select id from public.duo_v3_periods where household_id=%s and state='open'", (h,))
                cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR','raw','contribution',%s,%s,current_date)", (t, h, UA, pid))
                cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (%s,%s,duo_v3_private.account_of(%s,'cash'),'EUR',100),(%s,%s,duo_v3_private.account_of(%s,'clearing'),'EUR',-100)", (t, h, h, t, h, h))
            c.commit(); r = (True, "accepté")
        except psycopg.Error as e: c.rollback(); r = (False, f"{st(e)} {str(e).splitlines()[0]}")
    record("FB-14", F, "Écriture privilégiée (postgres) qui ajoute de la trésorerie sans fonds réels : refusée à la validation", "INSERT direct cash/clearing dans un duo activé",
           "23514", r[1], (not r[0]) and r[1].startswith("23514"))
    h0, _ = duo([("A", E(100), True)], members=(UC,), activate=False)      # C : n'interrompt pas le duo de A et B
    with conn() as c:
        try:
            with c.cursor() as cur:
                t = str(uuid.uuid4()); pid = q1("select id from public.duo_v3_periods where household_id=%s and state='open'", (h0,))
                cur.execute("insert into public.duo_v3_accounts(household_id,label,kind,currency) values (%s,'fx','funds_unassigned','EUR'),(%s,'fy','funds_external','EUR')", (h0, h0))
                cur.execute("insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id,occurred_on) values (%s,%s,'EUR','raw2','assignment',%s,%s,current_date)", (t, h0, UC, pid))
                cur.execute("insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) select %s,%s,id,'EUR',case kind when 'funds_unassigned' then 5 else -5 end from public.duo_v3_accounts where household_id=%s and kind in ('funds_unassigned','funds_external')", (t, h0, h0))
            c.commit(); r = (True, "accepté")
        except psycopg.Error as e: c.rollback(); r = (False, f"{st(e)} {str(e).splitlines()[0]}")
    record("FB-14b", F, "Livre funds utilisé dans un duo non activé : refusé", "INSERT privilégié", "23514", r[1], (not r[0]) and r[1].startswith("23514"))
    s_c = call(UC, "select public.duo_v3_get_funds_snapshot(%s)", (h,)); s_anon = call(None, "select public.duo_v3_get_funds_snapshot(%s)", (h,), role="anon")
    mv_c = move(UC, h, None, ids["A"], 1)
    good = s_c[0] and s_c[1]["envelopes"] == [] and s_c[1]["household"] is None and (not s_anon[0]) and str(s_anon[1]).startswith("42501") and (not mv_c[0]) and str(mv_c[1]).startswith("42501")
    record("FB-15", F, "Isolation : un non-membre ne lit rien et n'agit pas ; anon refusé", "C lit / affecte dans le duo A ; anon lit", "vide ; 42501 ; 42501",
           f"C enveloppes={s_c[1]['envelopes'] if s_c[0] else s_c[1]} foyer={s_c[1]['household'] if s_c[0] else ''} anon={s_anon[1][:5] if not s_anon[0] else 'ok'} C_move={mv_c[1][:5] if not mv_c[0] else 'ok'}", good)
    k1 = move(UA, h, None, ids["A"], 0); contrib(UA, h, E(10)); k2 = move(UA, h, None, ids["A"], 5, key="mk"); k3 = move(UA, h, None, ids["A"], 5, key="mk"); k4 = move(UA, h, None, ids["A"], 6, key="mk")
    record("FB-16", F, "Paramètres et idempotence des mouvements", "montant 0 ; rejeu même charge ; même clé autre montant", "22023 ; même uuid ; 23505",
           f"{k1[1][:5] if not k1[0] else 'ok'} ; même={k2[1] == k3[1]} ; {k4[1][:5] if not k4[0] else 'ok'}",
           (not k1[0]) and str(k1[1]).startswith("22023") and k2[0] and k2[1] == k3[1] and (not k4[0]) and str(k4[1]).startswith("23505"))
    with ac() as c:
        try: c.execute("select duo_v3_private.archive_envelope(%s)", (ids["A"],)); r = (True, "accepté")
        except psycopg.Error as e: r = (False, f"{st(e)} {str(e).splitlines()[0]}")
    record("FB-17", F, "Archivage d'une enveloppe qui détient des fonds réels : refusé", "archive_envelope (A détient 5 c réels, budget ≠ 0)", "23514", r[1], (not r[0]) and r[1].startswith("23514"))

    F = "Migration V2 → V3 (base V2 synthétique, fixtures PR #17)"
    tmp = tempfile.mkdtemp(); v2 = os.path.join(tmp, "v2.sqlite"); db = sqlite3.connect(v2)
    db.executescript(open(pathlib.Path(__file__).resolve().parent / "v2_reference/schema_v2_ddl.sql").read())
    db.executemany("insert into members(id,name) values (?,?)", [("m-a", "Membre A"), ("m-b", "Membre B")])
    rows = [("logement", "Logement", 450, 0, 900, 650), ("alimentation", "Alimentation", 200, 0, 300, 185), ("transport", "Transport", 100, 0, 150, 80),
            ("loisirs", "Loisirs", 100, 0, 100, 45), ("vacances", "Vacances", 150, 1, 150, 0)]
    for cid, name, mpp, locked, contr, spent in rows:
        db.execute("insert into categories(id,name,monthly_per_person,locked) values (?,?,?,?)", (cid, name, mpp, locked))
        db.execute("insert into contributions(id,amount,category_id,member_id,date) values (?,?,?,?,date('now'))", (f"c-{cid}-a", contr / 2, cid, "m-a"))
        db.execute("insert into contributions(id,amount,category_id,member_id,date) values (?,?,?,?,date('now'))", (f"c-{cid}-b", contr / 2, cid, "m-b"))
        if spent: db.execute("insert into expenses(id,label,amount,category_id,paid_by_member_id,date) values (?,?,?,?,?,date('now'))", (f"x-{cid}", name, spent, cid, "m-a"))
    db.execute("insert into expenses(id,label,amount,category_id,paid_by_member_id,date) values ('x-flottant','test',0.1+0.2,'loisirs','m-b',date('now'))")
    db.execute("insert into expenses(id,label,amount,category_id,paid_by_member_id,date,status) values ('x-prevue','prévue',30,'loisirs','m-b',date('now'),'planned')")
    db.commit(); db.close()
    P = v2_plan(v2)
    record("FB-18", F, "Plan V2 : REAL → centimes exacts ; valeur non exprimable rejetée (jamais arrondie) ; opération non réalisée non migrée",
           "base V2 synthétique + 0.1+0.2 + une dépense 'planned'", "5 enveloppes ; cible = mensuel × 2 ; 1 rejet (x-flottant) ; 1 non migrée (x-prevue)",
           f"enveloppes={[(e['v2_id'], e['target_minor'], e['protected']) for e in P['envelopes']]} rejets={[r['id'] for r in P['rejected']]} non_migrées={[r['id'] for r in P['skipped']]}",
           len(P["envelopes"]) == 5 and [r["id"] for r in P["rejected"]] == ["x-flottant"] and [r["id"] for r in P["skipped"]] == ["x-prevue"]
           and {e["v2_id"]: e["target_minor"] for e in P["envelopes"]}["logement"] == E(900))
    h, ids = duo([(e["name"], e["target_minor"], True) for e in P["envelopes"]])
    vid = {e["v2_id"]: ids[e["name"]] for e in P["envelopes"]}; errs = []
    with ac() as c:
        for o in P["openings"]:
            c.execute("select duo_v3_private.post_opening_balance(%s,%s,%s,%s)", (h, vid[o["envelope"]], o["amount_minor"], f"v2-opening:{o['envelope']}"))
        again = [c.execute("select duo_v3_private.post_opening_balance(%s,%s,%s,%s)", (h, vid[o["envelope"]], o["amount_minor"], f"v2-opening:{o['envelope']}")).fetchone()[0] for o in P["openings"]]
    for e in P["envelopes"]:
        if e["protected"]: r = protect(UA, h, vid[e["v2_id"]], True); r[0] or errs.append(r[1])
    s = snap(UA, h); envs = s["envelopes"]
    tot = lambda k: sum(int(e[k]) for e in envs)
    prot = sum(int(e["realAvailable"]) for e in envs if e["protectionState"] == "protected")
    match = all(env_of(s, vid[k])["realAvailable"] == str(v) for k, v in P["expected_real_available"].items())
    order_ok = [e["protectionState"] for e in envs] == ["none"] * 4 + ["protected"]
    n_open = q1("select count(*) from public.duo_v3_transactions where household_id=%s and kind='funds_opening'", (h,))
    good = not errs and tot("target") == E(2000) and tot("realAvailable") == E(640) and tot("realizedExpenses") == 0 and prot == E(150) and match and order_ok \
           and s["household"]["realTreasury"] == str(E(640)) and s["household"]["unassignedRealFunds"] == "0" and s["household"]["invariantHolds"] \
           and P["reconciliation"]["balanced"] and P["reconciliation"]["openings_total_minor"] == E(640) and n_open == 5 and len(P["archive_sha256"]) == 64 and len(P["backup_sha256"]) == 64
    record("FB-19", F, "R-B4 : soldes d'ouverture par enveloppe (idempotents) ; rapprochement Σ ouvertures = Σ versé − Σ dépensé V2 ; détail archivé (empreinte) ; sauvegarde (empreinte)",
           "plan V2 synthétique → 5 ouvertures ×2 (rejeu), protection", "réel par enveloppe = V2 ; total réel 640 ; protégé 150 ; trésorerie 640 ; 5 écritures ; rapprochement équilibré",
           f"erreurs={errs} cible={tot('target')} réel={tot('realAvailable')} protégé={prot} trésorerie={s['household']['realTreasury']} ouvertures={n_open} rapprochement={P['reconciliation']} archive={P['archive_sha256'][:12]}", good,
           note="Écart explicite avec le prototype (rejeu des contributions et dépenses V2) : R-B4 retient des soldes d'ouverture ; le détail 1600/960 reste dans l'archive.")
    record("FB-19b", F, "Prévisionnel par enveloppe non modélisé (R-B2, lot distinct) : état explicite, jamais un zéro", "lecture", "forecastBalance null ; forecastState not_available ; contributions attendues not_configured",
           f"{[e['forecastBalance'] for e in envs][:2]} {envs[0]['forecastState']} {s['household']['expectedContributionsState']}",
           all(e["forecastBalance"] is None and e["forecastState"] == "not_available" for e in envs) and s["household"]["expectedContributionsState"] == "not_configured")
    F = "Contributions attendues (R-B3)"
    shares = json.dumps({UA: 6000, UB: 4000}); exc = json.dumps({vid["vacances"]: {UA: 5000, UB: 5000}})
    bad1 = call(UA, "select public.duo_v3_propose_contribution_split(%s,%s::jsonb,'{}'::jsonb)", (h, json.dumps({UA: 6000, UB: 3000})))
    pr = call(UA, "select public.duo_v3_propose_contribution_split(%s,%s::jsonb,%s::jsonb)::text", (h, shares, exc))
    s_prov = snap(UB, h)["household"]
    self_acc = call(UA, "select public.duo_v3_accept_contribution_split(%s,%s)::text", (h, pr[1]))
    acc = call(UB, "select public.duo_v3_accept_contribution_split(%s,%s)::text", (h, pr[1]))
    hh = snap(UA, h)["household"]; by = {m["userId"]: m for m in hh["expectedByMember"]}
    starts = q1("select starts_on::text from public.duo_v3_periods where household_id=%s and state='open'", (h,))
    good = (not bad1[0]) and str(bad1[1]).startswith("22023") and pr[0] and s_prov["expectedContributionsState"] == "provisional" and (not self_acc[0]) and str(self_acc[1]).startswith("42501") \
           and acc == (True, starts) and hh["expectedContributionsState"] == "agreed" and by[UA]["expected"] == str(E(1170)) and by[UB]["expected"] == str(E(830)) \
           and hh["expectedContributions"] == str(E(2000)) and hh["forecastTreasury"] == str(E(640 + 2000))
    record("FB-20", F, "Répartition globale 60/40, exception Vacances 50/50, accord mutuel ; 1re répartition sur le cycle courant (CF-10) ; attendu ≠ argent",
           "proposition invalide ; proposition A ; lecture ; A accepte sa propre proposition ; B accepte", "22023 ; provisoire ; 42501 ; effet au début du cycle courant ; A 1170, B 830 (total 2000) ; trésorerie prévue 2640",
           f"{str(bad1[1])[:5]} {s_prov['expectedContributionsState']} {str(self_acc[1])[:5]} effet={acc[1]} A={by[UA]['expected']} B={by[UB]['expected']} total={hh['expectedContributions']} prévu={hh['forecastTreasury']}", good,
           note="Écart explicite avec le prototype (contributions prévues déclarées) : R-B3 calcule l'attendu depuis la répartition convenue.")
    pr2 = call(UB, "select public.duo_v3_propose_contribution_split(%s,%s::jsonb,'{}'::jsonb)::text", (h, json.dumps({UA: 5000, UB: 5000})))
    acc2 = call(UA, "select public.duo_v3_accept_contribution_split(%s,%s)::text", (h, pr2[1]))
    ends = q1("select ends_on::text from public.duo_v3_periods where household_id=%s and state='open'", (h,))
    hh2 = snap(UA, h)["household"]; by2 = {m["userId"]: m for m in hh2["expectedByMember"]}
    record("FB-20b", F, "Modification acceptée : effet au cycle suivant, jamais rétroactive (D-010)", "nouvelle proposition 50/50 (B), acceptée par A",
           "effet = fin du cycle courant ; attendu courant inchangé (1170 / 830)", f"effet={acc2[1]} fin={ends} A={by2[UA]['expected']} B={by2[UB]['expected']}",
           acc2 == (True, ends) and by2[UA]["expected"] == str(E(1170)) and by2[UB]["expected"] == str(E(830)))
    contrib(UA, h, E(300)); hh3 = snap(UB, h)["household"]; by3 = {m["userId"]: m for m in hh3["expectedByMember"]}
    record("FB-20c", F, "Versements réels libres : A verse 300 ; l'attendu ne change pas, la prévision baisse d'autant", "contribution A 300", "A attendu 1170, réalisé 300 ; prévision trésorerie 2640",
           f"A={by3[UA]} prévu={hh3['forecastTreasury']}", by3[UA]["expected"] == str(E(1170)) and by3[UA]["realized"] == str(E(300)) and hh3["forecastTreasury"] == str(E(940 + 870 + 830)))

    F = "Invariant global"
    with ac() as c:
        bad = c.execute("""select x.household_id from public.duo_v3_entries x join public.duo_v3_accounts a on a.id=x.account_id
                           join public.duo_v3_households h on h.id=x.household_id where h.funds_tracking group by 1
                           having coalesce(sum(x.amount_minor) filter (where a.kind='cash'),0) <> coalesce(sum(x.amount_minor) filter (where a.kind in ('funds_unassigned','funds_envelope')),0)
                              or coalesce(sum(x.amount_minor) filter (where a.book='funds'),0) <> 0
                              or coalesce(sum(x.amount_minor) filter (where a.kind='funds_unassigned'),0) < 0""").fetchall()
        n = c.execute("select count(*) from public.duo_v3_households where funds_tracking").fetchone()[0]
    record("FB-21", F, "Sur tous les duos activés du banc : Σ fonds = trésorerie ; livre funds équilibré ; non-affecté ≥ 0", "requête globale", "0 duo en défaut",
           f"duos activés={n} en défaut={len(bad)}", n > 0 and not bad)

if __name__ == "__main__":
    fresh()
    try: run()
    except Exception as e:
        import traceback; record("FB-ERR", "Exécution", "Erreur du banc", "—", "aucune", f"{type(e).__name__}: {e} {traceback.format_exc()[-400:]}", False)
    with admin() as c: c.execute(f'drop database if exists "{DB}" with (force)')
    summ = {}
    for r in RESULTS: summ[r["statut"]] = summ.get(r["statut"], 0) + 1
    p = pathlib.Path(__file__).resolve().parent / "results" / f"{LABEL}.json"
    p.write_text(json.dumps(dict(label=LABEL, template=TEMPLATE, resume=summ, resultats=RESULTS), indent=1, ensure_ascii=False, default=str)); print(json.dumps(summ))
