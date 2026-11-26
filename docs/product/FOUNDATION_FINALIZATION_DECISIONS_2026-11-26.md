# Duo Budget V3 — Foundation Finalization : arbitrages approuvés
26 novembre 2026. Validation explicite des 16 arbitrages par le propriétaire. Autorisation de préparer les PR uniquement. Aucune migration DEV ou production sans validation distincte.
Références : PR #17, #18, #19 ; archive Foundation Finalization du 26/11 SHA-256 96a03aada2ea89c24158155024b52dd862234b5b3b9c4b60a7017cc18a6431cb, documents 08 et 10.
| ID | Décision approuvée |
|---|---|
| R-A1 | Préparer PR 006 révisée F1–F7 ; application DEV seulement après revue indépendante, vérification état DEV et autorisation explicite séparée. |
| R-A2 | Garder plafond 120 cycles par écriture ; prévoir récupération administrative ultérieure. |
| R-A3 | Horodater/ordonner les écritures sous verrou transactionnel, en cohérence avec les frontières des épisodes d'appartenance. |
| R-B0 | Adopter M2 : trois livres trésorerie, planification budgétaire, fonds réels. |
| R-B1 | Balayer reliquats réels positifs des enveloppes sans report vers fonds réels non affectés à la clôture ; préserver déficits ; distinguer réserve réelle et budgétaire. |
| R-B2 | Modéliser dépenses et affectations prévues dans un lot distinct ; prévisionnel indisponible tant que non modélisé, jamais zéro fictif. |
| R-B3 | Répartition globale par défaut et exceptions par enveloppe (CF-02), accord mutuel ; liberté des versements réels. |
| R-B4 | Migration V2 par soldes d'ouverture par enveloppe, archive du détail, rapprochement, sauvegarde et simulation avant données réelles. |
| R-B5 | Annulation de contribution affectée refusée tant que fonds correspondants non libérés ; parcours guidé de désaffectation. |
| R-B6 | Double accord pour lever la protection commune ; propriétaire seul pour protection personnelle. |
| R-C1 | Informer les deux partenaires de la visibilité des soldes communs actuels après retour et de l'absence de détail des opérations intermédiaires. |
| R-C2 | Déclencheur immédiat et réconciliation horaire si compatible ressources ; aucune autorisation active pour compte supprimé. |
| R-C3 | Pas de réouverture automatique de duo archivé en MVP ; nouveau duo, droits archivés définis. |
| R-C4 | Reporter le financement personnel par le commun ; aucune mutation inter-périmètres sans règles de consentement, visibilité et comptabilité. |
| R-C5 | Autoriser can_read_at uniquement après audit de ses paramètres, privilèges et risques d'oracle ; nouveau test distinct, X18 historique conservé. |
| R-D1 | Contrat mobile v3 candidat de référence sur fixtures, versionnement et revue des mappers avant connexion réelle. |
## Ordre de consolidation
1. Restaurer les bundles historiques lots 1/2 avec leurs SHA, vérifier ancestry et contenu, publier sur branches isolées après audit. Ne jamais publier deux migrations 006 actives. Vérifier secrets et données réelles, mécanismes CI/déploiement, noms de migration CF-12 et historique DEV 005. Ne pas modifier les fichiers historiques ni falsifier attribution.
2. Préparer PR candidate 006r1 basée sur fondation vérifiée ; original archivé hors répertoire actif, rollback hors chemin automatique. Joindre tests et résultats, versions CF-06 distinctes, traiter R-A3 si absent (sans confondre correction candidate et preuve déjà obtenue). Vérifier privilèges, concurrence, déploiement transactionnel et intégration Supabase réelle avant demande d'autorisation DEV. Aucun merge automatique.
3. PR M2 séparée : R-B1, R-B5, R-B6, invariant trésorerie = fonds non affectés + fonds affectés signés, aucun double compte ; R-B2 lot distinct. Tests de clôture, protection, concurrence, annulation, confidentialité et migration synthétique.
4. PR lot 3 : R-C1 à R-C5, frontières temporelles sous verrou, sécurité Auth réelle à qualifier séparément ; aucun compte réel.
5. Contrat mobile v3 : revue puis intégration sur mocks isolés. Ne jamais substituer budgetBalance à realAvailable ; Capability explicite pour indisponibilité. Aligner Figma page 14 et fixtures, pas de promotion baseline.
6. Qualité mobile : adapter scripts Maestro de Gemini aux vrais testID et fixtures, assertions soldes et confidentialité, mesurer sur builds autonomes ; aucun test natif revendiqué.
## Portes
006 originale NO GO. 006r1 GO préparation PR et revue uniquement. M2 et lot 3 prototypes à transformer en candidats. Pas de migration DEV/prod, pas de fusion ni déploiement implicite, pas de service payant, pas de données réelles. Préserver PR #3/#14/#15 et Figma V3.0.7. Les détails techniques et critères ci-dessus sont des conditions de revue, pas des tests exécutés. Les arbitrages R-B1/R-B2/R-B6 et R-A3 exigent des écarts explicites par rapport aux prototypes livrés. Ne pas confondre approbation produit et qualification technique.
