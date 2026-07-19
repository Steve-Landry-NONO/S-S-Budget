# Patch V2.4 — Journal d’activité

Ce patch ajoute un journal d’activité synchronisé côté serveur.

## Ce qui est ajouté

- Nouvelle table SQLite `activity_logs`.
- Migration automatique au démarrage du serveur.
- Historique des créations, suppressions, sauvegardes, exports et restaurations.
- Ajout d’un onglet **Journal** dans l’application.
- Affichage de l’utilisateur qui a réalisé l’action, du type d’action, du montant et de la date quand disponible.
- Route API `GET /api/activity-logs`.

## Actions journalisées

- Dépense ajoutée / prévue / supprimée.
- Versement ajouté / prévu / supprimé.
- Versements automatiques.
- Caisse ajoutée / modifiée / archivée / supprimée.
- Membre ajouté / modifié / supprimé.
- Sauvegarde SQLite créée.
- Export JSON ou CSV créé.
- Restauration de sauvegarde.
- Réinitialisation serveur si la route est appelée.

## Remarque

Le journal commence à partir de l’installation du patch. Les actions réalisées avant V2.4 ne peuvent pas être reconstruites automatiquement.
