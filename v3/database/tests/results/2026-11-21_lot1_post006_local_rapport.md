# Lot 1 rejoué sur le modèle 006 (réplique locale PG 17.12, 001→006, 2026-11-21T07:20:46.685166+01:00)

**Bilan : 58 réussis, 0 échoués, 4 constats** sur 62 vérifications. Constats connus : P01, T03, M01, S11c.

| ID | Matrice | Vérification | Attendu | Obtenu | Message | ms | Verdict |
|---|---|---|---|---|---|---|---|
| L01 | — | Écriture équilibrée +100/−100 validée au COMMIT | ok | OK |  | 2.2 | ✅ Réussi |
| L02 | — | Une seule ligne d’écriture refusée au COMMIT | 23514 | 23514 | Ledger posting requires at least two balanced entries | 1.29 | ✅ Réussi |
| L03 | — | Écriture déséquilibrée +100/−99 refusée | 23514 | 23514 | Ledger posting requires at least two balanced entries | 1.48 | ✅ Réussi |
| L04 | — | Transaction sans ligne refusée | 23514 | 23514 | Ledger posting requires at least two balanced entries | 0.73 | ✅ Réussi |
| L05 | SEC-01 | Ligne du duo A pointant un compte du duo B refusée (FK composite) | 23503 | 23503 | insert or update on table "duo_v3_entries" violates foreign key constraint "duo_ | 1.28 | ✅ Réussi |
| L06 | FIA-05 | Clé d’idempotence dupliquée dans un même duo refusée | 23505 | 23505 | duplicate key value violates unique constraint "duo_v3_transactions_household_id | 0.69 | ✅ Réussi |
| L07a | SEC-08 | UPDATE d’une transaction comptabilisée refusé | 23514 | 23514 | Posted ledger history is immutable | 0.41 | ✅ Réussi |
| L07b | SEC-08 | DELETE d’une ligne comptabilisée refusé | 23514 | 23514 | Posted ledger history is immutable | 0.35 | ✅ Réussi |
| L08 | TRF-15 | Contre-passation exacte acceptée | ok | OK |  | 2.68 | ✅ Réussi |
| L09 | TRF-15 | Deuxième contre-passation du même original refusée | 23505 | 23505 | duplicate key value violates unique constraint "duo_v3_single_reversal" | 0.76 | ✅ Réussi |
| L10a | SEC-01 | Contre-passation depuis un autre duo refusée | 23514 | 23514 | Reversal must reference an original in the same household and currency | 1.73 | ✅ Réussi |
| L10b | — | Contre-passation dans une autre devise refusée | 23514 | 23514 | Reversal must reference an original in the same household and currency | 1.58 | ✅ Réussi |
| L11 | TRF-15 | Contre-passation inexacte (répartition différente) refusée | 23514 | 23514 | Reversal must exactly negate original entries by account | 1.66 | ✅ Réussi |
| P01 | TRF-12 | Écriture privilégiée 100,6 centimes : refus attendu (pas d’arrondi silencieux) | 22023 | OK |  | 1.47 | ⚠️ Constat |
| S01 | SEC-02 | Camille lit son duo : 1 duo, 2 membres, 6 comptes, écritures visibles | ok | OK |  | 2.28 | ✅ Réussi |
| S02 | SEC-02 | Alex (partenaire) lit le même registre partagé | ok | OK |  | 0.91 | ✅ Réussi |
| S03 | SEC-01 | Claire (duo B) ne voit rien du duo A | ok | OK |  | 1.39 | ✅ Réussi |
| S04 | SEC-01 | Rôle anon : lecture du registre refusée | 42501 ou OK | 42501 | permission denied for table duo_v3_entries | 0.31 | ✅ Réussi |
| S05 | SEC-01 | Jeton authenticated sans sujet : zéro ligne | ok | OK |  | 0.59 | ✅ Réussi |
| S06 | SEC-04 | INSERT direct d’une transaction par Camille refusé | 42501 | 42501 | permission denied for table duo_v3_transactions | 0.58 | ✅ Réussi |
| S07 | SEC-04 | INSERT direct de lignes par Camille refusé | 42501 | 42501 | permission denied for table duo_v3_entries | 0.68 | ✅ Réussi |
| S08 | SEC-01 | Claire s’ajoute elle-même au duo A : refusé | 42501 | 42501 | permission denied for table duo_v3_members | 0.34 | ✅ Réussi |
| S09 | SEC-04 | UPDATE direct d’un compte refusé | 42501 | 42501 | permission denied for table duo_v3_accounts | 0.3 | ✅ Réussi |
| S10 | SEC-08 | DELETE direct d’une ligne refusé | 42501 | 42501 | permission denied for table duo_v3_entries | 0.27 | ✅ Réussi |
| S12 | SEC-08 | TRUNCATE du registre par un utilisateur connecté refusé | 42501 | 42501 | permission denied for table duo_v3_entries | 0.18 | ✅ Réussi |
| S13 | SEC-08 | TRUNCATE du registre par anon refusé | 42501 | 42501 | permission denied for table duo_v3_entries | 0.16 | ✅ Réussi |
| R01 | TRF-13 | Transfert 25,00 € cash → Loisirs : conservatif (somme du duo constante) | ok | OK |  | 4.06 | ✅ Réussi |
| R02 | FIA-05 | Rejeu identique (même clé) : même identifiant, une seule transaction | ok | OK |  | 1.26 | ✅ Réussi |
| R03 | FIA-06 | Même clé, 30,00 € au lieu de 25,00 € : rejet 23505, rien écrit | 23505 | 23505 | Idempotency key reused for different transfer | 1.29 | ✅ Réussi |
| R04 | FIA-07 | Double appui (deux appels successifs, même clé) : une seule opération | ok | OK |  | 2.57 | ✅ Réussi |
| R05 | SEC-01 | Claire écrit dans le duo A par la RPC : refusé | 42501 | 42501 | Not authorized for this household | 0.72 | ✅ Réussi |
| R06 | SEC-01 | Camille vise un compte du duo B : refusé | 23503 | 23503 | Accounts not eligible in household/currency | 0.98 | ✅ Réussi |
| R07a | TRF-12 | Montant zéro refusé (22023) | 22023 | 22023 | Invalid transfer parameters | 0.58 | ✅ Réussi |
| R07b | TRF-12 | Montant négatif refusé (22023) | 22023 | 22023 | Invalid transfer parameters | 0.55 | ✅ Réussi |
| R07c | TRF-12 | Montant fraction de centime (0,015 €) refusé (22023) | 22023 | 22023 | Invalid transfer parameters | 0.49 | ✅ Réussi |
| R07d | TRF-12 | Montant nul refusé (22023) | 22023 | 22023 | Invalid transfer parameters | 0.49 | ✅ Réussi |
| R07e | TRF-12 | Montant 10^38 (hors bornes) refusé (22023) | 22023 | 22023 | Invalid transfer parameters | 0.94 | ✅ Réussi |
| R08 | TRF-12 | Compte source = destination refusé | 22023 | 22023 | Invalid transfer parameters | 0.61 | ✅ Réussi |
| R09 | — | Compte de compensation exclu des transferts | 23503 | 23503 | Accounts not eligible in household/currency | 0.99 | ✅ Réussi |
| R10 | — | Devise incohérente avec les comptes refusée | 23503 | 23503 | Accounts not eligible in household/currency | 0.91 | ✅ Réussi |
| R11 | SEC-01 | Session anonyme Supabase (is_anonymous) refusée | 42501 | 42501 | Not authorized for this household | 0.63 | ✅ Réussi |
| R12 | SEC-01 | Jeton sans sujet refusé | 42501 | 42501 | Not authorized for this household | 0.56 | ✅ Réussi |
| R13 | SEC-01 | Rôle anon : exécution de la RPC refusée | 42501 | 42501 | permission denied for function duo_v3_post_transfer | 0.46 | ✅ Réussi |
| R14 | SEC-02 | Alex (partenaire) écrit dans le duo A | ok | OK |  | 1.9 | ✅ Réussi |
| R15 | SEC-01 | … et Claire ne voit pas cette écriture | ok | OK |  | 0.46 | ✅ Réussi |
| R16 | TRF-12 | Grand montant 10^20 − 1 centimes conservé exactement | ok | OK |  | 1.85 | ✅ Réussi |
| R17a | FIA-05 | Clé d’idempotence vide refusée | 22023 | 22023 | Invalid transfer parameters | 0.62 | ✅ Réussi |
| R17b | FIA-05 | Clé d’idempotence de 129 caractères refusée | 22023 | 22023 | Invalid transfer parameters | 0.68 | ✅ Réussi |
| R18 | SEC-01 | Même clé dans un autre duo : transaction distincte, aucune fuite | ok | OK |  | 1.18 | ✅ Réussi |
| R21 | TRF-13 | Transition du contrat 006 : transfert trésorerie → enveloppe refusé (23503) | 23503 | 23503 | Accounts not eligible in household/currency | 0.9 | ✅ Réussi |
| R19 | SEC-01 | Oracle d’appartenance fermé : is_member(duo A, Camille) refusé à Claire | 42501 | 42501 | permission denied for function is_member | 0.44 | ✅ Réussi |
| R20 | SEC-01 | is_current_member : vrai pour Camille sur son duo, faux pour Claire | ok | OK |  | 0.54 | ✅ Réussi |
| T01 | SEC-08 | TRUNCATE par postgres refusé (trigger, contrôles différés vidés) | 23514 | 23514 | Posted ledger history is immutable | 1.3 | ✅ Réussi |
| T02 | SEC-08 | TRUNCATE … CASCADE par service_role refusé | 23514 | 23514 | Posted ledger history is immutable | 2.09 | ✅ Réussi |
| T03 | SEC-08 | Mode réplication (postgres) : refus attendu, contournement constaté puis annulé | 23514 | P0002 | contournement possible | 3.01 | ⚠️ Constat |
| D01 | SEC-08 | Nouvelle table et nouvelle fonction : aucun droit implicite pour anon/authenticated | ok | OK |  | 1.07 | ✅ Réussi |
| D02 | SEC-08 | Privilèges effectifs : anon aucun, authenticated SELECT seul sur les 5 tables | ok | OK |  | 1.21 | ✅ Réussi |
| M01 | SEC-06 | Troisième membre ajouté directement en base (rôle privilégié) : refus attendu | 23514 ou P0001 | OK |  | 0.56 | ⚠️ Constat |
| S11p | SEC-06 | Contrôle préalable : Dan, encore membre, lit le duo A | ok | OK |  | 0.6 | ✅ Réussi |
| S11a | SEC-06 | Membre retiré : il ne lit plus rien du duo A | ok | OK |  | 1.13 | ✅ Réussi |
| S11b | SEC-06 | Membre retiré : écriture par la RPC refusée | 42501 | 42501 | Not authorized for this household | 0.71 | ✅ Réussi |
| S11c | SEC-06 | Retrait d’un membre qui a déjà écrit (Alex) : possible sans casser l’historique | ok | 23503 | update or delete on table "duo_v3_members" violates foreign key constraint "duo_ | 0.53 | ⚠️ Constat |
