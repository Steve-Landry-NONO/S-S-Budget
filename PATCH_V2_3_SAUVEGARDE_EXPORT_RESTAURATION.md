# Patch V2.3 — Sauvegarde, export et restauration

Ce patch ajoute une couche de sécurité des données pour S&S Budget.

## Ajouts

- Création de sauvegardes SQLite depuis l’application, réservée à l’administrateur.
- Dossier serveur `server/backups/`.
- Export JSON complet des données.
- Export CSV des dépenses et versements.
- Route serveur de listing des sauvegardes.
- Route serveur de restauration manuelle à partir d’une sauvegarde SQLite.
- Sauvegarde de sécurité automatique avant restauration.

## Routes ajoutées

```http
POST /api/backups/create
GET /api/backups
POST /api/export/json
GET /api/export/json
POST /api/export/csv
POST /api/backups/restore
```

## Fichiers générés

Les fichiers sont créés sur le serveur dans :

```text
server/backups/
```

Exemples :

```text
ss-budget-backup-2026-07-19T04-30-00-000Z-mobile.sqlite
ss-budget-export-2026-07-19T04-30-00-000Z.json
ss-budget-expenses-2026-07-19T04-30-00-000Z.csv
ss-budget-contributions-2026-07-19T04-30-00-000Z.csv
```

## Restauration

La restauration est disponible côté API mais volontairement non exposée comme bouton direct dans l’app afin d’éviter une erreur de manipulation.

Exemple :

```bash
curl -X POST http://localhost:3001/api/backups/restore \
  -H "Content-Type: application/json" \
  -H "x-ss-budget-user-id: steve" \
  -d '{"file":"ss-budget-backup-YYYY-MM-DDTHH-MM-SS-000Z-mobile.sqlite"}'
```

Si `APP_SECRET` est activé, ajouter aussi :

```bash
-H "x-ss-budget-secret: votre-secret"
```

## Note

Les fichiers `.sqlite`, `.json` et `.csv` générés dans `server/backups/` sont ignorés par Git. Seul `.gitkeep` est versionné pour conserver le dossier.
