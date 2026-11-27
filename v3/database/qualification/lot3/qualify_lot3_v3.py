#!/usr/bin/env python3
"""Lot C — qualification des AJOUTS v3 du prototype lot 3 (POST006-02, -05, -06) et des courses.
La suite v2 (L3-01…L3-27) est rejouée séparément, inchangée (qualify_lot3_v2.py).
Usage : python3 qualify_lot3_v3.py <template=l3r|l3p> <label>"""
import json, sys, uuid, threading, time, datetime, os, pathlib
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2]]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import qualify_lot3_v2 as B          # helpers (connexion, JWT simulé, utilisateurs, duo, invitation)
import psycopg
B.DB = f"l3v3_{sys.argv[2]}"
call, q, user, duo, invite, accept, active, st = B.call, B.q, B.user, B.duo, B.invite, B.accept, B.active, B.st
RESULTS = []
def record(sid, rule, decision, action, expected, observed, ok, note=""):
    s = "Réussi" if ok else "Échoué"
    RESULTS.append(dict(id=sid, regle=rule, decision=decision, action=action, attendu=expected, observe=observed, statut=s, note=note))
    print(f"{sid:8} {s:8} {observed[:130]}", flush=True)
HAS_FUNDS = False
def pair():
    a, b = user(f"{uuid.uuid4().hex[:8]}@example.invalid"), user(f"{uuid.uuid4().hex[:8]}@example.invalid")
    h, env = duo(a); _, tok = invite(a, h); ok, v = accept(b, tok); assert ok, v
    return a, b, h, env
def role(h, u): return q("select role, status from public.duo_v3_members where household_id=%s and user_id=%s", (h, u))[0]
def events(h): return [r[0] for r in q("select event from public.duo_v3_membership_events where household_id=%s order by id", (h,))]
def archived(h): return q("select archived_at is not null from public.duo_v3_households where id=%s", (h,))[0][0]

def main():
    global HAS_FUNDS
    with B.admin() as c:
        c.execute(f'drop database if exists "{B.DB}" with (force)'); c.execute(f'create database "{B.DB}" template "{B.TEMPLATE}" owner postgres')
    HAS_FUNDS = bool(q("select count(*) from pg_proc where proname in ('duo_v3_get_funds_snapshot_all','funds_snapshot_all')")[0][0])

    D = "POST006-02"
    a, b, h, env = pair()
    call(b, "select public.duo_v3_post_contribution(%s,50000,current_date,'b-in')", (h,))
    call(b, "select public.duo_v3_post_expense(%s,%s,1000,current_date,'b-before')", (h, env))
    call(b, "select public.duo_v3_leave_household(%s)", (h,)); time.sleep(0.02)
    call(a, "select public.duo_v3_post_expense(%s,%s,2500,current_date,'a-during')", (h, env)); time.sleep(0.02)
    _, tok = invite(a, h); accept(b, tok)
    sa = call(a, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]; sb = call(b, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]
    strip = lambda s: {k: v for k, v in s.items() if k != "asOf"}
    va = call(a, "select balance_minor from public.duo_v3_envelope_balances where envelope_id=%s", (env,))[1]
    vb = call(b, "select balance_minor from public.duo_v3_envelope_balances where envelope_id=%s", (env,))[1]
    pa = call(a, "select cash_minor from public.duo_v3_household_position where household_id=%s", (h,))[1]
    pb = call(b, "select cash_minor from public.duo_v3_household_position where household_id=%s", (h,))[1]
    record("C3-01", "Soldes communs courants identiques pour les deux membres actifs, y compris un membre revenu", D,
           "B part, A dépense 25 €, B revient ; A et B lisent instantané, vue des soldes, position", "instantanés identiques (hors horodatage) ; soldes et trésorerie égaux",
           f"instantané_égal={strip(sa) == strip(sb)} solde A={va} B={vb} trésorerie A={pa} B={pb}", strip(sa) == strip(sb) and va == vb and pa == pb and va is not None)
    keys = call(b, "select array_agg(idempotency_key order by idempotency_key) from public.duo_v3_transactions where household_id=%s", (h,))[1][0] or []
    lines = call(b, "select count(*) from public.duo_v3_entries x join public.duo_v3_transactions t on t.id=x.transaction_id where t.idempotency_key='a-during'")[1][0]
    record("C3-02", "Détail de la période d'absence non accessible (transactions et lignes)", "CF-07 / POST006-02",
           "B lit le journal et les lignes", "« a-during » invisible ; 0 ligne", f"clés={keys} lignes_a_during={lines}", "a-during" not in keys and "b-before" in keys and lines == 0)
    record("C3-03", "Divulgation indirecte explicitée : l'effet net de l'absence est visible dans les soldes, jamais l'opération", "POST006-02",
           "B compare son solde à ses propres opérations visibles", "solde B = solde commun (inclut −25 €) ≠ somme des lignes que B voit",
           f"solde={vb[0]} somme_visible={call(b, 'select coalesce(sum(x.amount_minor),0) from public.duo_v3_entries x where x.account_id=(select account_id from public.duo_v3_envelopes where id=%s)', (env,))[1][0]}",
           vb[0] != call(b, "select coalesce(sum(x.amount_minor),0) from public.duo_v3_entries x where x.account_id=(select account_id from public.duo_v3_envelopes where id=%s)", (env,))[1][0],
           note="Comportement voulu et documenté (07_lot3 § divulgation) : le nombre d'opérations (ledgerVersion) et les soldes reflètent l'absence.")
    t = user("tiers@example.invalid")
    st_ = call(t, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]; vt = call(t, "select count(*) from public.duo_v3_envelope_balances where household_id=%s", (h,))[1][0]
    record("C3-04", "Non-membre et ancien membre (parti) : aucun solde, aucun instantané", "POST006-02", "tiers lit", "enveloppes [] ; 0 ligne de solde",
           f"enveloppes={st_['envelopes']} position={st_['position']} soldes={vt}", st_["envelopes"] == [] and st_["position"] is None and vt == 0)
    if HAS_FUNDS:
        with B.conn(autocommit=True) as c: c.execute("select duo_v3_private.activate_funds(%s)", (h,))
        fa = call(a, "select public.duo_v3_get_funds_snapshot(%s)", (h,))[1][0]; fb = call(b, "select public.duo_v3_get_funds_snapshot(%s)", (h,))[1][0]
        record("C3-05", "Fonds réels (prototype 007) : instantané identique pour les deux membres actifs", "POST006-02 × POST006-03", "A et B lisent l'instantané des fonds",
               "identique hors horodatage", f"égal={strip(fa) == strip(fb)} trésorerie={fa['household']['realTreasury']}", strip(fa) == strip(fb))

    D = "POST006-06"
    a, b, h, env = pair()
    call(a, "select public.duo_v3_leave_household(%s)", (h,))
    record("C3-06", "Départ du propriétaire : le membre restant devient propriétaire ; journalisé ; duo actif", D, "A (owner) quitte",
           "B owner actif ; évènements [left, owner_transferred] ; non archivé", f"B={role(h, b)} évènements={events(h)} archivé={archived(h)}",
           role(h, b) == ("owner", "active") and events(h) == ["left", "owner_transferred"] and not archived(h))
    okw = call(b, "select public.duo_v3_post_expense(%s,%s,500,current_date,'b-after-transfer')::text", (h, env))
    _, tk = invite(b, h); okr = accept(a, tk)
    record("C3-07", "Continuité : le nouveau propriétaire écrit et invite ; l'ancien propriétaire revient comme partenaire", D, "B écrit puis invite A",
           "écriture ok ; A revient partner", f"écriture={okw[0]} retour={okr[0]} A={role(h, a)}", okw[0] and okr[0] and role(h, a) == ("partner", "active"))
    n_before = q("select count(*) from public.duo_v3_transactions where household_id=%s", (h,))[0][0]
    call(a, "select public.duo_v3_leave_household(%s)", (h,)); call(b, "select public.duo_v3_leave_household(%s)", (h,))
    n_tx = q("select count(*) from public.duo_v3_transactions where household_id=%s", (h,))[0][0]
    record("C3-08", "Plus aucun membre : duo archivé, rien n'est détruit", D, "A puis B quittent", "archivé ; évènement household_archived ; transactions conservées (même nombre)",
           f"archivé={archived(h)} évènements={events(h)[-2:]} transactions {n_before}→{n_tx}", archived(h) and events(h)[-1] == "household_archived" and n_tx == n_before and n_tx >= 2)
    c_ = user("c@example.invalid")
    okinv = call(b, "select * from public.duo_v3_create_invitation(%s,'link',null)", (h,))
    try: q("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner')", (h, c_)); okins = (True, "")
    except psycopg.Error as e: okins = (False, f"{st(e)} {e}")
    try: q("update public.duo_v3_households set archived_at=null where id=%s", (h,)); okun = (True, "")
    except psycopg.Error as e: okun = (False, f"{st(e)} {e}")
    record("C3-09", "Duo archivé : ni invitation, ni réactivation directe, ni désarchivage", D, "inviter ; INSERT membre (postgres) ; UPDATE archived_at=null",
           "42501 (plus membre) ; 55000 ; 23514", f"{str(okinv[1])[:5]} ; {okins[1][:5]} ; {okun[1][:5]}",
           (not okinv[0]) and okins[1].startswith("55000") and okun[1].startswith("23514"))
    a, b, h, env = pair()
    out = B.race(2, lambda i: (a if i == 0 else b, "select public.duo_v3_leave_household(%s)", (h,)))
    ev = events(h); owners = q("select count(*) from public.duo_v3_members where household_id=%s and role='owner' and status='active'", (h,))[0][0]
    record("C3-10", "Course : les deux membres quittent simultanément", D, "2 départs simultanés", "2 ok ; archivé une seule fois ; 0 propriétaire actif",
           f"{out} évènements={ev} propriétaires_actifs={owners}", out == ["ok", "ok"] and ev.count("household_archived") == 1 and owners == 0 and archived(h))

    D = "POST006-05 / CF-09"
    a, b, h, env = pair()
    before = q("select count(*), coalesce(sum(amount_minor),0) from public.duo_v3_entries where household_id=%s", (h,))[0]
    q("delete from auth.users where id=%s", (a,))
    after = q("select count(*), coalesce(sum(amount_minor),0) from public.duo_v3_entries where household_id=%s", (h,))[0]
    record("C3-11", "Suppression Auth hors procédure : réconciliée dans la même transaction (déclencheur) ; propriété transmise ; grand livre intact", D,
           "DELETE auth.users du propriétaire", "A left ; B owner ; évènements [left, owner_transferred] ; lignes identiques",
           f"A={role(h, a)} B={role(h, b)} évènements={events(h)} lignes {before}→{after}",
           role(h, a) == ("owner", "left") and role(h, b) == ("owner", "active") and events(h) == ["left", "owner_transferred"] and before == after)
    a2, b2, h2, _ = pair()
    with psycopg.connect(host=B.HOST, port=B.PORT, user="supabase_admin", dbname=B.DB, autocommit=True) as c:
        c.execute("set session_replication_role = replica")          # simule une suppression qui contourne les déclencheurs
        c.execute("delete from auth.users where id=%s", (b2,))
    orphan_before = active(h2)
    n = q("select duo_v3_private.reconcile_orphan_memberships()")[0][0]; n2 = q("select duo_v3_private.reconcile_orphan_memberships()")[0][0]
    record("C3-12", "Réconciliation des orphelins : membre actif sans compte Auth → départ « auth_orphan » ; idempotente", D,
           "suppression sans déclencheur (replica, supabase_admin) ; reconcile ×2", "2 actifs avant ; 1 réconcilié puis 0 ; B left ; évènement orphan_reconciled",
           f"actifs_avant={orphan_before} réconciliés={n},{n2} B={role(h2, b2)} évènements={events(h2)}",
           orphan_before == 2 and n == 1 and n2 == 0 and role(h2, b2) == ("partner", "left") and events(h2) == ["orphan_reconciled"])
    u = user("solo@example.invalid"); hs, _ = duo(u, False); ok = q("select duo_v3_private.prepare_account_deletion(%s)", (u,))[0][0]
    record("C3-13", "Suppression du dernier membre : duo archivé, sans destruction", D, "prepare_account_deletion du seul membre", "1 départ ; archivé",
           f"départs={ok} archivé={archived(hs)} évènements={events(hs)}", ok == 1 and archived(hs) and events(hs) == ["left", "household_archived"])

    D = "Espace personnel"
    a, b, h, env = pair()
    okp, hp = call(a, "select public.duo_v3_create_personal_space('EUR')::text"); hp = hp[0] if okp else None
    okp2, hp2 = call(a, "select public.duo_v3_create_personal_space('EUR')::text")
    record("C3-14", "Espace personnel : créé à côté du duo actif (CF-05 ne porte que sur les duos) ; idempotent", D, "A crée deux fois",
           "même espace ; A actif dans le duo ET dans son espace", f"ok={okp} même={okp2 and hp2[0] == hp} duo_A={role(h, a)}", okp and okp2 and hp2[0] == hp and role(h, a)[1] == "active")
    penv = str(q("select duo_v3_private.create_envelope(%s,'Lecture',true)", (hp,))[0][0])
    q("select duo_v3_private.set_allocation(%s,6000,(select starts_on from public.duo_v3_periods where household_id=%s and state='open'))", (penv, hp))
    call(a, "select public.duo_v3_post_contribution(%s,5000,current_date,'p-in')", (hp,)); call(a, "select public.duo_v3_post_expense(%s,%s,1500,current_date,'p-livre')", (hp, penv))
    bs = call(b, "select public.duo_v3_get_envelope_snapshot(%s)", (hp,))[1][0]
    bt = call(b, "select count(*) from public.duo_v3_transactions where household_id=%s", (hp,))[1][0]
    bx = call(b, "select count(*) from public.duo_v3_entries where household_id=%s", (hp,))[1][0]
    bv = call(b, "select count(*) from public.duo_v3_envelope_balances where household_id=%s", (hp,))[1][0]
    bh = call(b, "select count(*) from public.duo_v3_households where id=%s", (hp,))[1][0]
    bm = call(b, "select count(*) from public.duo_v3_members where household_id=%s", (hp,))[1][0]
    bw = call(b, "select public.duo_v3_post_expense(%s,%s,1,current_date,'intrusion')", (hp, penv))
    record("C3-15", "Dépenses personnelles jamais exposées au partenaire, directement (journal, lignes) ni indirectement (soldes, instantané, existence)", D,
           "B lit transactions, lignes, soldes, instantané, foyer, membres de l'espace de A ; B écrit", "tout à 0 / vide ; écriture 42501",
           f"tx={bt} lignes={bx} soldes={bv} instantané={bs['envelopes']} foyer={bh} membres={bm} écriture={bw[1][:5] if not bw[0] else 'ACCEPTÉE'}",
           (bt, bx, bv, bh, bm) == (0, 0, 0, 0, 0) and bs["envelopes"] == [] and (not bw[0]) and str(bw[1]).startswith("42501"))
    common_before = call(b, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]
    call(a, "select public.duo_v3_post_expense(%s,%s,700,current_date,'p-2')", (hp, penv))
    common_after = call(b, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]
    strip = lambda s: {k: v for k, v in s.items() if k != "asOf"}
    record("C3-16", "Une dépense personnelle ne modifie aucune donnée commune (pas de canal indirect via le duo)", D, "A dépense dans son espace ; B relit le duo",
           "instantané commun inchangé (y compris ledgerVersion)", f"inchangé={strip(common_before) == strip(common_after)}", strip(common_before) == strip(common_after))
    inv = call(a, "select * from public.duo_v3_create_invitation(%s,'link',null)", (hp,))
    try: q("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'partner')", (hp, b)); ins = (True, "")
    except psycopg.Error as e: ins = (False, f"{st(e)} {e}")
    try: q("update public.duo_v3_members set space='duo' where household_id=%s and user_id=%s", (hp, a)); spc = q("select space from public.duo_v3_members where household_id=%s and user_id=%s", (hp, a))[0][0]
    except psycopg.Error as e: spc = f"{st(e)}"
    record("C3-17", "Espace personnel non partageable : ni invitation, ni 2e membre (même privilégié) ; espace non falsifiable", D,
           "inviter ; INSERT direct de B ; UPDATE space='duo'", "23514 ; 23514 ; space reste personal", f"{str(inv[1])[:5]} ; {ins[1][:5]} ; space={spc}",
           (not inv[0]) and str(inv[1]).startswith("23514") and ins[1].startswith("23514") and spc == "personal")
    if HAS_FUNDS:
        with B.conn(autocommit=True) as c: c.execute("select duo_v3_private.activate_funds(%s)", (hp,))
        fb = call(b, "select public.duo_v3_get_funds_snapshot(%s)", (hp,))[1][0]; fa = call(a, "select public.duo_v3_get_funds_snapshot(%s)", (hp,))[1][0]
        e = next(x for x in fa["envelopes"] if x["envelopeId"] == penv)
        record("C3-18", "Enveloppe personnelle (fonds réels) : lisible par son seul titulaire", D, "A et B lisent l'instantané des fonds de l'espace de A",
               "A : trésorerie 28 € (devenue fonds non affectés à l'activation) ; B : vide", f"A réel={e['realAvailable']} trésorerie={fa['household']['realTreasury']} B={fb['envelopes']} {fb['household']}",
               fb["envelopes"] == [] and fb["household"] is None and fa["household"]["realTreasury"] == "2800")

    D = "Courses"
    for i in range(6):
        a, b, h, env = pair()
        out = [None, None]; bar = threading.Barrier(2)
        def leave():
            bar.wait(); out[0] = call(b, "select public.duo_v3_leave_household(%s)", (h,))
        def write():
            bar.wait(); out[1] = call(b, "select public.duo_v3_post_expense(%s,%s,100,current_date,%s)::text", (h, env, f"race-{i}"))
        ts = [threading.Thread(target=leave), threading.Thread(target=write)]; [t.start() for t in ts]; [t.join() for t in ts]
        left_at = q("select left_at from public.duo_v3_members where household_id=%s and user_id=%s", (h, b))[0][0]
        late = q("select count(*) from public.duo_v3_transactions where household_id=%s and created_by=%s and created_at >= %s", (h, b, left_at))[0][0]
        RESULTS.append(dict(id=f"_r{i}", ok=out[0][0] and (out[1][0] or str(out[1][1]).startswith("42501")) and late == 0, w=out[1][0]))
    rr = [r for r in RESULTS if r["id"].startswith("_r")]; [RESULTS.remove(r) for r in rr]
    record("C3-19", "Départ et écriture financière simultanés (F7) : aucune écriture postérieure au départ", "F7 × POST006-06", "6 courses départ/dépense de B",
           "départ toujours ok ; dépense acceptée avant ou refusée 42501 ; 0 écriture après left_at", f"{[('écrite' if r['w'] else 'refusée') for r in rr]} conformes={all(r['ok'] for r in rr)}",
           all(r["ok"] for r in rr))
    bad = 0; seen = []
    for i in range(6):
        a, b, h, env = pair()
        out = B.race(2, lambda k: (a, "select public.duo_v3_leave_household(%s)", (h,)) if k == 0 else (b, "select public.duo_v3_post_expense(%s,%s,100,current_date,'w')", (h, env)))
        r_ = role(h, b); seen.append((out[1], r_)); bad += not (r_ == ("owner", "active") and out[0] == "ok")
    record("C3-20", "Départ du propriétaire et écriture du partenaire simultanés : écriture acceptée, propriété transmise", "POST006-06", "6 courses",
           "départ ok ; B owner ; écriture ok", f"{seen[:3]} incohérences={bad}", bad == 0 and all(s[0] == "ok" for s in seen))
    bad = []
    for i in range(6):
        a, b, h, env = pair()
        x = user(f"x{i}-{uuid.uuid4().hex[:6]}@example.invalid"); hx, _ = duo(x, False); _, tokx = invite(x, hx)
        out = [None, None]; bar = threading.Barrier(2)
        def dele():
            bar.wait()
            try: q("delete from auth.users where id=%s", (b,)); out[0] = "ok"
            except psycopg.Error as e: out[0] = st(e)
        def acc():
            bar.wait(); out[1] = accept(b, tokx)
        ts = [threading.Thread(target=dele), threading.Thread(target=acc)]; [t.start() for t in ts]; [t.join() for t in ts]
        act_b = q("select count(*) from public.duo_v3_members m where m.user_id=%s and m.status='active'", (b,))[0][0]
        if act_b != 0 or q("select count(*) from auth.users where id=%s", (b,))[0][0] != 0: bad.append((out, act_b))
    record("C3-21", "Suppression du compte et acceptation d'une invitation simultanées : jamais de membre actif sans compte", "POST006-05", "6 courses",
           "0 appartenance active pour le compte supprimé", f"anomalies={bad}", not bad,
           note="L'acceptation est refusée (CF-05 : déjà actif ailleurs) ou suivie de la suppression qui réconcilie toutes ses appartenances.")
    a, b, h, env = pair()
    call(b, "select public.duo_v3_leave_household(%s)", (h,)); ii, tk = invite(a, h)
    c_ = user("c2@example.invalid")
    out = B.race(2, lambda k: (a, "select public.duo_v3_revoke_invitation(%s)", (ii,)) if k == 0 else (c_, "select public.duo_v3_accept_invitation(%s)", (tk,)))
    stt = q("select status from public.duo_v3_invitations where id=%s", (ii,))[0][0]; n = active(h)
    record("C3-22", "Révocation et acceptation simultanées après un départ : état final cohérent", "CF-08", "révoquer / accepter",
           "accepted + 2 actifs, ou revoked + 1 actif", f"{out} statut={stt} actifs={n}", (stt == "accepted" and n == 2) or (stt == "revoked" and n == 1))

    summary = {}
    for r in RESULTS: summary[r["statut"]] = summary.get(r["statut"], 0) + 1
    with B.admin() as c: c.execute(f'drop database if exists "{B.DB}" with (force)')
    p = pathlib.Path(__file__).resolve().parent / "results" / f"{sys.argv[2]}.json"
    p.write_text(json.dumps(dict(label=sys.argv[2], template=B.TEMPLATE, fonds=HAS_FUNDS, bilan=summary, resultats=RESULTS), indent=1, ensure_ascii=False, default=str))
    print(json.dumps(summary, ensure_ascii=False))

if __name__ == "__main__":
    main()
