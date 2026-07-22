# Patch V2.7 — Notifications locales et centre d’alertes

## Objectif

Permettre à chaque utilisateur de voir qu’il existe des activités du journal qu’il n’a pas encore consultées, sans dépendre de vraies notifications push distantes entre téléphones.

Ce patch met en place :

- un centre d’alertes interne à l’application (badge + indicateurs) ;
- une notion d’activité « lue / non lue » **par membre** ;
- la préparation du terrain pour de vraies notifications push dans un patch futur.

Il n’ajoute **aucune** notification système (pas de push distant, pas de dépendance `expo-notifications`). Voir la section « Centre d’alertes vs push » plus bas pour l’explication de ce choix.

## Fichiers modifiés

- `server/schema.sql` — nouvelle colonne `read_by_member_ids` sur `activity_logs`.
- `server/src/db.js` — migration automatique de la colonne (nouvelle base et base existante).
- `server/src/index.js` — écriture/lecture de `read_by_member_ids`, nouvelles routes de marquage lu.
- `App.js` — badge sur l’onglet Journal, badge « Nouveau » par entrée, boutons de marquage lu.

Aucun changement dans `package.json`, `server/data`, `server/backups`, les assets ou le logo.

## Modèle de données

`activity_logs` gagne une colonne :

```sql
read_by_member_ids TEXT NOT NULL DEFAULT '[]'
```

C’est une liste JSON des `member_id` ayant déjà vu cette activité (ex. `["steve"]`, `["steve","sorelle"]`). On reste sur `activity_logs` directement (pas de table séparée) car le volume est faible (foyer à 2 personnes, quelques centaines de lignes) et ça évite une jointure supplémentaire à chaque lecture du journal.

**Choix pour l’auteur d’une action** : à la création d’un log, `read_by_member_ids` est initialisé à `[actor_member_id]` — l’auteur de l’action est donc considéré comme l’ayant déjà « lue ». Raison : c’est le cas le plus simple à raisonner (pas de logique spéciale côté client pour exclure ses propres actions du badge), et ça correspond à l’usage réel : on sait déjà ce qu’on vient de faire, le badge doit signaler ce que **l’autre** personne a fait. Une activité créée par Steve apparaît donc immédiatement « non lue » pour Sorelle, et vice versa.

## Migration SQLite

Dans `server/src/db.js`, `migrateDb()` :

```js
await addColumnIfMissing(db, 'activity_logs', 'read_by_member_ids', "TEXT NOT NULL DEFAULT '[]'");
...
await db.run("UPDATE activity_logs SET read_by_member_ids = '[]' WHERE read_by_member_ids IS NULL OR TRIM(read_by_member_ids) = ''");
```

- `addColumnIfMissing` vérifie d’abord `PRAGMA table_info` — la migration ne casse rien si la colonne existe déjà (redémarrages multiples, bases déjà migrées).
- Le `UPDATE` de sécurité garantit que même une valeur `NULL` ou vide (par ex. si une valeur incohérente était présente) redevient `'[]'`, jamais `NULL`.
- Aucune ligne d’`activity_logs` n’est supprimée ou réécrite dans son contenu métier (label, montant, date, détails inchangés).
- Testé manuellement sur une base reconstituée avec l’ancien schéma (sans la colonne) : la migration s’applique sans erreur, les logs et les membres existants sont conservés, et l’ancien log récupère `read_by_member_ids = []` (personne, y compris l’auteur d’origine, n’est marqué comme l’ayant lu — c’est un historique antérieur à la fonctionnalité).

`server/schema.sql` inclut aussi la colonne dans la définition `CREATE TABLE IF NOT EXISTS activity_logs`, pour qu’une toute nouvelle base parte directement avec le bon schéma.

## Routes API

Toutes derrière le même mécanisme d’identification déjà en place (header `x-ss-budget-user-id`, lu par `getCurrentUser(req)` — le sujet demandait `x-ss-budget-member-id` mais le mécanisme existant du projet utilise déjà `x-ss-budget-user-id` sur toutes les routes ; c’est celui-ci qui est réutilisé pour rester cohérent avec le reste de l’API).

- `GET /api/activity-logs` — inchangé dans son usage, renvoie maintenant aussi `readByMemberIds` (tableau) pour chaque entrée.
- `GET /api/state` — `activityLogs` inclut également `readByMemberIds` (utilisé par le polling 15s déjà en place dans l’app).
- `POST /api/activity-logs/:id/read` — marque une activité comme lue pour l’utilisateur courant (ajoute son id à `read_by_member_ids` s’il n’y est pas déjà). Retourne l’état complet (même format que les autres routes de mutation).
- `POST /api/activity-logs/read-all` — marque **toutes** les activités comme lues pour l’utilisateur courant (parcourt la table entière, pas seulement les 100/200 dernières affichées, pour rester correct même si l’historique grandit). Retourne l’état complet.

Ces deux routes ne posent pas de nouvelle entrée dans le journal (marquer une activité comme lue n’est pas elle-même une « activité » à journaliser, pour éviter le bruit).

## Frontend (App.js)

- L’onglet « Journal » affiche désormais `Journal • N` quand l’utilisateur courant a `N` activités non lues (calculé côté client à partir de `readByMemberIds`), sinon simplement `Journal`.
- Dans l’onglet Journal :
  - un résumé texte (« X activité(s) non lue(s) pour vous » / « Tout est à jour pour vous ») ;
  - un bouton **« Tout marquer comme lu »**, visible seulement s’il reste des activités non lues ;
  - chaque activité non lue affiche un badge **« Nouveau »** à côté du nom de l’auteur ;
  - chaque activité non lue a son propre bouton **« Marquer comme lu »**.
- **Important : ouvrir l’onglet Journal ne marque rien comme lu automatiquement.** C’était une exigence explicite du patch — la lecture doit être un geste volontaire (bouton individuel ou « Tout marquer comme lu »), pas un effet de bord de la navigation.
- En cas de serveur injoignable, le marquage suit le même schéma que le reste de l’app (`mutate()`) : mise à jour optimiste locale de `readByMemberIds` + message « Serveur non disponible / Action appliquée en local uniquement », strictement identique au comportement déjà présent pour les dépenses/versements.
- Le journal garde toutes les améliorations de lisibilité de la V2.4.1 (noms humains, `Pour :`, `Payé par :`, `Action réalisée par :`) — rien n’a été retiré, seulement ajouté autour.

## Centre d’alertes interne vs vraies notifications push

Ce patch reste volontairement dans l’app :

- **Centre d’alertes interne (ce patch)** : badge dans l’app, calculé à la demande (au chargement de l’état ou au polling 15s existant), visible uniquement quand l’app est ouverte. Aucune permission système requise, aucune dépendance ajoutée, compatible Expo Go tel quel.
- **Vraies notifications push (patch futur)** : nécessiteraient `expo-notifications`, la demande de permission système, un canal de notification Android, et surtout un mécanisme de livraison quand l’app est fermée (push distant via Expo Push Service, ou a minima une notification locale programmée pendant que l’app tourne en arrière-plan). `expo-notifications` **n’est pas installé** dans ce projet (`package.json` ne le liste pas) — conformément à la consigne du patch, je n’ai pas ajouté cette dépendance sans validation explicite. La table `activity_logs.read_by_member_ids` posée ici est directement réutilisable comme base pour déclencher ces futures notifications (il suffira de détecter, après chaque synchronisation, les nouvelles lignes non lues pour l’utilisateur courant et de les transformer en notifications locales/push).

## Tests effectués

Testé manuellement en local avec le serveur Node (base SQLite temporaire, dépendances `server/node_modules` installées puis conservées car `node_modules/` est déjà ignoré par git) :

1. Démarrage sur une base neuve → tables créées avec `read_by_member_ids` dès la création.
2. `POST /api/expenses` en tant que `steve` → le log créé a bien `readByMemberIds: ["steve"]`.
3. `GET /api/state` avec `x-ss-budget-user-id: sorelle` → le même log apparaît avec `readByMemberIds: ["steve"]`, donc non lu pour Sorelle.
4. `POST /api/activity-logs/:id/read` en tant que `sorelle` → `readByMemberIds` devient `["steve","sorelle"]`.
5. Ajout d’un versement, vérification du compteur de non-lus pour Sorelle (1), puis `POST /api/activity-logs/read-all` en tant que `sorelle` → compteur revenu à 0 ; compteur de Steve (l’auteur) resté à 0 tout du long.
6. **Migration sur base existante** : construction d’une base avec l’ancien schéma V2.6 (sans la colonne, avec un log historique), démarrage du serveur patché dessus → démarrage sans erreur, membres et catégories intacts, ancien log conservé avec `readByMemberIds: []`, marquage lu fonctionnel dessus.

### Commandes de test manuelles (reproductibles)

```bash
# Démarrer le serveur sur une base de test
cd server
npm install
DB_PATH=./data/test-v27.sqlite PORT=3901 npm run dev

# Dans un autre terminal
curl -s http://localhost:3901/api/health

curl -s -X POST http://localhost:3901/api/expenses \
  -H 'Content-Type: application/json' -H 'x-ss-budget-user-id: steve' \
  -d '{"label":"Test","amount":10,"categoryId":"weekends","paidByMemberId":"steve","date":"2026-07-20"}'

curl -s -H 'x-ss-budget-user-id: sorelle' http://localhost:3901/api/activity-logs

# Remplacer <id> par l'id du log renvoyé ci-dessus
curl -s -X POST -H 'x-ss-budget-user-id: sorelle' http://localhost:3901/api/activity-logs/<id>/read
curl -s -X POST -H 'x-ss-budget-user-id: sorelle' http://localhost:3901/api/activity-logs/read-all
```

Côté app : lancer `npm start`, se connecter au serveur de test, ajouter une action depuis un profil (`Membres` → changer d’utilisateur), vérifier :

- le badge `Journal • N` apparaît/disparaît correctement selon l’utilisateur courant sélectionné ;
- le badge « Nouveau » s’affiche sur les bonnes entrées ;
- « Tout marquer comme lu » fait retomber le compteur à zéro ;
- le bouton individuel « Marquer comme lu » fonctionne activité par activité ;
- ouvrir l’onglet Journal seul ne fait pas disparaître le badge sans action explicite.

## Limites actuelles

- Pas de notification système, pas de push : l’utilisateur doit ouvrir l’app et l’onglet Journal pour voir le badge.
- `read-all` parcourt toute la table `activity_logs` ligne par ligne dans une transaction ; suffisant pour le volume actuel (foyer à 2 personnes), à revoir si le journal grossit énormément (des dizaines de milliers de lignes).
- Le badge de l’onglet et le compteur sont calculés côté client à partir des données déjà chargées (`/api/state`, limité à 100 lignes) : une activité très ancienne, au-delà de cette limite, ne sera jamais comptée comme non lue même si elle ne l’a jamais été.

## Version

Tag recommandé : `v2.7`
