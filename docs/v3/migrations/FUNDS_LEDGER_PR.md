# PR — Troisième livre « fonds réels » (M2, R-B0 à R-B6)

**Statut.**
- Migration candidate, PR en brouillon.
- **Dépendances explicites** : `20261126120000_duo_v3_financial_model_r1` et `20261126130000_duo_v3_membership_lifecycle`. La migration vérifie leur présence et refuse de s'appliquer sinon.
- Fichier : `supabase/migrations/20261126140000_duo_v3_funds_ledger.sql`.
- R-B2 (dépenses et affectations prévues) est **exclu** et renvoyé à un lot distinct.

## Pourquoi après le lot 3

R-B6 distingue protection commune et protection personnelle, ce qui requiert les espaces du lot 3. R-B3 répartit l'attendu entre les membres **actifs**, au sens du lot 3. La dépendance est donc réelle, pas seulement d'ordre.

## Décisions appliquées, avec les écarts explicites par rapport au prototype

| Décision | Mise en œuvre | Écart avec le prototype | Tests |
|---|---|---|---|
| R-B0 | Trois livres (cash, budget, funds). Invariant : trésorerie = non affecté + Σ affecté signé, contrôlé à chaque transaction (contrôle différé SECURITY DEFINER). | — | FB-01, FB-14, FB-21 |
| R-B1 | À la clôture, le reliquat réel positif des enveloppes **sans report** passe aux fonds non affectés (écriture `funds_sweep`, idempotente). Les déficits sont conservés. | Le prototype ne balayait pas | FB-13 |
| R-B3 | Répartition globale par défaut et exceptions par enveloppe, en points de base. Proposition par un membre, acceptation par l'autre. Première répartition sur le cycle courant (CF-10), changements au cycle suivant (D-010). Statut « provisoire » sans accord. Versements libres. | Remplace les « contributions prévues déclarées » | FB-20, FB-20b, FB-20c |
| R-B4 | `post_opening_balance` : solde d'ouverture **par enveloppe**, signé et idempotent. Le planificateur V2 produit le rapprochement (Σ ouvertures = Σ versé − Σ dépensé), l'empreinte de l'archive du détail et l'empreinte de la sauvegarde source. | Remplace le rejeu détaillé | FB-18, FB-19 |
| R-B5 | L'annulation d'une contribution affectée est refusée (indice `release_funds_first`) tant que les fonds ne sont pas libérés. Parcours guidé : `duo_v3_contribution_release_plan`. | Ajout du parcours | FB-11b, FB-12b |
| R-B6 | Protection commune : poser est immédiat ; lever demande un double accord (le demandeur ne peut pas s'approuver). Protection personnelle : propriétaire seul. Tout est journalisé. | Le prototype permettait une levée par un seul membre | FB-10, FB-10b |
| R-B2 | Non modélisé : prévisionnel par enveloppe `not_available`, jamais zéro. | — | FB-19b |

## Résultats

- **Banc** : 30/30 à chacune des 3 exécutions (s3).
- **Non-régression** : lot 2 variante CF-05 à 71/72 sur s3, avec X18 attendu (voir PR lot 3). Suites lot 3 sur s3 : 22/22 et 10/10 ×3.
- **Catalogue** : s2 → s3, 7 lignes retirées et 96 ajoutées (`results/catalogs/diff_s2_s3.txt`).

## Risques

- Pas de rollback scripté.
- Activation par duo via `activate_funds`, une seule fois.
- La migration de vraies données V2 exige une sauvegarde, une simulation sur base jetable et un rapprochement signé (R-B4) **avant toute donnée réelle**.
