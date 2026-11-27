#!/usr/bin/env python3
"""Évalue une sortie brute du lot 2 contre lot2_specs.json ; écrit éventuellement le rapport Markdown."""
import json, sys, pathlib, hashlib
here = pathlib.Path(__file__).parent
specs = {s['id']: s for s in json.load(open(here / 'lot2_specs.json'))}
raw = json.loads(open(sys.argv[1]).read())
res = raw['lot2']['resultats'] if 'lot2' in raw else raw['resultats']
n = {'ok': 0, 'ko': 0, 'info': 0}; rows = []
for r in res:
    s = specs[r['id']]; exp = s['expect']
    passed = (r['obtenu'] == 'OK' if exp == 'ok' else r['obtenu'] in exp.split('|')) and r['controle'] and (not s.get('msg') or s['msg'] in r['message'])
    k = 'ok' if passed else ('info' if s['info'] else 'ko'); n[k] += 1
    if k != 'ok': print('NON RÉUSSI', r['id'], s['titre'][:70], '| attendu', exp, '| obtenu', r['obtenu'], r['controle'], r['message'][:150])
    rows.append((r, s, k))
print(n, len(res))
if len(sys.argv) > 2:
    L = [l.replace('{N}', str(len(res))) for l in sys.argv[3:]] if len(sys.argv) > 3 else []
    out = [f"# Lot 2 — recette de la migration 006 ({sys.argv[2]})", '',
           f"**Bilan : {n['ok']} réussis, {n['ko']} échoués, {n['info']} constats** sur {len(res)} vérifications.", '',
           '| ID | Matrice | Décision | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |', '|---|---|---|---|---|---|---|---|---|']
    for r, s, k in rows:
        v = {'ok': '✅ Réussi', 'ko': '❌ Échoué', 'info': '⚠️ Constat'}[k]
        out.append(f"| {r['id']} | {s['mat']} | {s['dec']} | {s['titre']} | {r['role']} | {s['expect'].replace('|',' ou ')} | {r['obtenu']} | {r['ms']} | {v} |")
    (here / 'results' / 'lot2_rapport_table.md').write_text('\n'.join(out) + '\n')
