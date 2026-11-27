<p align="center"><img src="brand/svg/duo-app-icon.svg" alt="Logo officiel Duo Budget" width="100"></p>

<h1 align="center">Duo Budget</h1>
<p align="center"><strong>Deux personnes. Des projets communs. Une vision claire de leur argent.</strong></p>
<p align="center">Application mobile de gestion budgétaire à deux · iOS & Android · V3 en développement</p>

## État du projet — 27 novembre 2026

**Maturité globale estimée : 53,81 % (~54 %).** Indicateur de pilotage pondéré, non pourcentage de code livré ni taux de disponibilité. Voir [méthode, preuves et limites](docs/PROJECT_STATUS.md).

| Version / environnement | Situation |
|---|---|
| V2 historique sur main | Application Expo/React Native, API Express et SQLite auto-hébergées ; documentation historique V2.2.3 |
| V3 mobile | Candidat consolidé #28, CI 9/9 ; recette native et intégration restantes |
| V3 cloud | Supabase/PostgreSQL ; migrations 001–005 déclarées appliquées sur DEV selon rapport ; PR #23–26 R3 publiées et CI vertes ; qualification locale rapportée, NO GO DEV |
| Alpha Cloud | Prochain jalon, non disponible |
| Bêta / stores | Non ouverts |

## Vision

Aider deux partenaires à comprendre, organiser et anticiper leurs finances communes et personnelles. Duo Budget ne fournit ni compte bancaire, ni service de paiement, ni connexion bancaire dans le périmètre actuel.

### Fonctionnalités cibles V3 (non toutes implémentées)

- Dashboard : argent réellement disponible, budget, prévisions et synchronisation.
- Enveloppes communes et personnelles, réserve, objectifs, protections et reports.
- Dépenses, versements, opérations futures, historique et annulations réversibles.
- Comptes individuels, invitations, répartition globale ou par enveloppe, confidentialité.
- Accessibilité, grande police, réduction des animations et expérience Premium Duo.

## Architecture cible

```text
iOS / Android (React Native + Expo)
          |
   Contrat DuoBackend V3
          |
Couche de gestion applicative (G-A à G-E, à développer)
          |
Supabase Auth + PostgreSQL (RLS, transactions)
          |
Trésorerie | Planification budgétaire | Fonds réels
```

Les trois livres représentent des dimensions distinctes : une allocation budgétaire ne crée pas d'argent. Le disponible réel ne doit jamais être remplacé par un solde budgétaire. Les prévisions non modélisées sont explicitement indisponibles.

## Roadmap

| Sprint | Échéance indicative | Maturité estimée |
|---|---|---:|
| 0 — Fondations | 05–11 nov. 2026 | 100 % |
| 1 — Navigation & thème | 12–25 nov. | 95 % |
| 2 — Dashboard | 26 nov.–09 déc. | 95 % |
| 3 — Enveloppes | 10–23 déc. | 40 % |
| 4 — Opérations & activité | 24 déc.–06 janv. 2027 | 45 % |
| 5 — Duo & auth | 07–20 janv. | 40 % |
| 6 — Motion & accessibilité | 21 janv.–03 fév. | 45 % |
| 7 — Bêta privée | 04–17 fév. | 20 % |
| 8+ — Bêta publique | à partir du 18 fév. | 8 % |

Dates de la roadmap historique, non engagements de sortie. Sprint 1 non clôturé : recette et intégration restantes. Aucun couple externe avant qualification cloud, sécurité et distribution. Recalage du calendrier à valider.

## Priorités actuelles

- Revue G1, couverture historique et recette mobile interne fictive ; aucune fusion #28 avant validation.
- Récupération G8 qualifiée localement seulement ; export DEV réel et restauration locale à préparer. G2/G5/G6 remplies, G7/G8 partielles ; NO GO DEV.
- R-02/R-03 bloquants avant diffusion externe ; G8-R4 bloque les migrations contenant des duos existants.
- Sprint 3 : conception sur espace séparé, #28 et Figma V3.0.7 préservées.

## Documentation

- [Clôture du 27 novembre et reprise Ubuntu](docs/CLOSURE_2026-11-27.md)
- [Registre consolidé D1–D7 et R3](docs/CONSOLIDATION_R2_DECISIONS_2026-11-27.md)

- [Consolidation des trois audits](docs/CONSOLIDATED_AUDITS_2026-11-26.md)
- [Arbitrages de consolidation validés](docs/CONSOLIDATION_DECISIONS_2026-11-26.md)
- [Registre historique récupéré](docs/product/DECISION_REGISTER_RECOVERED_2026-11-26.md)

- [État du projet et méthode de mesure](docs/PROJECT_STATUS.md)
- [Roadmap détaillée](docs/ROADMAP_DUO_BUDGET_2026_2027.md)
- [Sprint 3 — Enveloppes](docs/product/SPRINT_3_ENVELOPES_UX.md)
- [Cloud Foundation](docs/product/CLOUD_FOUNDATION_DECISIONS_2026-11-25.md)
- [Arbitrages post-006](docs/product/POST006_DECISIONS_2026-11-26.md)
- [Foundation Finalization — décisions approuvées](docs/product/FOUNDATION_FINALIZATION_DECISIONS_2026-11-26.md)
- [Collaboration et règles de contribution](CONTRIBUTING.md)
- [Identité visuelle](brand/README.md)
- [Figma — fichier de référence](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/)
- [Figma — page 14, exploration Enveloppes](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/?node-id=366-62)

## Installation de la V2 historique

La documentation complète d'installation, API et sauvegarde est conservée dans [README V2](docs/legacy/README_V2.md). Elle décrit le système historique, pas une procédure de déploiement V3 ni une garantie de sécurité actuelle. Ne pas exposer publiquement l'API historique ; utiliser uniquement un réseau privé et des données de test pour la qualification.

## Collaboration

Propriétaire : décisions produit et autorisations sensibles. ChatGPT : pilotage, design et intégration. Claude : ingénierie backend. Gemini : préparation QA et distribution. Les livrables externes ne sont pas considérés comme intégrés avant revue.

Aucune migration DEV ou production sans autorisation distincte. Aucune donnée financière réelle dans les tests ou les archives. Figma V3.0.7 gelée.

Licence historique déclarée : MIT.
