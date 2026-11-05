# Duo Budget V3.1 — Fondations Premium Duo

## Objectif

Migrer progressivement l'application mobile V2 vers une interface fintech grand public suivant [le fichier Figma Premium Duo](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/), **sans modifier les calculs financiers, les données existantes ni l'API de production**.

Cette branche est préparatoire : les nouveaux composants ne remplacent pas encore l'interface V2. Les écrans Figma non présents dans le code demeurent dans la roadmap.

## Point de départ vérifié

- Expo SDK 54, React Native 0.81.5.
- Application V2 actuellement concentrée dans `App.js`.
- API Node.js/Express, SQLite, authentification PIN.
- Code encore intitulé S&S Budget : changement public progressif, sans renommer les clés de stockage et identifiants avant migration documentée.
- Référence Figma : 4 onglets Accueil, Enveloppes, Activité, Mon duo.

## Livrables de ce premier commit

- `src/theme/tokens.js` : couleurs Premium Duo, thème clair/sombre, typographie et espacement.
- `src/components/BalanceCard.js` : carte de soldes de présentation (montants passés en props).
- `src/components/PremiumButton.js` : bouton réutilisable accessible.

## Séquence suivante (sur la même branche)

1. Extraire des sélecteurs de calcul pur depuis `App.js` (reports, réalisé, prévu) et les couvrir par tests avec cas mensuels.
2. Créer une navigation à quatre onglets et garder chaque fonctionnalité V2 accessible.
3. Implémenter le dashboard avec une liste défilante, barre inférieure fixe et SafeAreaView.
4. Implémenter les enveloppes et le détail, y compris indisponible/bloqué, report et prévisionnel.
5. Ajouter les parcours transactions, historique, journal et profil, sans casser l'authentification.
6. Tester iPhone/Android, petits écrans, accessibilité, et erreurs réseau avant migration de l'écran principal.

## Critères de validation

- Les soldes réels et prévisionnels sont calculés par le domaine existant, jamais à partir des objectifs.
- Le report ne se perd pas d'un mois à l'autre.
- Le membre acteur est distinct du membre bénéficiaire/payeur.
- Le PIN et les restrictions de modification et suppression restent appliqués côté serveur.
- Le serveur et la base de production ne sont pas modifiés dans ce lot.
- Les nouveaux assets de marque restent dans la branche `design/duo-budget-brand-v3` jusqu'à validation et intégration séparée.
- Aucune fusion vers `main` sans vérifications et revue de PR.

## Tests

Non exécutés dans ce commit GitHub : l'intégration runtime reste à faire. Exécuter localement `npm install`, `npx expo-doctor`, puis tests Expo sur deux profils et contrôle du comportement hors-ligne avant tout merge.
