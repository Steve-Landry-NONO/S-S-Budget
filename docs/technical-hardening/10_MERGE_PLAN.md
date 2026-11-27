# 10 — Plan de consolidation (LOT T10)

**Aucune fusion n'a été réalisée.** Fusionnabilité évaluée par simulation dans un clone jetable (`git merge --no-ff`, git 2.34 n'ayant pas `merge-tree --write-tree`) ; compatibilité fonctionnelle évaluée par les tests et la CI.

## 1. Simulation de fusion (24/11/2026)

| Fusion simulée | Résultat |
|---|---|
| PR #3 `b03af49` → `main` `8e7f6f6` | propre |
| PR #14 `376c719` → PR #3 | propre (avance rapide possible) |
| PR #15 (durcissement) → `feat/v3-sprint2-dashboard` | propre (avance rapide possible) |
| Pile complète (durcissement) → `main` | propre |
| PR #4 → PR #3 ou → Sprint 2 | propre |
| **PR #4 → Sprint 2 + durcissement** | **conflit** `app.config.js`, `eas.json`, `scripts/check-android-preview.js` (ajouts concurrents ; PR #4 remplacée) |
| Branches PR #6, #7, #8, #9, #11, #12 → pile durcissement | propres ; elles n'ajoutent que leurs propres workflows `v3-*.yml` et des fichiers hors `App.js`/`src/`/`server/`/`package*.json` |

## 2. Fiches par PR

### PR #3 — Sprint 1 (`feature/duo-budget-v3-glance-first-screen` → `main`)

| Rubrique | Contenu |
|---|---|
| SHA vérifié | `b03af49000a57f3d628339614e70c6848e53c7f6` |
| Dépendances | aucune en amont ; `main` a 3 commits de docs en plus (fusion propre) |
| CI | verte (45452731604, 45452748037 : static checks, navigation) |
| Risques | minimatch modéré (non exploitable) et chaîne sqlite3 non corrigés **sur cette branche** ; défaut de concurrence serveur présent (préexistant V2) |
| Tests réalisés | recette iPhone Sprint 1 (propriétaire), CI ; tous les tests ajoutés ici passent sur la pile qui la contient |
| Tests manquants | Android ; tests serveur sur cette base seule |
| Conditions | validation propriétaire ; accepter que les correctifs arrivent via la pile Sprint 2 (ou cherry-pick `b0bae5d`, `d3d766f`, `c80cd8f` vers PR #3 si `main` doit être corrigé immédiatement) |
| Retour arrière | `git revert -m 1 <merge>` sur `main` |
| **Recommandation** | **GO conditionnel** — fusion avec commit de fusion (`--no-ff`) après décision propriétaire |

### PR #15 — Durcissement (`fix/v3-technical-hardening` → `feat/v3-sprint2-dashboard`)

| Rubrique | Contenu |
|---|---|
| SHA | voir `11_HANDOVER_CHATGPT.md` (tête de branche) |
| Dépendances | PR #14 |
| CI | ✅ 6/6 (45472502146) |
| Risques | (1) **déploiement serveur** : sqlite3 6.0.1 exige glibc ≥ 2.38 ou compilation (procédure 03 §8) ; (2) `5746c73` modifie un composant recetté sur iPhone (style seul) ; (3) trafic clair Preview (D-04) |
| Tests réalisés | 37 + 22 tests, 13 + 32 + 16 assertions, matrice 40/40, prebuild Android, audits 0/0, gitleaks 0 |
| Tests manquants | recheck natif « Votre duo » ; serveur réel non touché ; APK non produite |
| Conditions | revue indépendante ; décisions D-01…D-04 notées ; propriétaire informé que `server/` ne doit être réinstallé qu'en suivant 03 §8 |
| Retour arrière | commits atomiques : `git revert <sha>` individuel ; serveur : revert `c80cd8f` + `npm ci` (base compatible) |
| **Recommandation** | **GO conditionnel** |

### PR #14 — Sprint 2 (`feat/v3-sprint2-dashboard` → PR #3)

| Rubrique | Contenu |
|---|---|
| SHA vérifié | `376c7190dd76cdad5351336515662277114ba0b3` (+ PR #15 si fusionnée avant) |
| Dépendances | PR #3 (base) ; idéalement PR #15 |
| CI | verte (45461389533, 45461431485) |
| Risques | sans PR #15 : réserve QA Lab non levée, audits non corrigés |
| Tests réalisés | iPhone V5 10/10 (déclaré), QA Lab 5/5 soldes (vidéo propriétaire), + tout PR #15 |
| Tests manquants | Android ; recheck natif cartes membres ; comparaison Figma finale |
| Conditions | PR #15 fusionnée dedans ; PR #3 fusionnée dans `main` ; **re-cibler PR #14 vers `main`** (sinon elle ne ferait que rejoindre la branche Glance) |
| Retour arrière | `git revert -m 1 <merge>` sur `main` |
| **Recommandation** | **GO conditionnel** après PR #15 et PR #3 |

### PR #4 — Android Preview (`feature/android-preview-eas-v1` → PR #3)

| Rubrique | Contenu |
|---|---|
| SHA vérifié | `590adfec05010a8ecbcf832ea244fd929a74cd7c` |
| Dépendances | base ancienne `3ab10a1` (avant SDK 58) |
| CI | verte mais sur l'ancienne base (45360201391) |
| Risques | APK incapable de joindre le serveur HTTP (cleartext), `allowBackup`, permissions inutiles ; `app.json` de branche pré-SDK 58 |
| Contenu repris | `app.config.js`, `eas.json`, `check-android-preview.js` (`176cf87`), guide (`a01effc`) — à l'identique, puis durcis (`283480d`) |
| Non repris | modifications de `README.md`, `docs/ROADMAP…` et du workflow `duo-budget-ci.yml` de la PR (roadmap déjà consolidée sur `main`) |
| **Recommandation** | **NO GO en l'état** — fermer comme « remplacée par PR #15 » après fusion de celle-ci (ou la rebaser, sans force-push, dans une nouvelle branche) |

## 3. Ordre de fusion proposé

1. Revue indépendante de **PR #15** → fusion dans `feat/v3-sprint2-dashboard`.
2. Recheck natif rapide iPhone (cartes « Votre duo », 165 €) sur la tête Sprint 2.
3. **PR #3** → `main` (`--no-ff`). Clôture Sprint 1.
4. Re-cibler **PR #14** vers `main`, CI verte, → `main` (`--no-ff`). Clôture Sprint 2 (hors Android).
5. Fermer **PR #4** (remplacée). Lancer le premier build EAS Preview depuis `main` quand le propriétaire le décide (07 §6).
6. Démarrer Sprint 3 depuis `main`.

## 4. Stratégie de retour arrière

- Toutes les fusions en `--no-ff` → un `git revert -m 1` par étape, sans réécriture d'historique (aucun force-push).
- Dépendances : `package-lock.json` et `server/package-lock.json` versionnés → `npm ci` restaure l'état exact.
- Serveur réel : sauvegarde hors ligne de la base **avant** toute réinstallation ; base compatible 5.1.7 ↔ 6.0.1 (testé).

## 5. Conséquences sur les autres branches ouvertes (non modifiées)

| PR / branche | Base | Effet de la consolidation |
|---|---|---|
| #6 `design/cloud-multi-duo-architecture` | `chore/expo-sdk58-iphone-validation` | Documentation ; aucune collision |
| #7 `feat/v3-financial-core-foundation` | #6 | Ajoute `v3-financial-core.yml` ; aucune collision ; son moteur financier V3 est distinct de `dashboardModel` → **prévoir un test de parité** V3 ↔ `dashboardModel` (l'oracle `v2-reference-aggregation.cjs` est réutilisable) |
| #8 `feat/v3-cloud-data-foundation`, #9 `feat/v3-ledger-rls-tests` | #7 / #8 | Workflows propres ; Supabase/RLS **non touchés** |
| #11 `test/v3-finance-edge-cases` | #7 | idem |
| #12 `feat/v3-ledger-schema-dev` → `main` | `main` | Fusion propre avec la pile ; ses workflows `v3-finance-*.yml` s'ajouteront à `technical-hardening.yml` sans conflit |

Ces branches restent à qualifier par leurs propres pipelines ; une fusion textuellement propre ne vaut pas compatibilité.
