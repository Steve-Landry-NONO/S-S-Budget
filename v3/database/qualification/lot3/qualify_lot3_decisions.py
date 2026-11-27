#!/usr/bin/env python3
"""Lot 3 candidat — tests des décisions R-A3 (frontières), R-C1 à R-C5 (registre PR #20).
Les suites v2 (L3-*) et v3 (C3-*) sont rejouées séparément, sans modification de leurs attentes.
Usage : python3 qualify_lot3_decisions.py <gabarit s2|s3> <label>"""
import json, sys, uuid, threading, time, pathlib
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2]]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import qualify_lot3_v2 as B
import psycopg
B.DB = f"l3d_{sys.argv[2]}"
call, q, user, duo, invite, accept, active, st = B.call, B.q, B.user, B.duo, B.invite, B.accept, B.active, B.st
RESULTS = []
def record(sid, rule, action, expected, observed, ok, note=""):
    s = "Réussi" if ok else "Échoué"
    RESULTS.append(dict(id=sid, regle=rule, action=action, attendu=expected, observe=observed, statut=s, note=note)); print(f"{sid:8} {s:8} {observed[:130]}", flush=True)
def pair():
    a, b = user(f"{uuid.uuid4().hex[:8]}@example.invalid"), user(f"{uuid.uuid4().hex[:8]}@example.invalid")
    h, env = duo(a); _, tok = invite(a, h); ok, v = accept(b, tok); assert ok, v
    return a, b, h, env

def main():
    with B.admin() as c:
        c.execute(f'drop database if exists "{B.DB}" with (force)'); c.execute(f'create database "{B.DB}" template "{B.TEMPLATE}" owner postgres')
    # ---------------- R-A3 : frontière d'épisode sous verrou
    a, b, h, env = pair()
    ready = threading.Event(); res = {}
    def a_writer():
        with B.conn() as c:
            with c.cursor() as cur:
                B.claims(cur, a); cur.execute("select now()"); ready.set(); time.sleep(0.5)      # transaction commencée AVANT le départ
                try: cur.execute("select public.duo_v3_post_expense(%s,%s,700,current_date,'a-straddle')", (h, env)); c.commit(); res["a"] = "ok"
                except psycopg.Error as e: c.rollback(); res["a"] = st(e)
    t = threading.Thread(target=a_writer); t.start(); ready.wait(); time.sleep(0.1)
    call(b, "select public.duo_v3_leave_household(%s)", (h,)); t.join()
    time.sleep(0.05); _, tk = invite(a, h); accept(b, tk)
    seen = call(b, "select array_agg(idempotency_key) from public.duo_v3_transactions where household_id=%s", (h,))[1][0] or []
    row = q("select created_at, posted_at from public.duo_v3_transactions where idempotency_key='a-straddle'")[0]
    left = q("select left_at from public.duo_v3_member_episodes where household_id=%s and user_id=%s and left_at is not null", (h, b))[0][0]
    record("RD-01", "R-A3 : écriture commencée avant un départ mais inscrite après → appartient à l'absence (invisible au retour)",
           "A ouvre sa transaction, B part, A inscrit sa dépense, B revient", "dépense acceptée ; created_at < left_at < posted_at ; invisible pour B",
           f"A={res.get('a')} created<left={row[0] < left} left<posted={left < row[1]} visible_B={'a-straddle' in seen}",
           res.get("a") == "ok" and row[0] < left < row[1] and "a-straddle" not in seen,
           note="Avant R-A3, la frontière comparait created_at (début de transaction) : l'opération aurait été visible.")
    # ---------------- R-C1 : avis de retour aux deux partenaires
    na = call(a, "select public.duo_v3_list_membership_notices(%s)", (h,))[1][0]; nb = call(b, "select public.duo_v3_list_membership_notices(%s)", (h,))[1][0]
    t3 = user("tiers@example.invalid"); nt = call(t3, "select public.duo_v3_list_membership_notices(%s)", (h,))[1][0]
    record("RD-02", "R-C1 : les deux partenaires sont informés (soldes communs visibles, opérations intermédiaires non visibles)",
           "A et B lisent les avis après le retour ; un tiers aussi", "1 avis RETURN_VISIBILITY_NOTICE chacun (partner / returning_member) ; tiers : []",
           f"A={[(n['code'], n['audience']) for n in na]} B={[(n['code'], n['audience']) for n in nb]} tiers={nt}",
           [n["audience"] for n in na] == ["partner"] and [n["audience"] for n in nb] == ["returning_member"] and nt == []
           and all(n["facts"] == ["current_common_balances_visible", "absence_operations_not_visible"] for n in na + nb))
    # ---------------- R-C2 : aucune autorisation pour un compte supprimé, avant toute réconciliation
    a, b, h, env = pair()
    with psycopg.connect(host=B.HOST, port=B.PORT, user="supabase_admin", dbname=B.DB, autocommit=True) as c:
        c.execute("set session_replication_role = replica"); c.execute("delete from auth.users where id=%s", (b,))
    still = q("select status from public.duo_v3_members where household_id=%s and user_id=%s", (h, b))[0][0]
    w = call(b, "select public.duo_v3_post_expense(%s,%s,100,current_date,'ghost')", (h, env)); r = call(b, "select count(*) from public.duo_v3_transactions")
    s_ = call(b, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]
    record("RD-03", "R-C2 : compte supprimé hors déclencheurs — appartenance encore « active » en base, mais aucune autorisation effective",
           "suppression replica ; B (jeton encore valide) écrit et lit", "statut active (non réconcilié) ; écriture 42501 ; 0 ligne ; instantané vide",
           f"statut={still} écriture={w[1][:5] if not w[0] else 'ACCEPTÉE'} lignes={r[1][0] if r[0] else r[1]} enveloppes={s_['envelopes']}",
           still == "active" and (not w[0]) and str(w[1]).startswith("42501") and r[1][0] == 0 and s_["envelopes"] == [])
    script = (pathlib.Path(__file__).resolve().parents[4] / "supabase/scheduled/reconcile_orphans_hourly.sql").read_text()
    record("RD-04", "R-C2 : réconciliation horaire fournie hors migration (opt-in, pg_cron gratuit), sans effet tant qu'elle n'est pas planifiée",
           "inspection du script", "appelle reconcile_orphan_memberships ; cron horaire ; hors supabase/migrations",
           f"contient_appel={'reconcile_orphan_memberships' in script} cron_horaire={'0 * * * *' in script}", "reconcile_orphan_memberships" in script and "0 * * * *" in script)
    # ---------------- R-C3 : archivage, droits archivés
    a, b, h, env = pair()
    call(a, "select public.duo_v3_leave_household(%s)", (h,)); call(b, "select public.duo_v3_leave_household(%s)", (h,))
    ra = call(a, "select count(*) from public.duo_v3_households where id=%s", (h,))[1][0]
    re_ = call(a, "select public.duo_v3_get_envelope_snapshot(%s)", (h,))[1][0]
    ex_cli = call(a, "select duo_v3_private.export_archived_household(%s)", (h,))
    ex = q("select duo_v3_private.export_archived_household(%s)", (h,))[0][0]
    record("RD-05", "R-C3 : duo archivé — aucun accès applicatif des anciens membres ; export réservé aux rôles serveur ; pas de réouverture",
           "A lit ; A appelle l'export ; export par postgres", "0 ; instantané vide ; 42501 ; export complet (2 membres, évènements, somme de contrôle)",
           f"lecture={ra} enveloppes={re_['envelopes']} export_client={ex_cli[1][:5] if not ex_cli[0] else 'OK'} export_membres={len(ex['members'])} évènements={len(ex['events'])}",
           ra == 0 and re_["envelopes"] == [] and (not ex_cli[0]) and str(ex_cli[1]).startswith("42501") and len(ex["members"]) == 2 and ex["ledgerChecksum"])
    # ---------------- R-C4 : aucune mutation inter-périmètres
    a, b, h, env = pair()
    ok, hp = call(a, "select public.duo_v3_create_personal_space('EUR')::text"); hp = hp[0]
    penv = str(q("select duo_v3_private.create_envelope(%s,'Perso',true)", (hp,))[0][0])
    x1 = call(a, "select public.duo_v3_post_expense(%s,%s,100,current_date,'cross1')", (h, penv))
    accs = [str(r[0]) for r in q("select duo_v3_private.account_of(%s,'reserve') union all select account_id from public.duo_v3_envelopes where id=%s", (h, penv))]
    x2 = call(a, "select public.duo_v3_post_transfer(%s,%s,%s,100,'EUR','cross2')", (h, accs[0], accs[1]))
    record("RD-06", "R-C4 : aucune mutation entre l'espace commun et l'espace personnel (dépense commune sur enveloppe personnelle, transfert réserve commune → enveloppe personnelle)",
           "2 tentatives par le titulaire des deux espaces", "23503 ; 23503", f"{str(x1[1])[:5]} ; {str(x2[1])[:5]}",
           (not x1[0]) and str(x1[1]).startswith("23503") and (not x2[0]) and str(x2[1]).startswith("23503"))
    # ---------------- R-C5 : audit de can_read_at, X18b
    a, b, h, env = pair(); t3 = user("t3@example.invalid")
    sig = q("""select p.prosecdef, p.provolatile, p.proconfig, pg_get_function_identity_arguments(p.oid),
                      has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')
               from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='duo_v3_private' and p.proname='can_read_at'""")[0]
    record("RD-07", "R-C5 : can_read_at — SECURITY DEFINER, STABLE, search_path vide, paramètres (duo, instant), anon exclu",
           "catalogue", "secdef ; s ; search_path=\"\" ; anon non ; authenticated oui (nécessaire à la RLS)", f"{sig}",
           sig[0] is True and sig[1] == "s" and sig[2] == ['search_path=""'] and sig[3] == "p_household uuid, p_at timestamp with time zone" and sig[4] is False and sig[5] is True)
    probes = {}
    for label, hh in (("duo existant", h), ("duo inexistant", str(uuid.uuid4()))):
        for at in ("-infinity", "now()", "infinity"):
            probes[(label, at)] = call(t3, f"select duo_v3_private.can_read_at(%s, {at if at == 'now()' else repr(at) + '::timestamptz'})", (hh,))[1][0]
    record("RD-08", "R-C5 : aucun oracle pour un non-membre — même réponse (false) pour un duo existant ou inexistant, à tout instant",
           "tiers interroge can_read_at sur 2 duos × 3 instants", "6 × false", f"{sorted(set(probes.values()))}", set(probes.values()) == {False})
    own = [call(b, "select duo_v3_private.can_read_at(%s, %s)", (h, x))[1][0] for x in ("2000-01-01", "2100-01-01")]
    oth = q("select count(*) from public.duo_v3_member_episodes where household_id=%s and user_id=%s", (h, a))[0][0]
    record("RD-09", "R-C5 : pour un membre, la réponse ne dépend que de SES épisodes (aucune information sur l'autre membre)",
           "B interroge deux instants ; épisodes de A inchangés", "réponses déterminées par l'épisode de B uniquement",
           f"B(2000)={own[0]} B(2100)={own[1]} épisodes_A={oth}", own == [True, True] and oth == 1,
           note="2000 : antérieur à toute arrivée de B = histoire commune (CF-07) ; 2100 : épisode ouvert.")
    x18b = q("""select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='duo_v3_private'
               and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))""")[0][0]
    record("X18b", "R-C5 : fonctions privées exécutables — liste fermée {is_current_member, can_read_at} ; is_member reste retirée (005, constat R19) ; X18 historique conservé tel quel",
           "catalogue", "exactement 2 fonctions, aucune pour anon", f"{x18b}", sorted(x18b) == ["can_read_at", "is_current_member"])
    summary = {}
    for r in RESULTS: summary[r["statut"]] = summary.get(r["statut"], 0) + 1
    with B.admin() as c: c.execute(f'drop database if exists "{B.DB}" with (force)')
    p = pathlib.Path(__file__).resolve().parent / "results" / f"{sys.argv[2]}.json"
    p.write_text(json.dumps(dict(label=sys.argv[2], template=B.TEMPLATE, bilan=summary, resultats=RESULTS), indent=1, ensure_ascii=False, default=str)); print(json.dumps(summary, ensure_ascii=False))
if __name__ == "__main__":
    main()
