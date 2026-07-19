# Patch V2.1 — Dates intelligentes

Ce patch améliore la gestion des dates dans S&S Budget.

## Changements

- Le mois affiché au lancement devient automatiquement le mois courant.
- Pour le mois courant, les formulaires proposent par défaut la date du jour.
- Pour un ancien/futur mois consulté, les formulaires proposent le premier jour de ce mois.
- Les dates restent modifiables manuellement au format `AAAA-MM-JJ`.
- Les dates sont validées plus strictement : la date doit exister et appartenir au mois affiché.
- L'historique mensuel reste conservé : les anciens mois restent accessibles avec les flèches ou la saisie `AAAA-MM`.

## Installation rapide

Depuis le projet actuel :

```bash
cd ~/Bureau/ss-budget-v2-selfhosted
cp App.js App.js.backup-avant-v2-1-dates
```

Puis copier le `App.js` fourni dans ce patch à la place du fichier existant.

Relancer Expo :

```bash
cd ~/Bureau/ss-budget-v2-selfhosted
REACT_NATIVE_PACKAGER_HOSTNAME=100.101.178.124 npx expo start --lan -c
```

Le serveur API ne change pas pour ce patch.
