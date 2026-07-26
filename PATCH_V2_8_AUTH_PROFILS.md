# Patch V2.8 — Authentification par PIN et verrouillage des profils

## Objectif

Jusqu'à la V2.7.1, n'importe qui tenant un téléphone pouvait basculer librement entre les profils Steve et Sorelle via un simple sélecteur, sans aucune vérification. Pire : côté serveur, l'identité de l'auteur d'une action reposait entièrement sur un header HTTP (`x-ss-budget-user-id`) que le client choisissait librement — n'importe quel appareil sur le réseau Tailscale pouvait usurper l'un ou l'autre membre.

Comme l'identité sert maintenant aux droits admin/membre, aux suppressions/modifications, au journal d'activité et aux activités non lues, ce n'était plus acceptable. Ce patch ajoute une authentification par PIN, vérifiée côté serveur, et supprime le changement de profil libre.

## Pourquoi l'authentification arrive avant les notifications push (V2.9)

Des notifications push par membre n'ont de sens que si le serveur sait, avec certitude, à qui les envoyer et pour le compte de qui une action a été réalisée. Construire les push sur une identité non vérifiée (V2.7.1) aurait signifié notifier — ou usurper — la mauvaise personne. L'auth PIN devient donc le socle d'identité fiable sur lequel la V2.9 pourra s'appuyer (jeton associé à un appareil/canal de notification, etc.).

## Colonnes ajoutées (`members`)

- `pin_salt TEXT NOT NULL DEFAULT ''`
- `pin_hash TEXT NOT NULL DEFAULT ''`
- `failed_pin_attempts INTEGER NOT NULL DEFAULT 0`
- `pin_locked_until TEXT`

`pin_hash` vide signifie « PIN pas encore défini ». La migration dans `server/src/db.js` (`addColumnIfMissing`) est additive : aucune donnée existante n'est supprimée, Steve et Sorelle restent utilisables immédiatement après mise à jour, simplement sans PIN tant qu'ils n'en ont pas créé un.

## Logique de hash du PIN

- Le PIN n'est **jamais** stocké ni journalisé en clair.
- Hash via `crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha512')` (module natif Node, aucune dépendance ajoutée), avec un sel aléatoire de 16 octets (`crypto.randomBytes`) par membre.
- Comparaison en temps constant (`crypto.timingSafeEqual`) pour éviter les attaques par mesure de temps.
- Format accepté : 4 à 8 chiffres (`/^\d{4,8}$/`). Tout autre format est rejeté (`code: 'PIN_FORMAT'`).

## Logique du jeton d'authentification (HMAC stateless)

- À la connexion réussie (`POST /api/auth/login`), le serveur émet un jeton `payload_base64url.signature_base64url` où `payload = { memberId, role, iat, exp }`.
- Signature HMAC-SHA256 avec `APP_SECRET` (celui déjà utilisé pour protéger l'API). Si `APP_SECRET` est absent ou laissé à sa valeur d'exemple, le serveur retombe sur une clé de développement codée en dur (`ss-budget-dev-insecure-secret-changez-moi`) et affiche un avertissement au démarrage — **à ne jamais utiliser en usage réel**.
- Le codage base64url est fait manuellement (remplacement de caractères) plutôt qu'avec l'encodage natif `'base64url'` de Node, pour rester compatible avec une version de Node plus ancienne éventuellement installée sur le vieux PC serveur.
- Validité par défaut : 12h (`AUTH_TOKEN_TTL_HOURS`). Aucune révocation possible avant expiration : le jeton est stateless par choix (pas de table de sessions à gérer). Voir « Limites actuelles ».
- Chaque route protégée vérifie **à la fois** le jeton et la cohérence avec le header `x-ss-budget-user-id` (défense en profondeur demandée) : un jeton valide mais associé à un autre `memberId` que celui déclaré dans le header est rejeté.

## Compteur d'échecs et verrouillage temporaire

- `PIN_MAX_ATTEMPTS` (défaut 5) : au-delà, le profil est verrouillé `PIN_LOCK_MINUTES` (défaut 15) minutes, et le compteur est remis à zéro.
- S'applique à la fois à `POST /api/auth/login` et à la vérification du `currentPin` dans `POST /api/auth/set-pin` (les deux consomment le même secret).
- Un verrouillage déclenché est journalisé (`login_locked`) pour que l'autre membre du couple voie, dans l'onglet Journal, que quelqu'un a échoué à plusieurs reprises sur un profil — transparence volontaire pour un usage à deux. En revanche, les échecs individuels (avant verrouillage) ne sont **pas** journalisés un par un, pour ne pas polluer le journal à chaque faute de frappe.

## Routes ajoutées

### `GET /api/auth/status` (publique)
Retourne la liste des membres avec `pinSet` (bool), `locked` (bool), `lockedUntil` (ISO ou `null`). Ne retourne **jamais** `pin_hash` ni `pin_salt`. Sert à afficher l'écran de connexion avant qu'un jeton existe.

### `POST /api/auth/set-pin` (publique, auto-protégée)
Body : `{ memberId, pin, currentPin? }`.
- Si aucun PIN n'existe pour ce membre : création directe (bootstrap), pas de `currentPin` requis.
- Si un PIN existe déjà : `currentPin` obligatoire et vérifié (mêmes règles de verrouillage que le login).
- Journalise `pin_created` ou `pin_updated`.

### `POST /api/auth/login` (publique, c'est le point d'entrée)
Body : `{ memberId, pin }`. Vérifie le PIN, remet `failed_pin_attempts` à 0 en cas de succès, renvoie `{ member, authToken, expiresAt }`. En cas d'échec : incrémente le compteur, verrouille au seuil. Journalise `member_login` en cas de succès, `login_locked` si le verrouillage se déclenche.

### Pas de `POST /api/auth/logout` côté serveur
Choix assumé : le jeton étant stateless (aucune table de sessions), le serveur n'a rien à invalider — une déconnexion « serveur » nécessiterait une liste de révocation, de l'état supplémentaire, et irait à l'encontre du choix « stateless » validé pour ce patch. La déconnexion est donc gérée **côté app uniquement** : elle efface le jeton et la date d'expiration stockés localement (`App.js`, fonction `logout`), ce qui suffit à forcer une nouvelle saisie de PIN à la prochaine action.

## Routes protégées (nécessitent `requireAuth`, certaines aussi `requireAdminRole`)

- Membres, caisses : création/modification/suppression → `requireAuth` + `requireAdminRole` (déjà admin avant ce patch, migré vers la nouvelle vérification de jeton).
- Dépenses, versements, versements automatiques : création/modification/suppression → `requireAuth` (la vérification de propriété `paid_by_member_id`/`created_by_member_id` utilise maintenant `req.currentUser`, garanti authentique).
- Journal : lecture (`GET /api/activity-logs`) et marquage lu (`POST .../read`, `.../read-all`) → `requireAuth`.
- Sauvegardes, exports JSON/CSV, restauration, reset → `requireAuth` + `requireAdminRole` (déjà admin avant ce patch).
- **`GET /api/state` → `requireAuth` (nouveau)**. Avant ce patch, l'intégralité des données (dépenses, versements, journal) était lisible par quiconque atteignait l'API, sans aucune vérification d'identité. Ce n'était pas listé explicitement dans la demande initiale, mais laisser cette lecture ouverte aurait vidé le patch de son sens : autant verrouiller les écritures si la lecture complète reste libre. Comme l'app exige désormais une connexion avant tout usage, ce resserrement ne casse rien côté client.

## Routes restées publiques (justification)

- **`GET /api/health`** : simple test de connectivité (nom de l'app, chemin de la base, heure serveur). Nécessaire pour configurer l'URL du serveur avant même de pouvoir se connecter. Exposition minimale, déjà protégée par le secret API partagé si `APP_SECRET` est configuré.
- **`GET /api/auth/status`** : doit être accessible avant qu'un jeton existe, pour afficher l'écran de connexion (liste des membres, PIN défini ou non, verrouillage en cours). Ne renvoie que des booléens, jamais de PIN.
- **`POST /api/auth/set-pin` et `POST /api/auth/login`** : ce sont les routes qui *produisent* l'authentification — elles ne peuvent pas exiger elles-mêmes le jeton qu'elles délivrent. Leur sécurité repose sur le PIN (hash + sel + verrouillage) et, en amont, sur le secret API partagé (`APP_SECRET`) qui protège déjà tout `/api/*` — voir « Choix de sécurité ».

## Choix de sécurité

- **Deux couches indépendantes** : le secret API partagé (`x-ss-budget-secret`, existant depuis une version antérieure) protège l'accès réseau à l'API elle-même ; le PIN protège l'identité *à l'intérieur* de cet accès. Configurer `APP_SECRET` reste fortement recommandé, d'autant plus maintenant qu'il sert aussi de clé de signature des jetons.
- **Bootstrap du premier PIN non protégé par un secret PIN** : la création d'un PIN quand aucun n'existe encore ne demande pas de preuve d'identité préalable (impossible autrement, PIN inexistant). C'est un compromis assumé pour une app privée à deux, dont l'atténuation principale est `APP_SECRET` : sans lui, quiconque atteint l'API peut créer le premier PIN d'un profil ; avec lui, seul un appareil connaissant déjà le secret partagé le peut.
- **Jeton stateless plutôt que sessions en base** : plus simple à opérer sur un serveur self-hosted sans infrastructure dédiée, au prix de l'impossibilité de révoquer un jeton avant expiration (d'où un TTL de 12h par défaut, pas plus).
- **PIN 4 à 8 chiffres, pas un mot de passe** : proportionné à un usage privé à deux sur réseau Tailscale fermé, pas à une exposition publique. Le verrouillage temporaire après 5 échecs compense la faible entropie.

## Limites actuelles

- Pas de révocation de jeton avant expiration (choix stateless assumé ci-dessus).
- Le premier PIN d'un profil peut être créé par quiconque atteint l'API tant qu'aucun PIN n'existe — atténué par `APP_SECRET`.
- Pas de limite de débit (rate limiting) au niveau réseau/IP, seulement par membre côté PIN : un attaquant pourrait distribuer ses tentatives sur plusieurs membres en parallèle sans jamais atteindre le seuil sur un seul. Risque jugé faible sur un réseau Tailscale privé à deux personnes.
- Le stockage local du jeton utilise AsyncStorage (non chiffré), pas `expo-secure-store` : décision explicitement validée pour ce patch (app privée à deux, `expo-secure-store` non installé pour ne pas ajouter de dépendance non nécessaire). À revoir si l'app doit un jour être installée sur un appareil moins maîtrisé.

## Fichiers modifiés

- `server/schema.sql` — colonnes PIN sur `members` (installs neuves).
- `server/src/db.js` — migration additive des mêmes colonnes (bases existantes).
- `server/src/index.js` — hash PIN, jeton HMAC, middlewares `requireAuth`/`requireAdminRole`, routes `/api/auth/*`, protection des routes existantes.
- `server/.env.example` — documentation d'`APP_SECRET` (double rôle) et des variables optionnelles `PIN_MAX_ATTEMPTS`, `PIN_LOCK_MINUTES`, `AUTH_TOKEN_TTL_HOURS`.
- `App.js` — écran de connexion par PIN, suppression du sélecteur de profil libre, modales « Changer de profil » et « Modifier mon PIN », gestion du jeton (stockage, expiration, erreurs 401).

Aucun changement dans `server/data`, `server/backups`, les assets/logo/splash, ou le README.

## Tests effectués pendant le développement (serveur, via curl)

- Migration d'une base V2.7.1 simulée (sans colonnes PIN) : démarrage sans erreur, colonnes ajoutées, membres existants conservés avec `pin_hash` vide.
- Création de PIN pour Steve et Sorelle, connexion réussie pour les deux.
- `GET /api/state` refusé (401 `AUTH_REQUIRED`) sans jeton, accepté avec un jeton valide.
- Usurpation testée : header `x-ss-budget-user-id` seul (sans jeton) → rejeté. Jeton valide de Steve combiné à un header `x-ss-budget-user-id: sorelle` → rejeté.
- 5 échecs de PIN consécutifs sur un profil → verrouillage 15 minutes, visible dans `GET /api/auth/status` (`locked: true`, `lockedUntil`).
- Dépense créée par Steve authentifié ; tentative de suppression par Sorelle authentifiée refusée (403, règle de propriété inchangée).
- Route admin (`POST /api/categories`) testée avec le jeton d'un membre non-admin → 403.
- Journal d'activité vérifié : `pin_created`, `member_login`, `login_locked` apparaissent avec le bon auteur et les bons `readByMemberIds`.

## Tests à effectuer côté app (Expo Go)

- Ancienne base SQLite (V2.7.1) démarre sans erreur après mise à jour du serveur ; colonnes PIN bien migrées (vérifiable via `PRAGMA table_info(members)`).
- Premier lancement : écran de connexion affiché, création du PIN de Steve puis de Sorelle.
- Connexion avec bon PIN → accès à l'app ; mauvais PIN → message clair, pas d'accès.
- Verrouillage temporaire après plusieurs mauvais PIN → message « Profil temporairement verrouillé », compte à rebours affiché.
- Impossible de changer de profil sans repasser par l'écran/modale PIN (sélecteur libre supprimé de l'onglet Membres et de la Configuration).
- Actions (dépenses, versements, modifications, suppressions) toujours attribuées au bon auteur dans le journal.
- Badges d'activités non lues toujours corrects par membre.
- Sauvegardes/export toujours réservés à l'admin et fonctionnels.
- Reports mensuels (report précédent, solde prévisionnel) inchangés — ce patch ne touche à aucune logique de calcul.
- Expiration de session (attendre le TTL ou le forcer en réduisant `AUTH_TOKEN_TTL_HOURS` en test) → l'app repropose l'écran de connexion avec le message « Session expirée ».
- Déconnexion manuelle depuis Configuration → PIN redemandé à la prochaine action.
- Vérifier qu'aucun PIN n'apparaît jamais en clair dans le journal d'activité.

## Commandes de test suggérées

```bash
# Démarrer le serveur en local
npm --prefix server run dev

# Vérifier les colonnes après migration
sqlite3 server/data/ss-budget.sqlite "PRAGMA table_info(members);"

# Flux d'authentification (remplacer l'IP/port si besoin)
curl -s http://localhost:3001/api/auth/status
curl -s -X POST http://localhost:3001/api/auth/set-pin -H "Content-Type: application/json" -d '{"memberId":"steve","pin":"1234"}'
curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"memberId":"steve","pin":"1234"}'

# Doit échouer sans jeton
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/state
```

## Prochaines étapes — V2.9 Notifications push

Ce patch fournit le socle d'identité fiable nécessaire à des notifications push réelles :
- associer un token de notification (Expo Push Token) au `memberId` authentifié, à l'intérieur d'une session valide ;
- envoyer une notification push à l'autre membre lors d'une action marquante (nouvelle dépense, verrouillage de profil, etc.) au lieu du seul badge interne actuel ;
- réfléchir à la révocation de jeton (passage éventuel à un stockage de sessions léger) si les push exigent de pouvoir invalider un appareil précis avant l'expiration naturelle du jeton.
