# 09 — Dette technique (LOT T09)

Audit sans refonte : aucune refactorisation n'a été faite (les seules modifications de code applicatif sont `5746c73`, une propriété de style, et `d3d766f`, côté serveur).

## P0 — bloquant sécurité ou intégrité financière

| Id | Constat | État |
|---|---|---|
| D-P0-1 | Perte d'écritures acquittées sous concurrence (serveur) | **Corrigé** `d3d766f` + test |
| D-P0-2 | Jetons forgeables si `APP_SECRET` absent (R-01) | Ouvert — décision ; **vérifier le `.env` du serveur réel avant fusion** |

## P1 — nécessaire avant bêta

| Id | Constat | Recommandation |
|---|---|---|
| D-P1-1 | `App.js` 1 249 lignes, 85 Ko : 35 `useState`, 15 `useMemo`, 5 `useEffect`, 47 fonctions internes, 52 `Alert.alert` ; API, session, cache, formulaires et écrans mêlés | Extraire progressivement `apiClient` (requête/erreurs/401), `sessionStore`, `localCache`, puis les écrans ; une extraction par tranche, testée comme `dashboardModel` |
| D-P1-2 | Client HTTP non testable (`request()` dans le composant) | Première extraction ; tests réponses non JSON, 401, réseau coupé |
| D-P1-3 | Stockage non chiffré + déconnexion partielle (R-06, R-07) | SecureStore ; purge du cache à la déconnexion |
| D-P1-4 | Révocation de session / enrôlement (R-02, R-03) | Voir 05 |
| D-P1-5 | F-01 : « -0,00 € » et alerte négative sur résidu flottant | Arrondi au centime en présentation |
| D-P1-6 | `sqlite3` amont non maintenu | Migrer vers `better-sqlite3` (ou `node:sqlite` stable) |
| D-P1-7 | README obsolète (« Expo SDK 54 ») | Mettre à jour lors de la consolidation |

## P2 — amélioration planifiable

| Id | Constat |
|---|---|
| D-P2-1 | **Duplication de calculs** : `personState` calculé dans `App.js` et recalculé différemment dans `preview/fixtures.cjs` (sans `Number()`, sans filtre de mois) ; `formatEuro` dupliqué (`App.js`, `fixtures.cjs`) ; `DELETE_WINDOW_DAYS` dupliqué client/serveur ; ID `'steve'` codé en dur comme admin (client et migration serveur) |
| D-P2-2 | Effet `saveLocal` : 6 écritures AsyncStorage à **chaque** changement d'état, promesse non attendue ni capturée (rejet silencieux possible) ; dépend de l'ordre des effets pour ne pas écraser le cache au démarrage |
| D-P2-3 | Erreurs silencieuses : `.catch(()=>{})` sur `isReduceMotionEnabled` (Dashboard, Glance — acceptable) ; `catch (_) {}` sur `ROLLBACK` et réouverture de base (serveur) ; `logActivity` avale ses erreurs (journal incomplet sans alerte) |
| D-P2-4 | `pbkdf2Sync` bloque la boucle d'événements à chaque tentative de PIN |
| D-P2-5 | Pas de validation de format de date côté serveur ; pas de borne de montant |
| D-P2-6 | Fenêtre de suppression : `created_at` UTC relu en heure locale |
| D-P2-7 | Actions GitHub épinglées par tag majeur, pas par SHA |
| D-P2-8 | Couplage : tests de navigation basés sur des regex du source de `App.js` (fragiles à toute reformulation) |

## P3 — optimisation non urgente

| Id | Constat |
|---|---|
| D-P3-1 | Code QA Lab présent (inaccessible) dans le bundle Web normal (taille non mesurée isolément) |
| D-P3-2 | `recentOperations` appelé à chaque rendu dans `App.js` (non mémoïsé) ; listes `summary.map` recalculées sans `React.memo` — non mesuré ; volumétrie faible (duo) |
| D-P3-3 | Styles en ligne très compacts (une ligne par composant) dans `DashboardOverview.js`, `WebPreview.js` : lisibilité/diffs |
| D-P3-4 | B-07 (statut des lignes historiques futures) — décision métier |
| D-P3-5 | `/api/reset` ne purge pas `activity_logs` |

## Réutilisation du Dashboard

Bonne : `DashboardOverview` et `dashboardModel` sont réellement partagés par l'app et le QA Lab (prouvé par l'isolation des bundles et la matrice). Les seules divergences sont dans les **données d'entrée** (D-P2-1) : un test de parité `personState` app/fixtures serait utile lors de l'extraction D-P1-1.

## Mise à jour lot 2

D-P0-2 (R-01) corrigé ; D-P1-5 (F-01) corrigé ; D-P1-6 : plan de migration du pilote dans `12_LOT2_REVIEW_FIXES.md` §5 ; D-P3-4 (B-07) : outil d'audit livré.
