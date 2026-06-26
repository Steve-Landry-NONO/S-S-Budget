# S&S Budget — V1.1

Application mobile minimale de gestion de budget de couple, développée avec Expo / React Native.

## Nouveautés V1.1

- Mois de départ modifiable depuis l'application.
- Membres modifiables : ajouter, renommer, supprimer si aucun historique.
- Versement automatique par membre ou pour tous les membres.
- Versements manuels conservés pour prendre de l'avance ou ignorer temporairement une caisse.
- Pas de blocage des versements supérieurs au budget prévu.
- Bouton Nouveau mois.
- Page Caisses améliorée avec option de verrouillage par catégorie.
- Historique clair des dépenses et versements du mois.

## Installation

```bash
npm install
npx expo start --tunnel -c
```

## Versions importantes

Cette version est alignée sur Expo SDK 54 pour fonctionner avec Expo Go sur iPhone.

```json
"expo": "~54.0.0",
"react": "19.1.0",
"react-native": "0.81.5",
"babel-preset-expo": "~54.0.10"
```

Ne lance pas `npm audit fix --force` pendant les tests, car cela peut casser l'alignement Expo.
