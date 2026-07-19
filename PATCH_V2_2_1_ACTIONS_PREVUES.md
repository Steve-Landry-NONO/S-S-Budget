# Patch V2.2.1 — Actions prévues simples

Ce patch ajoute la gestion simple des dates futures.

## Fonctionnalités

- Une action datée dans le futur du mois affiché est autorisée après confirmation.
- Elle est enregistrée avec `status = planned`.
- Les actions prévues sont visibles avec un badge **Prévu**.
- Les totaux principaux restent des totaux réels : les actions prévues ne modifient pas le solde réel.
- Le tableau de bord affiche un bloc **À venir ce mois-ci** avec dépenses prévues, versements prévus et solde prévisionnel.
- Migration automatique de la base SQLite : ajout de la colonne `status` sur `expenses` et `contributions`.

## Fichiers modifiés

- `App.js`
- `server/schema.sql`
- `server/src/db.js`
- `server/src/index.js`

## Installation

Sauvegarde tes fichiers puis remplace-les par ceux du patch. Ne supprime pas la base SQLite.
