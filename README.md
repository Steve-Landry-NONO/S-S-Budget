# S&S Budget

**S&S Budget** est une application mobile de gestion budgétaire pensée pour un couple ou un foyer. Elle permet de suivre les versements, les dépenses, les caisses budgétaires et les soldes mensuels depuis plusieurs téléphones, avec une synchronisation privée via un serveur personnel.

Le projet est conçu pour rester simple, autonome et peu coûteux : l'application fonctionne avec **Expo / React Native** côté mobile, une API **Node.js / Express** côté serveur, et une base **SQLite** locale. L'ensemble peut être hébergé sur un vieux PC Linux, sans abonnement cloud obligatoire.

---

## Objectif du projet

S&S Budget vise à offrir un outil clair pour gérer un budget commun :

- suivre les dépenses du foyer ;
- organiser l'argent par caisses budgétaires ;
- enregistrer les versements de chaque personne ;
- visualiser les soldes par mois ;
- conserver les reports non dépensés d'un mois sur l'autre ;
- synchroniser les données entre plusieurs téléphones ;
- garder la maîtrise des données grâce à un serveur privé.

L'application peut être utilisée dans un couple, mais le principe est extensible à tout petit foyer ou binôme qui souhaite gérer des enveloppes budgétaires communes.

---

## Version actuelle

Version fonctionnelle actuelle : **V2.2.3**

Principales capacités déjà intégrées :

- application mobile Expo / React Native ;
- serveur self-hosted Node.js / Express ;
- base SQLite locale ;
- synchronisation via réseau local ou Tailscale ;
- gestion des membres ;
- gestion des caisses budgétaires ;
- dépenses et versements ;
- versements automatiques ;
- navigation mensuelle ;
- dates intelligentes ;
- rôles et actions sensibles ;
- actions prévues ;
- solde réel et solde prévisionnel ;
- reports mensuels automatiques par caisse ;
- migrations SQLite robustes.

---

## Philosophie produit

S&S Budget repose sur trois idées simples :

1. **Un budget doit être lisible.**  
   Les informations importantes doivent être compréhensibles rapidement : budget prévu, montant versé, montant dépensé, reste disponible.

2. **Les données doivent rester privées.**  
   L'application privilégie un serveur personnel accessible via Tailscale ou réseau local, sans exposition publique obligatoire.

3. **Les rôles ne doivent pas être genrés.**  
   L'application peut avoir une personne administratrice et une personne membre, mais ces rôles sont fonctionnels, pas liés au fait d'être Monsieur ou Madame. Dans un foyer, Madame peut tout autant être administratrice que Monsieur. L'implémentation par défaut peut choisir un ordre pratique, mais le modèle produit reste neutre et adaptable.

---

## Architecture générale

```text
Téléphone personne A ─┐
                      ├── App Expo / React Native ── API Node.js ── SQLite
Téléphone personne B ─┘                         serveur personnel Linux
```

Pour un usage privé, le scénario recommandé est :

```text
Téléphones + serveur personnel connectés au même réseau Tailscale
```

L'API n'a donc pas besoin d'être ouverte publiquement sur Internet.

---

## Contenu du projet

```text
.
├── App.js                  # Application mobile Expo / React Native
├── app.json                # Configuration Expo
├── package.json            # Dépendances frontend
├── babel.config.js
├── assets/                 # Icônes et ressources visuelles
└── server/
    ├── package.json        # Dépendances backend
    ├── schema.sql          # Structure SQLite + données initiales
    ├── .env.example        # Exemple de configuration serveur
    └── src/
        ├── db.js           # Connexion DB + migrations robustes
        ├── initDb.js       # Initialisation de la base
        └── index.js        # API Express
```

---

## Fonctionnalités principales

### Synthèse mensuelle

La vue de synthèse affiche :

- budget prévu du mois ;
- report précédent ;
- total versé ;
- total dépensé ;
- solde compte réel ;
- solde prévisionnel lorsque des actions prévues existent ;
- état par membre ;
- état par caisse.

### Caisses budgétaires

Les caisses représentent les enveloppes du budget commun, par exemple :

- week-ends ;
- semaines d'école ou de travail ;
- vacances ;
- cadeaux ;
- épargne ;
- toute autre catégorie personnalisée.

Chaque caisse peut avoir :

- un budget mensuel ;
- des dépenses associées ;
- un report précédent ;
- un disponible réel ;
- un disponible prévisionnel.

### Reports mensuels automatiques

Depuis la V2.2.3, l'argent non utilisé n'est plus perdu visuellement au changement de mois.

Exemple :

```text
Juin
Budget : 360 €
Versé : 360 €
Dépensé : 0 €
Solde fin juin : 360 €

Juillet
Report précédent : 360 €
Versements juillet : 40 €
Dépenses juillet : 53,14 €
Solde réel : 346,86 €
```

Le report est aussi conservé par caisse : chaque enveloppe garde son propre reste disponible.

### Actions prévues

Une dépense ou un versement peut être enregistré à une date future du mois sélectionné.

Dans ce cas :

- l'action est marquée comme **Prévue** ;
- elle n'impacte pas le solde réel ;
- elle impacte le solde prévisionnel ;
- elle permet d'anticiper la situation du compte.

### Rôles et sécurité

L'application distingue deux types de rôles :

```text
admin  : personne autorisée à gérer les actions sensibles
member : personne autorisée à utiliser l'application au quotidien
```

Les rôles ne sont pas liés au genre ou à la place dans le couple. Le rôle admin peut être attribué à Monsieur ou Madame selon l'organisation du foyer.

Règles actuelles :

- les actions sensibles sont limitées ;
- la réinitialisation dangereuse n'est pas exposée dans l'interface courante ;
- les suppressions sont encadrées ;
- les anciennes actions sont protégées ;
- le serveur prépare les permissions côté API.

---

## Installation du serveur

### Prérequis recommandés

- Linux ou machine équivalente ;
- Node.js 20 ou version récente ;
- npm ;
- SQLite ;
- Git.

Sur une machine Linux récente, il est recommandé d'utiliser Node.js 20 plutôt que la version parfois ancienne fournie par défaut par certaines distributions.

### Installation rapide

```bash
git clone git@github.com:Steve-Landry-NONO/S-S-Budget.git
cd S-S-Budget/server
cp .env.example .env
npm install
npm run init-db
npm run dev
```

Le serveur démarre par défaut sur :

```text
http://0.0.0.0:3001
```

Test local :

```bash
curl http://localhost:3001/api/health
```

---

## Configuration Tailscale recommandée

Tailscale permet de connecter les téléphones et le serveur dans un réseau privé sécurisé, sans ouvrir le serveur sur Internet.

Sur le serveur personnel :

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Tailscale retourne une IP privée du type :

```text
100.xx.yy.zz
```

Dans l'application mobile :

```text
Config → URL API maison → http://100.xx.yy.zz:3001
```

Chaque téléphone doit utiliser la même URL API pour se synchroniser avec le même serveur.

---

## Lancer l'application mobile en développement

À la racine du projet :

```bash
npm install
npx expo start -c
```

Avec Expo Go, scanner le QR code depuis le téléphone.

Si l'application doit passer par l'IP Tailscale du serveur ou du poste de développement :

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=100.xx.yy.zz npx expo start --lan -c
```

---

## API principale

### Santé du serveur

```http
GET /api/health
```

### État complet synchronisé

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

Les routes sensibles doivent rester protégées par le secret API et les règles de rôle.

---

## Sécurité

Le fichier `server/.env` permet de définir un secret partagé :

```text
APP_SECRET=une-phrase-longue-et-privee
```

Lorsque `APP_SECRET` est défini, l'application doit envoyer ce secret dans l'en-tête :

```text
x-ss-budget-secret
```

Recommandations :

- ne pas exposer le port `3001` publiquement ;
- privilégier Tailscale ou un réseau local privé ;
- définir un `APP_SECRET` robuste ;
- ne pas versionner `server/.env` ;
- sauvegarder régulièrement la base SQLite ;
- limiter les actions sensibles au rôle admin.

---

## Base de données

La base SQLite est stockée dans :

```text
server/data/ss-budget.sqlite
```

Ce fichier contient les données réelles de l'application. Il ne doit pas être supprimé sans sauvegarde.

Les migrations robustes ajoutent automatiquement les colonnes nécessaires lorsque l'application évolue, par exemple :

- rôle des membres ;
- créateur d'une action ;
- statut réalisé / prévu ;
- autres champs nécessaires aux futures versions.

---

## Sauvegarde simple

Sauvegarde manuelle de la base :

```bash
cp server/data/ss-budget.sqlite ~/backup-ss-budget-$(date +%F).sqlite
```

La prochaine étape produit prévue est d'ajouter une vraie fonctionnalité d'export et de restauration.

---

## Historique des versions

| Version | Contenu principal |
|---|---|
| V1.0 | Première version mobile de S&S Budget |
| V1.1 | Application rendue plus générique et modulable |
| V1.1.1 | Amélioration de la lisibilité de la navigation |
| V1.1.2 | Corrections sur dates, versements et caisses |
| V2.0 | Mode self-hosted avec serveur maison |
| V2.1 | Dates intelligentes et navigation mensuelle améliorée |
| V2.2 | Sécurité, rôles et actions sensibles |
| V2.2.1 | Actions prévues et solde prévisionnel |
| V2.2.2 | Migrations SQLite robustes |
| V2.2.3 | Reports mensuels automatiques par caisse |

---

## Roadmap

### V2.3 — Sauvegarde, export et restauration

- export JSON complet ;
- export CSV des dépenses et versements ;
- sauvegardes automatiques ;
- restauration manuelle sécurisée ;
- bouton admin d'export.

### V2.4 — Journal d'activité

- historique des actions ;
- création, suppression, modification ;
- membre à l'origine de l'action ;
- horodatage ;
- meilleure traçabilité.

### V2.5 — Modification des dépenses et versements

- modifier une dépense récente ;
- modifier un versement récent ;
- corriger une erreur de montant ou de caisse ;
- verrouiller les anciennes actions.

### V2.6 — Logo, splash screen et finition visuelle

- logo personnalisé ;
- écran de lancement ;
- icônes propres ;
- meilleure cohérence visuelle ;
- préparation éventuelle à une PWA installable.

---

## Licence

MIT
