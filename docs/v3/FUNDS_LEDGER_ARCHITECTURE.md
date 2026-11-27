# 04 — Architecture financière hybride (lot B)

**Mise à jour 26/11 après-midi : R-B0 à R-B6 tranchés (PR #20), voir `migrations/FUNDS_LEDGER_PR.md` pour les écarts avec ce texte (R-B1 balayage, R-B3 répartition, R-B4 ouvertures, R-B6 double accord).** Statut initial : proposition d'architecture et prototype séparé. Rien de ce document n'est intégré à la 006, ni originale ni révisée (consigne du lot B, POST006-03). Le prototype est la « 007 prototype » (`lotB/proto_007_fonds_reels.sql`). Il s'applique après la 006 révisée, sur la réplique jetable uniquement.

## 1. Problème

La 006 tient deux livres :
- la **trésorerie** (`cash`, `clearing`) dit combien d'argent réel le duo possède ;
- le **budget** (`envelope`, `reserve`, `budget_source`, `budget_spent`) dit combien il prévoit de dépenser par enveloppe.

Rien ne relie les deux livres enveloppe par enveloppe. Le solde d'une enveloppe 006 est donc un **solde budgétaire**. L'afficher comme « disponible réel » violerait POST006-04. C'est ce que faisait encore la correspondance mobile du 25/11 (corrigée au lot D).

La V2 et la PR #17 raisonnent autrement : l'argent est « versé » dans une catégorie. POST006-03 tranche : l'affectation des fonds réels aux enveloppes est **explicite**, et elle n'est jamais une recette.

## 2. Les dix notions

| # | Notion | Définition | Source dans le modèle recommandé |
|---|---|---|---|
| 1 | Trésorerie réelle | Argent réellement détenu par l'espace | Solde du compte `cash` (livre cash) |
| 2 | Budget cible | Montant visé pour l'enveloppe sur le cycle | `allocation_versions` en vigueur (`target`) |
| 3 | Allocation budgétaire | Budget effectivement passé pour le cycle | Écriture `allocation`, livre budget (`budgetAllocation`) |
| 4 | Contributions prévues | Intention déclarée par membre et par cycle | `duo_v3_planned_contributions` (jamais une écriture) |
| 5 | Contributions réalisées | Argent entré dans la trésorerie | Transactions `contribution` (cash +, clearing −) |
| 6 | Fonds réels affectés | Argent réel réservé à une enveloppe | Compte `funds_envelope` de l'enveloppe |
| 7 | Fonds réels non affectés | Argent réel encore libre (« réserve réelle ») | Compte `funds_unassigned` |
| 8 | Disponible réel par enveloppe | Ce qu'il reste réellement à dépenser | Solde `funds_envelope` (négatif = déficit réel) |
| 9 | Reste budgétaire | Budget non consommé | `carryOver + target − realizedExpenses` (livre budget) |
| 10 | Prévisionnel | Projection de fin de cycle | Trésorerie + contributions prévues non réalisées. La part enveloppe reste `not_available` tant que les dépenses prévues ne sont pas modélisées |

Identité centrale (invariant I1) : **trésorerie = fonds non affectés + Σ fonds affectés**.

La **réserve budgétaire** (D-014, reliquats de budget) et les **fonds réels non affectés** sont deux notions distinctes. Le contrat v3 ne les confond jamais.

## 3. Modèles comparés

| Critère | M1 Table d'affectations (hors grand livre) | **M2 Troisième livre « funds » (recommandé)** | M3 Budget = argent (fusion type YNAB) | M4 Répartition calculée au prorata |
|---|---|---|---|---|
| Affectation explicite (POST006-03) | oui | oui | oui | **non** (implicite) |
| Garde le budget cible séparé du réel | oui | oui | **non** : la cible n'est plus qu'un objectif hors livre | oui |
| Garde les deux livres de 006 intacts | oui | oui (aucune écriture 006 modifiée) | **non** : refonte du livre budget | oui |
| Invariant vérifiable en base | difficile : somme de lignes mutables à rapprocher de la trésorerie | **oui**, par transaction (contrôle différé) | oui | sans objet |
| Historique immuable, annulation par contre-passation | à reconstruire (table modifiable ou journal ad hoc) | **natif** (mêmes règles que 006 : append-only, reversal exact, sceau F5) | natif | non : recalcul rétroactif |
| Concurrence (affectations simultanées) | verrou + contrôle ad hoc | verrou du duo (même que 006) + contrôle différé | idem M2 | sans objet |
| Déficit réel visible par enveloppe | oui | **oui** (solde négatif) | oui | approximatif |
| Coût de migration V2 | moyen | moyen | élevé | faible, mais infidèle à la V2 (versements par catégorie) |
| Risque principal | divergence silencieuse avec la trésorerie | trois livres à expliquer | perte de la distinction cible / réel exigée par PR #17 et PR #19 | contredit POST006-03 |

**Recommandation : M2.**
- Il réutilise toutes les garanties de la 006 révisée : équilibre par livre, période ouverte (F1), sceau (F5), unités (F4), autorisation sous verrou (F7) et idempotence par auteur (CF-06).
- Il ajoute un seul invariant transversal, contrôlé à la validation de chaque transaction.

M1 serait plus simple à écrire, mais il recrée hors du grand livre le problème que la 006 résout. M3 et M4 sont incompatibles avec les décisions validées.

## 4. Modèle M2 en détail

### Comptes

`funds_external` est la contrepartie : il est au livre funds ce que `clearing` est au livre cash. On ajoute aussi un compte `funds_unassigned` par espace, et un compte `funds_envelope` par enveloppe (`envelopes.funds_account_id`).

### Écritures types

Chaque livre s'équilibre séparément.

| Opération | Livre cash | Livre budget | Livre funds |
|---|---|---|---|
| Contribution X (non affectée) | cash +X, clearing −X | — | external −X, unassigned +X |
| Contribution X affectée (a à E) | cash +X, clearing −X | — | external −X, E +a, unassigned +(X−a) |
| Affectation a (non affecté → E) | — | — | unassigned −a, E +a |
| Désaffectation / transfert interne | — | — | E1 −a, E2 (ou unassigned) +a |
| Dépense X sur E | cash −X, clearing +X | E −X, spent +X | E −X, external +X |
| Allocation de cycle, report budgétaire | — | inchangé (006) | — |
| Annulation | contre-passation exacte de tous les livres de l'original | idem | idem |
| Restauration | nouvelle écriture identique à l'original (`restores_transaction_id`, unique) | idem | idem |

### Invariants

Le contrôle différé vérifie I1 à I3 au COMMIT. Les fonctions RPC vérifient I4 à I6 sous le verrou du duo.

- **I1** Δcash = Δ(unassigned + Σ envelopes) dans chaque transaction, donc trésorerie = fonds réels à tout instant. Une écriture privilégiée qui ajoute de la trésorerie sans fonds est refusée (FB-14).
- **I2** Le livre funds est équilibré par transaction. C'est la règle générique de 006 par livre : `book` vaut désormais `funds` pour ces comptes (colonne générée, `SET EXPRESSION`).
- **I3** Les fonds non affectés restent ≥ 0.
- **I4** Un mouvement interne (affectation, désaffectation, transfert, annulation d'affectation ou de contribution) ne crée jamais de solde négatif. Seule une **dépense réelle** peut créer un déficit réel (FB-07, FB-12).
- **I5** Les fonds d'une enveloppe **protégée** ne sortent que par une dépense. Transfert, désaffectation et annulation qui la débiteraient sont refusés tant que la protection n'est pas levée explicitement (FB-10, FB-12b). La levée est journalisée (`duo_v3_envelope_protection_events`).
- **I6** Une affectation ne touche jamais `cash` ni `clearing`. Elle ne peut donc ni créer une recette ni modifier les contributions réalisées (FB-04, FB-05).
- **I7** L'archivage d'une enveloppe exige des fonds réels nuls, en plus du solde budgétaire nul de D-023 (FB-17).

### Reports

Les fonds réels sont cumulatifs : un report positif ou négatif traverse la clôture sans écriture. Le livre budget garde les règles D-013, D-014, D-017 et D-018.

Décision ouverte **R-B1** : faut-il balayer vers le non-affecté les fonds réels d'une enveloppe sans report positif, en symétrie avec D-014 ? Le prototype ne balaie rien, ce qui est conservateur : l'argent ne change pas de place sans action d'un membre (FB-13).

### Déficit et dépassement

Ce sont deux drapeaux distincts.
- `real_deficit` : fonds réels < 0.
- `budget_overrun` : reste budgétaire < 0.

Une enveloppe peut dépasser son budget sans déficit réel, si elle a été financée au-delà de sa cible (fixture 5).

### Activation

`activate_funds(duo)` est idempotent. Il crée les comptes et place la trésorerie existante en fonds **non affectés** (écriture système `funds_opening`). Tant qu'un duo n'est pas activé, les RPC de 006 gardent leur comportement exact : les suites historiques passent à l'identique sur `p007` (lot 2 72/72 ; suite indépendante et approfondissements identiques à `r006`).

## 5. Migration depuis la V2 (sans données réelles)

Le planificateur `lotB/v2_to_v3_plan.py` est une fonction pure. Il lit une base V2 (DDL de `server/schema.sql`, main @ 8e7f6f6) et produit un plan. Le banc l'a appliqué à une base **synthétique** (FB-18, FB-19).

| V2 | V3 hybride | Règle |
|---|---|---|
| `amount REAL` (euros) | unités mineures entières | `Decimal(repr(x)) × 100` ; toute valeur qui n'est pas un centime exact est **rejetée** et listée, jamais arrondie (ex. `0.1+0.2`) |
| `categories` actives | enveloppes communes | cible = `monthly_per_person × nombre de membres` |
| `locked = 1` | enveloppe protégée | protection posée après le financement initial |
| `active = 0` | enveloppe archivée | seulement si son solde réel migré est nul ; sinon rejet à arbitrer |
| `contributions` (par catégorie) | contribution réalisée **affectée** à l'enveloppe | traduction fidèle du « versé » V2 |
| `expenses` | dépense réalisée sur l'enveloppe | payeur conservé comme auteur ; clé d'idempotence `v2:<id>` (rejouable) |
| `status ≠ 'done'` | non migré | opérations prévues non modélisées ; listées |
| `activity_logs` | non rejoués | archive en lecture seule |
| membres V2 (PIN) | comptes Supabase Auth | rattachement par invitation (CF-08), hors migration financière |

Stratégie recommandée pour les vraies données (décision **R-B4**) : migrer l'historique V2 comme **soldes d'ouverture par enveloppe** dans la période courante, et archiver le détail V2 en lecture seule. On ne rejoue pas l'historique dans des périodes passées : une période close ne reçoit plus rien (D-029, F1).

Le banc a vérifié sur la base synthétique alignée sur la PR #17 :
- le plan appliqué par les RPC donne exactement les totaux 2000 / 1600 / 960 / réel 640 / protégé 150 ;
- la trésorerie vaut 640 et les fonds non affectés 0.

## 6. Ce que le modèle ne couvre pas encore

- **Dépenses prévues et affectations prévues** par enveloppe : le prévisionnel par enveloppe reste `not_available` (le 655 de la PR #17 n'est pas productible par la base). Décision **R-B2**.
- **Politique de contribution** : qui doit verser combien, équité entre membres. Décision **R-B3**.
- **Multi-devises** : exclu par D-005 et F3.
