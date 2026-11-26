# CF-12 — Inventaire et réconciliation des migrations (26/11/2026)

**Constat.**
- La CLI Supabase lit le préfixe numérique d'un fichier, jusqu'au premier `_`, comme numéro de version.
- Les fichiers historiques `20261120_001_…` à `20261120_004_…` partagent donc la même version `20261120`, ce qui est un conflit.
- `20261121_005_…` porte la version `20261121`, qui ne correspond à aucune version appliquée sur DEV.

**Réconciliation.** Les fichiers sont renommés avec les versions **réellement appliquées sur DEV**, lues en lecture seule dans `supabase_migrations.schema_migrations` le 26/11.
- Le contenu de chaque fichier est inchangé : c'est un `git mv` pur, l'historique est conservé.
- Aucune migration n'a été rejouée ni appliquée.

| Fichier historique | Fichier réconcilié | Version DEV | Nom DEV | Contenu fichier = instructions DEV |
|---|---|---|---|---|
| `20261120_001_duo_v3_ledger_foundation.sql` | `20261120092413_duo_v3_ledger_foundation.sql` | 20261120092413 | duo_v3_ledger_foundation | **identique octet pour octet** (md5 `0eceddc4…`) |
| `20261120_002_duo_v3_ledger_integrity.sql` | `20261120092416_duo_v3_ledger_integrity.sql` | 20261120092416 | duo_v3_ledger_integrity | identique (md5 `d1e2363f…`) |
| `20261120_003_duo_v3_posting_rls.sql` | `20261120092419_duo_v3_posting_rls.sql` | 20261120092419 | duo_v3_posting_rls | identique (md5 `28aa5c9c…`) |
| `20261120_004_duo_v3_transfer_hardening.sql` | `20261120102820_duo_v3_transfer_hardening.sql` | 20261120102820 | duo_v3_transfer_hardening | identique (md5 `90b0cbcb…`) |
| `20261121_005_duo_v3_privilege_hardening.sql` | `20261121050030_duo_v3_privilege_hardening.sql` | 20261121050030 | duo_v3_privilege_hardening | **équivalent**, pas identique : DEV a reçu les mêmes instructions sans commentaires ni `begin/commit` (md5 DEV `971e7e9d…`, 2 377 caractères ; fichier 4 158). Équivalence de catalogue établie le 25/11. |

**Migrations nouvelles.** Versions strictement postérieures à la dernière version DEV (`20261121050030`) :
- `20261126120000_duo_v3_financial_model_r1.sql` (006 révisée) ;
- `20261126130000_duo_v3_membership_lifecycle.sql` (lot 3) ;
- `20261126140000_duo_v3_funds_ledger.sql` (fonds réels).

**Archivage de la 006 originale.**
- La migration a été déplacée dans `supabase/archive/006-original/`. Ce dossier n'est jamais lu par la CLI : elle ne lit que les fichiers `.sql` placés directement dans `supabase/migrations/`.
- Son rollback est au même endroit.
- Le rollback de la 006 révisée est dans `supabase/rollback/`, lui aussi hors du chemin automatique.

**Avant tout `supabase db push`** (après autorisation) :
1. lancer `supabase migration list` ;
2. vérifier que les 5 versions locales et distantes correspondent ;
3. vérifier que seules les nouvelles migrations sont en attente.

Si une version distante est absente du dépôt ou diffère : **arrêt**. Il ne faut ni `repair` ni rejeu à l'aveugle.
