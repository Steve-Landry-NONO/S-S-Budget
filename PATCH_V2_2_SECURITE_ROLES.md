# Patch 2 — Sécurité et rôles

Ce patch protège les actions dangereuses et prépare la gestion des rôles dans S&S Budget.

## Ce qui change

- Ajout d'un rôle par membre : `admin` ou `member`.
- Steve est configuré comme `admin`.
- Sorelle est configurée comme `member`.
- L'app envoie l'utilisateur courant au serveur via l'en-tête `x-ss-budget-user-id`.
- Le bouton dangereux **Réinitialiser les données serveur** est retiré de l'écran de configuration.
- Le bouton **Revenir en mode local** devient **Désactiver la synchronisation**, avec confirmation.
- Les suppressions de dépenses et versements sont limitées à 5 jours après création.
- Un membre ne peut supprimer que ses propres actions récentes.
- L'admin peut supprimer les actions récentes de tout le monde.
- Les caisses et membres passent en lecture seule pour les non-admins côté app.
- Le serveur protège aussi les routes sensibles : membres, caisses et reset sont réservés à l'admin.

## Fichiers à remplacer

Depuis ce patch, remplace dans ton projet actuel :

```bash
App.js
server/schema.sql
server/src/db.js
server/src/index.js
```

## Installation recommandée

Depuis ton projet actuel :

```bash
cd ~/Bureau/ss-budget-v2-selfhosted
cp App.js App.js.backup-avant-patch2-securite
cp server/schema.sql server/schema.sql.backup-avant-patch2-securite
cp server/src/db.js server/src/db.js.backup-avant-patch2-securite
cp server/src/index.js server/src/index.js.backup-avant-patch2-securite
```

Puis copie les fichiers du patch dans ton dossier actuel.

## Migration base existante

Le patch ajoute automatiquement les colonnes manquantes au démarrage du serveur :

- `members.role`
- `expenses.created_by_member_id`
- `contributions.created_by_member_id`

Donc tu n'as pas besoin de supprimer la base SQLite.

Lance simplement :

```bash
cd ~/Bureau/ss-budget-v2-selfhosted/server
npm run dev
```

## Configuration sur les téléphones

Dans l'app :

```text
Config → Utilisateur de ce téléphone
```

Sur ton téléphone, choisis `Steve`.

Sur le téléphone de Sorelle, choisis `Sorelle`.

C'est important, parce que le serveur utilise ce choix pour appliquer les droits.

## Tests à faire

1. Sur ton téléphone avec Steve : vérifier que tu vois `Rôle actuel : admin` dans Config.
2. Sur le téléphone de Sorelle : choisir Sorelle comme utilisateur.
3. Ajouter une dépense avec Sorelle.
4. Vérifier que Sorelle peut supprimer sa dépense récente.
5. Vérifier qu'elle ne voit plus le bouton de reset serveur.
6. Vérifier que les anciennes actions trop anciennes affichent un message de verrouillage.
