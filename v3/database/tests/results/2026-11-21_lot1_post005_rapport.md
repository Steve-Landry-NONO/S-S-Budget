# Lot 1 backend — recette après migration 005 sur Supabase DEV

- **Exécution** : passe A 2026-11-21T05:10:20 UTC (non destructive), passe B 2026-11-21T05:12:18 UTC (TRUNCATE/DELETE), chacune dans une transaction terminée par `ROLLBACK`.
- **Environnement** : projet `eetnzdvjfzexgvqbtyrj`, PostgreSQL 17.12, migrations 20261120092413 → 20261121050030 (005 active).
- **Niveau de preuve** : SQL sur la base réelle, rôles `anon`/`authenticated`/`service_role` réellement endossés, **JWT simulé** (`request.jwt.claims`). Pas de test HTTP ni de vrai jeton Auth à ce stade.
- **Empreintes SHA-256** : `lot1_run_A.sql` 237819b764ad1547…, `lot1_run_B.sql` 8a75070629f7d384…, sorties brutes A 3e1e56f13d54792a…, B e7b9a2f2016bbb3c…
- **État de DEV relu à 2026-11-21 05:12:25 UTC** : 0 utilisateur, 0 duo, 0 transaction, 0 ligne, 0 objet témoin ; 5 migrations ; 2 triggers anti-TRUNCATE ; TRUNCATE anon = False, authenticated = False.

**Bilan : 57 réussis, 0 échoués, 4 constats connus** sur 61 vérifications.

| Passe | ID | Matrice | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |
|---|---|---|---|---|---|---|---|---|
| A | L01 | — | Écriture équilibrée +100/−100 validée au COMMIT | postgres | ok | OK | 3.06 | ✅ Réussi |
| A | L02 | — | Une seule ligne d’écriture refusée au COMMIT | postgres | 23514 | 23514 | 1.74 | ✅ Réussi |
| A | L03 | — | Écriture déséquilibrée +100/−99 refusée | postgres | 23514 | 23514 | 2.03 | ✅ Réussi |
| A | L04 | — | Transaction sans ligne refusée | postgres | 23514 | 23514 | 1.06 | ✅ Réussi |
| A | L05 | SEC-01 | Ligne du duo A pointant un compte du duo B refusée (FK composite) | postgres | 23503 | 23503 | 1.92 | ✅ Réussi |
| A | L06 | FIA-05 | Clé d’idempotence dupliquée dans un même duo refusée | postgres | 23505 | 23505 | 0.85 | ✅ Réussi |
| A | L07a | SEC-08 | UPDATE d’une transaction comptabilisée refusé | postgres | 23514 | 23514 | 0.77 | ✅ Réussi |
| A | L08 | TRF-15 | Contre-passation exacte acceptée | postgres | ok | OK | 4.03 | ✅ Réussi |
| A | L09 | TRF-15 | Deuxième contre-passation du même original refusée | postgres | 23505 | 23505 | 1.04 | ✅ Réussi |
| A | L10a | SEC-01 | Contre-passation depuis un autre duo refusée | postgres | 23514 | 23514 | 2.15 | ✅ Réussi |
| A | L10b | — | Contre-passation dans une autre devise refusée | postgres | 23514 | 23514 | 2.14 | ✅ Réussi |
| A | L11 | TRF-15 | Contre-passation inexacte (répartition différente) refusée | postgres | 23514 | 23514 | 2.28 | ✅ Réussi |
| A | P01 | TRF-12 | Écriture privilégiée 100,6 centimes : refus attendu (pas d’arrondi silencieux) | postgres | 22023 | OK | 2.01 | ⚠️ Constat |
| A | S01 | SEC-02 | Camille lit son duo : 1 duo, 2 membres, 6 comptes, écritures visibles | authenticated · a1000000… | ok | OK | 3.61 | ✅ Réussi |
| A | S02 | SEC-02 | Alex (partenaire) lit le même registre partagé | authenticated · a2000000… | ok | OK | 1.41 | ✅ Réussi |
| A | S03 | SEC-01 | Claire (duo B) ne voit rien du duo A | authenticated · c1000000… | ok | OK | 2.6 | ✅ Réussi |
| A | S04 | SEC-01 | Rôle anon : lecture du registre refusée | anon | 42501 ou OK | 42501 | 0.56 | ✅ Réussi |
| A | S05 | SEC-01 | Jeton authenticated sans sujet : zéro ligne | authenticated | ok | OK | 1.06 | ✅ Réussi |
| A | S06 | SEC-04 | INSERT direct d’une transaction par Camille refusé | authenticated · a1000000… | 42501 | 42501 | 0.73 | ✅ Réussi |
| A | S07 | SEC-04 | INSERT direct de lignes par Camille refusé | authenticated · a1000000… | 42501 | 42501 | 0.98 | ✅ Réussi |
| A | S08 | SEC-01 | Claire s’ajoute elle-même au duo A : refusé | authenticated · c1000000… | 42501 | 42501 | 0.61 | ✅ Réussi |
| A | S09 | SEC-04 | UPDATE direct d’un compte refusé | authenticated · a1000000… | 42501 | 42501 | 0.56 | ✅ Réussi |
| A | R01 | TRF-13 | Transfert 25,00 € cash → Loisirs : conservatif (somme du duo constante) | authenticated · a1000000… | ok | OK | 5.44 | ✅ Réussi |
| A | R02 | FIA-05 | Rejeu identique (même clé) : même identifiant, une seule transaction | authenticated · a1000000… | ok | OK | 2.55 | ✅ Réussi |
| A | R03 | FIA-06 | Même clé, 30,00 € au lieu de 25,00 € : rejet 23505, rien écrit | authenticated · a1000000… | 23505 | 23505 | 1.81 | ✅ Réussi |
| A | R04 | FIA-07 | Double appui (deux appels successifs, même clé) : une seule opération | authenticated · a1000000… | ok | OK | 2.72 | ✅ Réussi |
| A | R05 | SEC-01 | Claire écrit dans le duo A par la RPC : refusé | authenticated · c1000000… | 42501 | 42501 | 0.87 | ✅ Réussi |
| A | R06 | SEC-01 | Camille vise un compte du duo B : refusé | authenticated · a1000000… | 23503 | 23503 | 1.18 | ✅ Réussi |
| A | R07a | TRF-12 | Montant zéro refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.88 | ✅ Réussi |
| A | R07b | TRF-12 | Montant négatif refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.78 | ✅ Réussi |
| A | R07c | TRF-12 | Montant fraction de centime (0,015 €) refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.78 | ✅ Réussi |
| A | R07d | TRF-12 | Montant nul refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.82 | ✅ Réussi |
| A | R07e | TRF-12 | Montant 10^38 (hors bornes) refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.89 | ✅ Réussi |
| A | R08 | TRF-12 | Compte source = destination refusé | authenticated · a1000000… | 22023 | 22023 | 0.88 | ✅ Réussi |
| A | R09 | — | Compte de compensation exclu des transferts | authenticated · a1000000… | 23503 | 23503 | 1.07 | ✅ Réussi |
| A | R10 | — | Devise incohérente avec les comptes refusée | authenticated · a1000000… | 23503 | 23503 | 1.05 | ✅ Réussi |
| A | R11 | SEC-01 | Session anonyme Supabase (is_anonymous) refusée | authenticated · a1000000… | 42501 | 42501 | 0.67 | ✅ Réussi |
| A | R12 | SEC-01 | Jeton sans sujet refusé | authenticated | 42501 | 42501 | 0.68 | ✅ Réussi |
| A | R13 | SEC-01 | Rôle anon : exécution de la RPC refusée | anon | 42501 | 42501 | 0.68 | ✅ Réussi |
| A | R14 | SEC-02 | Alex (partenaire) écrit dans le duo A | authenticated · a2000000… | ok | OK | 2.15 | ✅ Réussi |
| A | R15 | SEC-01 | … et Claire ne voit pas cette écriture | authenticated · c1000000… | ok | OK | 0.73 | ✅ Réussi |
| A | R16 | TRF-12 | Grand montant 10^20 − 1 centimes conservé exactement | authenticated · a1000000… | ok | OK | 2.23 | ✅ Réussi |
| A | R17a | FIA-05 | Clé d’idempotence vide refusée | authenticated · a1000000… | 22023 | 22023 | 0.84 | ✅ Réussi |
| A | R17b | FIA-05 | Clé d’idempotence de 129 caractères refusée | authenticated · a1000000… | 22023 | 22023 | 0.77 | ✅ Réussi |
| A | R18 | SEC-01 | Même clé dans un autre duo : transaction distincte, aucune fuite | authenticated · c1000000… | ok | OK | 1.45 | ✅ Réussi |
| A | R19 | SEC-01 | Oracle d’appartenance fermé : is_member(duo A, Camille) refusé à Claire | authenticated · c1000000… | 42501 | 42501 | 0.63 | ✅ Réussi |
| A | R20 | SEC-01 | is_current_member : vrai pour Camille sur son duo, faux pour Claire | authenticated · a1000000… | ok | OK | 0.73 | ✅ Réussi |
| A | D01 | SEC-08 | Nouvelle table et nouvelle fonction : aucun droit implicite pour anon/authenticated | postgres | ok | OK | 5.46 | ✅ Réussi |
| A | D02 | SEC-08 | Privilèges effectifs : anon aucun, authenticated SELECT seul sur les 5 tables | postgres | ok | OK | 3.68 | ✅ Réussi |
| B | L07b | SEC-08 | DELETE d’une ligne comptabilisée refusé | postgres | 23514 | 23514 | 1.29 | ✅ Réussi |
| B | S10 | SEC-08 | DELETE direct d’une ligne refusé | authenticated · a1000000… | 42501 | 42501 | 1.46 | ✅ Réussi |
| B | S12 | SEC-08 | TRUNCATE du registre par un utilisateur connecté refusé | authenticated · a1000000… | 42501 | 42501 | 1.37 | ✅ Réussi |
| B | S13 | SEC-08 | TRUNCATE du registre par anon refusé | anon | 42501 | 42501 | 0.35 | ✅ Réussi |
| B | T01 | SEC-08 | TRUNCATE par postgres refusé (trigger, contrôles différés vidés) | postgres | 23514 | 23514 | 0.76 | ✅ Réussi |
| B | T02 | SEC-08 | TRUNCATE … CASCADE par service_role refusé | service_role | 23514 | 23514 | 0.59 | ✅ Réussi |
| B | T03 | SEC-08 | Mode réplication (postgres) : refus attendu, contournement constaté puis annulé | postgres | 23514 | P0002 | 4.19 | ⚠️ Constat |
| B | M01 | SEC-06 | Troisième membre ajouté directement en base (rôle privilégié) : refus attendu | postgres | 23514 ou P0001 | OK | 0.92 | ⚠️ Constat |
| B | S11p | SEC-06 | Contrôle préalable : Dan, encore membre, lit le duo A | authenticated · d1000000… | ok | OK | 1 | ✅ Réussi |
| B | S11a | SEC-06 | Membre retiré : il ne lit plus rien du duo A | authenticated · d1000000… | ok | OK | 1.32 | ✅ Réussi |
| B | S11b | SEC-06 | Membre retiré : écriture par la RPC refusée | authenticated · d1000000… | 42501 | 42501 | 1.04 | ✅ Réussi |
| B | S11c | SEC-06 | Retrait d’un membre qui a déjà écrit (Alex) : possible sans casser l’historique | postgres | ok | 23503 | 0.62 | ⚠️ Constat |

**Constats connus (non bloquants pour ce lot, suivis au lot 3 ou documentés)** : P01 arrondi silencieux d’une écriture privilégiée directe (les clients passent par la RPC) ; T03 le propriétaire peut désactiver les triggers en mode réplication (gestion stricte des accès administrateurs) ; M01 pas de plafond de deux membres en base ; S11c départ impossible pour un membre ayant écrit (appartenance avec statut, validée).
