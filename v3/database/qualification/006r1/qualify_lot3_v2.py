#!/usr/bin/env python3
"""Qualification du PROTOTYPE lot 3 v2 (sur 006 + correctifs) : CF-05, CF-07, CF-08, CF-09 et revue sécurité.
Usage : python3 qualify_lot3_v2.py <template_db> <label>"""
import os, json, sys, uuid, threading, time, datetime, os
import psycopg
HOST, PORT = "/tmp", 54317
TEMPLATE, LABEL = sys.argv[1], sys.argv[2]
DB = f"l3_{LABEL}"
RESULTS = []
def admin(): return psycopg.connect(host=HOST, port=PORT, user="supabase_admin", dbname="postgres", autocommit=True)
def conn(autocommit=False): return psycopg.connect(host=HOST, port=PORT, user="postgres", dbname=DB, autocommit=autocommit)
def st(e): return getattr(e, "sqlstate", None) or "?"
def record(sid, rule, action, expected, observed, ok, status=None, note="", decision=""):
    s = status or ("Réussi" if ok else "Échoué")
    RESULTS.append(dict(id=sid, regle=rule, decision=decision, action=action, attendu=expected, observe=observed, statut=s, note=note))
    print(f"{sid:8} {s:10} {observed[:120]}")
def claims(cur, sub, anonymous=False, email=None):
    c = {"role": "authenticated", "sub": sub, "aud": "authenticated", "is_anonymous": anonymous}
    if email: c["email"] = email
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(c),)); cur.execute("set local role authenticated")
def call(sub, sql, params=(), anonymous=False, email=None):
    with conn() as c:
        try:
            with c.cursor() as cur:
                claims(cur, sub, anonymous, email); cur.execute(sql, params)
                v = cur.fetchone() if cur.description else None
            c.commit(); return True, v
        except psycopg.Error as e:
            c.rollback(); return False, f"{st(e)} {str(e).splitlines()[0]}"
def q(sql, params=()):
    with conn(autocommit=True) as c:
        r = c.execute(sql, params); return r.fetchall() if r.description else None
def user(email, confirmed=True):
    u = str(uuid.uuid4())
    q("insert into auth.users(id,aud,role,email,email_confirmed_at) values (%s,'authenticated','authenticated',%s,%s)", (u, email, datetime.datetime.now(datetime.timezone.utc) if confirmed else None))
    return u
def duo(owner, with_env=True):
    h = str(uuid.uuid4())
    q("insert into public.duo_v3_households(id) values (%s)", (h,))
    q("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'owner')", (h, owner))
    q("select duo_v3_private.bootstrap_household(%s)", (h,))
    env = None
    if with_env:
        env = str(q("select duo_v3_private.create_envelope(%s,'Courses',true)", (h,))[0][0])
        q("select duo_v3_private.set_allocation(%s,50000,(select starts_on from public.duo_v3_periods where household_id=%s and state='open'))", (env, h))
        q("select duo_v3_private.post_period_allocations(%s,(select id from public.duo_v3_periods where household_id=%s and state='open'))", (h, h))
    return h, env
def invite(owner, h, channel="link", email=None):
    ok, v = call(owner, "select invitation_id::text, token from public.duo_v3_create_invitation(%s,%s,%s)", (h, channel, email))
    assert ok, v; return v
def active(h): return q("select count(*) from public.duo_v3_members where household_id=%s and status='active'", (h,))[0][0]
def accept(u, tok, email=None): return call(u, "select public.duo_v3_accept_invitation(%s)::text", (tok,), email=email)
def race(n, fns):
    out = [None] * n; bar = threading.Barrier(n)
    def w(i):
        sub, sql, params = fns(i)
        with conn() as c:
            try:
                with c.cursor() as cur:
                    claims(cur, sub); bar.wait(); cur.execute(sql, params)
                c.commit(); out[i] = "ok"
            except psycopg.Error as e:
                c.rollback(); out[i] = st(e)
    ts = [threading.Thread(target=w, args=(i,)) for i in range(n)]; [t.start() for t in ts]; [t.join() for t in ts]; return out

def main():
    with admin() as c:
        c.execute(f'drop database if exists "{DB}" with (force)'); c.execute(f'create database "{DB}" template "{TEMPLATE}" owner postgres')
    a, b = user("p1@example.invalid"), user("p2@example.invalid"); h, env = duo(a)
    inv, tok = invite(a, h)
    ok, v = accept(b, tok)
    record("L3-01", "D-002 lien : acceptation authentifiée", "B accepte", "B actif, 2 actifs", f"ok={ok} actifs={active(h)}", ok and active(h) == 2)
    stored = q("select encode(token_sha256,'hex') from public.duo_v3_invitations where id=%s", (inv,))[0][0]
    record("L3-02", "CF-08 : jeton haché", "comparer", "sha256 seul", f"{stored[:12]}…", tok not in stored and len(stored) == 64)
    ok, v = accept(user("x1@example.invalid"), tok)
    record("L3-03", "CF-08 : usage unique", "réutilisation", "P0002", str(v), (not ok) and v.startswith("P0002"))
    ok, v = call(a, "select * from public.duo_v3_create_invitation(%s,'link',null)", (h,))
    record("L3-04", "D-001 : pas d'invitation pour un duo complet", "créer", "23514", str(v), (not ok) and v.startswith("23514"))
    try:
        q("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,'partner')", (h, user("x2@example.invalid"))); ok, v = True, "inséré"
    except psycopg.Error as e: ok, v = False, f"{st(e)} {e}"
    record("L3-05", "D-001 garanti en base", "INSERT direct d'un 3e membre", "23514", str(v)[:120], (not ok) and v.startswith("23514"), note="Corrige M01.")
    # course au dernier siège
    o = user("r0@example.invalid"); h2, _ = duo(o, False); _, tok2 = invite(o, h2); racers = [user(f"r{i}@example.invalid") for i in range(1, 7)]
    out = race(6, lambda i: (racers[i], "select public.duo_v3_accept_invitation(%s)", (tok2,)))
    record("L3-06", "D-001 sous concurrence", "6 acceptations simultanées du même lien", "1 succès, 2 actifs", f"{out} actifs={active(h2)}", out.count("ok") == 1 and active(h2) == 2)
    # expiration
    o = user("e0@example.invalid"); h3, _ = duo(o, False); inv3, tok3 = invite(o, h3)
    q("update public.duo_v3_invitations set created_at=now()-interval '3 days', expires_at=now()-interval '1 day' where id=%s", (inv3,))
    ok, v = accept(user("e1@example.invalid"), tok3)
    record("L3-07", "CF-08 : 48 h", "acceptation après échéance", "null, statut expired", f"{v} {q('select status from public.duo_v3_invitations where id=%s',(inv3,))[0][0]}", ok and v == (None,))
    o = user("v0@example.invalid"); h4, _ = duo(o, False); _, old = invite(o, h4); _, new = invite(o, h4)
    ok, v = accept(user("v1@example.invalid"), old)
    pend = q("select count(*) from public.duo_v3_invitations where household_id=%s and status='pending'", (h4,))[0][0]
    record("L3-08", "CF-08 : renvoi = nouveau lien + révocation de l'ancien ; une invitation par siège", "accepter l'ancien", "P0002 ; 1 invitation en attente", f"{v} en_attente={pend}", (not ok) and v.startswith("P0002") and pend == 1)
    # nominative : e-mail confirmé côté serveur
    o = user("m0@example.invalid"); h5, _ = duo(o, False); _, tok5 = invite(o, h5, "email", "Partner@Example.invalid ")
    spoof = user("intrus@example.invalid"); unconf = user("partner@example.invalid", confirmed=False)
    ok1, v1 = accept(spoof, tok5, email="partner@example.invalid")      # claim JWT falsifié
    ok2, v2 = accept(unconf, tok5)
    record("L3-09", "CF-08 : destinataire vérifié par l'e-mail CONFIRMÉ en base, pas par le JWT", "intrus avec claim email falsifié ; destinataire non confirmé",
           "P0002 et P0002", f"intrus={v1} ; non confirmé={v2}", (not ok1) and v1.startswith("P0002") and (not ok2) and v2.startswith("P0002"))
    ok3, _ = call(spoof, "select public.duo_v3_decline_invitation(%s)", (tok5,))
    still = q("select status from public.duo_v3_invitations where household_id=%s", (h5,))[0][0]
    record("L3-10", "Refus nominatif : destinataire vérifié aussi au refus", "l'intrus refuse", "aucun effet, réponse identique", f"réponse_ok={ok3} statut={still}", ok3 and still == "pending")
    q("update auth.users set email_confirmed_at=now() where id=%s", (unconf,))
    ok4, v4 = accept(unconf, tok5)
    record("L3-11", "Destinataire confirmé accepté", "après confirmation", "accepté", f"ok={ok4}", ok4 and active(h5) == 2)
    okx, _ = call(spoof, "select public.duo_v3_decline_invitation(%s)", ("jeton-inexistant-0123456789",))
    record("L3-12", "Refus d'un jeton inconnu : même réponse", "decline inconnu", "succès silencieux", f"ok={okx}", okx)
    an = user("n1@example.invalid"); o = user("n0@example.invalid"); h6, _ = duo(o, False); _, tok6 = invite(o, h6)
    ok, v = call(an, "select public.duo_v3_accept_invitation(%s)", (tok6,), anonymous=True)
    record("L3-13", "Session anonyme refusée", "accepter", "42501", str(v), (not ok) and v.startswith("42501"))
    # CF-05
    ok, v = accept(a, tok6)
    record("L3-14", "CF-05 : un seul duo actif par compte", "A (actif dans un duo) accepte une invitation d'un autre duo", "23505 ALREADY_IN_ANOTHER_DUO", str(v), (not ok) and v.startswith("23505"))
    u = user("double@example.invalid"); ox, oy = user("ox@example.invalid"), user("oy@example.invalid"); hx, _ = duo(ox, False); hy, _ = duo(oy, False)
    _, tx = invite(ox, hx); _, ty = invite(oy, hy)
    out = race(2, lambda i: (u, "select public.duo_v3_accept_invitation(%s)", ((tx, ty)[i],)))
    n_act = q("select count(*) from public.duo_v3_members where user_id=%s and status='active'", (u,))[0][0]
    record("L3-15", "CF-05 sous concurrence (deux duos distincts)", "acceptations simultanées dans X et Y", "1 succès, 1 refus 23505", f"{out} duos_actifs={n_act}", sorted(out) == ["23505", "ok"] and n_act == 1)
    # révocation et acceptation concurrentes
    bad = 0; outcomes = {}
    for i in range(15):
        oo = user(f"rv{i}@example.invalid"); hh, _ = duo(oo, False); ii, tt = invite(oo, hh); cand = user(f"rc{i}@example.invalid")
        out = race(2, lambda k: ((cand, "select public.duo_v3_accept_invitation(%s)", (tt,)), (oo, "select public.duo_v3_revoke_invitation(%s)", (ii,)))[k])
        status = q("select status from public.duo_v3_invitations where id=%s", (ii,))[0][0]; mem = active(hh)
        outcomes[(tuple(out), status, mem)] = outcomes.get((tuple(out), status, mem), 0) + 1
        if not ((status == "accepted" and mem == 2) or (status == "revoked" and mem == 1)): bad += 1
    record("L3-16", "Révocation et acceptation simultanées", "15 courses", "accepté+2 membres ou révoqué+1 membre, jamais d'état mixte", f"incohérences={bad} issues={ {str(k): v for k, v in outcomes.items()} }", bad == 0)
    bad = 0; seen = {}
    for i in range(15):
        oo = user(f"lv{i}@example.invalid"); hh, _ = duo(oo, False); ii, tt = invite(oo, hh); cand = user(f"lc{i}@example.invalid")
        out = race(2, lambda k: ((cand, "select public.duo_v3_accept_invitation(%s)", (tt,)), (oo, "select public.duo_v3_leave_household(%s)", (hh,)))[k])
        status = q("select status from public.duo_v3_invitations where id=%s", (ii,))[0][0]
        cs = q("select status from public.duo_v3_members where household_id=%s and user_id=%s", (hh, cand)); cs = cs[0][0] if cs else None
        seen[(tuple(out), status, cs)] = seen.get((tuple(out), status, cs), 0) + 1
        if not ((status == "accepted" and cs == "active") or (status == "revoked" and cs is None)): bad += 1
    record("L3-17", "Départ du propriétaire et acceptation simultanés", "15 courses", "état final cohérent", f"incohérences={bad} issues={ {str(k): v for k, v in seen.items()} }", bad == 0,
           note="Si le départ passe d'abord, l'invitation est révoquée et l'acceptation refusée.")
    # départ, historique, retour (CF-07)
    ok, _ = call(b, "select public.duo_v3_post_expense(%s,%s,1000,current_date,'b-before')", (h, env))
    t_before = q("select id from public.duo_v3_transactions where idempotency_key='b-before'")[0][0]
    ok, _ = call(b, "select public.duo_v3_leave_household(%s)", (h,))
    okr, nr = call(b, "select count(*) from public.duo_v3_transactions")
    okw, vw = call(b, "select public.duo_v3_post_expense(%s,%s,100,current_date,'b-after-leave')", (h, env))
    hist = q("select count(*) from public.duo_v3_transactions where created_by=%s", (b,))[0][0]
    record("L3-18", "Départ : accès révoqué, historique conservé", "B quitte", "B lit 0 ; RPC 42501 ; historique 1", f"lus={nr} rpc={vw} historique={hist}", okr and nr == (0,) and (not okw) and vw.startswith("42501") and hist == 1)
    okrp, vrp = call(b, "select public.duo_v3_post_expense(%s,%s,1000,current_date,'b-before')", (h, env))
    record("L3-18b", "CF-06 : aucun rejeu ne contourne la révocation", "B (parti) rejoue sa propre clé déjà utilisée, même charge", "42501",
           str(vrp), (not okrp) and str(vrp).startswith("42501"))
    time.sleep(0.05)
    ok, _ = call(a, "select public.duo_v3_post_expense(%s,%s,2000,current_date,'a-during-absence')", (h, env))
    time.sleep(0.05)
    _, tokb = invite(a, h); ok, v = accept(b, tokb)
    okv, seen_ids = call(b, "select array_agg(idempotency_key order by idempotency_key) from public.duo_v3_transactions")
    record("L3-19", "CF-07 : retour par nouvelle invitation", "B accepte", "B actif (partner)", f"ok={ok} actifs={active(h)} rôle={q('select role from public.duo_v3_members where household_id=%s and user_id=%s',(h,b))[0][0]}", ok and active(h) == 2)
    keys = seen_ids[0] or []
    record("L3-20", "CF-07 : pas d'accès automatique aux opérations produites pendant l'absence", "B relit le journal", "voit « b-before », pas « a-during-absence »",
           f"clés visibles={keys}", "b-before" in keys and "a-during-absence" not in keys)
    _, bal_b = call(b, "select balance_minor from public.duo_v3_envelope_balances where envelope_id=%s", (env,))
    _, bal_a = call(a, "select balance_minor from public.duo_v3_envelope_balances where envelope_id=%s", (env,))
    record("L3-21", "CF-07 : agrégats (vue des soldes) pour un membre revenu", "A et B lisent le solde de Courses", "politique à préciser (CF-07)",
           f"A={bal_a} B={bal_b}", True, status="Décision requise",
           note="Avec un filtrage des lignes, B voit un solde différent de A (les opérations de l'absence sont exclues du calcul) ; sans filtrage, l'agrégat révèle indirectement l'absence. CF-07 laisse ce point à préciser.")
    # CF-09 suppression de compte
    before = q("select count(*), coalesce(sum(amount_minor),0) from public.duo_v3_entries")[0]
    q("select duo_v3_private.prepare_account_deletion(%s)", (b,))
    try:
        q("delete from auth.users where id=%s", (b,)); okd, vd = True, "supprimé"
    except psycopg.Error as e: okd, vd = False, f"{st(e)} {e}"
    after = q("select count(*), coalesce(sum(amount_minor),0) from public.duo_v3_entries")[0]
    mem = q("select status from public.duo_v3_members where household_id=%s and user_id=%s", (h, b))[0][0]
    unb = q("select count(*) from (select e.transaction_id, a.book from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id group by 1,2 having sum(e.amount_minor)<>0) s")[0][0]
    record("L3-22", "CF-09 : suppression du compte Auth sans altérer le grand livre", "préparation puis DELETE auth.users", "suppression OK ; lignes et sommes identiques ; membre « left »",
           f"suppression={vd} avant={before} après={after} membre={mem} déséquilibres={unb}", okd and before == after and mem == "left" and unb == 0)
    _, tokn = invite(a, h); nn = user("nouveau@example.invalid"); okn, _ = accept(nn, tokn)
    record("L3-23", "CF-09 : la place libérée est réutilisable", "nouvelle invitation acceptée", "accepté", f"ok={okn} actifs={active(h)}", okn and active(h) == 2)
    o = user("orph@example.invalid"); ho, _ = duo(o, False); _, to_ = invite(o, ho); pp = user("orphp@example.invalid"); accept(pp, to_)
    try:
        q("delete from auth.users where id=%s", (pp,)); okd2 = True
    except psycopg.Error: okd2 = False
    record("L3-24", "Suppression Auth directe sans préparation", "DELETE auth.users d'un membre actif", "refus souhaité", f"suppression={okd2} actifs_restants={active(ho)}",
           not okd2, status="Constat" if okd2 else None,
           note="Sans clé étrangère, une suppression qui contourne la procédure laisse une place active orpheline. Garde-fou : passer exclusivement par la fonction serveur, contrôle périodique des orphelins.")
    okc, vc = call(a, "select token_sha256 from public.duo_v3_invitations limit 1")
    record("L3-25", "Condensat illisible", "SELECT token_sha256", "42501", str(vc), (not okc) and str(vc).startswith("42501"))
    okn2, vn2 = call(user("tiers@example.invalid"), "select * from public.duo_v3_create_invitation(%s,'link',null)", (h,))
    record("L3-26", "Non-membre ne peut pas inviter", "create_invitation", "42501", str(vn2), (not okn2) and str(vn2).startswith("42501"))
    # interaction avec les périodes : un duo dont un membre est parti continue de clôturer
    o = user("per0@example.invalid"); hp, envp = duo(o); _, tp = invite(o, hp); pq = user("per1@example.invalid"); accept(pq, tp); call(pq, "select public.duo_v3_leave_household(%s)", (hp,))
    ends = q("select ends_at from public.duo_v3_periods where household_id=%s and state='open'", (hp,))[0][0]
    try:
        q("select duo_v3_private.close_period(%s,(select id from public.duo_v3_periods where household_id=%s and state='open'),%s)", (hp, hp, ends)); okp = True
    except psycopg.Error as e: okp = f"{st(e)} {e}"
    record("L3-27", "Clôture d'un duo après départ d'un membre", "close_period", "clôture et nouvelle période", f"ok={okp} périodes={q('select count(*) from public.duo_v3_periods where household_id=%s',(hp,))[0][0]}", okp is True)
    summary = {}
    for r in RESULTS: summary[r["statut"]] = summary.get(r["statut"], 0) + 1
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"), exist_ok=True)
    json.dump(dict(label=LABEL, template=TEMPLATE, horodatage=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), bilan=summary, resultats=RESULTS),
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", f"{LABEL}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))
if __name__ == "__main__":
    main()
