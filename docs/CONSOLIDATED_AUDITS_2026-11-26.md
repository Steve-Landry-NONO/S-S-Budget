# Consolidation des trois audits — 26 novembre 2026
Statut : proposition de pilotage à valider. Sources : Claude backend closure audit (archive SHA256 44aedd72b6a4eb4e0188fea392e4cfd9f6382390015081360e4c52f7de0a45e9 ; 34 entrées du manifeste vérifiées, CRC OK), Gemini Product & QA Readiness (8 documents, aucun test natif exécuté), revue statique ChatGPT [REV-01–08](INDEPENDENT_REVIEW_23_26_2026-11-26.md). Les tests SQL et lectures DEV sont rapportés par Claude, non rejoués par ChatGPT.
## Preuves
Claude : 001–005 DEV concordantes (005 sans commentaires), DEV vide au contrôle 15h55 ; 006r1 72/72 et 38/38, 94 réussites + 4 constats + 1 sans objet + 2 échecs historiques ; rollback sur réplique OK ; lot3 10/10, 20/20 et 22/22 sur M2 ; M2 30/30 ; contrat 35/35 ; financeService 4/4 mais obsolète. Ne pas additionner suites recouvrantes. CI #26 verte précédemment vérifiée. Exceptions C01/C07a/X18 et fixtures F3/CF05 documentées. Aucune autorisation DEV.
## Préservation historique
Sources #6 et #8 récupérées dans docs/legacy ; registre 20 décisions dans docs/product/DECISION_REGISTER_RECOVERED_2026-11-26.md. CF-01 mapping contextuel, D-021–029 à retrouver, états historiques non actuels. #12 absorbée par #23 (ascendance et blobs selon audit Claude), jamais fusionner seule (versions CLI dupliquées). #6/#7/#8/#9/#11 non ancêtres ; fermeture proposée #9,#11,#8,#7,#6 après validation couverture et fusion des documents, branches conservées. #4 après remplacement Android vérifié. Ne pas supprimer de bases.
## Matrice des corrections
| Lot | IDs | Critère de passage |
|---|---|---|
| Fondation et procédure | REV-01, REV-08, G13, R-03 | Transport exact des entiers en chaînes, tests limites et JSON ; essai à blanc réellement annulable ; harnais E2E obsolète désactivé avant fusion #23, service historique non utilisable ; CI SQL jetable à préparer |
| Contrat lecture/mock | REV-02–07, G8,G9,G10,G14 | Idempotence par auteur, isolation cache/session/période, invariants et validation runtime, prévisions partielles explicites, protection en attente, absence vs zéro, résolution du scope ; régénérer fixtures après correction |
| Gestion applicative | G1–G5,G7,G11,G12 | RPC autorisées pour duo/enveloppes/allocations, activation fonds contrôlée, libellés, journal et statut, aperçu invitation, commandes M2, Auth/sessions/suppression, synchronisation ; ne pas exposer fonctions privées directement |
| Transferts et correction | G2,G6 | Séparer réaffectation budget et déplacement fonds ; D-030 correction append-only contre-passation + nouvelle écriture candidate à valider, version logique, audit, concurrence, idempotence |
| Prévisions | R-B2, REV-05/07 | Lot distinct ; prévision complète non disponible avant modèle ; attentes ≠ cash |
| Recovery | R-02,R-07 | Récupération exercée sur copie DEV avant application ; procédures #24/#25, qualification Auth HTTP réelle et réconciliation horaire avant Alpha ; migration V2 réelle séparée, backup et rapprochement |
## Corrections QA Gemini
- FUNC01/02 et NAV03 Auth réelle/invitation au S5/porte Alpha, pas blocage de clôture S1/S2 sur mock ; parcours de navigation et état local au périmètre actuel.
- PROT01/02/FUNC08/AC03 : protection commune visible aux deux membres actifs ; double accord pour lever, personnel privé et propriétaire seul ; notifications discrètes. Pas de masquage d'une enveloppe commune protégée.
- DASH02 : trésorerie = fonds non affectés + somme affectée signée, même scope/période/version ; ne pas comparer budget à cash.
- ENV03/DISP01 : contribution et affectation distinctes ; cas cible500, affecté300, dépense42,50 => disponible257,50, budget restant457,50, objectif non financé200 ; sans report/mouvement interne. Annulation conserve historique, restauration exactement une fois.
- PREV01/02 : R-B2 absent ; état indisponible explicite ; simulation identifiée. Prévision partielle non complète.
- Maestro 06 Verify/Confirm, 07 statut annulé et restauration, 08 résultat inconnu et lookup avant retry, 10 cache compte/épisode/période ; fixtures réinitialisables et testIDs réels ; objectif zéro sans division ; montants longs, signes, 360/390/430 ×100/135/200 (90 combinaisons pour 10 écrans), lecteur d'écran, contrastes et réduction motion. Aucun E2E natif exécuté par Gemini. Ne pas réduire automatiquement la police.
- AC01 #26 n'est pas une migration ; qualification séquentielle des migrations #23–25, gestion et Auth réelle ; builds autonomes et recette avant externe ; pas de paywall. Hypothèses freemium, abonnement duo, essai 14–30j, exclusivités, prix géographiques conservées dans chantier Growth, non validées.
## Séquence proposée
1. PR #27 : documents récupérés, revue, consolidation ; validation propriétaire puis fusion documentaire seule après contrôle diff. #22 commerciale indépendante à consolider comme candidat.
2. En parallèle : branche d'intégration mobile depuis main avec pile #3/#14/#15, préserver README/roadmap, pas de déploiement intermédiaire ; CI et recette native. Figma page14 finitions et accessibilité ; Sprint3 sur mock seulement.
3. Claude : correctifs fondation/contrat, tests sur réplique, désactiver harnais obsolète avant fusion #23 ; préparer lot gestion et recovery sans appliquer DEV. Revue indépendante des résultats.
4. #26 corrigée : revue sémantique et CI, fusion documentaire/code contrat distincte après accord.
5. #23 retarget main, vrai merge commit (pas squash/rebase), hash exact à autoriser ; DEV vide vérifié à nouveau, backup, qualification, application autorisée puis fusion dans même fenêtre contrôlée, liste migrations alignée. Suspendre déploiements et commandes db push concurrentes ; historique 006 originale reste interdit même après merge. #12 fermer après fusion.
6. #24 puis #25 retarget main et fenêtres DEV distinctes, recovery éprouvé ; aucun utilisateur réel dans état intermédiaire, pas de connexion app avant gestion, Auth, isolation et contrat corrigé.
7. Gestion + opérations prévues, raccordement cloud et QA native, Alpha interne puis porte externe. Calendrier et score 48,96% officiel inchangés jusqu'à validation des nouvelles preuves et critères ; aucune estimation d'intégration inventée.
## Arbitrages à valider
Archivage anciennes PR sans supprimer branches ; merge commit séquentiel ; désactivation harnais obsolète ; lot gestion prioritaire avant connexion ; correction D-030 append-only candidate ; recovery testé avant DEV, rollback ou restauration démontrée avant production ; aucune autorisation DEV implicite. Ne pas modifier baseline Figma ni créer service payant.
