# 11 — Passation pour revue indépendante (ChatGPT)

Objet : revue indépendante du durcissement technique des Sprints 1-2 de Duo Budget V3 et décision de consolidation.
Dépôt : https://github.com/Steve-Landry-NONO/S-S-Budget · Branche : `fix/v3-technical-hardening` · PR brouillon : **#15** → `feat/v3-sprint2-dashboard` (https://github.com/Steve-Landry-NONO/S-S-Budget/pull/15).
Base vérifiée : `376c7190dd76cdad5351336515662277114ba0b3` (= tête PR #14 sur le remote le 24/11/2026).
**Aucune fusion, aucun force-push, aucune modification de `main`, Figma, Supabase/RLS/migrations, ni des branches backend. Aucun déploiement. Aucune donnée réelle utilisée. Aucun build EAS.**

## 1. Liste exacte des commits (ordre chronologique)

| # | SHA | Message | Statut |
|---|---|---|---|
| 1 | `b0bae5dc8be7e44c39831dfce94fa126c223eb39` | build(deps): override minimatch to 11.0.9 for GHSA-g3hv-75wg-m249 without Expo downgrade | Implémenté, testé ✅ |
| 2 | `ecc54b5de7b9451489c48d1502490ccdf7f550fa` | test(server): qualify auth, sessions, persistence and V2.0 base migration on temporary SQLite | Testé ✅ |
| 3 | `d3d766f47bcb38b9f504bedcddf896b848d9b7af` | fix(server): serialize mutating requests sharing the single SQLite connection | Implémenté, testé ✅ (échec reproduit avant) |
| 4 | `c80cd8fd833aebab5ff0509aa9d3f20d49d94767` | build(server): upgrade sqlite3 5.1.7 -> 6.0.1 and track a reproducible lockfile | Implémenté, testé ✅ ; déploiement réel non testé |
| 5 | `06d17d959fa19ae2c5d2d2361d11795ad2fe7e41` | test(finance): differential V2 parity and deterministic financial edge cases | Testé ✅ (+1 todo F-01) |
| 6 | `5746c73cab129c0cfd576444f77a6d2dfe467893` | fix(dashboard): give member cards intrinsic height in the column root | Implémenté, testé Web ✅ ; natif non testé |
| 7 | `176cf8781ff5da305333173c69f60041e4974371` | build(android): port PR #4 preview EAS profile onto the Sprint 2 SDK 58 base | Implémenté, testé (config) ✅ |
| 8 | `283480d898a472798ccb7b550cf26a69dedd4b74` | build(android): make the preview APK reach the HTTP recette server and harden it | Implémenté, testé (prebuild) ✅ ; APK non produite |
| 9 | `6ef6f4f9150a57794aba3f1d8974928823c6de5b` | test(security): log hygiene, bundle isolation and visible residual risks | Testé ✅ (+5 todo) |
| 10 | `3b9af4ce681b0c8541b19531ccd64389b6482b0c` | ci: add technical hardening gates and automated browser QA | CI ❌ (run 45472278433, Playwright/Ubuntu 26.04) |
| 11 | `7cc587ff6b8552076f35bbafb60c1d491bf36017` | ci: pin the browser QA job to ubuntu-24.04 | CI ✅ (run 45472502146) |
| 12 | `a01effc189630a69febd1723f41d303606aeec47` | docs(android): port the PR #4 Android Preview build guide verbatim | Documentation |
| 13 | tête de branche | docs(hardening): …(ce dossier) | Documentation |

## 2. Fichiers modifiés (hors `docs/technical-hardening/`)

Code applicatif : `src/features/dashboard/DashboardOverview.js` (1 ligne, style), `server/src/index.js` (+19, file d'écriture).
Dépendances : `package.json` (+`overrides`), `package-lock.json` (minimatch), `server/package.json` (sqlite3, `engines`, scripts `test`/`check:native`), `server/package-lock.json` (nouveau suivi).
Android : `app.config.js`, `eas.json`, `plugins/withPreviewCleartext.js`, `scripts/check-android-preview.js`, `docs/ANDROID_PREVIEW_BUILD.md`.
Tests/outillage : `scripts/finance.test.cjs`, `scripts/fixtures/v2-reference-aggregation.cjs`, `scripts/preview.test.cjs` (+1 test), `scripts/check-bundle-isolation.cjs`, `scripts/qa/web-qa.cjs`, `server/test/{helpers,auth,persistence,concurrency,security}.test.cjs`, `server/test/fixtures/schema-v2.0.sql`.
CI : `.github/workflows/technical-hardening.yml` (nouveau ; workflows existants intacts).
Total : 23 fichiers, +3 277 / −8 (avant documentation).

## 3. Corrections réalisées

1. **Intégrité serveur (P0)** — écritures acquittées perdues / lots partiels sous concurrence → sérialisation des requêtes mutantes.
2. **Vulnérabilités serveur** — 1 critique, 4 élevées, 2 faibles (chaîne d'installation) → sqlite3 6.0.1.
3. **Vulnérabilités frontend** — 3 modérées → override minimatch 11.0.9 (sans rétrograder Expo).
4. **QA Lab espaces verticaux** — cartes membres à hauteur intrinsèque.
5. **Android Preview** — HTTP clair (opt-in Preview), `allowBackup=false`, permissions inutiles bloquées ; config PR #4 portée sur SDK 58.
6. **Reproductibilité** — lockfile serveur versionné ; CI complète.

## 4. Versions avant / après

| Élément | Avant | Après |
|---|---|---|
| expo / react-native / react | 58.0.26 / 0.88.1 / 19.3.0 | **inchangé** |
| minimatch (via @expo/fingerprint 0.21.10) | 10.2.6 | 11.0.9 (override) |
| sqlite3 (serveur) | 5.1.7 (SQLite 3.44.2) | 6.0.1 (SQLite 3.52.0) |
| tar / node-gyp (serveur) | 6.2.1 / 8.4.1 | 7.5.23 / 12.4.0 |
| npm audit frontend | 3 modérées | 0 |
| npm audit serveur | 1 critique, 4 élevées, 2 faibles | 0 |
| Tests frontend / serveur | 24 / 0 | 37 (1 todo) / 22 (5 todo) |
| Node requis serveur | non déclaré | `>=20.17.0` |

## 5. Commandes exécutées (principales)

```bash
git ls-remote origin; git fetch origin <branches PR>; git switch -c fix/v3-technical-hardening 376c719...
npm audit --json; npm ls minimatch --all; npm view minimatch …; curl api.github.com/advisories/GHSA-g3hv-75wg-m249
# bac à sable : override + createFingerprintAsync avec minimatch 10 vs 11 (script fpdiff)
npm install (override); rm -rf node_modules && npm ci; npm audit
npx expo-doctor@1.21.8; node --test scripts/*.test.cjs; node scripts/check-glance.js
npx expo export --platform web --output-dir dist; EXPO_PUBLIC_DUO_PREVIEW=1 npx expo export … dist-preview
cd server && npm audit --json; npm test (baseline puis après correctif); scripts race (3 exécutions)
npm install sqlite3@6.0.1 → échec GLIBC_2.38; npm rebuild sqlite3 --build-from-source; npm ci --build-from-source
# réouverture base écrite par 5.1.7 avec 6.0.1, et relecture inverse avec 5.1.7
node --test scripts/finance.test.cjs; mutants via sed + git checkout
node scripts/qa/web-qa.cjs --preview dist-preview --normal dist --out qa-out   # Chrome 126 local
APP_VARIANT=preview [PREVIEW_ALLOW_CLEARTEXT=1] npx expo prebuild --platform android --no-install --clean  # bac à sable
git grep / git log -p (motifs de secrets); clone jetable + git merge --no-ff (simulation de fusions)
git push -u origin fix/v3-technical-hardening; gh pr create --draft …
```

## 6. Résultats réels

| Contrôle | Local | CI 45472502146 |
|---|---|---|
| Tests frontend | 36 ✅ + 1 todo | idem |
| Glance / Android / bundles | 13 / 32 / 16 ✅ | idem |
| Expo Doctor | 20/20 | 20/20 |
| Tests serveur | 17 ✅ + 5 todo (sqlite3 5.1.7 et 6.0.1 source) | 17 ✅ + 5 todo (6.0.1 précompilé) |
| Matrice navigateur | 40/40, 0 échec (avant correctif : 24/40 en échec) | 40/40, 0 échec |
| Audits | 0 / 0 | 0 / 0 |
| gitleaks | non exécuté localement (refusé) ; motifs `git grep` : 0 | 130 commits, 0 fuite |
| Prebuild Android Preview | manifeste conforme | « Preview manifest OK » |

Échecs observés et conservés en preuve : concurrence avant `d3d766f` (3/3 runs avec erreurs, pertes en runs 2-3) ; `require('sqlite3')` 6.0.1 précompilé sur glibc 2.35 ; run CI 45472278433 (web-qa) ; F-01 et R-01…R-05 (todo).

## 7. Liens CI

- ✅ https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45472502146 (6/6)
- ❌ https://github.com/Steve-Landry-NONO/S-S-Budget/actions/runs/45472278433 (web-qa, corrigé par `7cc587f`)
- Références PR existantes : PR #3 45452731604 / 45452748037 ; PR #14 45461389533 / 45461431485 ; PR #4 45360201391 (ancienne base)

## 8. Risques résiduels

| Id | Risque | Niveau |
|---|---|---|
| R-01 | Sans `APP_SECRET`, jetons admin forgeables (clé de dev publique) | **P0 si mal configuré** |
| DEP-1 | sqlite3 6.0.1 : glibc ≥ 2.38 ou compilation ; amont non maintenu ; plus de win32-ia32 | P1 déploiement |
| F-01 | « -0,00 € » et alerte négative sur résidu flottant | P1 |
| R-02/R-03 | Pas de révocation ; enrôlement ouvert | P1 |
| R-06/R-07 | Stockage non chiffré ; cache conservé après déconnexion | P1 avant bêta |
| UX-1 | `5746c73` non revalidé sur iPhone | P1 recette |
| AND-1 | APK jamais compilée ni installée | P1 recette |
| D-04 | HTTP clair autorisé dans la Preview | P2 (recette) / P1 (bêta) |
| R-04/R-05, B-07 | Infos dans `/api/health`, messages SQLite, statut historique | P3 |

## 9. Limitations de l'environnement

Linux Ubuntu 22.04 (glibc 2.35), Node 22.23.5, npm 10.9.9, git 2.34.1 ; pas de SDK Android, pas d'appareil, disque à 99 % ; pas d'iPhone ; Chrome 126 local / Chromium 141 CI (pas de WebKit) ; exécution locale d'un binaire téléchargé (gitleaks) refusée par la politique de l'agent ; aucun accès au serveur réel ni au compte EAS (volontairement).

## 10. Actions requises du propriétaire

1. **Vérifier immédiatement** que le `server/.env` du serveur réel définit un `APP_SECRET` long et non égal à l'exemple (sinon R-01 est exploitable aujourd'hui, en V2).
2. Ne **pas** relancer `npm ci` dans `server/` sur l'hôte réel sans suivre 03 §8 (`ldd --version`, sauvegarde, `check:native`).
3. Recheck iPhone rapide : Dashboard 165 €, cartes « Votre duo » (normal + grande police).
4. Revoir les captures `docs/technical-hardening/captures/` et l'artefact CI `web-qa-report-and-captures`.
5. Trancher D-01…D-06 ci-dessous ; puis suivre l'ordre de fusion (10 §3).
6. Quand décidé : `eas login`, `eas init`, `eas build --platform android --profile preview` (07 §6), puis checklist Android.

## 11. Décisions à soumettre à ChatGPT (revue indépendante)

| Id | Question | Recommandation de l'agent |
|---|---|---|
| D-01 | Le correctif de concurrence (file d'écriture globale) est-il acceptable, ou faut-il des transactions par connexion dédiée ? | Accepter (simple, prouvé) ; revoir lors d'une migration de pilote |
| D-02 | Adopter sqlite3 6.0.1 (non maintenu, glibc 2.38) maintenant, ou garder 5.1.7 et planifier `better-sqlite3` ? | Adopter 6.0.1 + procédure ; planifier `better-sqlite3` (P1) |
| D-03 | F-01 : arrondi au centime en présentation (notice et affichage) sans toucher aux totaux ? | Oui |
| D-04 | Preview Android : HTTP clair via Tailscale ou HTTPS `tailscale serve` ? | HTTP clair pour la recette interne, HTTPS avant bêta |
| D-05 | R-01 : refus de démarrage sans `APP_SECRET` en production ? | Oui, en priorité |
| D-06 | `5746c73` (composant recetté) : accepter sur preuve Web + raisonnement Yoga, ou exiger un recheck natif avant fusion ? | Recheck natif rapide avant fusion |
| D-07 | Override minimatch : acceptable jusqu'à ce qu'Expo l'intègre ? | Oui (différentiel identique) |

## 12. Recommandations GO / NO GO

| Fusion | Recommandation | Argument |
|---|---|---|
| **PR #15** → `feat/v3-sprint2-dashboard` | **GO conditionnel** | CI 6/6, correctifs prouvés par des tests qui échouaient avant ; conditions : revue indépendante, D-02 et D-06 tranchées, consigne de déploiement serveur connue du propriétaire |
| **PR #3** → `main` | **GO conditionnel** | CI verte, recette iPhone Sprint 1, fusion propre ; condition : décision propriétaire ; les correctifs de sécurité arriveront avec Sprint 2 (ou cherry-pick `b0bae5d`, `d3d766f`, `c80cd8f`) |
| **PR #14** (incluant #15) → `main` après re-ciblage | **GO conditionnel** | Recette iPhone V5 10/10 déclarée, matrice Web 40/40, parité V2 prouvée ; conditions : #3 fusionnée, recheck natif cartes membres, Android hors périmètre de clôture ou accepté comme ouvert |
| **PR #4** → Glance | **NO GO** | Base pré-SDK 58, APK incapable de joindre le serveur HTTP, contenu repris et corrigé dans #15 ; fermer comme remplacée |
| Branches backend/cloud (#6-#12) | Hors périmètre — non évaluées pour fusion | Fusion textuellement propre avec la pile ; qualification par leurs propres pipelines |

Les documents 00 à 10 détaillent chaque point ; toutes les preuves chiffrées sont reproductibles avec les commandes du §5 et la CI.
