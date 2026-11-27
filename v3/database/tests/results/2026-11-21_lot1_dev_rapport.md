# Lot 1 backend — exécution sur Supabase DEV (2026-11-21 04:47:37 UTC)

- **Environnement** : projet `eetnzdvjfzexgvqbtyrj` (Duo Budget V3 — DEV), PostgreSQL 17.12, migrations 20261120_001 à 004.
- **Méthode** : script SQL unique exécuté par le connecteur Supabase, dans une transaction terminée par `ROLLBACK` (aucune donnée conservée). Les rôles `authenticated` et `anon` sont réellement endossés (`SET ROLE`), le JWT est simulé par `request.jwt.claims` comme le fait PostgREST.
- **Limite** : ce n’est pas un test HTTP de bout en bout. La concurrence réelle (plusieurs connexions) et les vrais jetons Auth restent à exécuter avec `scripts/v3-finance-e2e-dev.cjs`.
- **Empreintes** : script `aa7b397fe042b02f…`, sortie brute `34c6bf883945257b…` (SHA-256).

**Bilan : 49 réussis, 2 échoués, 4 constats** sur 55 vérifications.

| ID | Matrice | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |
|---|---|---|---|---|---|---|---|
| L01 | — | Écriture équilibrée +100/−100 validée au COMMIT | postgres | ok | OK | 4.15 | ✅ Réussi |
| L02 | — | Une seule ligne d’écriture refusée au COMMIT | postgres | 23514 | 23514 | 1.79 | ✅ Réussi |
| L03 | — | Écriture déséquilibrée +100/−99 refusée | postgres | 23514 | 23514 | 2.04 | ✅ Réussi |
| L04 | — | Transaction sans ligne refusée | postgres | 23514 | 23514 | 1.09 | ✅ Réussi |
| L05 | SEC-01 | Ligne du duo A pointant un compte du duo B refusée (FK composite) | postgres | 23503 | 23503 | 2.54 | ✅ Réussi |
| L06 | FIA-05 | Clé d’idempotence dupliquée dans un même duo refusée | postgres | 23505 | 23505 | 0.76 | ✅ Réussi |
| L07a | SEC-08 | UPDATE d’une transaction comptabilisée refusé | postgres | 23514 | 23514 | 3.36 | ✅ Réussi |
| L07b | SEC-08 | DELETE d’une ligne comptabilisée refusé | postgres | 23514 | 23514 | 0.62 | ✅ Réussi |
| L08 | TRF-15 | Contre-passation exacte acceptée | postgres | ok | OK | 4.3 | ✅ Réussi |
| L09 | TRF-15 | Deuxième contre-passation du même original refusée | postgres | 23505 | 23505 | 0.97 | ✅ Réussi |
| L10a | SEC-01 | Contre-passation depuis un autre duo refusée | postgres | 23514 | 23514 | 2.06 | ✅ Réussi |
| L10b | — | Contre-passation dans une autre devise refusée | postgres | 23514 | 23514 | 2.01 | ✅ Réussi |
| L11 | TRF-15 | Contre-passation inexacte (répartition différente) refusée | postgres | 23514 | 23514 | 2.2 | ✅ Réussi |
| P01 | TRF-12 | Écriture privilégiée 100,6 centimes : refus attendu (pas d’arrondi silencieux) | postgres | 22023 | OK | 2.72 | ⚠️ Constat |
| S01 | SEC-02 | Camille lit son duo : 1 duo, 2 membres, 6 comptes, écritures visibles | authenticated · a1000000… | ok | OK | 3.97 | ✅ Réussi |
| S02 | SEC-02 | Alex (partenaire) lit le même registre partagé | authenticated · a2000000… | ok | OK | 1.2 | ✅ Réussi |
| S03 | SEC-01 | Claire (duo B) ne voit rien du duo A | authenticated · c1000000… | ok | OK | 1.91 | ✅ Réussi |
| S04 | SEC-01 | Rôle anon : lecture du registre refusée | anon | 42501 ou OK | OK | 0.47 | ✅ Réussi |
| S05 | SEC-01 | Jeton authenticated sans sujet : zéro ligne | authenticated | ok | OK | 0.71 | ✅ Réussi |
| S06 | SEC-04 | INSERT direct d’une transaction par Camille refusé | authenticated · a1000000… | 42501 | 42501 | 2.07 | ✅ Réussi |
| S07 | SEC-04 | INSERT direct de lignes par Camille refusé | authenticated · a1000000… | 42501 | 42501 | 0.98 | ✅ Réussi |
| S08 | SEC-01 | Claire s’ajoute elle-même au duo A : refusé | authenticated · c1000000… | 42501 | 42501 | 0.57 | ✅ Réussi |
| S09 | SEC-04 | UPDATE direct d’un compte refusé | authenticated · a1000000… | 42501 | 42501 | 0.61 | ✅ Réussi |
| S10 | SEC-08 | DELETE direct d’une ligne refusé | authenticated · a1000000… | 42501 | 42501 | 0.59 | ✅ Réussi |
| S12 | SEC-08 | TRUNCATE du registre par un utilisateur connecté refusé | authenticated · a1000000… | 42501 | OK | 6.58 | ❌ Échoué |
| S13 | SEC-08 | TRUNCATE du registre par anon refusé | anon | 42501 | OK | 2.41 | ❌ Échoué |
| R01 | TRF-13 | Transfert 25,00 € cash → Loisirs : conservatif (somme du duo constante) | authenticated · a1000000… | ok | OK | 13.65 | ✅ Réussi |
| R02 | FIA-05 | Rejeu identique (même clé) : même identifiant, une seule transaction | authenticated · a1000000… | ok | OK | 2.41 | ✅ Réussi |
| R03 | FIA-06 | Même clé, 30,00 € au lieu de 25,00 € : rejet 23505, rien écrit | authenticated · a1000000… | 23505 | 23505 | 2.83 | ✅ Réussi |
| R04 | FIA-07 | Double appui (deux appels successifs, même clé) : une seule opération | authenticated · a1000000… | ok | OK | 2.44 | ✅ Réussi |
| R05 | SEC-01 | Claire écrit dans le duo A par la RPC : refusé | authenticated · c1000000… | 42501 | 42501 | 0.78 | ✅ Réussi |
| R06 | SEC-01 | Camille vise un compte du duo B : refusé | authenticated · a1000000… | 23503 | 23503 | 1.07 | ✅ Réussi |
| R07a | TRF-12 | Montant zéro refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.79 | ✅ Réussi |
| R07b | TRF-12 | Montant négatif refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.77 | ✅ Réussi |
| R07c | TRF-12 | Montant fraction de centime (0,015 €) refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.79 | ✅ Réussi |
| R07d | TRF-12 | Montant nul refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.75 | ✅ Réussi |
| R07e | TRF-12 | Montant 10^38 (hors bornes) refusé (22023) | authenticated · a1000000… | 22023 | 22023 | 0.76 | ✅ Réussi |
| R08 | TRF-12 | Compte source = destination refusé | authenticated · a1000000… | 22023 | 22023 | 0.75 | ✅ Réussi |
| R09 | — | Compte de compensation exclu des transferts | authenticated · a1000000… | 23503 | 23503 | 1 | ✅ Réussi |
| R10 | — | Devise incohérente avec les comptes refusée | authenticated · a1000000… | 23503 | 23503 | 0.99 | ✅ Réussi |
| R11 | SEC-01 | Session anonyme Supabase (is_anonymous) refusée | authenticated · a1000000… | 42501 | 42501 | 0.67 | ✅ Réussi |
| R12 | SEC-01 | Jeton sans sujet refusé | authenticated | 42501 | 42501 | 0.66 | ✅ Réussi |
| R13 | SEC-01 | Rôle anon : exécution de la RPC refusée | anon | 42501 | 42501 | 0.64 | ✅ Réussi |
| R14 | SEC-02 | Alex (partenaire) écrit dans le duo A | authenticated · a2000000… | ok | OK | 1.86 | ✅ Réussi |
| R15 | SEC-01 | … et Claire ne voit pas cette écriture | authenticated · c1000000… | ok | OK | 0.6 | ✅ Réussi |
| R16 | TRF-12 | Grand montant 10^20 − 1 centimes conservé exactement | authenticated · a1000000… | ok | OK | 1.9 | ✅ Réussi |
| R17a | FIA-05 | Clé d’idempotence vide refusée | authenticated · a1000000… | 22023 | 22023 | 0.78 | ✅ Réussi |
| R17b | FIA-05 | Clé d’idempotence de 129 caractères refusée | authenticated · a1000000… | 22023 | 22023 | 0.8 | ✅ Réussi |
| R18 | SEC-01 | Même clé dans un autre duo : transaction distincte, aucune fuite | authenticated · c1000000… | ok | OK | 1.37 | ✅ Réussi |
| R19 | SEC-01 | Oracle d’appartenance : Claire interroge is_member(duo A, Camille) | authenticated · c1000000… | ok | P0001 | 0.68 | ⚠️ Constat |
| M01 | SEC-06 | Troisième membre ajouté directement en base (rôle privilégié) : refus attendu | postgres | 23514 ou P0001 | OK | 0.83 | ⚠️ Constat |
| S11p | SEC-06 | Contrôle préalable : Dan, encore membre, lit le duo A | authenticated · d1000000… | ok | OK | 0.75 | ✅ Réussi |
| S11a | SEC-06 | Membre retiré : il ne lit plus rien du duo A | authenticated · d1000000… | ok | OK | 1.1 | ✅ Réussi |
| S11b | SEC-06 | Membre retiré : écriture par la RPC refusée | authenticated · d1000000… | 42501 | 42501 | 0.8 | ✅ Réussi |
| S11c | SEC-06 | Retrait d’un membre qui a déjà écrit (Alex) : possible sans casser l’historique | postgres | ok | 23503 | 0.76 | ⚠️ Constat |
