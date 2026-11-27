#!/usr/bin/env python3
"""Construit le rapport Markdown du lot 1 à partir des spécifications et de la sortie brute DEV."""
import json, hashlib, pathlib, sys
here = pathlib.Path(__file__).parent
specs = {s['id']: s for s in json.load(open(here / 'lot1_specs.json'))}
rawp = here / 'results' / sys.argv[1]
raw = json.load(open(rawp))
res = raw['lot1']['resultats']
sha_sql = hashlib.sha256((here / 'lot1_dev_integration.sql').read_bytes()).hexdigest()
sha_raw = hashlib.sha256(rawp.read_bytes()).hexdigest()
rows, ok, ko, info = [], 0, 0, 0
for r in res:
    s = specs[r['id']]
    exp = s['expect']
    passed = (r['obtenu'] == 'OK' if exp == 'ok' else r['obtenu'] in exp.split('|')) and r['controle']
    verdict = ('✅ Réussi' if passed else ('⚠️ Constat' if s['info'] else '❌ Échoué'))
    if s['info'] and not passed: info += 1
    elif passed: ok += 1
    else: ko += 1
    who = r['role'] + (f" · {r['sub'][:8]}…" if r['sub'] else '')
    rows.append(f"| {r['id']} | {s['mat']} | {s['titre']} | {who} | {exp.replace('|', ' ou ')} | {r['obtenu']} | {r['ms']} | {verdict} |")
L = [f"# Lot 1 backend — exécution sur Supabase DEV ({raw['lot1']['horodatage_serveur'][:19].replace('T', ' ')} UTC)", '',
     f"- **Environnement** : projet `eetnzdvjfzexgvqbtyrj` (Duo Budget V3 — DEV), PostgreSQL {raw['lot1']['pg']}, migrations 20261120_001 à 004.",
     '- **Méthode** : script SQL unique exécuté par le connecteur Supabase, dans une transaction terminée par `ROLLBACK` (aucune donnée conservée). '
     'Les rôles `authenticated` et `anon` sont réellement endossés (`SET ROLE`), le JWT est simulé par `request.jwt.claims` comme le fait PostgREST.',
     '- **Limite** : ce n’est pas un test HTTP de bout en bout. La concurrence réelle (plusieurs connexions) et les vrais jetons Auth restent à exécuter avec `scripts/v3-finance-e2e-dev.cjs`.',
     f"- **Empreintes** : script `{sha_sql[:16]}…`, sortie brute `{sha_raw[:16]}…` (SHA-256).", '',
     f"**Bilan : {ok} réussis, {ko} échoués, {info} constats** sur {len(res)} vérifications.", '',
     '| ID | Matrice | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |', '|---|---|---|---|---|---|---|---|'] + rows
(here / 'results' / rawp.name.replace('_raw.json', '_rapport.md')).write_text('\n'.join(L) + '\n')
print(ok, ko, info, len(res))
