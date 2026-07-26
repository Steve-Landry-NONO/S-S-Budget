# Patch V2.7.1 — Nettoyage technique et correction des warnings

## Objectif

Corriger deux avertissements observés au démarrage de l'application, sans toucher à la moindre fonctionnalité métier :

1. `SafeAreaView has been deprecated and will be removed in a future release. Please use react-native-safe-area-context instead.`
2. `expo@54.0.35 - expected version: ~54.0.36`

Ce patch est purement technique : aucune route serveur, aucune table SQLite, aucun écran fonctionnel n'est modifié. Le journal d'activité, le centre d'alertes ([[PATCH_V2_7_NOTIFICATIONS_ALERTES]]), les dépenses/versements et leur modification, les sauvegardes/export et le logo/splash restent identiques.

## Warnings corrigés

### 1. `SafeAreaView` dépréciée

`SafeAreaView` importé depuis `react-native` est déprécié depuis plusieurs versions de React Native (RN 0.81 inclus, utilisé par le SDK Expo 54). Le composant recommandé vient du package `react-native-safe-area-context`, qui calcule les zones sûres de façon plus fiable (encoches, barres de statut, gestes système) et qui est de toute façon déjà inclus dans la plupart des templates Expo modernes.

Correction :
- `SafeAreaView` est désormais importé depuis `react-native-safe-area-context` au lieu de `react-native`.
- Le composant racine de `App()` est enveloppé dans un `SafeAreaProvider` (requis par `react-native-safe-area-context` pour calculer correctement les insets). Ce provider ne rend aucun élément visuel propre (pas de couleur, pas de padding) : il ne fait que fournir les mesures d'insets au reste de l'arbre, y compris aux `SafeAreaView` utilisées à l'intérieur des `Modal`. L'affichage reste donc pixel pour pixel identique.
- Les styles (`styles.safe`, `styles.modalSafe`) ne sont pas modifiés.

### 2. Version Expo `54.0.35` vs `54.0.36`

`package.json` fixait `"expo": "~54.0.0"`, une plage assez large. L'environnement de build attend la version `54.0.36`, dernière version publiée sur la branche `sdk-54` au moment du patch. La plage a été resserrée vers `~54.0.36` pour que les futures installations récupèrent bien cette version (ou tout correctif `54.0.x` ultérieur), au lieu de rester bloquées sur `54.0.35`.

Aucune autre dépendance n'a été modifiée au hasard.

## Fichiers modifiés

- `App.js` — import de `SafeAreaView` déplacé vers `react-native-safe-area-context`, ajout de `SafeAreaProvider` autour du rendu racine.
- `package.json` — `expo` passé de `~54.0.0` à `~54.0.36`, ajout de la dépendance `react-native-safe-area-context` (`~5.6.0`, version alignée sur ce que `expo install` recommande pour le SDK 54).

Aucun changement dans `server/`, `server/data/`, `server/backups/`, les assets, le logo/splash ou le README.

## Commandes recommandées après le patch

Le dossier ne contenait pas de `node_modules` ni de lockfile au moment du patch : les dépendances doivent être (ré)installées avant de lancer l'app.

```bash
# Installe les dépendances déclarées dans package.json (dont react-native-safe-area-context)
npm install

# Fait confirmer/ajuster par Expo les versions exactes compatibles avec le SDK 54
# (corrige au passage un éventuel écart de version résiduel sur expo ou react-native-safe-area-context)
npx expo install --check

# Vérification santé générale du projet (optionnel mais recommandé)
npx expo-doctor
```

Si `npx expo install --check` propose une modification de version, il est préférable de la laisser faire : cette commande connaît la matrice de compatibilité exacte du SDK 54.

## Workflow SSHFS / Tailscale

Le poste de développement travaille sur `~/Téléchargements/ss-budget-git/S-S-Budget`. Le serveur applicatif (Node/Express/SQLite) tourne sur l'ancien PC, accessible via le réseau privé Tailscale, et son dossier est monté localement en SSHFS dans `~/Bureau/ss-budget-serveur`.

Rappel du workflow habituel, inchangé par ce patch :

1. Monter le dossier distant du serveur en SSHFS (si ce n'est pas déjà fait) :
   ```bash
   sshfs utilisateur@<ip-tailscale-du-serveur>:/chemin/vers/ss-budget-serveur ~/Bureau/ss-budget-serveur
   ```
2. Lancer `deploy-ss-budget.sh` pour copier les fichiers à jour vers le point de montage.
3. Redémarrer le serveur Node côté machine distante (`npm run server` ou équivalent sur l'ancien PC).

**Point d'attention pour ce patch précisément** : `deploy-ss-budget.sh` copie aujourd'hui `App.js`, `app.json` et les fichiers `server/schema.sql`, `server/src/db.js`, `server/src/index.js`, mais **pas** `package.json`. Comme ce patch ajoute une dépendance (`react-native-safe-area-context`) et change la version d'`expo`, il faut soit :
- copier manuellement `package.json` vers le dossier synchronisé avant de relancer `npm install` côté client mobile/build, soit
- ajouter une ligne `cp "$REPO/package.json" "$SERVER/package.json"` dans `deploy-ss-budget.sh` si ce fichier doit aussi vivre côté serveur.

Ce patch ne modifie pas `deploy-ss-budget.sh` lui-même : ce choix est laissé à l'utilisateur.

## Commande de déploiement

```bash
./deploy-ss-budget.sh
```

Copie `App.js` (et les autres fichiers listés dans le script) vers `~/Bureau/ss-budget-serveur`. Voir la remarque ci-dessus concernant `package.json`.

## Tests à faire après le patch

Fonctionnels (non-régression, aucun de ces comportements ne doit changer) :

- [ ] L'app démarre sans le warning `SafeAreaView has been deprecated`.
- [ ] `npx expo install --check` ou `npx expo-doctor` ne signale plus d'écart de version sur `expo`.
- [ ] Les zones sûres (encoche, barre de statut, geste de retour) sont toujours correctement respectées sur écran principal et sur chaque `Modal` (dépense, versement, caisse, configuration serveur).
- [ ] Le journal d'activité s'affiche normalement, avec le badge de compteur sur l'onglet « Journal » et le badge « Nouveau » par entrée non lue.
- [ ] Ajout, modification et suppression d'une dépense fonctionnent, y compris le verrouillage après 5 jours.
- [ ] Ajout, modification et suppression d'un versement (manuel et automatique) fonctionnent.
- [ ] Les modifications de catégories/caisses fonctionnent (admin uniquement).
- [ ] Sauvegarde SQLite et exports JSON/CSV depuis l'écran de configuration fonctionnent toujours.
- [ ] Le logo et le splash screen s'affichent normalement au démarrage.
- [ ] La synchronisation Tailscale avec le serveur maison fonctionne (connexion, `syncFromServer`).

Techniques :

- [ ] `npm install` se termine sans erreur.
- [ ] `npx expo start` compile l'app sans erreur Metro liée à `react-native-safe-area-context`.
- [ ] Test sur Expo Go (Android et/ou iOS) pour confirmer la compatibilité.
