#!/usr/bin/env python3
"""Rapport de la recette lot 1 après migration 005 (passes A et B)."""
import json, hashlib, pathlib
here = pathlib.Path(__file__).parent
specs = {s['id']: s for s in json.load(open(here / 'lot1_specs.json'))}
parts = [json.load(open(here / 'results' / f'2026-11-21_lot1_post005_{p}_raw.json')) for p in 'AB']
H = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()[:16]
rows, n = [], {'ok': 0, 'ko': 0, 'info': 0}
for part in parts:
    for r in part['lot1']['resultats']:
        s = specs[r['id']]; exp = s['expect']
        passed = (r['obtenu'] == 'OK' if exp == 'ok' else r['obtenu'] in exp.split('|')) and r['controle']
        k = 'ok' if passed else ('info' if s['info'] else 'ko'); n[k] += 1
        v = {'ok': '✅ Réussi', 'info': '⚠️ Constat', 'ko': '❌ Échoué'}[k]
        who = r['role'] + (f" · {r['sub'][:8]}…" if r['sub'] else '')
        rows.append(f"| {part['lot1']['passe']} | {r['id']} | {s['mat']} | {s['titre']} | {who} | {exp.replace('|', ' ou ')} | {r['obtenu']} | {r['ms']} | {v} |")
st = parts[1]['etat_dev_apres']
L = ['# Lot 1 backend — recette après migration 005 sur Supabase DEV', '',
     f"- **Exécution** : passe A {parts[0]['lot1']['horodatage_serveur'][:19]} UTC (non destructive), passe B {parts[1]['lot1']['horodatage_serveur'][:19]} UTC (TRUNCATE/DELETE), chacune dans une transaction terminée par `ROLLBACK`.",
     '- **Environnement** : projet `eetnzdvjfzexgvqbtyrj`, PostgreSQL 17.12, migrations 20261120092413 → 20261121050030 (005 active).',
     '- **Niveau de preuve** : SQL sur la base réelle, rôles `anon`/`authenticated`/`service_role` réellement endossés, **JWT simulé** (`request.jwt.claims`). Pas de test HTTP ni de vrai jeton Auth à ce stade.',
     f"- **Empreintes SHA-256** : `lot1_run_A.sql` {H(here/'lot1_run_A.sql')}…, `lot1_run_B.sql` {H(here/'lot1_run_B.sql')}…, sorties brutes A {H(here/'results/2026-11-21_lot1_post005_A_raw.json')}…, B {H(here/'results/2026-11-21_lot1_post005_B_raw.json')}…",
     f"- **État de DEV relu à {st['verifie_a'][:19]} UTC** : {st['users']} utilisateur, {st['households']} duo, {st['transactions']} transaction, {st['entries']} ligne, {st['objets_temoins_restants']} objet témoin ; 5 migrations ; 2 triggers anti-TRUNCATE ; TRUNCATE anon = {st['anon_truncate']}, authenticated = {st['auth_truncate']}.", '',
     f"**Bilan : {n['ok']} réussis, {n['ko']} échoués, {n['info']} constats connus** sur {sum(n.values())} vérifications.", '',
     '| Passe | ID | Matrice | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |', '|---|---|---|---|---|---|---|---|---|'] + rows + ['',
     '**Constats connus (non bloquants pour ce lot, suivis au lot 3 ou documentés)** : P01 arrondi silencieux d’une écriture privilégiée directe (les clients passent par la RPC) ; T03 le propriétaire peut désactiver les triggers en mode réplication (gestion stricte des accès administrateurs) ; M01 pas de plafond de deux membres en base ; S11c départ impossible pour un membre ayant écrit (appartenance avec statut, validée).']
(here / 'results' / '2026-11-21_lot1_post005_rapport.md').write_text('\n'.join(L) + '\n')
print(n)
