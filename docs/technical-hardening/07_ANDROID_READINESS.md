# 07 — Android Preview (LOT T07)

**Statut : configuration prête pour un build de recette. Aucune APK n'a été produite.** Aucun build EAS n'a été déclenché (ni gratuit ni payant) ; aucune connexion au compte Expo n'a été utilisée.

## 1. Audit de la PR #4 (`590adfe`)

| Élément | Constat |
|---|---|
| Base | `3ab10a1`, en retard sur PR #3 (`b03af49`) : la PR n'a jamais été validée sur SDK 58 ni avec la navigation/Dashboard |
| `app.config.js` | Variante `APP_VARIANT=preview` → « Duo Budget Preview », `com.ss.budgetcouple.preview` ; standard inchangé. Correct |
| `eas.json` | Profil `preview` : distribution interne, `buildType: apk` ; `production` : AAB. Correct |
| `scripts/check-android-preview.js` | 15 assertions sans identifiants EAS. Correct |
| `app.json` de la branche | Antérieur au SDK 58 (clé `splash` legacy, plugin `expo-splash-screen` absent) — **non porté** |
| CI | Run 45360201391 vert, mais sur l'ancienne base |

## 2. Portage sur Sprint 2 / SDK 58

- `176cf87` : `app.config.js`, `eas.json`, `check-android-preview.js` **repris à l'identique** de PR #4.
- `npx expo config` (SDK **58.0.0**) : standard = « Duo Budget » / `com.ss.budgetcouple` ; preview = « Duo Budget Preview » / `com.ss.budgetcouple.preview`, `extra.appVariant=preview`, plugin splash conservé. → **V2 et Preview installables simultanément.**
- `npx expo-doctor@1.21.8` : **20/20** avec `app.config.js`.

## 3. Vérification par `expo prebuild` (bac à sable, puis CI)

`APP_VARIANT=preview npx expo prebuild --platform android --no-install` a révélé, **avant correctif** :

| Constat | Conséquence |
|---|---|
| `usesCleartextTraffic="true"` uniquement dans `src/debug*/AndroidManifest.xml` | **Bloquant** : l'APK (release) refuse `http://100.x.y.z:3001` ; l'app ne joindrait pas le serveur de recette |
| `allowBackup="true"` | Jeton, secret API et cache financier (AsyncStorage) inclus dans les sauvegardes Android |
| `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` dans le manifeste principal | Permissions jamais utilisées par l'app |

Correctif `283480d` (**variante Preview uniquement**) :
- plugin local `plugins/withPreviewCleartext.js` (10 lignes, `expo/config-plugins`, **aucune nouvelle dépendance**), activé seulement si `PREVIEW_ALLOW_CLEARTEXT=1` — positionné visiblement dans `eas.json` › `preview.env` ;
- `android.allowBackup=false` ;
- `android.blockedPermissions` pour les 3 permissions.

Manifeste Preview après correctif (prebuild local + job CI `android-preview`) : `INTERNET`, `VIBRATE` conservés ; 3 permissions `tools:node="remove"` ; `allowBackup="false"` ; `usesCleartextTraffic="true"` ; `applicationId 'com.ss.budgetcouple.preview'` ; libellé « Duo Budget Preview ». Manifeste **standard** : strictement identique à avant.

## 4. Autres vérifications

| Point | Résultat |
|---|---|
| Dépendances natives | Uniquement celles d'Expo 58 + async-storage + safe-area-context ; aucune ajoutée |
| Assets | `icon.png`, `adaptive-icon.png` (fond `#0F1C2E`), `splash.png` présents et référencés ; la PR #4 signalait que les PNG natifs sont encore les visuels historiques — à confirmer visuellement |
| Secrets dans le build | Aucune variable `EXPO_PUBLIC_*` autre que `EXPO_PUBLIC_DUO_PREVIEW` ; aucune clé secrète dans `eas.json` env ni `extra` (assertions) ; aucune valeur secrète dans le projet natif généré (CI) |
| Avertissement prebuild | `userInterfaceStyle` demande `expo-system-ui` (thème clair uniquement : sans effet bloquant) |
| `versionCode` | 1 pour le paquet Preview (indépendant) ; `appVersionSource: local` |
| Compatibilité réseau | Assurée par le plugin (HTTP clair) ; alternative recommandée D-04 ci-dessous |

## 5. Pourquoi aucune APK

- Machine locale : pas de SDK Android, **disque à 99 %** (2,4 Go libres) — build Gradle local impossible.
- EAS : nécessite la connexion au compte du propriétaire, le choix du projet (`eas init` ajoute `extra.eas.projectId`, à ne pas inventer), la génération/gestion du keystore et consomme du quota → **non déclenché sans validation**.

## 6. Procédure reproductible (à exécuter par le propriétaire)

```bash
git switch fix/v3-technical-hardening          # ou la branche Sprint 2 après fusion
npm ci
node scripts/check-android-preview.js           # 32 assertions
npx expo-doctor@1.21.8
APP_VARIANT=preview PREVIEW_ALLOW_CLEARTEXT=1 npx expo config --json | grep -E '"package"|usesCleartext|allowBackup'
npm install --global eas-cli
eas login && eas whoami
eas init                                         # une seule fois ; commiter extra.eas.projectId
eas build --platform android --profile preview   # quota EAS : vérifier l'offre gratuite avant
```

Puis : installer l'APK via le lien EAS, vérifier qu'elle cohabite avec l'app historique, configurer l'URL Tailscale du serveur **de test**, dérouler la checklist de `docs/ANDROID_PREVIEW_BUILD.md` (PR #4) + cartes « Votre duo ».

## 7. Décision D-04 (propriétaire)

Garder le trafic clair pour la Preview (tunnel Tailscale chiffré, mais autorise HTTP vers tout hôte) **ou** passer le serveur en HTTPS (`tailscale serve` / `tailscale cert`, URL `https://<machine>.<tailnet>.ts.net`) puis supprimer le plugin et `PREVIEW_ALLOW_CLEARTEXT`. Recommandation : HTTPS avant toute bêta ; cleartext acceptable pour la recette interne.

## Mise à jour lot 2

Inchangé : HTTP clair seulement pour la Preview explicitement activée. Parcours HTTPS bêta (`tailscale serve`) : `12_LOT2_REVIEW_FIXES.md` §5.
