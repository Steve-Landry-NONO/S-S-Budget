# S&S Budget — application de gestion de budget de couple

V1 minimaliste en Expo / React Native.

## Fonctionnalités

- Gérer les catégories : créer, modifier, supprimer.
- Définir un budget mensuel par personne.
- Voir le budget couple automatiquement.
- Ajouter des dépenses par catégorie.
- Suivre les dépenses du mois, le restant et les dépassements.
- Ajouter les versements de Steve et Sorelle.
- Suivre les soldes par caisse.
- Stockage local sur le téléphone via AsyncStorage.

## Lancer l'application

```bash
npm install
npx expo start
```

Ensuite, scanne le QR code avec Expo Go sur iPhone ou Android.

## Installation rapide depuis zéro

```bash
npm install -g npm
npm install
npx expo start
```

## Limites de cette V1

- Les données sont locales au téléphone.
- Pas encore de synchronisation entre Steve et Sorelle.
- Pas encore d'authentification.
- Pas encore de connexion bancaire automatique.

## Prochaine V2 possible

- Synchronisation cloud avec Supabase ou Firebase.
- Comptes utilisateurs Steve / Sorelle.
- Export Excel/PDF.
- Notifications de versement mensuel.
- Verrouillage strict d'une catégorie quand le budget est dépassé.
