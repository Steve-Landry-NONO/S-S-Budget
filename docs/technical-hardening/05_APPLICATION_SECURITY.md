# 05 — Audit de sécurité applicative (LOT T05)

Légende : ✅ conforme (testé) · ⚠️ risque résiduel documenté · ❌ défaut corrigé dans cette branche.
Les risques qui modifieraient l'architecture de sécurité ou les règles d'autorisation sont **isolés pour validation** (non corrigés) et visibles en CI comme `todo` dans `server/test/security.test.cjs`.

## 1. Constats par domaine

| Domaine | Constat | Statut |
|---|---|---|
| Secrets dans le dépôt | `gitleaks 8.30.1` (CI, checksum vérifié) : **130 commits, aucune fuite**. Balayage local par motifs (jetons GitHub, AWS, clés privées, Slack, Google, JWT) sur l'arbre et tout l'historique : 0. Seul `server/.env.example` est versionné ; `APP_SECRET` n'apparaît qu'avec des valeurs d'exemple | ✅ |
| Secret API | En-tête `x-ss-budget-secret` ; comparaison `!==` non constante (faible sur LAN) ; refus des quasi-égalités testé | ✅ / faible |
| **Clé de signature par défaut** | Si `APP_SECRET` est absent ou égal à l'exemple : (1) le secret API n'est plus exigé, (2) les jetons sont signés avec `ss-budget-dev-insecure-secret-changez-moi`, **publique dans le dépôt**. Un jeton admin forgé est **accepté** (test R-01). Le serveur se contente d'un avertissement | ⚠️ **R-01 — P0 si mal configuré** |
| Jetons de session | HMAC-SHA256, TTL 12 h, vérification `timingSafeEqual`, membre relu en base, en-tête utilisateur discordant refusé ; falsifications testées | ✅ |
| Révocation | Jetons sans état : ni déconnexion serveur, ni révocation au changement de PIN (R-02) ; la déconnexion client efface seulement le jeton local | ⚠️ R-02 — P1 |
| Enrôlement | Un profil sans PIN peut recevoir un PIN de quiconque détient le secret API (conception V2.8 « premier usage ») (R-03) | ⚠️ R-03 — P1 |
| PIN | PBKDF2-SHA512 100 000 itérations, sel 16 octets, comparaison constante, verrouillage 5 essais / 15 min ; `pbkdf2Sync` bloque la boucle (~50-100 ms/tentative : DoS CPU possible pour qui a le secret) | ✅ / P2 |
| Autorisations | Admin requis pour membres, enveloppes, sauvegardes, exports, reset ; membre limité à ses opérations < 5 jours ; testé | ✅ |
| Validation des entrées | Montant > 0 fini, libellé non vide, PIN 4-8 chiffres ; FK SQLite pour enveloppe/membre. Pas de validation de format de **date** côté serveur (chaîne libre acceptée) ; pas de borne haute de montant | P2 |
| SQL | 100 % des valeurs paramétrées (`?`) ; seules interpolations : noms de tables/colonnes **constants** dans la migration. Injection testée | ✅ |
| Restauration | `path.basename` + préfixe/suffixe imposés : pas de traversée | ✅ (lecture) |
| Journaux serveur | `morgan('dev')` : méthode, URL, statut — ni corps, ni en-têtes ; PIN/jeton/secret absents (testé) | ✅ |
| Erreurs | Gestionnaire générique : statut 500 + `error.message` (messages SQLite exposés) ; JSON malformé → 500 au lieu de 400 (R-05) | ⚠️ R-05 — P3 |
| Exposition | `/api/health` renvoie le **chemin absolu** de la base (R-04) ; écoute `0.0.0.0` ; CORS `*` par défaut. README : ne pas exposer sur Internet | ⚠️ R-04 — P3 |
| Réseau | HTTP clair ; protégé en pratique par Tailscale (WireGuard). Voir T07 pour l'APK | Décision D-04 |
| Stockage client | Jeton, secret API et cache financier dans AsyncStorage (non chiffré ; `localStorage` sur Web, lisible par tout script de la page) | ⚠️ R-06 — P1 avant bêta |
| Déconnexion | `logout()` efface jeton + expiration **mais conserve** le cache financier et le secret API sur l'appareil | ⚠️ R-07 — P1 avant bêta |
| Session hors ligne | Un jeton local non expiré ouvre l'app sur le cache sans vérification serveur (conçu pour le mode hors ligne) | Conception, documenté |
| Sauvegarde Android | `allowBackup=true` par défaut → AsyncStorage dans les sauvegardes | ❌→✅ Preview (`283480d`) ; standard inchangé |

## 2. Duo Glance avant authentification — vérifié

- Statique : montants `DEMO` gelés (`Object.freeze`), aucun `AsyncStorage`/`fetch`/`/api/` (13 assertions).
- **Dynamique (navigateur, build normal)** : cache privé semé avec un montant sentinelle `98765,43 €`, secret, URL et jeton factices.

| Cas | Glance affiché | Sentinelle affichée | Appels réseau |
|---|---|---|---|
| Aucun jeton | ✅ | ❌ non | `/api/auth/status` uniquement (public : noms/rôles) |
| Jeton expiré | ✅ (jeton purgé du stockage) | ❌ non | `/api/auth/status` uniquement |
| Jeton **valide** stocké | non — l'app s'ouvre (session en cours) | oui (cache de l'utilisateur connecté) | `/api/state` |

Conclusion : **aucune donnée réelle avant authentification**. Le 3e cas correspond à une session déjà ouverte (comportement voulu), documenté pour revue (R-07).

## 3. QA Lab — vérifié

| Exigence | Preuve |
|---|---|
| Activation explicite uniquement | `App()` : `Platform.OS==='web' && process.env.EXPO_PUBLIC_DUO_PREVIEW==='1'` — variable **inlinée au build** ; un build normal ne peut pas l'activer à l'exécution |
| Données fictives exclusivement | `fixtures.cjs` (« Partenaire A/B ») ; bandeau « DONNÉES FICTIVES » ; test sentinelle : rien de privé affiché |
| Ne monte pas l'app authentifiée | `return <WebPreview />` avant `<AuthenticatedApp />` ; **le bundle QA Lab ne contient même pas** les clés de stockage, en-têtes d'auth, routes `/api/state` et `/api/auth/login` (élimination au build, 16 contrôles `check-bundle-isolation.cjs`) |
| Aucun accès stockage / API | Instrumentation navigateur de `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `XMLHttpRequest`, `WebSocket` pendant toute la matrice : **0 accès** ; 3 requêtes, toutes statiques, même origine |

Note : le bundle **normal** contient le code du QA Lab (inaccessible, données fictives) — sans risque, P3 (séparation possible par import dynamique).

## 4. Décisions demandées (aucune appliquée)

| Id | Proposition | Impact |
|---|---|---|
| R-01 | En `NODE_ENV=production`, refuser de démarrer sans `APP_SECRET` (≥ 32 caractères) | Démarrage bloqué si `.env` incomplet : vérifier le `.env` réel avant |
| R-02 | Version de jeton par membre (`token_version` incrémentée au changement de PIN/déconnexion) | Ajout de colonne → migration additive |
| R-03 | Premier PIN exigeant une validation admin ou un code d'enrôlement | Change le parcours V2.8 |
| R-04 | Retirer `dbPath` de `/api/health` | Mineur |
| R-05 | Erreurs 500 génériques + 400 pour JSON invalide | Mineur ; messages utilisateur à revoir |
| R-06 | `expo-secure-store` pour jeton et secret | Nouveau module natif, rebuild |
| R-07 | Déconnexion : purge du cache financier (et option d'oubli du secret) | UX hors ligne modifiée |
