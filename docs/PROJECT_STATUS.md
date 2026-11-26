# Duo Budget — État et pilotage du projet
Snapshot 26 novembre 2026. Source distante main au début de l'audit : 8e7f6f66d4094bb0dc88b865042eb9c8c2ae3e40. Les travaux externes sont rapportés, pas indépendamment rejoués ici.

## Méthode
Maturité = somme des poids × scores / 100. Poids total 100. Scores estimés par jugement de maturité, non par volume de code ni par tests passés. Les critères de sortie de sprint de la roadmap demeurent obligatoires. Un score de 100 ne remplace pas une recette ou une clôture formelle. Revoir chaque semaine à preuves comparables ; noter les changements de périmètre et garder l'historique. Ne pas inventer un taux d'intégration : le mesurer après inventaire des critères effectivement présents sur main. La baisse par rapport à l'ancienne estimation informelle de 53 % correspond à un recalage du périmètre, pas une régression démontrée.

| Sprint | Poids | Maturité estimée | Contribution | Justification / prochain contrôle |
|---|---:|---:|---:|---|
| S0 Fondations | 8 | 100 | 8,00 | Marque et fondations initiales intégrées ; ne valide pas la sécurité V3 |
| S1 Navigation | 10 | 95 | 9,50 | #3/#15 candidats ; recette native et intégration restantes, échéance 25/11 dépassée |
| S2 Dashboard | 12 | 90 | 10,80 | #14/#15 candidats ; vérification native et fusion restantes |
| S3 Enveloppes | 15 | 35 | 5,25 | Figma page 14, contrat mobile candidat ; implémentation RN non intégrée |
| S4 Opérations | 15 | 30 | 4,50 | prototypes financiers, règles ; migration et UI restantes |
| S5 Duo & auth | 15 | 35 | 5,25 | onboarding Figma et prototype lot 3 ; Auth réelle et intégration non qualifiées |
| S6 Motion & accessibilité | 8 | 45 | 3,60 | explorations Figma, matrice QA ; recette native restante |
| S7 Bêta privée | 10 | 15 | 1,50 | protocoles préparés ; aucun couple externe autorisé |
| S8+ Bêta publique | 7 | 8 | 0,56 | préparation distribution ; aucune publication |
| Total | 100 | | 48,96 | ~49 % de maturité, non disponibilité |

## État des preuves et portes
- main : V2 historique, marque et fondations initiales ; ne pas présenter V3 comme disponible. Pas de pourcentage intégré vérifié.
- PR #3, #4, #6–#9, #11, #12, #14–#20 ouvertes et brouillons à l'instant de l'audit (14). #16–#20 documents repris dans la PR de consolidation ; ne pas fermer avant comparaison et intégration vérifiée.
- #15 hardening : CI historique verte rapportée au SHA cb31618 ; recette native complémentaire et décisions L2 non clôturées. #4 ne fermer qu'après remplacement effectif.
- Claude, archive Foundation Finalization 26/11 : 006 originale NO GO ; 006r1 F1–F7 candidate, 72/72 historiques et 34/34 approfondis rapportés, rollback qualifié sur réplique ; exceptions C01/C07a et fixture historique USD documentées. M2 27/27, lot 3 20/20 + 22/22, contrat 33/33 rapportés. Pas de nouvelle exécution indépendante ici.
- DEV 001–005 selon rapport Claude, non revérifié dans ce chantier. Aucune migration autorisée. R-A1 = préparation PR et revue, non autorisation d'application.
- Figma page 14 : dix écrans créés, 16 liens configurés ; finitions, grande police et recette exhaustive restantes. V3.0.7 gelée. Ne pas assimiler prototype à implémentation.
- Gemini : dossier QA et dix scénarios Maestro candidats ; identifiants provisoires, aucun test E2E exécuté, tarifs et exigences stores non vérifiés ici.
- Dates roadmap inchangées. S1 non clôturé ; S2 commence le 26/11. Porte cloud avant tout couple externe ; recalage officiel restant à valider.
- Prévisionnel non disponible tant que dépenses prévues non modélisées. Les fixtures UX illustratives ne prouvent pas une capacité backend.

## Registre et priorité en cas de contradiction
Les textes originaux des PR #16–#20 sont conservés. Les décisions explicites les plus récentes (Foundation Finalization, #20) complètent et, sur leur périmètre précis, remplacent les restrictions ou options historiques contradictoires : préparation/publication de PR backend après audit autorisée ; aucune migration ni fusion majeure autorisée ; M2 à trois livres adopté ; contrat mobile candidat. La roadmap ancienne décrit des états datés, non l'état actuel. Les exemples de prévisionnel du Sprint 3 sont fictifs ; ne pas substituer budgetBalance à realAvailable. Les décisions non couvertes (L2, ONB, réconciliation D-021–029) ne sont pas réputées validées. Voir les documents product et demander un arbitrage en cas de contradiction non résolue.

## Prochain jalon Alpha Cloud
1. Revue et intégration maîtrisée #15/#14/#3, après recette et vérification protections.
2. Restauration historique lots backend, PR 006r1, revue indépendante ; demander autorisation distincte DEV.
3. M2 et membres en PR séparées ; qualification Auth et isolation réelle.
4. Sprint 3 mobile sur fixtures, puis raccordement cloud ; prévisions lot distinct.
5. Adaptation Maestro, builds autonomes et recette iOS/Android ; aucune publication implicite.

## Mise à jour quotidienne
Rapport : livré / preuve SHA et test / en cours / bloqué / décisions / prochain livrable. Séparer preuves GitHub, rapports externes, tests locaux et tests réels. Ne pas augmenter un score uniquement parce qu'une PR est ouverte. Réviser la pondération uniquement en expliquant la rupture de comparabilité. Objectif interne indicatif suivant : 60 %, non prévision garantie.
