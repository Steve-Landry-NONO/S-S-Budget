# 03 — Qualification du serveur SQLite (LOT T03)

Aucune base réelle n'a été lue ni modifiée : chaque test lance le vrai serveur (`server/src/index.js`) en sous-processus sur une base jetable sous `os.tmpdir()`, avec un port et un `APP_SECRET` aléatoires, `cwd` temporaire (aucun `.env` réel chargé). `withDb()` refuse d'ouvrir un fichier hors du répertoire temporaire. Les routes de sauvegarde/restauration/reset (qui écrivent dans `server/backups/`) ne sont **pas** exécutées par les tests, sauf pour vérifier leur refus `403` à un membre.

## 1. Audit reproduit (sqlite3 5.1.7)

`npm audit` : **7 entrées — 1 critique, 4 élevées, 2 faibles** (conforme au rapport).

| Paquet | Gravité | Chemin | Phase concernée |
|---|---|---|---|
| `tar` 6.2.1 (12 avis, dont « Decompression/parse DoS » critique ≤ 7.5.18, traversées de chemin/liens) | critique | sqlite3 → tar ; node-gyp → tar ; cacache → tar | **installation** (extraction du binaire précompilé / en-têtes Node) |
| `node-gyp` 8.4.1 | élevée | sqlite3 (optionnelle) | **compilation** (repli si pas de binaire) |
| `cacache`, `make-fetch-happen` | élevée | node-gyp | installation/compilation |
| `http-proxy-agent`, `@tootallnate/once` | faible | make-fetch-happen | installation/compilation |
| `sqlite3` 5.1.7 | élevée (transitif) | direct | — |

**À l'exécution**, `sqlite3/lib/*.js` ne charge que `bindings` et `node_sqlite3.node` : aucun de ces paquets n'est chargé par l'API. Le risque porte sur `npm install`/`npm ci` (archive ou réseau compromis), pas sur les requêtes HTTP.

## 2. Usages réels de sqlite3

`server/src/db.js` : `open({ filename, driver: sqlite3.Database })` via `sqlite@5.1.1`, puis uniquement `db.exec/run/get/all/close` et `PRAGMA`. Transactions : `BEGIN TRANSACTION`/`COMMIT`/`ROLLBACK` dans `/api/auto-contributions` et `/api/activity-logs/read-all`. Migrations additives `ALTER TABLE ADD COLUMN` au démarrage. Aucune API spécifique 5.x.

## 3. sqlite3 6.0.1 — analyse

| Point | Constat |
|---|---|
| Notes de version | 6.0.0 « Bump all dependencies, SQLite, and modernise CI » ; 6.0.1 corrige les binaires musl. **Dépôt amont marqué « unmaintained »** (PR #1844) |
| Dépendances | `tar ^7.5.10` (résolu **7.5.23**, > 7.5.20), `node-gyp 12.x` (**12.4.0**), `node-addon-api ^8` |
| Moteurs | Node **>= 20.17.0** (Node 22 OK) |
| API JS | Inchangée pour notre usage |
| SQLite embarqué | **3.44.2 → 3.52.0** |
| Binaires précompilés | darwin x64/arm64, linux x64/arm64, linuxmusl x64/arm64, win32 x64. **win32-ia32 supprimé** (présent en 5.1.7) |
| **glibc** | Le binaire linux-x64 6.0.1 exige **GLIBC_2.38** (5.1.7 : ≤ 2.4). Sur Ubuntu 22.04 (glibc 2.35), `npm install` **réussit** mais `require('sqlite3')` échoue : `GLIBC_2.38 not found` → **le serveur ne démarrerait pas** |
| Compilation source | `npm ci --build-from-source` (python3, make, g++) : OK en ~2 min sur Ubuntu 22.04 ; binaire obtenu : GLIBC ≤ 2.34 |

### Alternatives évaluées

| Option | Avantages | Inconvénients | Avis |
|---|---|---|---|
| sqlite3 6.0.1 (retenu) | 0 vulnérabilité, API identique, tests verts | Amont non maintenu ; glibc 2.38 ou compilation | **Court terme** |
| Rester en 5.1.7 | Aucun changement de déploiement | 7 vulnérabilités d'installation ; amont figé | Acceptable seulement si `npm ci` n'est plus jamais relancé |
| `better-sqlite3` | Maintenu, binaires larges, API synchrone rapide | Réécriture de la couche d'accès (API synchrone) | Recommandé P2 |
| `node:sqlite` (intégré) | Aucune dépendance native | **Expérimental** dans Node 22 (avertissement à l'exécution) | À réévaluer avec Node 24 LTS |

## 4. Résultats de qualification

Suite `server/test/*.test.cjs` (22 tests : 17 réussis + 5 `todo` sécurité, voir 05).

| Exigence | Test | 5.1.7 | 6.0.1 (source) | CI 6.0.1 (Ubuntu 26.04, précompilé) |
|---|---|---|---|---|
| Création / lecture / écriture | persistence #1–#5 | ✅ | ✅ | ✅ |
| Réouverture + persistance après redémarrage | persistence #1, #2 ; concurrency (relecture après redémarrage) | ✅ | ✅ | ✅ |
| 200 − 35 = 165 € via `dashboardModel` après redémarrage, prévisionnel 125 € | persistence #1 | ✅ | ✅ | ✅ |
| Écritures concurrentes simples (40 en parallèle) | concurrency #1 | ✅ | ✅ | ✅ |
| Transactions + écritures concurrentes | concurrency #2 | ❌ **échec** (voir §5) | ✅ après `d3d766f` | ✅ |
| Base au format historique V2.0 (schéma du tag `v2.0`) migrée, idempotente, `integrity_check=ok` | persistence #6 | ✅ | ✅ | ✅ |
| Base **écrite par 5.1.7** rouverte et écrite par 6.0.1 | script ponctuel | — | ✅ intégrité ok, soldes 345/305 € cohérents | — |
| Base **écrite par 6.0.1** relue par 5.1.7 (retour arrière) | script ponctuel | ✅ intégrité ok | — | — |
| `npm ci` depuis le lockfile | — | — | ✅ 133 paquets, 0 vuln. | ✅ |

## 5. Défaut d'intégrité trouvé et corrigé — P0 (préexistant V2)

**Reproduction** (serveur non modifié, sqlite3 5.1.7) : en parallèle 3 lots `/api/auto-contributions`, 20 `POST /api/expenses`, 3 `/api/activity-logs/read-all`. Trois exécutions :

| Exécution | Dépenses acquittées 201 | Dépenses présentes après redémarrage | Lots auto en 500 | Lignes de versements laissées |
|---|---|---|---|---|
| 1 | 20 | 20 | 3 | 0 |
| 2 | 20 | **8** | 3 | **8** (partielles) |
| 3 | 20 | **13** | 3 | **9** (partielles) |

Erreurs : `SQLITE_ERROR: cannot start a transaction within a transaction`, `cannot commit - no transaction is active`. **Cause** : une seule connexion SQLite partagée ; un `BEGIN` capture les instructions d'autres requêtes, un `ROLLBACK` concurrent les annule après leur acquittement.

**Correctif `d3d766f`** : file d'attente promise pour les requêtes mutantes `/api` (hors GET/HEAD/OPTIONS), libérée sur `finish`/`close` de la réponse. Aucune route, validation, autorisation ou règle financière modifiée. Après correctif : 3/3 exécutions, 20/20 dépenses, 30/30 lignes de versements, 0 erreur.
**Effet de bord** : les écritures sont traitées l'une après l'autre (négligeable pour un duo). Une requête mutante qui ne répondrait jamais bloquerait la file : toutes les routes répondent ou passent par le gestionnaire d'erreurs.

## 6. Constat historique documenté, non modifié — B-07

La migration V2.2.1 ajoute `status ... DEFAULT 'done'` **avant** l'`UPDATE` qui classe par date : les lignes historiques datées dans le futur deviennent `done` (réalisées) au lieu de `planned`. Déjà appliqué aux bases réelles ; le corriger maintenant reclasserait des opérations : **décision métier requise**, aucune action.

## 7. Correctif de dépendance — commit `c80cd8f`

- `sqlite3` `^5.1.7` → `^6.0.1`, `engines.node >=20.17.0`, script `check:native`, script `test`.
- `server/package-lock.json` désormais **suivi** (il était non suivi).
- `npm audit` serveur : **7 → 0**.

## 8. Procédure de déploiement sur le serveur du propriétaire (à exécuter par lui)

Aucune migration de schéma n'est nécessaire (format de fichier compatible dans les deux sens).

```bash
# 0. Arrêter le serveur, puis sauvegarder la base (copie hors ligne)
cp server/data/ss-budget.sqlite ~/ss-budget-avant-sqlite6-$(date +%F).sqlite
# 1. Vérifier l'environnement
node --version            # >= 20.17.0
ldd --version | head -1   # glibc >= 2.38 => binaire précompilé ; sinon étape 2b
# 2a. glibc >= 2.38
cd server && npm ci
# 2b. glibc < 2.38 (ex. Ubuntu 22.04) : outils python3 make g++ requis
cd server && npm ci --build-from-source
# 3. Contrôle obligatoire avant démarrage
npm run check:native      # doit afficher "sqlite3 native binding OK, SQLite 3.52.0"
npm test                  # bases temporaires uniquement
# 4. Démarrer, vérifier /api/health puis une connexion PIN
```

**Retour arrière** : arrêter, `git checkout <commit précédent> -- server/package.json server/package-lock.json`, `npm ci`, redémarrer ; la base reste lisible (vérifié).
Windows 32 bits : non supporté par 6.0.1 → rester en 5.1.7 sur cet hôte.
