# 01 — Audit initial du dépôt (LOT T01)

Date : 24 novembre 2026 · Branche : `fix/v3-technical-hardening` · Base : `376c7190dd76cdad5351336515662277114ba0b3`

## 1. Références Git vérifiées (`git ls-remote origin`, 24/11/2026)

| Référence | SHA | Constat |
|---|---|---|
| `main` | `8e7f6f6` | 3 commits de documentation absents des branches Sprint (roadmap, gouvernance) — fichier unique `docs/ROADMAP_DUO_BUDGET_2026_2027.md` |
| PR #3 `feature/duo-budget-v3-glance-first-screen` → `main` | `b03af49` | Brouillon, `MERGEABLE/CLEAN`, CI verte (runs 45452731604, 45452748037) |
| PR #14 `feat/v3-sprint2-dashboard` → PR #3 | `376c719` | **Identique au candidat annoncé.** Brouillon, CI verte (runs 45461389533, 45461431485). 8 commits au-dessus de `b03af49` |
| PR #4 `feature/android-preview-eas-v1` → PR #3 | `590adfe` | Brouillon. Base `3ab10a1` : **en retard** de 13 commits sur PR #3 (ne contient ni SDK 58 ni navigation). CI 45360201391 exécutée sur cet état ancien |
| `feat/v3-sprint1-navigation` (PR #13) | `fcdb3a4` | Ancêtre de PR #3 |
| Branches backend/cloud (PR #6 à #12) | — | Non modifiées. Voir `10_MERGE_PLAN.md` §5 |

Chaîne : `main ← PR #3 (b03af49) ← PR #14 (376c719) ← fix/v3-technical-hardening`. PR #4 est empilée sur PR #3 mais à partir d'un ancêtre antérieur.

## 2. Arborescence et responsabilités

| Zone | Contenu | Remarque |
|---|---|---|
| `App.js` (1 249 lignes, 85 Ko) | App authentifiée V2 complète + aiguillage QA Lab | 35 `useState`, 15 `useMemo`, 52 `Alert.alert` — voir T09 |
| `src/features/dashboard` | `DashboardOverview.js` (présentation) + `dashboardModel.cjs` (agrégation pure extraite de V2) | Modèle partagé App / QA Lab |
| `src/features/glance` | `DuoGlanceScreen.js` — écran public pré-auth, montants `DEMO` gelés | Aucun accès stockage/API |
| `src/features/navigation` | `routes.cjs`, `DuoNavigation.js` | Barre fixe 4 onglets, mode 2×2 grande police |
| `src/features/preview` | `WebPreview.js`, `fixtures.cjs` — QA Lab Web | Monté seulement si `Platform.OS==='web'` et `EXPO_PUBLIC_DUO_PREVIEW==='1'` (build) |
| `server/` | API Express + SQLite V2 (1 005 lignes dans `index.js`) | Serveur auto-hébergé réel du propriétaire (LAN/Tailscale) |
| `scripts/` | Tests `node:test` + `check-glance.js` | 24 tests + 13 assertions à l'état initial |
| `.github/workflows/` | `duo-budget-ci.yml`, `sprint1-navigation.yml`, `sprint2-dashboard.yml` | Pas de test serveur, pas d'audit, pas de scan de secrets |

## 3. Dépendances (état initial)

| Projet | Clé | Version installée |
|---|---|---|
| Frontend | expo / react-native / react | 58.0.26 / 0.88.1 / 19.3.0 |
| Frontend | `@expo/fingerprint` → `minimatch` | 0.21.10 → **10.2.6** (vulnérable GHSA-g3hv-75wg-m249) |
| Frontend | `@react-native-async-storage/async-storage` | 2.2.0 |
| Serveur | sqlite3 / sqlite / express | **5.1.7** / 5.1.1 / 4.22.3 |
| Serveur | `server/package-lock.json` | **non suivi par Git** (généré localement par le propriétaire) |

Node local et CI : 22 (local 22.23.5). Lockfile frontend v3 présent et suivi.

## 4. Configurations Expo / EAS

- `app.json` : nom « Duo Budget », slug `ss-budget-couple`, `com.ss.budgetcouple` (Android et iOS), plugin `expo-splash-screen` (format SDK 58).
- Pas de `eas.json` ni `app.config.js` sur PR #3/#14 : ils n'existent que sur PR #4.
- PR #4 contient un `app.json` antérieur au SDK 58 (clé `splash` legacy, sans plugin) : **à ne pas reprendre** (non porté, voir T07).

## 5. Stockage local (AsyncStorage ; `localStorage` sur le Web)

| Clé | Contenu | Sensibilité |
|---|---|---|
| `SS_BUDGET_V2_CACHE` | membres, enveloppes, dépenses, versements, journal | **Données financières personnelles** |
| `SS_BUDGET_V2_API_URL` | URL du serveur | Faible |
| `SS_BUDGET_V2_API_SECRET` | secret API partagé | **Secret** |
| `SS_BUDGET_V2_AUTH_TOKEN` / `_EXPIRES_AT` | jeton de session HMAC 12 h | **Secret** |
| `SS_BUDGET_V2_CURRENT_USER_ID` | identifiant membre | Faible |

Stockage non chiffré (pas de SecureStore). Voir `05_APPLICATION_SECURITY.md`.

## 6. Tests et documentation existants

- 24 tests `node:test` (navigation 8, dashboard 10, preview 6 dont 1 ajouté ici → 7) et 13 assertions Glance : principalement statiques (regex sur le source) + calculs du modèle.
- Aucun test serveur, aucun test d'intégration, aucun test navigateur.
- README annonce « Expo SDK 54 » (obsolète, réel : 58).

## 7. Cartographie des risques (avant intervention)

| # | Risque | Gravité | Traitement |
|---|---|---|---|
| A1 | Écritures acquittées perdues sous concurrence (transactions sur connexion SQLite partagée) | **P0 intégrité** | Corrigé `d3d766f`, prouvé par test |
| A2 | 1 critique + 4 élevées dans la chaîne d'installation sqlite3 | P1 | Corrigé `c80cd8f` (sqlite3 6.0.1) avec précondition de déploiement |
| A3 | minimatch modéré via Expo, correctif npm = rétrogradation SDK interdite | P2 | Corrigé `b0bae5d` (override ciblé, différentiel prouvé) |
| A4 | Sans `APP_SECRET`, jetons forgeables avec la clé de dev publique | **P0 si mal configuré** | Documenté R-01, décision propriétaire |
| A5 | APK Preview incapable de joindre le serveur HTTP de recette | Bloquant Android | Corrigé (variante Preview) `283480d`, décision propriétaire |
| A6 | Réserve « espaces verticaux » QA Lab | P1 UX | Cause trouvée et corrigée `5746c73` |
| A7 | Lockfile serveur non suivi → installations non reproductibles | P1 | Corrigé `c80cd8f` |
| A8 | Aucune CI serveur / audit / secrets | P1 | Ajouté `3b9af4c` |

## 8. Dépendances entre branches et conditions de clôture

- Sprint 1 se clôt par la fusion de PR #3 dans `main` ; Sprint 2 ne peut être fusionné qu'après (sa base est PR #3).
- La branche de durcissement dépend de PR #14 (elle en est la suite directe) et rend PR #4 caduque (portage + correctifs).
- Une PR « fusionnable » (`CLEAN`) n'a été considérée que comme absence de conflit textuel : la compatibilité fonctionnelle a été évaluée par les tests (`04_TEST_REPORT.md`) et la simulation de fusion (`10_MERGE_PLAN.md`).

**Conditions de clôture Sprint 1 :** PR #3 recettée (fait, iPhone), CI verte (fait), décision de fusion propriétaire (à faire).
**Conditions de clôture Sprint 2 :** recette iPhone V5 (10/10, déclarée), matrice QA Lab (40/40 automatisée ici, revue humaine à faire), recheck natif des cartes « Votre duo » après `5746c73`, Android (configuration prête, APK non produite), décisions R-01…R-05 et F-01.
