#!/usr/bin/env python3
"""Reproduction / correction — REV-01 (lectures fonds réels) et REV-06 (lift_pending), 26/11/2026.

Usage : python3 rev_corrections_funds.py <gabarit publié s3> <gabarit corrigé c3> <label>
  s3 = 001→005 + 006r1 + lot 3 + M2 tels que publiés (df41563) ; c3 = mêmes migrations corrigées (ce commit).
Le banc réutilise les aides de test_funds_final.py (mêmes comptes fictifs, mêmes duos). Réplique jetable uniquement."""
import json, sys, pathlib
PUB, COR, LABEL = sys.argv[1], sys.argv[2], sys.argv[3]
sys.argv = [sys.argv[0], PUB, LABEL]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import test_funds_final as T

def raw(sub, fn, h):
    ok, v = T.call(sub, f"select public.{fn}(%s)::text", (h,)); assert ok, v; return v
def numbers_in(txt):
    found = []; json.loads(txt, parse_int=lambda s: found.append(s) or int(s), parse_float=lambda s: found.append(s) or float(s)); return found

def scenario(tpl):
    T.TEMPLATE = tpl; T.fresh()
    h, ids = T.duo([("Vacances", T.E(300), True), ("Courses", T.E(100), True)]); T.contrib(T.UA, h, T.E(400)); T.move(T.UA, h, None, ids["Vacances"], T.E(150))
    T.protect(T.UB, h, ids["Vacances"], True)
    s0 = T.env_of(T.snap(T.UA, h), ids["Vacances"])["protectionState"]
    req = T.protect(T.UA, h, ids["Vacances"], False)                 # demande de levée (A) : en attente de B
    s1a = T.env_of(T.snap(T.UA, h), ids["Vacances"])["protectionState"]; s1b = T.env_of(T.snap(T.UB, h), ids["Vacances"])["protectionState"]
    blocked = T.move(T.UA, h, ids["Vacances"], ids["Courses"], T.E(10))
    nums_f = numbers_in(raw(T.UA, "duo_v3_get_funds_snapshot", h)); nums_e = numbers_in(raw(T.UA, "duo_v3_get_envelope_snapshot", h))
    T.protect(T.UB, h, ids["Vacances"], False)                       # approbation (B)
    s2 = T.env_of(T.snap(T.UA, h), ids["Vacances"])["protectionState"]
    return dict(s0=s0, req=req, s1a=s1a, s1b=s1b, blocked=blocked, s2=s2, nums_f=nums_f, nums_e=nums_e)

r = scenario(PUB)
T.record("REV06-R", "REV-06", "Reproduction : levée demandée, la lecture publiée n'expose pas lift_pending", "B protège ; A demande la levée",
         "demande lift_pending mais protectionState = protected (état en attente invisible)", f"demande={r['req'][1]} lecture A={r['s1a']} B={r['s1b']}",
         r["req"] == (True, "lift_pending") and r["s1a"] == "protected" and r["s1b"] == "protected")
T.record("REV01-F-R", "REV-01", "Reproduction : nombres JSON dans les lectures publiées (fonds et enveloppes)", "lecture brute (texte JSON)",
         "au moins un nombre JSON (ledgerVersion, position)", f"fonds={r['nums_f']} enveloppes={r['nums_e'][:6]}", len(r["nums_f"]) > 0 and len(r["nums_e"]) > 0)
c = scenario(COR)
T.record("REV06-C", "REV-06", "Correction : protected → lift_pending (pour les deux membres, mouvement toujours refusé) → none après approbation",
         "B protège ; A demande ; A tente un transfert ; B approuve", "protected ; lift_pending ×2 ; 23514 ; none",
         f"{c['s0']} ; A={c['s1a']} B={c['s1b']} ; transfert={c['blocked'][1][:5] if not c['blocked'][0] else 'accepté'} ; après={c['s2']}",
         c["s0"] == "protected" and c["s1a"] == c["s1b"] == "lift_pending" and not c["blocked"][0] and str(c["blocked"][1]).startswith("23514") and c["s2"] == "none")
T.record("REV01-F-C", "REV-01", "Correction : aucun nombre JSON dans les lectures fonds et enveloppes (montants, compteurs en chaînes)", "lecture brute",
         "0 nombre JSON", f"fonds={c['nums_f']} enveloppes={c['nums_e']}", c["nums_f"] == [] and c["nums_e"] == [])

with T.admin() as a: a.execute(f'drop database if exists "{T.DB}" with (force)')
summ = {}
for x in T.RESULTS: summ[x["statut"]] = summ.get(x["statut"], 0) + 1
(pathlib.Path(__file__).resolve().parent / "results" / f"{LABEL}.json").write_text(json.dumps(dict(label=LABEL, publie=PUB, corrige=COR, resume=summ, resultats=T.RESULTS), indent=1, ensure_ascii=False, default=str))
print(json.dumps(summ, ensure_ascii=False))
