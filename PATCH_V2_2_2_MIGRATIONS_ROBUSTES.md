# Patch V2.2.2 — Migrations SQLite robustes

Ce patch corrige le démarrage du serveur lorsqu'une base SQLite existante a été créée avant l'ajout des colonnes `role`, `status` et `created_by_member_id`.

## Problème corrigé

Erreur rencontrée :

```text
SQLITE_ERROR: table members has no column named role
```

Le problème venait du fichier `schema.sql` : il essayait d'insérer les membres avec la colonne `role` avant que la migration automatique ait pu ajouter cette colonne sur une ancienne base.

## Correction

- `schema.sql` insère maintenant les membres uniquement avec `id` et `name`.
- `server/src/db.js` garde la responsabilité d'ajouter les colonnes manquantes.
- `server/src/db.js` applique ensuite les rôles : Steve = admin, Sorelle = member.
- Le serveur peut démarrer avec une ancienne base sans suppression de données.

## Fichiers concernés

- `server/schema.sql`
- Documentation du patch

## Important

Ne supprime pas `server/data/ss-budget.sqlite`.
