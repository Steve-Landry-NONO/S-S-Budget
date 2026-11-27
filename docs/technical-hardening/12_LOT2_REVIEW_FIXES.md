# 12 — Lot 2 : corrections après revue indépendante

24 novembre 2026 · Branche `fix/v3-technical-hardening` · Tête distante vérifiée avant intervention : `cc4dba2` (= PR #15).
Restrictions inchangées : aucune fusion, aucun force-push, `main`/Figma/Supabase/autres branches intacts, aucun serveur réel touché, aucun build EAS.

## 1. P0 — Verrou d'écriture SQLite (`fd772ba`)

**Constat de la revue confirmé.** `serializeWrites` (`d3d766f`) libérait le verrou sur `res 'close'` : (a) une déconnexion du client pendant une transaction libérait le verrou alors que le travail SQLite continuait ; (b) une requête en attente déconnectée libérait son créneau puis s'exécutait plus tard en parallèle de la suivante.

**Tests déterministes** (`server/test/write-lock.test.cjs`). Transaction longue obtenue par un lot de versements automatiques fictif de 3 000 × 5 = 15 000 lignes (~2 s), déconnexions par `AbortController`. L'ordre est prouvé par le journal d'activité (la requête suivante, émise par l'autre membre, marque comme lue l'entrée de fin du lot), pas par des délais fins.

| Test | Avant (`cc4dba2`) | Après |
|---|---|---|
| Déconnexion **pendant** la transaction : la requête transactionnelle suivante attend, lot atomique, ordre prouvé | ❌ `500 cannot start a transaction within a transaction` | ✅ |
| Déconnexion **pendant l'attente** : requête non exécutée, rien écrit, la suivante ne chevauche pas, file non bloquée | ❌ même erreur 500 | ✅ |
| Chemins d'erreur (FK, échec FK **dans** la transaction → ROLLBACK, JSON invalide, validation) libèrent le verrou ; garde anti-blocage 5 s | ✅ | ✅ |

Après correctif : 3 exécutions sur 3 vertes ; les tests de concurrence précédents restent verts.

**Conception.** `withWriteLock(task)` chaîne sur la promesse du gestionnaire lui-même : libération quand le gestionnaire (COMMIT/ROLLBACK compris) se termine, quelle que soit l'issue. Toutes les routes POST/PUT/PATCH/DELETE (y compris futures) sont enveloppées automatiquement. Une requête dont le client est parti avant son tour n'est pas exécutée (journalisé). Détection : `res 'close'` avant `writableEnded` et état de la socket — `req.destroyed` est inutilisable (vrai dès que le corps JSON est lu, constaté pendant le développement).
**Blocage permanent :** impossible par construction tant que chaque gestionnaire se termine ; toutes les opérations attendues sont des appels SQLite qui aboutissent ou échouent. Aucun délai d'expiration n'a été ajouté : libérer un verrou pendant qu'une transaction tourne réintroduirait le défaut.
**Limite connue :** les lectures (GET) ne prennent pas le verrou et peuvent lire l'état intermédiaire d'une transaction en cours sur la même connexion (comportement inchangé).

## 2. P0 — R-01 secret serveur (`543381d`)

- `server/src/config.js` : `APP_SECRET` refusé s'il est absent, < 32 caractères, < 10 caractères distincts, entouré d'espaces, ou public (valeurs connues + fragments `change-moi`, `changez-moi`, `changeme`, `insecure`, `example`, `exemple`). **Indépendant de `NODE_ENV`.**
- Démarrage refusé (code 1) avec message actionnable ; la valeur n'est jamais journalisée (vérifié pour chaque cas).
- Clé de secours publique **supprimée** ; aucun mode de développement dérogatoire (un secret aléatoire local suffit ; non nécessaire).
- Secret API toujours exigé, comparaison à temps constant (SHA-256 + `timingSafeEqual`).
- Tests `config.test.cjs` : avant 4/5 (le serveur démarrait sans secret, avec l'exemple, ou trop court), après 5/5 ; jeton forgé avec l'ancienne clé → 401 ; rotation → sessions et ancien secret API refusés, PIN conservés.

### Rotation des secrets

1. Générer : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Arrêter le serveur, remplacer `APP_SECRET` dans `server/.env`, redémarrer.
3. Effet immédiat : **toutes les sessions sont invalidées** (signature différente) et l'ancien secret API est refusé. Les PIN ne changent pas.
4. Sur chaque téléphone : « Modifier la configuration du serveur » → saisir le nouveau secret → se reconnecter avec le PIN.
5. Retour arrière : remettre l'ancien secret (les jetons encore non expirés redeviennent valides).

## 3. P1 — F-01 zéro négatif (`2b464ac`)

`presentedAmount()` = montant affiché (même arrondi `toFixed(2)` qu'avant, sans zéro négatif) ; `formatEuro()` partagé par l'app et le QA Lab. Alertes (solde réel/prévisionnel négatif), statuts d'enveloppe, styles négatifs, signes +/−, « reste à verser » et badges hérités comparent le montant affiché. Totaux bruts, persistance, agrégation V2 et indicateurs `needsFunding`/`overBudget` **inchangés** (différentiel V2 strict toujours vert).

| Valeur brute | Avant | Après | Alerte négative |
|---|---|---|---|
| −5,55e−17 (0,30 − 0,10 − 0,20) | « -0,00 € » + alerte | « 0,00 € » | non |
| −0,004 / +0,004 / −0 | « -0,00 € » / « 0,00 € » / « 0,00 € » | « 0,00 € » | non |
| −0,005 | « -0,01 € » | « -0,01 € » | oui |
| +0,005 | « 0,01 € » | « 0,01 € » | — |
| 1,005 | « 1,00 € » (binaire 1,00499…) | « 1,00 € » | — |

Propriété sur 20 000 valeurs : texte identique à l'ancien formateur sauf « -0,00 € » → « 0,00 € ». Tests F-01 : avant 0/3, après 3/3. Matrice navigateur 40/40 après changement.

## 4. R-04 / R-05 (`29fc002`)

- `/api/health` → `{ok, name, time}`. Seul consommateur : exemple `curl` du README (inchangé, compatible).
- Erreurs : JSON invalide → **400 `INVALID_JSON`** ; corps trop gros → 413 ; défaut interne → 500 `INTERNAL_ERROR` avec message générique ; messages SQLite plus jamais renvoyés.
- Journaux : méthode, chemin, code et pile pour les erreurs internes ; jamais l'objet d'erreur d'un JSON invalide.
- **Nouveau constat corrigé :** l'ancien `console.error(error)` journalisait le corps brut d'un JSON malformé (body-parser l'attache à l'erreur et le message de `JSON.parse` le cite) → un PIN envoyé dans un login malformé était écrit dans les journaux (vérifié : vrai avant, faux après).
- Tests : avant 3 réussis / 3 échecs, après 6 + 2 todo (R-02, R-03).

## 5. Dépendances et Android

- Conservés : sqlite3 **6.0.1**, minimatch **11.0.9** (audits 0/0, Doctor 20/20, mêmes contrôles qu'au lot 1).
- HTTP clair : **uniquement** variante Preview avec `PREVIEW_ALLOW_CLEARTEXT=1` (inchangé, 32 assertions dont « jamais hors Preview », « jamais en production »).

### Migration future vers un pilote SQLite maintenu (non réalisée)

| Étape | Contenu |
|---|---|
| Cible | `better-sqlite3` (maintenu, binaires larges, API synchrone) ; `node:sqlite` quand stable en LTS |
| Isolation | Créer `server/src/dbDriver.js` exposant `run/get/all/exec/transaction(fn)` ; `index.js` ne parle plus qu'à cette façade |
| Transactions | `db.transaction(fn)` synchrone natif → supprime la classe de défauts du §1 ; garder le verrou d'écriture tant que des `await` existent dans les gestionnaires |
| Compatibilité | Même fichier SQLite, aucune migration de schéma ; vérifier `PRAGMA foreign_keys`, types REAL, `CURRENT_TIMESTAMP` |
| Qualification | Rejouer `server/test` à l'identique (32 tests), réouverture croisée des bases, test sur glibc 2.35 et 2.39 |
| Retour arrière | Revert du commit de façade + `npm ci` |

### Parcours HTTPS pour la bêta

1. Sur le serveur : `tailscale serve --bg --https=443 http://127.0.0.1:3001` (certificat géré par Tailscale, nom `https://<machine>.<tailnet>.ts.net`), et lier l'API à `127.0.0.1` (variable d'écoute à ajouter, aujourd'hui `0.0.0.0`).
2. Dans l'app : saisir l'URL `https://…ts.net`.
3. Build bêta : profil EAS sans `PREVIEW_ALLOW_CLEARTEXT` → le plugin n'est pas appliqué (vérifié par les garde-fous).
4. Supprimer ensuite `plugins/withPreviewCleartext.js` et la variable.

## 6. Risques planifiés, non implémentés

### R-02 — révocation des sessions
Colonne additive `members.session_version INTEGER NOT NULL DEFAULT 0` (migration additive comme les autres) ; le jeton porte `sv` ; `requireAuth` refuse si `sv !== member.session_version`. Incrément au changement de PIN, à une route `POST /api/auth/logout-all`, et par l'admin. Coût : 1 colonne, ~15 lignes, tests existants R-02 (todo) prêts. Effet : déconnexion de tous les appareils du membre.

### R-03 — enrôlement du premier PIN
Option A (recommandée) : le premier PIN d'un membre ne peut être défini que par un administrateur authentifié (`POST /api/members/:id/enroll`) qui obtient un code à usage unique (6 chiffres, 15 min, haché) que le membre saisit avec son PIN. Option B : seul le premier compte admin s'enrôle librement, puis enrôlement fermé. Impact UX : parcours V2.8 modifié → décision produit.

### R-06 — stockage du jeton et du secret
`expo-secure-store` (Keychain / Keystore) pour `AUTH_TOKEN`, `AUTH_EXPIRES_AT`, `API_SECRET` ; migration au premier lancement (lecture AsyncStorage → écriture SecureStore → suppression). Le cache financier reste en AsyncStorage (volume) mais est purgé selon R-07. Web : pas d'équivalent sûr → interdire la persistance du secret sur le build Web normal. Coût : module natif → nouveau build.

### R-07 — nettoyage à la déconnexion
`logout()` : supprimer `SS_BUDGET_V2_CACHE` et réinitialiser l'état en mémoire ; option « Oublier ce serveur » qui supprime aussi URL et secret. Mode hors ligne : la réouverture sans session n'affiche plus le cache. Tester avec le harnais navigateur (cas « jeton valide stocké » de `web-qa.cjs`).

### B-07 — méthode d'audit en lecture seule (outil livré `27790fa`)
1. Arrêter le serveur, **copier** la base (`cp server/data/ss-budget.sqlite /tmp/audit-copy.sqlite`), redémarrer.
2. `cd server && npm run audit:b07 -- /tmp/audit-copy.sqlite` (ou `--json`). Ouverture `SQLITE_OPEN_READONLY`, aucune écriture possible (test `SQLITE_READONLY`).
3. Lire la liste des candidates (« réalisée » datée après sa création) : certaines sont **voulues** (l'app propose « réalisé » pour une date future).
4. Lire l'impact simulé mois par mois (réel, report, prévisionnel) si elles étaient « prévues ».
5. Décision humaine ligne par ligne ; toute correction future passera par l'API (modification d'opération, journalisée), jamais par SQL direct.

## 7. Procédure de déploiement du serveur (propriétaire) et retour arrière

```bash
# 0. Sauvegarde hors ligne
cp server/data/ss-budget.sqlite ~/ss-budget-avant-lot2-$(date +%F).sqlite
cp server/.env ~/ss-budget-env-avant-lot2-$(date +%F)
# 1. Secret : vérifier SANS l'afficher
cd server && node -e "require('dotenv').config();console.log(require('./src/config').validateAppSecret(process.env.APP_SECRET))" && cd ..
#    affiche { ok: true } ou { ok: false, reason: '…' } (jamais la valeur) ; ok: false => générer un nouveau secret (§2) et prévoir la ressaisie sur les téléphones
# 2. Dépendances (voir 03 §8 : glibc >= 2.38 sinon --build-from-source)
cd server && npm ci && npm run check:native && npm test
# 3. Démarrer ; vérifier : curl http://localhost:3001/api/health  (sans secret : 401 attendu désormais)
curl -H "x-ss-budget-secret: <secret>" http://localhost:3001/api/health
```

Note : `/api/health` exige le secret API (comme avant quand `APP_SECRET` était défini).
**Retour arrière :** arrêter ; `git checkout cc4dba2 -- server/` (ou le commit voulu) ; `npm ci` ; restaurer le `.env` sauvegardé si besoin ; redémarrer. Base inchangée par ce lot (aucune migration).

## 8. Risques résiduels après lot 2

| Id | Statut |
|---|---|
| Verrou d'écriture | Corrigé ; limite : lectures concurrentes d'un état intermédiaire |
| R-01 | Corrigé ; **déploiement : un `.env` réel non conforme empêchera le démarrage** |
| F-01, R-04, R-05 | Corrigés |
| R-02, R-03 | Ouverts, propositions §6, tests `todo` prêts |
| R-06, R-07 | Ouverts, propositions §6 |
| B-07 | Ouvert ; outil d'audit lecture seule livré ; décision métier |
| sqlite3 amont non maintenu, glibc 2.38 | Inchangé ; plan §5 |
| HTTP clair Preview | Inchangé, opt-in ; parcours HTTPS §5 |
| APK, recheck natif | Toujours non réalisés |
