# Duo Budget — Consolidation & Integration Gate
26 novembre 2026. Snapshot sur main 8dfe83d2cc4e76b625be42261e8e08c5b885657c. Ce document propose une coordination, pas une autorisation de fusion, migration ou déploiement.
## Référence et preuves
- PR #21 fusionnée à 8dfe83d ; #16–20 fermées après comparaison des blobs. Le README V2 reste archivé.
- Publication native par le propriétaire : six branches aux SHA originaux vérifiés à distance, quatre PR #23–26 en brouillon. Historiques af15af0684410fbdffd89e4e26124d4682f2db36 et 6de82b35ffe1b87096733db371ea24d1905cb516. La seconde contient la 006 originale NO GO et ne doit pas servir de base de travail ni être déployée.
- CI #26 contract-tests success au SHA b647f72 ; aucun check SQL observé lors de la vérification précédente. Rapports Claude : 006r1 72/72 et 38/38 ×3, rollback qualifié sur réplique ; Lot3 10/10 et 20/20 (22/22 sur M2), M2 30/30, contrat 35/35 et tsc strict. Pas de rejeu SQL indépendant dans ce chantier. Exceptions historiques C01/C07a/X18 et fixtures F3/CF05 restent visibles.
- DEV 001–005 déclaré par Claude ; non revérifié ici. Aucun droit d'application 006r1 accordé. Pas de rollback scripté lot3/M2 ; Auth HTTP réelle non qualifiée ; R-B2 séparé. Revue des droits, invariants, concurrence, recovery et mappers nécessaire.
- Figma page 14 (366:62) : 10 écrans, 16 interactions rapportées lors des passes précédentes, six jauges individuelles configurées ; recette visuelle complète, grande police 135/200 %, écrans 360/390/430, finitions et illustrations restent ouverts. Baseline V3.0.7 inchangée selon les interventions précédentes.
- Gemini : dix scénarios Maestro candidats, aucun E2E natif revendiqué ; étude commerciale candidate #22, prix et limites non approuvés.
- Publication : Vercel aucun projet associé dans l'espace autorisé ; deux apps GitHub visibles (Codex et Vercel), hooks classiques vides selon terminal du propriétaire. Ne pas extrapoler à tous les espaces externes. Aucun nouveau contrôle DEV ni déploiement effectué ici.
## Inventaire GitHub observé avant création de cette PR
| PR | Head | Base | SHA | Action proposée |
|---|---|---|---|---|
| #26 | feat/v3-mobile-contract-v3 | main | b647f72 | Revue contrat et fixtures |
| #25 | feat/v3-funds-ledger | feat/v3-lot3-membership-lifecycle | df41563 | Revue SQL / dépendances ; aucune fusion |
| #24 | feat/v3-lot3-membership-lifecycle | feat/v3-006r1-financial-foundation | 7dcbaa2 | Revue SQL / dépendances ; aucune fusion |
| #23 | feat/v3-006r1-financial-foundation | feat/v3-ledger-schema-dev | 90e2274 | Revue SQL / dépendances ; aucune fusion |
| #22 | docs/v3-market-strategy-candidate | main | d9464de | Revue documentaire commerciale |
| #15 | fix/v3-technical-hardening | feat/v3-sprint2-dashboard | cb31618 | Recette et intégration mobile contrôlée |
| #14 | feat/v3-sprint2-dashboard | feature/duo-budget-v3-glance-first-screen | 376c719 | Recette et intégration mobile contrôlée |
| #12 | feat/v3-ledger-schema-dev | main | 4d41286 | Revue SQL / dépendances ; aucune fusion |
| #11 | test/v3-finance-edge-cases | feat/v3-financial-core-foundation | 22aee4a | Comparer les diffs et préserver les acquis |
| #9 | feat/v3-ledger-rls-tests | feat/v3-cloud-data-foundation | 013c122 | Comparer les diffs et préserver les acquis |
| #8 | feat/v3-cloud-data-foundation | feat/v3-financial-core-foundation | 2e28a43 | Comparer les diffs et préserver les acquis |
| #7 | feat/v3-financial-core-foundation | design/cloud-multi-duo-architecture | f3e71d3 | Comparer les diffs et préserver les acquis |
| #6 | design/cloud-multi-duo-architecture | chore/expo-sdk58-iphone-validation | c87f4ad | Comparer les diffs et préserver les acquis |
| #4 | feature/android-preview-eas-v1 | feature/duo-budget-v3-glance-first-screen | 590adfe | Conserver jusqu'au remplacement Android |
| #3 | feature/duo-budget-v3-glance-first-screen | main | b03af49 | Recette et intégration mobile contrôlée |
## Chemin critique
A — Mobile S1/S2 : vérifier #15, décisions L2, tests natifs et protection des déploiements, puis plan #15 vers #14, #3, retarget #14 vers main, sans état intermédiaire dangereux. Aucun merge automatique.
B — Cloud : revue indépendante #12/#23 (sécurité, rollback, migrations 001–005, fingerprint idempotence, verrous, devise, ordonnancement). Demande DEV distincte pour le fichier exact 006r1 ; qualification réelle après autorisation. Puis #24, #25 séquentiellement, avec recovery et réconciliation. Aucun accès aux données réelles.
C — Contrat #26 : revue des types/mappers/fixtures et incompatibilités, CI verte ≠ validation sémantique. Sprint3 sur mock après revue, jamais budgetBalance en remplacement de realAvailable ; prévision non disponible hors fixtures de démonstration. Pas de connexion cloud.
D — Figma : corriger chevauchements, états, navigation, grande police, recette responsive ; ne pas promouvoir baseline. Adapter Maestro aux vrais testID et scénarios ; qualifier appareils natifs.
E — Commercial : #22 candidat ; gratuit/premium/essai et marketing à explorer après stabilité, pas de paywall actuel. Vérifier marque et prix.
## Missions
Claude : audit en lecture seule des PR #6/7/8/9/11/12/23/24/25/26, mapping des fonctionnalités et commits conservés/perdus, plan de qualification et recovery, exceptions historiques et risques. Aucune nouvelle publication des six branches, aucune fusion ou migration. Remettre une matrice avec SHA et preuves.
Gemini : revue QA et critères de sortie S1–S3, scénarios, accessibilité, confidentialité et tests de non-régression, données fictives uniquement ; marquer non exécuté. Pas de besoin d'accès direct aux services ; utiliser le dossier de référence transmis.
ChatGPT : revue indépendante #23/#26, intégration mobile S1/S2 et Figma, arbitrages, tenue de la documentation et préparation de la prochaine décision utilisateur.
## Maturité et dates
Conserver 48,96 % du référentiel officiel jusqu'à réévaluation documentée des critères. S1 non clôturé ; S2 démarre le 26/11 selon calendrier historique. Ne pas déplacer officiellement les dates sans arbitrage. Alpha Cloud avant toute bêta externe. Distinguer maturité, tests, intégration et disponibilité.
## Clôture du jalon
Inventaire des PR exhaustif, matrice de couverture, décisions et risques ouverts identifiés, plan de fusion vérifié, critères de recette et preuves, validation explicite du propriétaire pour actions sensibles. Pas d'augmentation automatique de score.
