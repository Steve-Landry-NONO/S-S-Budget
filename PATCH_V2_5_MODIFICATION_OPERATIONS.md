# Patch V2.5 — Modification des dépenses et versements

Ce patch ajoute la modification des opérations récentes dans S&S Budget.

## Fonctionnalités ajoutées

- Bouton **Modifier** sur les dépenses récentes.
- Bouton **Modifier** sur les versements récents.
- Modification possible uniquement pendant la fenêtre de sécurité de 5 jours.
- Un administrateur peut modifier les opérations récentes de tout le monde.
- Un membre peut modifier uniquement ses propres opérations récentes.
- Les modifications sont enregistrées dans le journal d’activité.
- Les changements de montant, date, caisse, membre concerné, payeur et statut sont visibles dans le journal.

## Fichiers modifiés

- `App.js`
- `server/src/index.js`

## Migration

Aucune migration SQLite n’est nécessaire.

Le patch utilise la table `activity_logs` déjà créée par la V2.4.

## Tests recommandés

1. Ajouter une dépense récente.
2. Modifier son montant.
3. Modifier sa caisse.
4. Vérifier le journal : `Dépense modifiée`.
5. Ajouter un versement récent.
6. Modifier son montant ou le membre concerné.
7. Vérifier le journal : `Versement modifié`.
8. Vérifier qu’une ancienne opération reste verrouillée.
9. Vérifier qu’un membre non admin ne peut pas modifier une opération qui ne le concerne pas.

## Version

Tag recommandé : `v2.5`
