# Sprint 1 — Navigation V3
Base : Expo SDK 58, PR #5. Quatre destinations fixes sous le contenu, deux actions depuis Accueil, six écrans V2 conservés. Aucun changement métier, PIN, serveur ou migration. Styles issus des tokens existants. Les libellés sont associés à des pictogrammes natifs monochromes sans dépendance additionnelle ; ils restent la source d'information accessible. Pictogrammes provisoires, recette visuelle Figma et appareils requise avant validation produit.
## Recette restante
- iOS et Android : 360/390/430 px, safe areas, clavier ouvert, défilement, grande police 130/200 %, VoiceOver/TalkBack.
- Les six parcours : synthèse, caisses, membres, journal, dépense, versement ; retour Accueil depuis les deux actions.
- PIN invalide/valide, expiration, changement de profil, aucune donnée avant connexion.
- Comparer soldes et opérations V2 sur données fictives identiques.
- Aucun résultat natif prétendu ; CI statique et web distinctes.

CI du socle initial f31f4b3 : run 45360468225 réussi (Node, npm ci, garde-fous, Babel, export Web). Cette preuve ne s'applique pas automatiquement au commit de finition.

## Recette mobile intégrée — 24 novembre 2026
CI d0f9420 : run 45360996666 réussi (5 tests navigation, npm ci, confidentialité statique, Babel, export web). Ce résultat ne valide pas les appareils.
### Démarrage depuis un clone neuf (Node 22, Bash)
Ne pas réutiliser un clone contenant une base réelle, ni un téléphone Expo Go contenant un cache réel de cette application. Utiliser un appareil/profil de test vierge ou un simulateur propre. Aucun accès à Supabase ni au serveur personnel réel.

```bash
git clone --branch feat/v3-sprint1-navigation --single-branch https://github.com/Steve-Landry-NONO/S-S-Budget.git duo-sprint1-qa
cd duo-sprint1-qa
npm ci
node --test scripts/navigation.test.cjs
npm --prefix server install
```
Terminal serveur (réseau privé de test uniquement, jamais exposé sur Internet) :
```bash
export DB_PATH="$(mktemp -d)/qa.sqlite"
export APP_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
export PORT=3301
printf 'Secret QA temporaire : %s\\n' "$APP_SECRET"
npm --prefix server run dev
```
Terminal Expo dans le même clone :
```bash
npx expo start --lan -c
```
Scanner le QR avec Expo Go compatible SDK 58. Dans la configuration, utiliser http://IP_PRIVEE_DU_PC:3301 et le secret temporaire. Créer les PIN de test sur la base neuve. Aucun PIN ou secret dans les captures ou rapports. Si Expo Go est incompatible, utiliser une build native de test distincte après validation du profil EAS et des identifiants ; ne pas réutiliser le package de production.
### Fiche de recette (à remplir par appareil)
Appareil / OS / largeur logique / police / commit / date : à renseigner.
| ID | Test | Attendu | Résultat |
|---|---|---|---|
| QA-01 | Lancement à froid | Glance fictif, pas de données réelles | Non exécuté |
| QA-02 | PIN erroné puis valide | Refus puis accès autorisé | Non exécuté |
| QA-03 | Quatre onglets | Tous accessibles, sélection visible, barre fixe | Non exécuté |
| QA-04 | Dépense et versement | Accès et retour, formulaires V2 présents | Non exécuté |
| QA-05 | Opérations fictives | Soldes et journal identiques à V2 pour mêmes entrées | Non exécuté |
| QA-06 | Changement de profil et déconnexion | PIN demandé, aucune fuite après sortie | Non exécuté |
| QA-07 | 360/390/430 px, clavier et safe areas | Aucun recouvrement bloquant | Non exécuté |
| QA-08 | Police 130/200 %, VoiceOver/TalkBack | Libellés lisibles, ordre et sélection annoncés | Non exécuté |
| QA-09 | Perte réseau puis retour | Pas de confirmation trompeuse, état cohérent | Non exécuté |
| QA-10 | Expiration de session | Accès protégé refusé, retour connexion | Non exécuté |
Capturer Glance, Accueil, Enveloppes, Activité, Mon duo, Dépense, Versement. Ne pas publier de données personnelles. Archiver les preuves et anomalies P0/P1 avant intégration. Les tests d'expiration peuvent utiliser AUTH_TOKEN_TTL_HOURS réduit uniquement sur le serveur QA après vérification de son format accepté.

## 24 novembre — recette iOS et accessibilité
Recette utilisateur : navigation, authentification et scénario financier 200 - 35 = 165 EUR observés. Grande police : débordements signalés. Correctif candidat : commandes principales dans le scroll à grande taille, empilement des en-têtes et actions, métriques pleine largeur, contraste de barre de statut. Refaire recette native avec police agrandie et normale ; vérifier aussi Glance, modales et clavier. Aucun changement de règles financières ou d'authentification. Les assertions statiques ne constituent pas une validation native.
