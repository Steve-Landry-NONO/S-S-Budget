# Duo Budget V3.0.7 → Développement — Lot 01

## Baseline et isolation

Référence Figma gelée : [Duo Budget Premium Duo V3.0.7](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/). Le fichier Figma n'est pas modifié par cette PR.

Branche de base : `feature/v3-premium-duo-foundations` (composants et tokens). Cette PR est **empilée** sur cette branche, qui doit être revue et intégrée avant, ou avec, ce lot. `main` n'est pas modifiée.

## Livré

- Première expérience React Native **Duo Glance** avant authentification, inspirée de la maquette validée.
- Les quatre mini-bulles deviennent des bulles financières au geste vertical et au toucher. Ambiance de flottement discrète.
- Réduction des animations via `AccessibilityInfo`.
- Montants fictifs uniquement avant connexion, sans accès au stockage privé ni à l'API depuis le composant.
- Bouton **Se connecter** et bouton **Découvrir la configuration** ouvrant l'écran d'authentification/configuration V2 existant.
- Depuis l'écran de connexion : retour explicite vers l'aperçu.
- Nom d'affichage Expo « Duo Budget ». Slug, identifiants de paquet et clés de stockage V2 conservés pour éviter une migration implicite.
- `scripts/check-glance.js` : garde-fous statiques sans dépendance ajoutée.

## Non livré dans ce lot

- Inscription cloud multi-utilisateurs et invitation réelle par lien.
- Accès pré-authentification à des montants réels (volontairement interdit).
- Migration du dashboard, des enveloppes, de l'activité et du profil vers la nouvelle maquette.
- Intégration du Motion Lab aux écrans de production.
- Nouveau moteur d'authentification, de multi-tenancy et d'hébergement.
- Remplacement des images icônes existantes de l'application (assets de marque encore dans la branche dédiée).

## Vérifications à lancer avant fusion

```sh
npm install
node scripts/check-glance.js
npx expo-doctor
npx expo start
```

### Scénarios manuels obligatoires

1. Démarrer l'application sans session active : Duo Glance s'affiche, aucun solde réel n'apparaît.
2. Glisser vers le bas, toucher la bulle, glisser vers le haut : les quatre montants fictifs se déploient, puis se cachent.
3. Cliquer sur **Se connecter** : l'ancien portail PIN/serveur apparaît ; cliquer **← Aperçu** : retour au preview.
4. Configurer un serveur de test et s'authentifier : les fonctions financières V2 restent disponibles avec leurs données calculées par le domaine existant.
5. Tester petit iPhone/Android 360 px, largeur 390 px et largeur 430 px : aucun bouton masqué.
6. Activer « Réduire les animations » : les mouvements décoratifs doivent s'arrêter, le geste reste fonctionnel.
7. Tester avec VoiceOver et TalkBack : commandes accessibles et informations d'aperçu annoncées.
8. Vérifier la déconnexion et l'expiration de session, y compris le comportement après redémarrage.

Le code est présent dans GitHub, mais les essais Expo sur téléphone et les vérifications CI ne sont pas réputés réussis avant exécution.

## Étapes suivantes après revue

1. Extraire les règles de calcul financier en sélecteurs purs testables.
2. Brancher le vrai tableau de bord Premium Duo sur les données authentifiées, sans recalcul à partir des objectifs.
3. Ajouter la navigation fixe Accueil / Enveloppes / Activité / Mon duo et migrer les écrans progressivement.
4. Intégrer, puis tester, seulement les animations Figma validées.
5. Planifier l'architecture multi-duo, l'authentification publique et l'hébergement avant l'ouverture grand public.
