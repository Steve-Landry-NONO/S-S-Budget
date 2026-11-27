# Duo Budget — Android Preview (APK interne)

## Objectif / périmètre

Cette préparation intervient après la PR #3 Duo Glance. Elle ne modifie pas `main`, le design freeze Figma V3.0.7 ni les données de production.

- **Développement rapide :** Expo Go, via `npx expo start -c`. Aucune APK nécessaire pour le travail quotidien.
- **Recette indépendante :** APK **Preview** (profil `preview` EAS) avec JavaScript embarqué ; pas besoin de Metro pour démarrer. Distribution interne uniquement.
- **Version Play Store :** futur AAB `production`, **non déclenché** ici.

## Identités Android sans collision

| Mode | Nom affiché | Application ID | Source |
| --- | --- | --- | --- |
| Expo Go / standard | Duo Budget | `com.ss.budgetcouple` | `app.json` et `app.config.js` |
| APK Preview | Duo Budget Preview | `com.ss.budgetcouple.preview` | `APP_VARIANT=preview` défini par `eas.json` |

L'application historique `com.ss.budgetcouple` n'est donc pas écrasée lors de l'installation de l'APK Preview.

**Attention :** la Preview continue d'utiliser le parcours PIN/Tailscale hérité de V2 pour les données réelles, lorsque l'utilisateur choisit de s'authentifier. Le simple fait d'installer l'APK ne configure pas le serveur. Duo Glance utilise uniquement des montants de démonstration avant authentification.

## Prérequis du premier build

1. Compte Expo/EAS sous le contrôle du propriétaire du projet, puis connexion interactive à ce compte.
2. Node.js récent, npm, Git, réseau Internet ; compte EAS ayant les droits sur le projet.
3. Configurer les identifiants natifs définitifs **avant** toute distribution publique. Ne pas réutiliser la clé de signature de production sans validation.
4. Choisir le projet Expo EAS et son propriétaire ; la première initialisation peut ajouter `extra.eas.projectId` à la configuration. **Ne jamais inventer cet identifiant.**
5. Utiliser une branche de développement et ne pas mettre de secret ou de keystore privé dans Git.

## Validation de la configuration et preview

```bash
git clone https://github.com/Steve-Landry-NONO/S-S-Budget.git
cd S-S-Budget
git switch feature/android-preview-eas-v1
npm install
node scripts/check-glance.js
node scripts/check-android-preview.js
npx expo-doctor
```

Contrôler le rendu de la configuration Expo pour chaque variante :

```bash
npx expo config --json
APP_VARIANT=preview npx expo config --json
```

Sur **Windows PowerShell** :

```powershell
$env:APP_VARIANT = 'preview'
npx expo config --json
Remove-Item Env:APP_VARIANT
```

## Premier APK via EAS Build

```bash
npm install --global eas-cli
eas login
eas whoami
eas init
eas build --platform android --profile preview
```

À la première demande, EAS peut proposer de générer le keystore Android de test : conserver les références dans le gestionnaire EAS, jamais dans le dépôt. Une URL du build est fournie par EAS **uniquement après déclenchement effectif** ; aucune URL n'est présumée ici.

Après réussite, ouvrir le lien EAS sur Android pour télécharger/installler l'APK. Android peut demander l'autorisation d'installer une application provenant du navigateur. Révoquer cette autorisation lorsqu'elle n'est plus nécessaire.

## Expo Go reste disponible

```bash
npx expo start -c
```

Scanner le QR code sur le téléphone compatible. Les changements JavaScript peuvent être vus sans reconstruire une APK ; les ajouts de modules natifs ou certaines modifications de configuration nécessiteront un nouveau build.

## Checklist de recette Android (avant fusion PR #3 / PR Preview)

- [ ] La Preview apparaît comme « Duo Budget Preview » à côté de S&S Budget historique ; pas d'écrasement.
- [ ] L'icône et le splash correspondent aux assets réellement compilés (attention : les PNG natifs sont encore historiques).
- [ ] Le lancement hors réseau n'expose aucun solde réel ou cache privé avant authentification.
- [ ] Duo Glance se révèle au toucher/glissement ; navigation vers connexion/retour.
- [ ] Test du PIN avec serveur de **test**, expiration, déconnexion, retour sur lancement.
- [ ] Largeurs Android compactes/standard/grandes, clavier et barres système.
- [ ] « Réduire les animations » ; TalkBack et taille de texte augmentée.
- [ ] Échec réseau, fermeture forcée, redémarrage et retour en ligne.
- [ ] Les données et calculs V2 restent inchangés après authentification.

**Statut :** fichiers de build et garde-fous CI préparés ; APK réel **non compilé ni distribué** tant que l'authentification EAS, les credentials et l'exécution du build ne sont pas confirmés.

Références : [EAS Build / APK](https://docs.expo.dev/build-reference/apk/), [Distribution interne](https://docs.expo.dev/build/internal-distribution/), [eas.json](https://docs.expo.dev/build/eas-json/).
