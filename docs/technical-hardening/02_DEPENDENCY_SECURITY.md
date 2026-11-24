# 02 — Sécurité des dépendances frontend (LOT T02)

## 1. Reproduction de l'audit (état `376c719`)

`npm audit` : **3 modérées, 0 élevée, 0 critique** — conforme au rapport du propriétaire.

| Paquet | Plage vulnérable | Via | Correctif proposé par npm |
|---|---|---|---|
| `minimatch` | 7.0.0 – 11.0.0 | GHSA-g3hv-75wg-m249 (CVE-2026-118764) | `expo@52.0.49` (**interdit**) |
| `@expo/fingerprint` | ≥ 0.11.12-canary | minimatch | idem |
| `expo` | ≥ 53.0.0-canary | @expo/fingerprint | idem |

Arbre installé (`npm ls minimatch --all`) : **un seul** `minimatch@10.2.6`, sous `expo@58.0.26 › @expo/fingerprint@0.21.10` (spécification `^10.2.6`). Aucun autre consommateur dans `node_modules`.

## 2. Analyse de l'avis

- Déni de service par amplification de `globParts` dans `firstPhasePreProcess()` **uniquement si `optimizationLevel >= 2`**. Version corrigée : **11.0.1**.
- `@expo/fingerprint` crée ses matchers avec `{ dot: true }` (niveau par défaut 1) ; un commentaire du code Expo (`build/Options.js`) indique que l'avis ne s'applique pas. Motifs issus de fichiers du dépôt (`.fingerprintignore`), outil exécuté au build, absent du bundle applicatif.
- Exploitabilité réelle : **nulle en pratique**. Correction néanmoins réalisée car sans coût fonctionnel prouvé.

## 3. Compatibilité de minimatch 11

- API consommée par `@expo/fingerprint` (inventaire du code `build/`) : constructeur `Minimatch`, `.match()`, `.negate`, `.pattern` — **toutes présentes** dans 11.0.9 (`dist/commonjs/index.d.ts`).
- 11.x retire `makeRe`, `AST`, `regexp`… de la classe : **non utilisés**.
- Moteurs : 11.0.9 exige Node `20 || >=22` (Node 22 utilisé).
- **Test différentiel** (bac à sable, même projet) : `createFingerprintAsync` avec minimatch 10.2.6 puis 11.0.9 → **hash identique** `29eb62502596173216e8998756343fe42aa4c081`, **25 sources identiques** ; matcher (12 motifs dont négations, `**/../`, accolades) sur 19 chemins → résultats identiques ; `buildDirMatchObjects` identique.

## 4. Correctif appliqué — commit `b0bae5d`

```json
"overrides": { "minimatch": "^11.0.9" }
```

Diff du lockfile limité à `minimatch` 10.2.6 → 11.0.9 et `@isaacs/nonrecursive-glob-match@1.1.0` (+ `brace-expansion` contrainte `^5.0.12`, déjà satisfaite).

## 5. Vérifications après correctif

| Contrôle | Résultat |
|---|---|
| `rm -rf node_modules && npm ci` | OK, 512 paquets |
| `npm ls expo react-native` | expo **58.0.26**, react-native **0.88.1** (inchangés) |
| `npx expo-doctor@1.21.8` | **20/20** |
| `node --test` (24 tests existants) | 24/24 |
| `node scripts/check-glance.js` | 13/13 |
| `expo export --platform web` normal et QA Lab | OK |
| `npm audit` | **0 vulnérabilité** |
| CI run 45472502146 (job frontend + dependency-audit) | vert, `{"total":0}` |

## 6. Risque résiduel

- L'override devra être **revu à chaque montée Expo** : quand `@expo/fingerprint` exigera lui-même `minimatch >= 11.0.1`, supprimer l'override. Si une future version d'Expo exige une API absente de 11.x, `npm ci` / Doctor / le test différentiel (procédure §3) le révéleront.
- Retour arrière : `git revert b0bae5d` puis `npm ci`.
