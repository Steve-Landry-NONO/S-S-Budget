# Patch V2.2.3 — Reports mensuels automatiques par caisse

## Objectif

Ce patch corrige la logique comptable mensuelle : l'argent non dépensé sur un mois n'est plus perdu lorsque l'on passe au mois suivant.

## Règles ajoutées

- Chaque caisse garde automatiquement son solde réel des mois précédents.
- Le report précédent est calculé par caisse : versements réalisés avant le mois affiché - dépenses réalisées avant le mois affiché.
- Le solde réel d'une caisse devient : report précédent + versements réalisés du mois - dépenses réalisées du mois.
- Le disponible budgétaire devient : report précédent + budget prévu du mois.
- La synthèse affiche le report précédent global.
- La synthèse affiche le solde réel et le solde prévisionnel.
- Les actions prévues restent exclues du solde réel.

## Exemple

Si en juin 360 € sont versés et 0 € dépensés, alors juillet affiche automatiquement 360 € de report précédent.

Si juillet contient 40 € versés et 53,14 € dépensés, le solde réel devient :

```text
360 + 40 - 53,14 = 346,86 €
```

## Fichiers modifiés

- App.js

Aucune migration serveur n'est nécessaire pour ce patch.
