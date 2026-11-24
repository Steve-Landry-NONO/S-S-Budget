# 04 — Rapport de tests (LOT T04)

Tous les tests existants sont conservés et inchangés (seul ajout : 1 test dans `scripts/preview.test.cjs`). Données exclusivement fictives.

## 1. Synthèse chiffrée

| Suite | Avant | Après | Résultat local | Résultat CI (run 45472502146) |
|---|---:|---:|---|---|
| Frontend `node --test` (navigation, dashboard, preview, finance) | 24 | **37** | 36 ✅ + 1 todo | 36 ✅ + 1 todo |
| Assertions Duo Glance (`check-glance.js`) | 13 | 13 | ✅ | ✅ |
| Garde-fous Android (`check-android-preview.js`) | — (15 sur PR #4) | **32** | ✅ | ✅ |
| Isolation des bundles Web | — | **16** | ✅ | ✅ |
| Serveur `server/test` | 0 | **22** | 17 ✅ + 5 todo | 17 ✅ + 5 todo |
| Matrice navigateur QA Lab | 0 | **40 cellules** + Glance ×4 + 3 cas pré-auth + mouvement réduit | 0 échec | 0 échec |

`todo` = défaut ou risque **avéré**, signalé, non corrigé car il exige une décision (règle d'affichage ou de sécurité). Ils s'affichent à chaque exécution sans casser le pipeline.

## 2. Calculs financiers — `scripts/finance.test.cjs`

| Cas | Résultat |
|---|---|
| Versement 200 €, dépense 35 € → solde réel **165 €** ; budget objectif 180 € ≠ argent disponible | ✅ |
| Report positif (80), négatif (−50), nul (0) ; opérations prévues des mois passés exclues du report | ✅ |
| Réel vs prévisionnel : 165 / 125 ; prévues d'un mois ultérieur sans effet | ✅ |
| Changement de mois : chaînage oct. 165 → nov. 285 → déc. −15 → janv. report −15 ; sept. 0 | ✅ |
| Décimaux / virgule (0,1 + 0,2 ; 10,05 + 19,99 − 0,30 = 29,74 €) | ✅ |
| Enveloppes vides ; enveloppe à budget 0 (dépassement, pas de pourcentage) | ✅ |
| Dépassement vs « À alimenter » indépendants | ✅ |
| Modification / suppression / déplacement de mois / passage en « prévu » : delta exact | ✅ |
| Pureté (entrées non mutées) | ✅ |
| **Différentiel V2** : oracle gelé = transcription ligne à ligne de l'agrégation de `App.js` à `2a4053b^` ; **2 000 jeux** pseudo-aléatoires déterministes (mulberry32, graine 20261124) ; égalité **stricte flottante** de summary, totals, planned, forecast | ✅ |
| Sensibilité du différentiel : 3 mutants injectés (réordonnancement arithmétique, `>` → `>=`, ordre du prévisionnel) | 3/3 détectés |
| 5 scénarios QA Lab : 165/165, −35/−35, 0/0, 165/125, 165/165 | ✅ |

Parité V2 de bout en bout : `server/test/persistence.test.cjs` calcule 165 € / 125 € **à partir de l'état renvoyé par le vrai serveur après redémarrage**, via le même `dashboardModel`.

### F-01 — défaut d'affichage trouvé (todo, non corrigé)

0,30 € versé, 0,10 € + 0,20 € dépensés → solde réel `-5.55e-17` → affiché **« -0,00 € »** et l'alerte **« Le solde réel enregistré est négatif »** apparaît. Origine : arithmétique flottante V2 (inchangée) + `toFixed(2)` + test `< 0`. Le modèle indique explicitement « ne pas changer l'arrondi dans cette tranche » → **décision propriétaire** : arrondir au centime avant comparaison/affichage (proposition : `Math.round(x*100)/100` dans la présentation uniquement, sans toucher aux totaux stockés).

## 3. Backend — `server/test/`

| Exigence | Fichier / test | Résultat |
|---|---|---|
| Authentification correcte | auth #3 | ✅ |
| PIN incorrect (401 `PIN_INVALID`, pas de jeton) ; formats invalides (400) ; profil inconnu (404) | auth #3 | ✅ |
| Changement de PIN exige le PIN courant | auth #3 | ✅ |
| Verrouillage après N échecs (423), PIN correct refusé pendant le verrou, déverrouillage après délai | auth #4 | ✅ |
| Expiration de session (TTL 1,5 s) ; rotation `APP_SECRET` invalide les jetons | auth #5 | ✅ |
| Accès non authentifié, jeton forgé (payload élevé, autre clé, jetons malformés), en-tête utilisateur discordant | auth #2 | ✅ |
| Secret API absent / faux | auth #1, security | ✅ |
| Rôles : membre refusé sur routes admin, sur l'opération de l'autre ; garde ses propres opérations | auth #6 | ✅ |
| Persistance des opérations + redémarrage | persistence #1, #2 | ✅ |
| Fenêtre de modification/suppression (5 jours) | persistence #2 | ✅ |
| Erreurs de base (FK, date manquante, id dupliqué) sans ligne partielle, corps JSON | persistence #4 | ✅ |
| Validation des montants/libellés | persistence #3 | ✅ |
| Paramétrage SQL (métacaractères stockés littéralement, injection par chemin) | persistence #5 | ✅ |
| Base historique V2.0 | persistence #6 | ✅ |
| Requêtes concurrentes | concurrency #1, #2 | ✅ (#2 en échec avant `d3d766f`) |
| Journaux sans PIN / jeton / secret | security #1, #2 | ✅ |
| Risques R-01…R-05 | security (todo) | 5 todo avérés |

## 4. Non testé (et pourquoi)

| Élément | Raison |
|---|---|
| « Réponses invalides et erreurs réseau » côté **client** (`request()` dans `App.js`) | Logique enfermée dans le composant `AuthenticatedApp` ; l'extraire = refactorisation hors périmètre. Comportement lu : réponse non JSON → `{}` → `Erreur serveur <code>` ; 401 `AUTH_REQUIRED` → purge du jeton. Recommandé P1 (T09). |
| Sauvegarde / restauration / reset du serveur | Écrivent dans `server/backups/` du dépôt ; non exécutés pour ne toucher aucun fichier réel. Seul le refus `403` aux membres est testé. |
| Fuseau horaire de la fenêtre de suppression | `created_at` UTC relu comme heure locale (`parseDbDate`) : fenêtre raccourcie de l'écart UTC (ex. 1 h à Paris). Constaté à la lecture, non instrumenté. P3. |
| Dynamic Type iOS / police Android réelle | Impossible sur le Web (voir 06). |
| Appareil Android | Aucun SDK/appareil (voir 07). |

## 5. Commandes

```bash
npm ci && node --test scripts/navigation.test.cjs scripts/dashboard.test.cjs scripts/preview.test.cjs scripts/finance.test.cjs
node scripts/check-glance.js && node scripts/check-android-preview.js
cd server && npm ci && npm run check:native && npm test
```
