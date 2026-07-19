# S&S Budget — V2 self-hosted

**S&S Budget** est une application de gestion de budget de couple. La V2 ajoute une synchronisation gratuite et privée via un serveur maison : un vieux PC Linux peut héberger une API Node.js et une base SQLite, puis les téléphones se connectent à ce serveur via Tailscale ou le réseau local.

## Objectif de la V2

La V1 fonctionnait en local sur un seul téléphone. La V2 permet maintenant à deux téléphones de lire et écrire les mêmes données :

- membres du couple ;
- caisses / catégories ;
- dépenses ;
- versements ;
- versements automatiques ;
- soldes mensuels ;
- historique synchronisé.

## Architecture

```text
Téléphone Steve ─┐
                 ├── App Expo / PWA ── API Node.js ── SQLite
Téléphone Sorelle┘                  vieux PC Linux
```

Pour un usage gratuit et privé, le plus simple est d'installer **Tailscale** sur le vieux PC et sur les deux téléphones. L'API n'a alors pas besoin d'être exposée publiquement sur Internet.

## Contenu du projet

```text
.
├── App.js                  # Application mobile Expo / React Native
├── app.json
├── package.json            # Dépendances frontend Expo
├── babel.config.js
├── assets/
└── server/
    ├── package.json        # Dépendances backend
    ├── schema.sql          # Structure SQLite + données par défaut
    ├── .env.example
    └── src/
        ├── db.js
        ├── initDb.js
        └── index.js
```

## Installation du serveur sur le vieux PC Linux

```bash
sudo apt update
sudo apt install -y git nodejs npm sqlite3
```

Puis dans le projet :

```bash
cd server
cp .env.example .env
npm install
npm run init-db
npm run dev
```

Le serveur démarre par défaut sur :

```text
http://0.0.0.0:3001
```

Depuis le PC lui-même :

```bash
curl http://localhost:3001/api/health
```

## Configuration Tailscale recommandée

Sur le vieux PC :

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Tu obtiens une IP privée du style :

```text
100.xx.yy.zz
```

Dans l'application S&S Budget, ouvrir **Config** puis mettre :

```text
http://100.xx.yy.zz:3001
```

Sorelle met la même URL dans son téléphone.

## Lancer l'application en développement

```bash
npm install
npx expo start --tunnel -c
```

Ou, pour le web/PWA :

```bash
npm install
npx expo start --web
```

## Export web / PWA

```bash
npx expo export --platform web
```

Le dossier `dist/` peut ensuite être servi par Nginx sur le vieux PC.

## API disponible

### Santé serveur

```http
GET /api/health
```

### Synchronisation complète

```http
GET /api/state
```

### Membres

```http
POST /api/members
PUT /api/members/:id
DELETE /api/members/:id
```

### Caisses

```http
POST /api/categories
PUT /api/categories/:id
DELETE /api/categories/:id
```

### Dépenses

```http
POST /api/expenses
DELETE /api/expenses/:id
```

### Versements

```http
POST /api/contributions
DELETE /api/contributions/:id
POST /api/auto-contributions
```

### Reset

```http
POST /api/reset
```

## Sécurité

Le fichier `server/.env` permet de définir :

```text
APP_SECRET=une-phrase-longue-et-privee
```

Si `APP_SECRET` est renseigné, l'application doit envoyer ce secret dans l'en-tête `x-ss-budget-secret`. Dans l'app, ce secret se configure dans **Config**.

Pour un usage à deux, la sécurité recommandée est :

1. ne pas ouvrir le port 3001 sur Internet ;
2. utiliser Tailscale ;
3. garder un `APP_SECRET` privé ;
4. sauvegarder régulièrement `server/data/ss-budget.sqlite`.

## Sauvegarde de la base

```bash
cp server/data/ss-budget.sqlite ~/backup-ss-budget-$(date +%F).sqlite
```

## Roadmap V2+

- Authentification plus complète.
- Mode hors-ligne avancé avec file d'attente de synchronisation.
- Export Excel/PDF.
- Graphiques mensuels.
- Notifications.
- Historique annuel.
- Déploiement Nginx complet avec PWA installable.

## Licence

MIT
