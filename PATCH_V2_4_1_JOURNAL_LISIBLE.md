# Patch V2.4.1 — Journal d’activité plus lisible

Ce patch améliore la lisibilité du journal d’activité sans changer la structure de la base.

## Corrections

- Affiche le nom de la caisse supprimée ou archivée au lieu de son identifiant technique.
- Affiche le nom du membre supprimé au lieu de son identifiant technique.
- Ajoute les détails humains dans les logs de dépenses : caisse et personne qui a payé.
- Ajoute les détails humains dans les logs de versements : bénéficiaire et caisse.
- Ajoute les bénéficiaires dans les logs de versements automatiques.
- Masque les identifiants techniques lorsque des noms humains sont disponibles.
- Clarifie le badge du journal : le badge indique la personne qui a réalisé l’action, pas forcément la personne concernée par l’action.

## Exemple

Avant :

```text
Caisse supprimée
category_xxxxx
```

Après :

```text
Caisse supprimée
Test journal
Budget mensuel par personne : 60,00 €
```

Pour un versement ajouté depuis le téléphone de l’administrateur au nom d’un autre membre :

```text
Versement ajouté
Pour : Madame
Caisse : Weekends
Action réalisée par : Monsieur
```

## Migration

Aucune migration SQLite n’est nécessaire.

Les anciens logs déjà enregistrés avec des identifiants techniques ne peuvent pas tous être reconstruits si l’élément supprimé n’existe plus. Les nouveaux logs seront plus lisibles.
