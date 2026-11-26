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

## État des preuves et portes — actualisé après les trois audits
- Main reste V2 historique ; aucune V3 disponible. #21 fusionnée, #16–20 closes. #23–26 publiées aux SHA originaux vérifiés ; #26 CI verte. #27 consolide les documents et les décisions.
- #15 CI verte au SHA cb31618 (six catégories) ; recette native complémentaire et L2 restent ouverts. Intégration S1/S2 unique proposée et approuvée, sans exposer de version intermédiaire.
- Claude rapporte un rejeu depuis les SHA publiés : 006r1 72/72 et 38/38, rollback sur réplique OK ; lot3 10/10, 20/20 et 22/22 ; M2 30/30 ; contrat 35/35. Exceptions historiques conservées. DEV 001–005 concordantes et vide selon lecture Claude du 26/11 ; à revérifier avant autorisation. Aucune migration autorisée.
- REV-01–08 et G1–14 : transport exact, mock/idempotence, cache, invariants, capacités, procédure DEV et fonctions de gestion manquantes. #23 NO GO DEV en l'état ; #26 fixtures uniquement. Harnais Auth E2E historique obsolète à neutraliser avant #23.
- Figma page 14 : dix écrans et 16 liens rapportés ; finitions et recette responsive/accessible restantes. Baseline V3.0.7 gelée.
- Gemini : huit documents de qualification, dix scénarios Maestro à adapter ; aucun test natif exécuté. Recette corrigée : protection commune visible aux deux partenaires, confidentialité personnelle, contributions distinctes des affectations, annulation tracée, prévision indisponible.
- Dates historiques inchangées ; S1 non clôturé ; score 48,96 % conservé jusqu'à réévaluation documentée. Aucun couple externe autorisé.
- Voir [consolidation des audits](CONSOLIDATED_AUDITS_2026-11-26.md) et [arbitrages validés](CONSOLIDATION_DECISIONS_2026-11-26.md).

## Registre et priorité en cas de contradiction
Les textes originaux des PR #16–#20 sont conservés. Les décisions explicites les plus récentes (Foundation Finalization, #20) complètent et, sur leur périmètre précis, remplacent les restrictions ou options historiques contradictoires : préparation/publication de PR backend après audit autorisée ; aucune migration ni fusion majeure autorisée ; M2 à trois livres adopté ; contrat mobile candidat. La roadmap ancienne décrit des états datés, non l'état actuel. Les exemples de prévisionnel du Sprint 3 sont fictifs ; ne pas substituer budgetBalance à realAvailable. Les décisions non couvertes (L2, ONB, réconciliation D-021–029) ne sont pas réputées validées. Voir les documents product et demander un arbitrage en cas de contradiction non résolue.

## Prochain jalon Alpha Cloud
1. Intégration documentaire, préservation des sources historiques, puis archivage des PR obsolètes après vérification de couverture.
2. En parallèle : branche mobile S1/S2 unique depuis main, CI, recette native ; finaliser Figma et Sprint 3 sur fixtures.
3. Corriger REV-01–08 et écarts G1–14, harnais obsolète et recovery ; revue indépendante ; contrat #26 avant connexion.
4. #23 reciblée main, merge commit et fenêtre DEV distinctement autorisée ; #12 jamais fusionnée seule. #24 puis #25 dans leurs fenêtres respectives. Aucune migration implicite.
5. Gestion G-A à G-E, Auth, isolation, prévisions R-B2, intégration mobile-cloud et recette autonome avant Alpha externe.

## Mise à jour quotidienne
Rapport : livré / preuve SHA et test / en cours / bloqué / décisions / prochain livrable. Séparer preuves GitHub, rapports externes, tests locaux et tests réels. Ne pas augmenter un score uniquement parce qu'une PR est ouverte. Réviser la pondération uniquement en expliquant la rupture de comparabilité. Objectif interne indicatif suivant : 60 %, non prévision garantie.
