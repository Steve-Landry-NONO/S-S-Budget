# Dossier GO / NO GO — migration 006r1 seule (DEV)

> **Décision courante : NO GO.** Ce dossier décrit les conditions du GO ; il ne l'accorde pas.
> - Le GO est une autorisation écrite et distincte du propriétaire, visant **une empreinte exacte**.
> - **Périmètre : 006r1 uniquement** (`20261126120000_duo_v3_financial_model_r1.sql`).
> - Lot 3 et M2 restent NO GO DEV.
> - Mise à jour du 27/11 après-midi : R3-02 (qualification HTTP **exécutée** sur réplique jetable), R3-04 (essai à blanc sur base créée par l'outil), sauvegarde et restauration préparées.

## 1. Fichier visé

| Version | sha256 | Statut |
|---|---|---|
| r2, publiée dans #23 (`691db7f`) | `7c7e54b7b7168e446309b03429e92d582c8f32931bf2e87d13b432af8b16d6ac` | **Interdite** : défaut NUM-01, reproduit en HTTP (N05 et N12 acceptés, 9 instantanés illisibles pour le contrat). |
| r3, candidat local | `836354d51c72168a91fb76311388ab12b81f8450cd317d102195e0c2a5b90b67` | Version proposée, après revue et publication atomique coordonnée. |
| Rollback | `1ccb0d5065f50ae3ba8e145c10d44502ed298ee87c8e3983c6d409c5494569aa` | Inchangé. |
| 006 originale | `cd16cf26…` | NO GO définitif. |

## 2. Préconditions (toutes requises)

| # | Précondition | État au 27/11 |
|---|---|---|
| G1 | Revue indépendante du diff r2 → r3 approuvée : NUM-01 (une ligne SQL), outillage de qualification, documents. | **Non remplie** |
| G2 | r3 publiée par la **procédure atomique** (`PUBLISH_ATOMIC.sh`, simulation puis exécution autorisée), CI verte sur #23. | **Non remplie** (simulation seule réalisée) |
| G3 | sha256 du fichier dans le clone d'application = `836354d5…`. | À contrôler le jour J |
| G4 | DEV relevé **en lecture seule** le jour J : 5 versions exactement ; 0 ligne métier ; aucun objet 006 ; `dev_state_check.sql` = `f421a30206151d95999d5c6eb54196cd` (100 objets). Valeur égale à la réplique b005, constaté le 27/11. | Référence établie ; relevé à faire |
| G5 | Essai à blanc par `dry_run_migration.py --template b005` : l'outil **crée et détruit** sa base jetable locale (R3-04). Code 0. Jamais sur DEV. | **Remplie sur r3 local** (D00) |
| G6 | Suites rejouées depuis le SHA autorisé, sur réplique : lot 2 72/72 ; `qualify006` 94/4/1/2 (C01, C07a historiques) ; `deep006r1` 38/38 ; rollback vrai ; `rev_corrections` 16/16 ; suite adverse 45/45. | **Remplie sur r3 local** ; à rejouer depuis le SHA publié |
| G7 | Qualification HTTP (`POSTGREST_NUMERIC_PROTOCOL.md`), N01–N18 et D-01–D-09, sur réplique jetable et PostgREST local. Version PostgREST égale à celle de DEV, relevée en lecture seule. | **Exécutée sur r3** : 75/75 avec PostgREST 12.2.3. Version DEV à relever. |
| G8 | Sauvegarde **et** restauration exercée (§ 6) : export logique du schéma DEV en lecture seule, restauré sur réplique jetable, empreinte égale à G4. Point de restauration Supabase noté. | **Non remplie** (procédure prête) |
| G9 | Fenêtre : aucune autre migration, aucun déploiement, aucun workflow DEV, aucun client raccordé. Harnais E2E neutralisé (G13). | À confirmer le jour J |
| G10 | Autorisation écrite du propriétaire, avec l'empreinte `836354d5…`, la fenêtre et l'opérateur. | **Non remplie** |

## 3. Déroulé (le jour J)

1. Relevé G4, en lecture seule. **Arrêt** au moindre écart.
2. Sauvegarde G8, heure notée.
3. `supabase migration list`, puis application du **seul** fichier autorisé, en une transaction, avec l'outil d'application de migration.
4. Contrôles d'après, en lecture seule (§ 4).
5. Journal : opérateur, heure, sha256, durée, sorties brutes.

## 4. Contrôles d'après application (lecture seule sur DEV)

| Contrôle | Attendu |
|---|---|
| Versions | Les 5 précédentes, plus `20261126120000`. |
| `dev_state_check.sql` | `74db7168d8099981c5255203d601521f`, 307 objets. **Ce relevé ignore les domaines (CAT-01).** |
| Domaine `minor_units` | `CHECK (((VALUE = trunc(VALUE)) AND (scale(VALUE) = 0) AND (abs(VALUE) <= '99999999999999999999999999999999999999'::numeric)))`. |
| Sécurité | `get_advisors` : aucune nouvelle alerte de sécurité. |
| Privilèges | Aucune fonction `duo_v3_private` exécutable par `anon` ou `authenticated` (lecture du catalogue). |
| Fonctionnel | **Aucune suite ni requête d'écriture sur DEV.** Les suites et la qualification HTTP sont rejouées sur la réplique (G6, G7). |

## 5. Critères d'arrêt

- Toute différence au relevé G4.
- Une empreinte de fichier différente.
- Un échec d'application.
- Un verrou supérieur à 5 s.
- Une empreinte d'après différente.
- Un domaine différent.
- Une alerte de sécurité nouvelle.
- Toute action non prévue.

## 6. Sauvegarde et restauration exercée (prérequis G8, valable pour toute future migration)

| Étape | Où | Contenu |
|---|---|---|
| S1 | Tableau de bord Supabase (lecture) | Confirmer la sauvegarde quotidienne ou le PITR du projet DEV et noter l'heure du dernier point. |
| S2 | Poste du propriétaire, lecture seule sur DEV | `supabase db dump --db-url <DEV> -f dev_schema.sql` (schéma). Puis `--data-only -f dev_data.sql` (DEV est vide : fichier attendu sans ligne métier). Le dump est fait avec l'outil de la version du serveur (PostgreSQL 17). Noter les empreintes. |
| S3 | Réplique **jetable** locale PostgreSQL 17 | Base vierge Supabase (`supa`), puis `psql -f dev_schema.sql`, puis `dev_state_check.sql`. **L'empreinte doit être `f421a302…`.** C'est la preuve que la sauvegarde restaure l'état DEV. |
| S4 | Même réplique | Application de la 006r1 r3 sur la base restaurée, puis `dev_state_check.sql` = `74db7168…` et domaine conforme. C'est une répétition générale de la fenêtre. |
| S5 | Archivage | Empreintes de S2, sorties de S3 et S4, heure du point S1. |

Exercices **déjà réalisés localement**, sans DEV :
- restauration par copie de base ;
- export et import logique table par table ;
- panne injectée avant `COMMIT` (`recovery_drill.py`, 5/5, rejoué le 27/11).

Limite : `pg_dump` 17 n'est pas disponible dans l'environnement de qualification ; S2 se fait sur le poste du propriétaire.

**Récupération en cas d'incident**

| Situation | Conduite |
|---|---|
| Échec pendant l'application | Transaction unique annulée. Relevé G4, puis analyse. Aucune relance sans nouvelle autorisation. |
| Appliquée, contrôle d'après en échec, DEV vide | Script `down` (`1ccb0d50…`), qui refuse d'agir s'il trouve des données 006. Puis relevé G4. |
| Appliquée, données créées entre-temps | Restauration du point S1 ou du dump S2, de préférence vers une nouvelle instance. Jamais de `down` forcé. |

## 7. Verdict

**NO GO.** Le GO exige G1, G2, G3, G4 (relevé du jour J), G7 (version DEV relevée, rejouée si elle diffère), G8, G9 et G10.
