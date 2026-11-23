# Duo Budget V3 — Lot 2 : périodes, enveloppes, séparation trésorerie / budget

**Statut : proposition, non appliquée.** La migration 006 a été exécutée sur Supabase DEV **uniquement dans une transaction annulée** (accord du 21/11/2026). Elle n'est appliquée durablement nulle part. Branche dédiée, non fusionnée ; poussée seulement après audit. V3.0.7 reste gelée, V3.0.9 reste candidate.

| Élément | Valeur |
|---|---|
| Branche locale | `feat/v3-lot2-financial-model`, créée depuis `origin/feat/v3-ledger-schema-dev` (branche dédiée, non fusionnée) |
| Base | Migrations 001–004 de `schema-dev` ; 005 (sécurité) appliquée sur DEV le 21/11/2026 |
| Migration | `supabase/migrations/20261121_006_duo_v3_financial_model.sql` (883 lignes, sha256 `cd16cf266b4443c0…`) |
| Retour arrière | `supabase/migrations/rollback/20261121_006_duo_v3_financial_model.down.sql` (sha256 `85803726c928c9e7…`) |
| Script de campagne DEV | `v3/database/tests/lot2_financial_model_dev_compact.sql` (sha256 `72aee2a569ead898…`) |

**Niveaux de preuve.**

| Niveau | Environnement | Rôles et JWT |
|---|---|---|
| 1 | Réplique locale PostgreSQL 17.12 | Rôles Supabase réels, JWT simulé |
| 2 | **Supabase DEV**, 006 exécutée dans une transaction annulée | Rôles réels, JWT simulé |
| 3 (pas encore) | HTTP | Vraie authentification |

Dans le même esprit, la concurrence a été testée localement avec deux vraies sessions. La concurrence HTTP (FIA-07) reste à faire.

---

## 1. Conception

### 1.1 Deux livres dans un seul registre

Le registre en partie double (001–005) est conservé. Chaque compte appartient à un **livre**, porté par la colonne générée `book`.

| Livre | Comptes | Mesure |
|---|---|---|
| **Trésorerie** (`cash`) | `cash`, `clearing` (contrepartie externe) | L'argent réel du duo |
| **Budget** (`budget`) | `envelope`, `reserve`, `budget_source`, `budget_spent` | L'affectation de cet argent |

**Règle centrale.** Chaque transaction est équilibrée **dans chaque livre**. Une allocation, un report ou un transfert n'écrit rien dans le livre trésorerie. Ces opérations ne peuvent donc ni créer ni détruire d'argent réel.

| Événement | Trésorerie | Budget |
|---|---|---|
| Versement d'un membre (`contribution`) | cash +a / clearing −a | — |
| Allocation de période (`allocation`, système) | — | budget_source −a / enveloppe +a |
| Dépense (`expense`) | cash −a / clearing +a | enveloppe −a / budget_spent +a |
| Transfert enveloppe ↔ enveloppe, réserve → enveloppe (`transfer`) | — | source −a / cible +a |
| Report de clôture vers la réserve (`carry`, système) | — | enveloppe −a / réserve +a |

**Écart de financement.**
- Définition : `funding_gap = trésorerie − (enveloppes + réserve) = versements − allocations`.
- La vue `duo_v3_household_position` l'expose avec un indicateur `funding_alert`, vrai quand l'écart est négatif.
- Arbitrage : une allocation supérieure aux versements est **autorisée avec alerte**.

### 1.2 Périodes comptables (D-011, D-012, D-029)

- **Bornes.** Une période couvre `[starts_on, ends_on)` en date locale. Les bornes `timestamptz` sont calculées dans le fuseau du duo (défaut `Europe/Paris`).
- **Jour de début.** Il vaut de 1 à 31. Dans un mois plus court, la période démarre au dernier jour du mois (`min(jour, dernier jour)`).
- **Garanties en base.**
  - une seule période ouverte ;
  - périodes contiguës ;
  - dates immuables ; seule la transition `open → closed` est possible ;
  - aucune suppression ni TRUNCATE ;
  - calendrier et devise figés dès la première période.
- **Imputation.** Chaque transaction porte `period_id`, avec une clé étrangère composite vers une période du même duo. Toute écriture dans une période close est refusée.
- **Trois dates (D-029).** `occurred_on` est la date réelle, `period_id` la période d'imputation, `created_at` la réception par le serveur.

### 1.3 Enveloppes (D-008, D-013, D-023)

| Table | Contenu |
|---|---|
| `duo_v3_envelopes` | Identifiant stable, compte `envelope` dédié, règle `carry_positive`, statut `active` ou `archived` (définitif ; la réactivation relève de D-023, lot 5) |
| `duo_v3_allocation_versions` | Historique immuable du montant prévu |
| `duo_v3_period_allocations` | Allocation de chaque enveloppe active pour la période, y compris à 0 € (trace explicite, sans transaction) |
| `duo_v3_period_envelope_closes` | Instantané de clôture : solde, règle appliquée, montant reporté, montant envoyé à la réserve |
| `duo_v3_period_closes` | Récapitulatif de chaque clôture |

**Archivage (arbitrage du 21/11).** `duo_v3_private.archive_envelope` est une fonction serveur.
- Elle s'exécute sous le verrou du duo et elle est idempotente.
- Elle est refusée si le solde n'est pas **exactement nul au moment de l'exécution**. Le même contrôle existe dans le déclencheur, ce qui couvre aussi une mise à jour privilégiée directe.
- Elle ne déplace jamais d'argent.
- Une enveloppe archivée ne reçoit plus d'allocation, de dépense ni de transfert, et sort des clôtures.

### 1.4 Clôture (D-013 à D-018, D-029)

`close_period(duo, période, p_now)` se déroule en sept étapes :
1. Elle verrouille le duo et refuse de s'exécuter avant la fin de la période.
2. Elle est idempotente.
3. Elle clôt la période et ouvre la suivante.
4. Pour chaque enveloppe active, elle enregistre un instantané. Un solde positif sans report part vers la réserve par une transaction `carry`, avec la clé `carry:<p>:<e>` (D-014). Un solde positif avec report (D-013) ou un solde négatif (D-017, D-018) reste dans l'enveloppe.
5. Elle poste les allocations de la nouvelle période, avec la clé `alloc:<p>:<e>`.
6. Elle enregistre le récapitulatif.
7. Tout se fait dans **une seule transaction** : une interruption annule l'ensemble.

Les soldes sont cumulés. On obtient donc −30 + 400 = 370 et −500 + 400 = −100, et la réserve n'est jamais prélevée automatiquement.

**Clôture paresseuse.** `ensure_current_period` clôt les périodes échues avant toute écriture d'un membre. Elle reste le mécanisme de sécurité. Une tâche planifiée la complétera plus tard (arbitrage).

### 1.5 RPC membres et sérialisation

Les trois RPC partagent les mêmes garanties :
- `authenticated` exigé, `is_anonymous` refusé, appartenance vérifiée ;
- idempotence (même clé et contenu différent : 23505) ;
- **verrou de ligne sur le duo**, le même que celui de la clôture et de l'archivage.

Une écriture ne peut donc jamais échapper à l'instantané d'une clôture concurrente. Ce point a été ajouté au cours de cette passe : avant, le verrou ne portait que sur la clé d'idempotence.

| RPC | Règles |
|---|---|
| `duo_v3_post_transfer` (signature inchangée) | Comptes `envelope` (actifs) et `reserve` uniquement. Trésorerie → enveloppe refusé (23503). Réserve insuffisante : 23514 (D-015). **Une enveloppe source ne peut pas devenir négative ni être prélevée si elle l'est déjà : 23514 (arbitrage).** |
| `duo_v3_post_expense` | Écritures dans les deux livres. **Dépassement autorisé (D-016).** Date future : 22023. **Enveloppe archivée : refus explicite** 23503, message « choose an active envelope », indice `choose_active_envelope` (arbitrage, sans reclassement). |
| `duo_v3_post_contribution` | Livre trésorerie seul. Date future refusée. |

### 1.6 Sécurité

- **Tables.** RLS en lecture pour les membres actuels ; `anon` n'a aucun droit et `authenticated` n'a que SELECT.
- **Vues.** Elles sont en `security_invoker` et héritent donc de la RLS des tables.
- **Fonctions.** Les fonctions serveur, y compris `archive_envelope`, ne sont exécutables par aucun client. Seules les trois RPC le sont, par `authenticated`.
- **Immuabilité.** Les historiques refusent UPDATE, DELETE et TRUNCATE, même pour `postgres`.

---

## 2. Invariants comptables et preuves

La colonne « Tests » renvoie aux vérifications réussies **en local et sur DEV** (passe 2).

| # | Invariant | Tests |
|---|---|---|
| I1 | Toute transaction est équilibrée dans chaque livre | C06, C08 |
| I2 | Une allocation, un report ou un transfert ne modifie pas la trésorerie | C01, C04, R05, R08, S06 |
| I3 | Une dépense est atomique dans les deux livres | C03, X10 |
| I4 | Identités : trésorerie = versements − dépenses ; budget = allocations − dépenses ; écart = versements − allocations ; alerte si l'écart est négatif | C01, C02b, C05, R10 |
| I5 | Une clôture est idempotente, atomique, et ne crée aucun report ni allocation en double | R06, G01–G05, L07 |
| I6 | Aucune écriture, modification ni suppression dans une période close ou dans l'historique | L03–L05, X15, X16 |
| I7 | Reports : D-013 conservé, D-014 envoyé à la réserve, D-017/D-018 déficit conservé, réserve jamais prélevée | R01–R04, R07, R11 |
| I8 | Une opération tardive est imputée à la période ouverte, garde sa date réelle et ne rouvre rien | L01, L02, L06, L07 |
| I9 | Périodes contiguës, une seule ouverte, bornes D-011/D-012, heure d'été | K01–K10 |
| I10 | Aucune écriture client directe ; isolation entre duos ; `anon` sans accès | X01–X09, X12, X17, X18 |
| I11 | Une enveloppe appartient à un duo ; une enveloppe archivée ne reçoit rien | X09, X13, X14, A05, G02 |
| **I12** | **Seule une dépense crée un dépassement** : un transfert ne rend jamais une source négative | S01–S05 |
| **I13** | **Archivage à solde exactement nul, sans mouvement d'argent ni effet partiel** | A01–A04, A06 |
| **I14** | **Les écritures d'un duo sont sérialisées avec sa clôture** | Concurrence locale (§5.3) |

---

## 3. Correspondance avec les décisions

| Décision | Règle | Structure ou fonction | Tests |
|---|---|---|---|
| D-005 | Une devise par duo | `households.currency` figée | K10 |
| D-008 | Allocation prévue par enveloppe | `allocation_versions`, `period_allocations`, `post_period_allocations` | C01, R01, G02 |
| D-011 | Jour de début, `[début, fin)`, fuseau | `periods`, `cycle_boundary`, `cycle_containing`, `create_period` | K01, K02, K05, K06, K08–K10 |
| D-012 | `min(jour, dernier jour du mois)` | `cycle_boundary` | K03, K04, K06, K07 |
| **D-013** | Report configurable, historisé, atomique, idempotent | `carry_positive` (enveloppe et instantané), `close_period` | R01, R06, R07, G03 |
| **D-014** | Reliquat sans report envoyé à la réserve, clé d'idempotence | Transaction `carry`, clé `carry:<p>:<e>` | R02, R05, R07, R11, G04 |
| **D-015** | Réaffectation depuis la réserve, tracée, refusée si insuffisante | `duo_v3_post_transfer` | R08, R09, S06 |
| **D-016** | Dépassement possible **par une dépense uniquement** (arbitrage) | `duo_v3_post_expense` ; contrôle de la source dans `post_transfer` | C03, S02–S05 |
| **D-017** | Solde négatif toujours reporté | `close_period` | R03 |
| **D-018** | Déficit conservé, réserve jamais prélevée automatiquement | Soldes cumulés | R04, R11, S06 (réaffectation explicite seulement) |
| D-023 | Archivage sans mouvement implicite d'argent, solde exactement nul | `archive_envelope`, `guard_envelope`, `set_allocation` | A01–A06, X13, X14 |
| **D-029** | Clôture ; opération tardive imputée au cycle ouvert ; trois dates | `periods.state`, `period_closes`, `period_id` / `occurred_on` / `late_imputation` / `created_at`, `ensure_current_period` | R05, R06, L01–L07, G01–G05 |

### Ce qui est contrôlable maintenant, et ce qui relève des lots suivants

| Contrôle | Dans 006 | Lot |
|---|---|---|
| Une enveloppe archivée ne reçoit aucune allocation | ✅ G02, A05 | 2 |
| Un archivage incompatible au moment de l'exécution est refusé sans effet partiel | ✅ A01, A02, A06 | 2 |
| Statut « À revoir » d'une **demande** d'archivage | ❌ Aucune table de demandes. `archive_envelope` est l'étape d'exécution : le futur workflow capturera son refus et passera la demande à « À revoir ». | 5 (D-028) |
| D-029 étape 3 : demandes en attente à la clôture | ❌ Pas d'objet « demande » | 4 (approbations, D-026, D-027) |
| D-029 étape 4 : archivages programmés à la clôture | ❌ | 5 (D-028) |
| D-029 étape 7 : publication et notifications | Partiel (`period_closes`) | Ultérieur |
| Clôture interrompue ou relancée sans double report ni double allocation (séquentiel) | ✅ G01–G05 | 2 |
| Courses concurrentes réelles | Locale ✅ (§5.3) ; HTTP ❌ | FIA-07 |

---

## 4. Transition du contrat de `duo_v3_post_transfer`

| Aspect | Avant (004) | Après (006) |
|---|---|---|
| Signature, authentification, idempotence | — | **Inchangées** |
| Comptes acceptés | Tout compte du duo | Enveloppes actives et réserve |
| Trésorerie → enveloppe | Accepté | **Refusé (23503)** : allocation et versement sont deux opérations distinctes |
| Réserve source | Pas de contrôle | Solde ≥ montant, sinon 23514 |
| Enveloppe source | Pas de contrôle | **Solde ≥ montant, sinon 23514** |
| Prérequis | — | Duo initialisé, sinon 55000 |

**Lot 1 rejoué sur 001→006 (local) : 58 réussis, 0 échoué, 4 constats connus** (P01, T03, M01, S11c) sur 62 vérifications. Adaptations :
- fixtures avec période ouverte et réserve alimentée ;
- R01–R04 et R16 (10^20 − 1) passent par « réserve → enveloppe » ;
- R18 utilise une enveloppe du duo B alimentée ;
- **R21** prouve le refus « trésorerie → enveloppe ».

**À contrôler côté application avant toute activation.**
- Aucun appel de transfert depuis la trésorerie.
- Les transferts ne doivent jamais dépasser le solde de l'enveloppe source.
- Une dépense sur une enveloppe archivée doit être reproposée sur une enveloppe active.

---

## 5. Campagne DEV (transaction annulée)

### 5.1 Protocole

1. **Relevé avant.** Empreinte du schéma V3, volumes, migrations, fonctions privées.
2. **Exécution.** Un seul appel : `BEGIN`, puis 006, les 72 vérifications, l'empreinte du schéma 006 dans la transaction, et `ROLLBACK`.
3. **Relevé après.**
4. **Comparaison.**

### 5.2 Résultats

| Contrôle | Résultat |
|---|---|
| Empreinte DEV avant | `f421a302…` (100 objets), **identique à la réplique locale 005** |
| Volumes avant | 0 duo, 0 membre, 0 compte, 0 transaction, 0 écriture, 0 utilisateur Auth |
| Migrations avant | 5 (…092413, …092416, …092419, …102820, …050030) |
| Empreinte du schéma 006 dans la transaction | `da09ae9b…` (286 objets), **identique à la réplique locale** : DEV a testé exactement la même 006 |
| **Passe 2 (retenue), 06:20:00 UTC** | **72 réussis, 0 échoué, 0 constat**, chaque refus portant son message attendu |
| Passe 1 (non retenue), 06:14:29 UTC | 72/72 sur les codes. Mais X15 avait échoué pour une raison indirecte : un contrôle différé hérité d'un test précédent avait répondu à la place du déclencheur TRUNCATE. L'outillage a été corrigé (chaque test valide ses écritures à sa fin, messages vérifiés) avant la passe 2. |
| Empreinte DEV après | `f421a302…` (100 objets), **inchangée** |
| Volumes et migrations après | **Inchangés** (0 ligne, 0 utilisateur, 5 migrations, 2 fonctions privées) |

Preuves :
- `v3/database/tests/results/2026-11-21_lot2_dev_rollback_passe2_raw.json` ;
- `…_lot2_dev_rapport.md` ;
- `…_lot2_dev_etat_avant_apres.json`.

### 5.3 Concurrence (locale, deux sessions réelles)

Le test se trouve dans `v3/database/tests/concurrency/` et la sortie dans `results/2026-11-21_lot2_concurrence_locale.txt`. Le scénario :
- A lance la clôture d'une période échue et garde le verrou 3 s ;
- C relance la même clôture ;
- B poste une dépense tardive.

Résultats observés :
- B a attendu la fin de A (environ 2,5 s), puis a été imputée à la nouvelle période avec `late_imputation = true` ;
- C a renvoyé la même période ;
- il y a une clôture, un report et une allocation par période, et l'instantané est égal au solde réel.

Ce test utilise une base locale jetable avec commit ; il ne s'exécute pas sur DEV. **Il ne remplace pas FIA-07** (requêtes HTTP concurrentes avec vraie authentification).

---

## 6. Analyse des risques

| # | Risque | Gravité | Mesure | Reste à faire |
|---|---|---|---|---|
| R1 | Changement du contrat de transfert | Moyenne | Signature conservée, erreurs explicites, R21, S02–S05 | Audit des appels côté client |
| R2 | Écritures privilégiées : `period_id` et équilibre par livre obligatoires | Faible | Messages explicites | Scripts d'administration |
| R3 | La clôture paresseuse ajoute de la latence à la première écriture après échéance | Moyenne | Verrou par duo, limite de 120 itérations, idempotence | Mesure HTTP ; tâche planifiée |
| R4 | Fuseaux et changements d'heure | Moyenne | K05 (Paris) | Fuseau hors Europe |
| R5 | ~~Enveloppe archivée avec solde~~ | Résolu | Archivage à solde exactement nul (A01–A06) | Workflow « À revoir » (lot 5) |
| R6 | ~~Allocation non bornée~~ | Résolu | Autorisée avec `funding_alert` | Affichage de l'alerte côté client |
| R7 | Contournement des déclencheurs par le propriétaire en mode réplication (T03) | Élevée si les accès admin ne sont pas maîtrisés | Inchangé | Gestion stricte des accès admin |
| R8 | Arrondi silencieux d'une écriture privilégiée (P01) | Faible | Les RPC refusent les montants non entiers | — |
| R9 | Écarts propres à Supabase | Réduit | Exécution DEV identique au local (empreintes égales) | Tests HTTP |
| R10 | Tests dépendants de `now()` | Faible | Plusieurs exécutions identiques (local et DEV) | Exécution datée en fin de mois |
| R11 | Concurrence entre une clôture et des écritures | Réduit | Verrou de ligne commun, test local à deux sessions | FIA-07 en HTTP |
| R12 | Sérialisation par duo : contention si les écritures sont nombreuses | Faible (2 membres) | Verrou court, une ligne par duo | Mesure de charge si besoin |
| R13 | Retour arrière impossible avec des données | Faible (DEV vide) | Le script refuse (55000) | Voir §7 |

---

## 7. Plan de retour arrière

| Situation | Procédure | Vérifié |
|---|---|---|
| Avant application (état actuel) | Rien à faire. Les campagnes s'exécutent dans une transaction annulée. | DEV : empreinte, volumes et migrations inchangés après les deux passes |
| Après application, sans données 006 | Exécuter le script `down` : il recopie à l'identique `validate_posting` (002) et `post_transfer` (004), puis supprime les objets ajoutés. Retirer ensuite la ligne de migration, après validation. | 001→006→down donne la même empreinte que 001→005 (`f421a302…`) |
| Après application, avec données | Le script refuse (55000). Choisir entre une réinitialisation DEV revue et un correctif 007. | Refus testé |
| Production | Hors périmètre | — |

---

## 8. Arbitrages du 21/11/2026, intégrés

| Sujet | Décision | Mise en œuvre | Tests |
|---|---|---|---|
| Transfert rendant une enveloppe négative | Refusé | `post_transfer`, 23514 | S02, S05 |
| Dépense créant un solde négatif | Autorisée (D-016 à D-018) | `post_expense` | C03, S04 |
| Allocation supérieure aux versements | Autorisée avec alerte | `funding_alert` | C01, C02b |
| Archivage avec solde non nul | Refusé ; solde exactement nul à l'exécution, sans transfert automatique | `archive_envelope`, `guard_envelope` | A01–A06 |
| Dépense hors ligne sur une enveloppe archivée | Refus explicite, sans reclassement | `post_expense`, indice `choose_active_envelope` | X13 |
| Clôture paresseuse | Conservée comme mécanisme de sécurité | `ensure_current_period` | L07, G03 |

---

## 9. Reproduire

```sh
M=<schema-dev>/supabase/migrations/20261120_00
mkdb.sh duo_l2 ${M}1*.sql ${M}2*.sql ${M}3*.sql ${M}4*.sql supabase/migrations/20261121_005*.sql supabase/migrations/20261121_006*.sql
python3 v3/database/tests/gen_lot2.py                  # variantes locale et DEV, spécifications
psql -d duo_l2 -f v3/database/tests/lot2_financial_model_local.sql
python3 v3/database/tests/gen_lot1_post006.py && psql -d duo_l2 -f v3/database/tests/lot1_post006.sql
v3/database/tests/concurrency/run_local.sh duo_conc    # base jetable 001→006
# DEV : relevé (dev_state_check.sql), puis lot2_financial_model_dev_compact.sql (ROLLBACK final), puis relevé
```

**Matrice de recette non modifiée.** Je propose de la mettre à jour après ta validation.
- Les lignes concernées (CYC, ENV, TRF-13 à TRF-15) passeraient à « Réussi », avec le niveau de preuve « SQL sur DEV en transaction annulée, rôles réels, JWT simulé — 006 non appliquée ».
- FIA-07 et SEC-08 restent dans leur état actuel.
