# 08 — CI/CD (LOT T08)

Nouveau workflow `.github/workflows/technical-hardening.yml` (`3b9af4c`, `7cc587f`). Les workflows existants (`duo-budget-ci.yml`, `sprint1-navigation.yml`, `sprint2-dashboard.yml`) sont **inchangés**.
Déclencheurs : push sur `fix/v3-technical-hardening` et `feat/v3-sprint2-dashboard` ; PR vers Sprint 2, Glance (PR #3) et `main` ; manuel.

## 1. Jobs

| Job | Contenu | Échoue si |
|---|---|---|
| `frontend` | `npm ci` (lockfile) ; garde Expo **58** ; 37 tests ; 13 assertions Glance ; 32 garde-fous Android ; parse JSX ; `expo-doctor@1.21.8` ; export Web normal + QA Lab ; isolation des bundles (16) ; artefact `web-exports` | tout échec |
| `web-qa` | Playwright 1.56.1 installé **hors projet** ; matrice 40 cellules, Glance ×4, mouvement réduit (avec témoin), isolation stockage/réseau, 3 cas pré-auth ; artefact `web-qa-report-and-captures` (rapport JSON + 88 captures) | un contrôle échoue |
| `backend` | `server/npm ci` ; `check:native` ; 22 tests sur SQLite temporaire | tout échec |
| `android-preview` | garde-fous ; `expo prebuild` variante Preview (jetable) ; assertions manifeste ; recherche de valeurs secrètes ; **jamais d'appel EAS** | manifeste non conforme |
| `dependency-audit` | `npm audit` frontend et serveur ; résumé par gravité dans le log ; JSON en artefact | **modérée ou plus** |
| `secret-scan` | gitleaks **8.30.1**, archive vérifiée par **SHA-256 épinglé**, historique complet (`fetch-depth: 0`) ; rapport en artefact | une fuite |

Visibilité des risques : les 6 `todo` (F-01, R-01…R-05) apparaissent dans les logs à chaque exécution. Aucun contrôle de sécurité n'a été désactivé ni assoupli.

## 2. Exécutions réelles

| Run | Commit | Résultat | Détail |
|---|---|---|---|
| [45472278433](https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45472278433) | `3b9af4c` | ❌ | 5 jobs verts ; `web-qa` : « Playwright does not support chromium on ubuntu26.04-x64 » (`ubuntu-latest` = Ubuntu 26.04) |
| [45472502146](https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45472502146) | `7cc587f` | ✅ **6/6** | `web-qa` épinglé sur `ubuntu-24.04` |
| [45474001441](https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45474001441) (push) / [45474016808](https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45474016808) (PR #15) | `7aee64e` | ✅ **6/6** et ✅ **6/6** | tête de branche avec documentation |

Extraits du run 45472502146 : `expo 58.0.26` · `# tests 37 / # pass 36 / # todo 1` · `13 checks` · `32 assertions` · `16 checks` · `20/20 checks passed` · `web QA: 40 QA Lab cells, 0 failure(s)` · `sqlite3 native binding OK, SQLite 3.52.0` · `# tests 22 / # pass 17 / # todo 5` · `frontend {"total":0}` · `server {"total":0}` · gitleaks `130 commits scanned. no leaks found` · `Preview manifest OK`.

## 3. Artefacts de recette produits par la CI

`web-exports` (dist + dist-preview, 7 j), `web-qa-report-and-captures` (14 j), `dependency-audit` (14 j), `gitleaks-report` (14 j). Aucun déploiement, aucune publication.

## 4. Points d'attention

- `ubuntu-latest` = 26.04 : les jobs autres que `web-qa` y passent (sqlite3 précompilé OK grâce à glibc récente) ; **ce n'est pas représentatif d'un serveur Ubuntu 22.04** (voir 03 §8).
- Actions en `@v4` (tags majeurs) comme les workflows existants ; épinglage par SHA recommandé P2.
- Le workflow `sprint2-dashboard.yml` ne se déclenche pas sur une PR vers Sprint 2 ; le nouveau workflow couvre ce cas.

## Mise à jour lot 2 — scan de secrets

Runs 45480021617 (push) et 45480036277 (PR) sur `108bc7e` : 5 jobs verts, **gitleaks ❌ 2 constats** `generic-api-key` dans `server/test/config.test.cjs:58-59` (commit `543381d`) — la valeur volontairement invalide (trop courte) servant à prouver le refus de démarrage. Faux positif vérifié ; le contrôle a fonctionné. Traitement sans désactiver la règle : littéral remplacé par une construction à l'exécution, et `.gitleaksignore` limité aux **2 empreintes exactes** (l'historique publié n'est jamais réécrit). Résultats CI de la tête finale : description de la PR #15.
