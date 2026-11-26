# Duo Budget V3 — Lot 1 backend, première campagne sur Supabase DEV

Exécutée le 21 nov. 2026 (04:47 et 04:50 UTC) sur le projet `eetnzdvjfzexgvqbtyrj` (Duo Budget V3 — DEV, PostgreSQL 17.12).
Branche locale `test/v3-dev-backend-lot1`, partie de `feat/v3-ledger-schema-dev` @ 4d41286. **Branche dédiée, non fusionnée ; poussée seulement après audit.** Migration 005 appliquée sur DEV uniquement, le 21 nov. à 05:00 UTC, sur décision de Steve (voir la dernière section).

## Ce qui a été exécuté

| Campagne | Où | Résultat | Preuve |
|---|---|---|---|
| Intégrité du grand livre, RLS, écritures directes, RPC de transfert, ancien membre | DEV, transaction annulée | 49 réussis · 2 échoués · 4 constats (55) | `v3/database/tests/results/2026-11-21_lot1_dev_rapport.md`, `…_lot1_dev_raw.json` |
| Migration corrective 005 + non-régression | DEV, transaction annulée | 11/11 | `…_migration005_check_raw.json` |
| Cœur financier (précision, clôture, réserve) | Node 22, `test/v3-finance-edge-cases` @ 22aee4a | 11/11 | `…_unit_finance_core.txt` |
| Service Expo (validation, RPC, pas de rejeu automatique) | Node 22, `feat/v3-ledger-schema-dev` @ 4d41286 | 4/4 | `…_unit_finance_service.txt` |

Après les deux campagnes, DEV a été relu : 0 utilisateur, 0 duo, 0 écriture, 4 migrations, migration 005 absente.

**Méthode.** Un seul script SQL, généré par `v3/database/tests/gen_lot1.py`, exécuté par le connecteur Supabase dans `BEGIN … ROLLBACK`. Les rôles `authenticated` et `anon` sont réellement endossés (`SET ROLE`) et le JWT est simulé par `request.jwt.claims`, comme le fait PostgREST. Chaque vérification enregistre : rôle, sujet, code obtenu, message, contrôle d'état, durée en ms, horodatage serveur.

**Limite.** Ce n'est pas encore un test HTTP de bout en bout. Restent à exécuter avec de vrais comptes Auth et `scripts/v3-finance-e2e-dev.cjs` : la concurrence (plusieurs connexions simultanées, même clé), les vrais jetons et le passage par PostgREST.

## Défauts trouvés

| # | Gravité | Constat | Correction |
|---|---|---|---|
| S12, S13 | **Élevée** | `anon` et `authenticated` ont `TRUNCATE`, `REFERENCES` et `TRIGGER` sur les 5 tables (droits par défaut de Supabase). `TRUNCATE` vide le registre et contourne les triggers d'immuabilité. L'API REST n'expose pas `TRUNCATE`, mais le droit ne doit pas exister. | Migration 005 : `anon` n'a plus aucun droit, `authenticated` garde `SELECT` ; trigger `BEFORE TRUNCATE` sur transactions et lignes, y compris pour les rôles privilégiés. Vérifié H01–H04. |
| R19 | Moyenne | `duo_v3_private.is_member(duo, utilisateur)` est exécutable par tout utilisateur connecté : on peut tester l'appartenance de n'importe qui à n'importe quel duo (en SQL ; le schéma n'est pas exposé par l'API par défaut, à confirmer dans les réglages). | Migration 005 : `is_current_member(duo)` fondée sur `auth.uid()`, politiques RLS basculées, `is_member` retirée aux clients. Vérifié H05–H10. |
| M01 | Conception | Rien en base n'empêche un 3ᵉ membre. | Flux d'invitation transactionnel (verrou sur le duo, comptage) — à concevoir. |
| S11c | Conception | Un membre qui a déjà écrit ne peut pas quitter le duo (clé étrangère `created_by` en `RESTRICT`) : SEC-06 n'est pas réalisable avec de vraies données. | Appartenance avec statut (`active` / `left_at`) au lieu d'une suppression — à décider. |
| P01 | Information | La colonne `numeric(38,0)` arrondit en silence une écriture privilégiée de 100,6 centimes. Les clients passent par la RPC, qui refuse les fractions (R07c). | Garder la RPC comme seule porte d'écriture ; pas d'action immédiate. |

## Correspondance avec la matrice (volet backend)

| Test | Proposition de statut | Couverture |
|---|---|---|
| SEC-01 Isolation entre duos | Réussi | Lecture S03, R15 ; écriture R05, R06, S08, L05, L10a ; anon S04, R13 ; sans sujet S05, R12 ; session anonyme R11 ; clé partagée R18 |
| SEC-02 Lecture partagée | Réussi | S01, S02, R14 |
| SEC-04 Contournement par écriture directe | Bloqué | Écritures directes refusées (S06, S07, S09, S10), mais allocation et seuil n'existent pas encore en base |
| SEC-06 Ancien membre | Bloqué | Membre sans historique : refus en lecture et écriture (S11a, S11b). Membre avec historique : départ impossible (S11c) |
| SEC-08 Journalisation | Échoué | UPDATE/DELETE bloqués (L07, S10) mais TRUNCATE accepté (S12, S13) ; pas de qui/quand/avant-après ni de trois dates |
| SEC-03, SEC-05, SEC-09 | Bloqué | Pas de dépense privée ni de demande d'accord en base |
| FIA-05 Rejouer la même opération | Réussi | R02 (même identifiant, une transaction), L06 |
| FIA-06 Même clé, autres paramètres | Réussi | R03 : 23505, rien écrit |
| FIA-07 Double appui | À exécuter | Deux appels successifs : une opération (R04). Le double appui réel est concurrent : test HTTP requis |
| TRF-12 Précision des montants | Réussi | RPC : 0, négatif, 1,5 centime, nul, 10³⁸ refusés ; 10²⁰−1 exact (R07, R16) ; saisie 0,1+0,2, 10,005, 1e3 refusée ou exacte (tests unitaires 11/11) |
| TRF-13 Transfert conservatif | Réussi | R01 : somme du duo constante ; tests unitaires D-015 |

## Rapprochement des deux branches

| | `feat/v3-ledger-schema-dev` | `feat/v3-ledger-rls-tests` |
|---|---|---|
| Statut | **Déployée sur DEV** (migrations 001–004) | Scripts de revue, jamais exécutés |
| Modèle | `public.duo_v3_*` : ménages, membres, comptes, transactions, lignes | `duo_v3_private.*` : duos, adhésions, périodes, enveloppes, opérations, révisions, grand livre en deux livres (trésorerie / budget) |
| Écriture | RPC `duo_v3_post_transfer` (idempotente, verrous) | `post_shared_ledger_entry` (non testée) |
| Apport propre | Base exécutable et testée | Périodes, enveloppes, livres séparés, dépenses privées, plafond de 2 membres (conception) |

Les deux modèles ne fusionnent pas : ce sont deux schémas différents. Je propose de garder **schema-dev comme socle** et de porter les concepts de rls-tests sous forme de nouvelles migrations, chacune avec ses tests sur DEV, dans l'ordre du chantier P0 : livres trésorerie/budget et périodes, dépenses privées, appartenance avec statut et invitations, puis demandes d'accord. Les scripts de revue de rls-tests seraient alors archivés.

## Pour rejouer

```bash
python3 v3/database/tests/gen_lot1.py          # régénère lot1_dev_integration.sql et lot1_specs.json
# exécuter lot1_dev_integration.sql sur DEV (SQL Editor ou connecteur) ; il se termine par ROLLBACK
python3 v3/database/tests/report_lot1.py <sortie>.json   # produit le rapport
```

## Clôture du lot 1 : migration 005 appliquée et recette rejouée (21 nov. 2026)

**Vérifications préalables (transactions annulées, 04:59–05:00 UTC)**

| Condition | Résultat |
|---|---|
| Privilèges futurs | Tables et fonctions V3 appartiennent à `postgres` : les règles par défaut de 005 s'appliquent bien. Celles de `supabase_admin` (objets de la plateforme) ne sont pas modifiables par `postgres` et restent en place. |
| Fonctions RPC | Trou trouvé et corrigé avant application : PostgreSQL accorde `EXECUTE` à `PUBLIC` sur toute nouvelle fonction. 005 retire ce droit global. Vérifié : nouvelle table, séquence ou fonction sans droit pour `anon`/`authenticated` ; RPC accessible seulement après `GRANT` explicite ; `duo_v3_post_transfer` inchangée. |
| Protection du registre | `TRUNCATE` refusé pour `postgres` (y compris `CASCADE`) et `service_role` ; écritures légitimes (privilégiée équilibrée et RPC) toujours possibles. Limite : en mode réplication, le propriétaire désactive les triggers (T03). |

**Application** : `apply_migration` → version `20261121050030 duo_v3_privilege_hardening` (fichier `supabase/migrations/20261121_005_duo_v3_privilege_hardening.sql`). Conseiller de sécurité : un seul avertissement, attendu (RPC de transfert exposée volontairement).

**Recette après application** (rapport `v3/database/tests/results/2026-11-21_lot1_post005_rapport.md`) : passe A non destructive 05:10 UTC (49) et passe B `TRUNCATE`/`DELETE` 05:12 UTC (12), chacune annulée. **57 réussis, 0 échec, 4 constats connus** (P01, T03, M01, S11c). DEV relu à 05:12 UTC : 0 utilisateur, 0 donnée, aucun objet témoin, 5 migrations, 2 triggers anti-TRUNCATE.

Effet observé de 005 sur le harnais lui-même : ses fonctions temporaires n'étaient plus exécutables par `authenticated` sans `GRANT` explicite — preuve supplémentaire que les droits implicites ont disparu. Le harnais les accorde désormais explicitement.

| Critère de sortie | État |
|---|---|
| 005 appliquée et enregistrée sur DEV | ✅ |
| S12/S13 réussis | ✅ 42501 pour `authenticated` et `anon` |
| Aucune régression RLS ni transferts | ✅ 49/49 en passe A (hors constat P01 connu) |
| Privilèges par défaut sans accès implicite | ✅ D01, D02 |
| Opérations destructrices refusées | ✅ T01, T02, L07b, S10 |
| DEV dans son état initial | ✅ |
| SEC-08 | Reste échoué (journal qui/quand/avant-après et trois dates absents) |
| FIA-07 | Reste à exécuter (HTTP concurrent) |
| Rapport et preuves dans la matrice | ✅ révision 16 de la feuille |
