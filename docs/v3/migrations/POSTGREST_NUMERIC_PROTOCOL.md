# Protocole de qualification HTTP PostgREST — montants `numeric` transmis en chaînes (N01–N18)

| Élément | Valeur |
|---|---|
| Version | 27/11/2026, R3-02. Remplace le protocole « préparé » du 27/11 au matin. |
| Lieu d'exécution | **Exclusivement** sur une réplique PostgreSQL **jetable** créée et détruite par le harnais, avec une instance PostgREST **locale** (127.0.0.1, port aléatoire). |
| Interdits | Aucune requête HTTP d'écriture vers DEV. Aucune exécution sur DEV. |
| Harnais | `v3/database/qualification/postgrest/pgrst_qualify.py`, évaluation par le contrat mobile via `eval_contract.ts`. |
| Autorisation | TECH-ARB-1 (27/11) : qualification sur environnement isolé et bases jetables, sans contournement de permissions. |

## 1. Isolation

1. Le harnais crée la base `pgrst_<aléatoire>` sur la réplique locale, par socket Unix. Il la construit à partir des fichiers de migration du dépôt indiqué (`--migrations-dir`) et la détruit à la fin. Sa destruction est vérifiée et consignée (`base_detruite`).
2. PostgREST se connecte à cette seule base, par socket, avec le rôle `authenticator`. Il écoute sur 127.0.0.1.
3. Le secret JWT est aléatoire, propre au processus. Les jetons de test sont signés localement.
4. Les variables libpq (`PG*`) sont retirées de l'environnement des processus.
5. Les comptes de test sont `@example.invalid`. Les duos de test sont créés en SQL : les RPC de gestion G-A n'existent pas encore.

## 2. Cas (identifiants communs au harnais, au dossier GO/NO GO et aux rapports)

Chaque cas d'écriture est appliqué en EUR, USD et XAF, sur un duo neuf. Il est suivi d'une relecture HTTP de l'instantané des fonds.

| ID | Entrée (corps JSON brut de `rpc/duo_v3_post_contribution`) | Attendu |
|---|---|---|
| N01 | `"9007199254740993"` (2^53+1) | 200 ; trésorerie relue `"9007199254740993"` ; 0 nombre JSON |
| N02 | `9007199254740993` (nombre JSON) | 200, valeur exacte côté serveur. **Forme interdite côté client** : un `Number` JavaScript l'aurait arrondie avant l'envoi. |
| N03 | `"9…9"` (10^38−1) | 200 ; relecture exacte |
| N04 | `"1000…0"` (1 suivi de 38 zéros, 10^38) | 400 (22023) |
| N05 | `"100.0"` | **400** (23514, NUM-01) ; instantané resté lisible |
| N06 | `"1.5"` | 400 (22023) |
| N07 | `"1e3"` | 200, normalisé à 1000. Refusé côté client par `parseAmount` (ticket Sprint 4). |
| N08a / N08b | `"+7"` / `" 42 "` | 200, normalisés |
| N09a / N09b | `"0"` / `"-5"` | 400 (22023) |
| N10a / N10b / N10c | `"abc"` / `""` / `null` | 400 (22P02, 22P02, 22023) |
| N11a / N11b | `"NaN"` / `"Infinity"` | 400 (22023) |
| N12 | Dépense, mouvement de fonds, contribution affectée (montant dans `p_assignments`, jsonb) au-delà de 2^53 ; les mêmes avec `"100.0"`, `"1.0"` et `"10.0"` | 200 ×3 ; 400 ×3 ; trésorerie exacte |
| N13 | Instantané d'enveloppes 006r1 | 0 nombre JSON |
| N14 | Rejeu de la même clé, même montant | 200, même identifiant |
| N15 | Même clé, autre montant | 409 (23505) |
| N16 | `p_amount_minor` absent | 404 (PGRST202) |
| N17 | JWT d'un non-membre | 403 (42501), aucune donnée du duo |
| N18 | Sans JWT | 401 |
| D-01 | Instantané lu par un non-membre | Réponse neutre (`household: null`, `envelopes: []`) |
| D-02 / D-03 | JWT expiré / mal signé | 401 (PGRST301) |
| D-04 / D-05 | Fonction privée par `Content-Profile: duo_v3_private` / dans `public` | 406 (PGRST106) / 404 (PGRST202) |
| D-06 / D-07 | Écriture ou suppression directe dans le grand livre | 403 |
| D-08 / D-09 | Lecture des transactions d'un autre duo / en anonyme | `[]` (RLS) / 401 |
| NUM-01-HTTP | Tous les instantanés relus, passés aux validateurs du contrat | 100 % valides |
| ERR-PUBLIC | Toutes les erreurs HTTP passées à `errorFromPostgrest` | Message public, 0 fuite |

## 3. Version de PostgREST

La qualification locale utilise **PostgREST 12.2.3**, binaire officiel GitHub, sha256 `870a77f49508479bc87c5504b6b0c3715c7220926932d916b0d73952b297c617`.

Avant toute autorisation DEV :
1. relever la version servie par DEV **en lecture seule** : en-tête `Server` d'une requête anonyme `GET /rest/v1/`, ou tableau de bord ;
2. si elle diffère, rejouer le harnais localement avec cette version.

Aucune autre requête n'est faite vers DEV.

## 4. Critères

| Critère | Condition |
|---|---|
| Réussite | Tous les cas conformes sur le fichier 006r1 visé par l'autorisation. |
| Arrêt | Une valeur relue différente de la valeur envoyée ; un nombre JSON dans une lecture ; N05 accepté ; un instantané invalide pour le contrat ; un message brut exposé. |
