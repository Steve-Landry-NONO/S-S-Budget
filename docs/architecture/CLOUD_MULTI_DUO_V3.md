# Duo Budget V3 — Architecture cloud multi-duos (proposition)

**Statut : conception, non déployée.** Branche `design/cloud-multi-duo-architecture`. La V3.0.7 Figma reste gelée et le backend SQLite V2 inchangé.

## 1. État de départ vérifié

Le backend V2 est une API Express/SQLite (`server/src/index.js`, `server/src/db.js`, `server/schema.sql`). Le schéma comprend `members`, `categories`, `expenses`, `contributions`, `activity_logs`. Authentification PIN, rôles `admin/member`, journalisation, opérations `planned/done`. Les migrations attribuent historiquement `admin` à `steve` et le schéma insère deux membres et cinq enveloppes par défaut. Ces mécanismes ne conviennent pas à un service multi-clients.

## 2. Objectif et frontières

- Application iOS/Android Expo, authentification cloud, espaces `duos` isolés, deux membres maximum **pour le MVP** (à confirmer produit).
- PostgreSQL comme source de vérité, Auth Supabase comme candidat d'identité, politiques RLS côté base, HTTPS et permissions côté API/RPC.
- Le poste Ubuntu et Codespaces servent au développement, jamais à l'hébergement permanent.
- Pas de synchronisation de données financières réelles, pas de secrets dans Git ni dans l'app.
- Les données fictives pré-authentification Duo Glance restent locales et clairement identifiées.

## 3. Modèle de données candidat

`auth.users` (géré par le fournisseur d'identité) -> `duos` + `duo_memberships` (clé composite `duo_id,user_id`, rôle `owner/member`). Les tables `envelopes`, `expenses`, `contributions`, `activity_logs` portent `duo_id`. Les références à une enveloppe sont composites `(duo_id,envelope_id)` pour empêcher toute association inter-duos. Les membres acteurs sont référencés par `user_id`, et les actions sensibles doivent vérifier leur appartenance au duo.

Le fichier `docs/architecture/cloud-multi-duo-schema.draft.sql` est un **schéma de discussion non exécutable en production** : aucune politique d'écriture ni aucun droit d'accès client n'est accordé.

## 4. Règles financières à préserver

- Montants stockés en `numeric(18,2)` (devise unique EUR pour le MVP **à confirmer** ; si multi-devises, revoir précision et conversion).
- Solde réel calculé exclusivement à partir des opérations `done`; les `planned` ne modifient que le prévisionnel.
- Objectifs budgétaires et contributions attendues ne sont jamais assimilés à de l'argent disponible.
- Reports mensuels, verrouillage des enveloppes, dates de réalisation, transferts et corrections doivent être spécifiés et testés contre la V2 avant migration.
- Les écritures liées doivent être atomiques, idempotentes si rejouées, et historisées.

## 5. Sécurité à vérifier avant tout déploiement

- RLS activée sur toutes les tables applicatives exposées. Aucune règle « tout utilisateur authentifié peut tout lire ».
- Ne jamais utiliser `user_metadata` pour autoriser une opération; jamais de clé `service_role` dans Expo.
- L'invitation d'un membre, le transfert de propriété, la suppression d'un duo, l'export et la restauration exigent des workflows contrôlés côté serveur avec vérification de l'identité, de l'appartenance et du rôle.
- La politique de lecture seule proposée doit être auditée contre les risques de récursion RLS, d'accès croisé et d'exposition de données personnelles avant activation.
- Refuser par défaut les accès anonymes et les écritures directes tant que les règles métier ne sont pas codées et testées.
- Ne pas répliquer les seeds `steve`/`sorelle` ni le rôle admin codé en dur.

## 6. Recette de sécurité et métier (à automatiser)

| Scénario | Résultat attendu |
| --- | --- |
| Utilisateur A du duo 1 lit ses enveloppes | Autorisé |
| Utilisateur A du duo 1 lit les dépenses du duo 2 | Refusé, aucune ligne |
| Utilisateur A crée une dépense avec `duo_id` d'autrui | Refusé |
| Utilisateur A référence une enveloppe du duo 2 | Refusé par clé composite et autorisation |
| Utilisateur anonyme interroge les tables | Refusé |
| Membre sans droit modifie rôles ou invitations | Refusé |
| Dépense future saisie | N'affecte pas le solde réel |
| Modification `planned` vers `done` | Actualise réel et prévisionnel sans double comptage |
| Deux dépenses simultanées | Pas de perte d'écriture ni d'incohérence |
| Deux requêtes identiques rejouées | Pas de double opération lorsque clé d'idempotence fournie |
| Suppression d'un compte / duo | Politique de conservation, suppression et audit validée |

## 7. Plan de livraison proposé

1. Valider les décisions produit : duo limité à deux personnes, invitation, devise, rôles, suppression, partage des opérations.
2. Auditer les fonctions V2 dans `server/src/index.js` (calculs, autorisations, exports, sauvegardes) et créer des tests de référence.
3. Mettre en place un environnement PostgreSQL **de développement** séparé, avec migrations versionnées.
4. Écrire et tester les politiques RLS et fonctions transactionnelles; vérifier la séparation de deux duos fictifs.
5. Intégrer Auth et les écrans V3 dans une PR distincte, puis recette iPhone/Android.
6. Effectuer audit sécurité, sauvegardes, restauration et conformité avant bêta.

**Non fait :** projet Supabase, base cloud, authentification V3, RLS exécutée, migrations et tests d'intégration.