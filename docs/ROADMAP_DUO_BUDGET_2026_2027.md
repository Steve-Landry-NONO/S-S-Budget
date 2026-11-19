# Duo Budget — Plan de développement et pilotage V1
**Date de départ : 5 novembre 2026**  
**Référence visuelle : Figma V3.0.7 (gelée)**  
**Repository :** Steve-Landry-NONO/S-S-Budget  
**Stratégie :** sprints de 2 semaines, démos régulières, PR brouillon, tests, validation utilisateur avant fusion.

## Définition du produit et des livrables
- **Prototype fonctionnel UI :** parcours Figma essentiels, gestes, données démo sûres.
- **MVP privé :** comptes accessibles à des testeurs invités, données réelles séparées, opérations complètes, tests iOS/Android.
- **Bêta publique :** multi-duo, isolation des données côté serveur, sauvegardes, conformité, déploiement cloud, crash analytics, distribution TestFlight/Play.
- Ne pas confondre « UI conforme » et « banque » : Duo Budget gère un budget et ne fournit aucun compte ou service bancaire réglementé.
- La branche V2 reste la référence pour les calculs financiers : soldes réels, prévisionnel, report, opérations programmées et droits serveur.

## Cadence
- **Chaque jour de développement :** scope précis, PR ou commit sur branche, tests correspondants, rapport réel (« livré / en cours / bloqué »).
- **Chaque fin de semaine :** démonstration, vérification CI, revue des anomalies.
- **Chaque quinzaine :** sprint review, nouvelle build testable si possible, validation utilisateur.
- **Avant fusion :** checks reproductibles, revue sécurité et rollback si changement de données.

## Sprints suggérés
| Sprint | Dates indicatives | Objectif | Critères d'acceptation |
| --- | --- | --- | --- |
| 0 — Fondations | 05–11 nov. 2026 | Clarifier branches PR, scripts, CI, états actuels, démo Duo Glance | Expo démarre, aperçu privé sécurisé, aucun breaking change sur V2 |
| 1 — Navigation & thème | 12–25 nov. 2026 | Navigation 4 onglets, tokens, safe areas, composants réutilisables | 360 / 390 / 430 px, navigation accessible, aucun écran ancien perdu |
| 2 — Dashboard | 26 nov.–09 déc. 2026 | Solde réel/prévisionnel, report, actions rapides et état de sync | Chiffres identiques à V2 pour jeux de données de test |
| 3 — Enveloppes | 10–23 déc. 2026 | Liste/détail, jalons, dépense, versement | Modifications fiables, rôles respectés, aucun montant inventé |
| 4 — Opérations & activité | 24 déc. 2026–06 janv. 2027 | Transferts, opérations prévues, activité, confirmations | Replays et tests d'intégrité, annulation confirmée |
| 5 — Duo & auth | 07–20 janv. 2027 | Profils, invitation pilote, notifications, paramètres | PIN, sessions, droits et limites d'accès correctement appliqués |
| 6 — Motion & accessibilité | 21 janv.–03 fév. 2027 | Animations retenues, gestures, VoiceOver/TalkBack, reduced motion | Pas de baisse de lisibilité, modes sans animation pris en charge |
| 7 — Bêta privée | 04–17 fév. 2027 | Build interne, tests sur 2 téléphones et corrections P0/P1 | Scénarios bout-en-bout et cas d'erreur validés |
| 8+ — Bêta publique | à partir du 18 fév. 2027 | Isolation multi-duo, auth cloud, monitoring, migrations, conformité | Revue architecture/sécurité puis release gates stores |

Les dates sont des objectifs de planification et seront recalibrées selon les tests réels et les contraintes Apple/Google. L'échéance bêta publique pourra s'étendre jusqu'à avril-mai 2027.

## Priorités techniques
1. **Qualité des montants :** extraire des sélecteurs purs du code V2 et tester transactions, statuts futurs, reports et arrondis.
2. **Sécurité :** serveur = source d'autorité ; authentification forte, contrôles d'autorisation, isolation par duo/tenant avant toute ouverture publique.
3. **Gestion des données :** migrations versionnées, sauvegardes, restauration et absence de secrets dans le dépôt.
4. **Mobile :** navigation accessible, responsive, blocage de la fuite de données avant login, feedback réseau/hors ligne.
5. **CI :** tests statiques, tests unitaires, build preview, checks sur PR. Secrets CI sous GitHub Secrets.
6. **Tests :** Expo Go au début, builds EAS Preview pour recette réelle. iOS/TestFlight ou distribution interne signée sous réserve des comptes/droits Apple.

## Règles de collaboration
- Pas de modification non approuvée de `main`, de la baseline Figma ni des données de production.
- PR brouillon tant que la recette n'est pas complète ; ne pas prétendre à une validation basée seulement sur un code existant.
- Chaque tâche doit avoir : responsable, branche, PR, critère de réussite, preuves de test, décision.
- Les tâches bloquées sont signalées ; aucune promesse de travail invisible ou non vérifié.
- Le compte rendu standard est : « Réalisé, preuve, en cours, risques, décisions attendues, prochain livrable ».
- Les comptes rendus automatisés nécessitent une automatisation active disponible ; les sessions de développement autonomes nécessitent un environnement d'exécution configuré.

## État au 5 novembre 2026
- PR #1 marque et PR #2 fondations Premium Duo : **fusionnées dans `main`**.
- Lot 01 : `feature/duo-budget-v3-glance-first-screen`, PR #3 **brouillon, base `main`**.
- GitHub Actions : workflow d'assertions statiques, parsing Babel et export web Expo exécuté avec succès sur le lot 01. Cela ne valide pas les builds Android/iOS.
- Recette obligatoire avant fusion : tester Duo Glance sur appareils, authentification PIN, sessions, accessibilité et comportement responsive.
- Documentation : README enrichi du logo officiel et de captures Figma V3.0.7 ; aucune APK Android publiée à ce stade.


## Point de pilotage — 19 novembre 2026 (mise à jour proposée)

> Cette section actualise l'état du 5 novembre sans remplacer les critères d'acceptation des sprints. État des PR à revérifier dans GitHub avant fusion.

### Environnements et protections
- Référence Figma V3.0.7 gelée ; V3.0.8 reste un laboratoire séparé.
- Supabase **Duo Budget V3 — DEV**, région eu-west-3, projet `eetnzdvjfzexgvqbtyrj`, créé et déclaré ACTIVE_HEALTHY le 19/11. **Aucune migration exécutée** : la première requête SQL a renvoyé une erreur de permission.
- Ne pas écrire de secrets dans GitHub, ne pas utiliser les autres projets Supabase et ne pas présenter le backend comme déployé.
- Tâche automatisée « Duo Budget — Développement quotidien » active, tous les jours à 19 h Europe/Paris. Elle doit lire cette roadmap sur la branche où elle est présente, les PR et les preuves CI ; ne jamais fusionner sans approbation.

### Chaînes de travaux et dépendances
- **UI/mobile** : PR #3 (Duo Glance), #4 (incrément UI) et #5 (Expo SDK 58) : revue des bases, compatibilité, tests appareil et validation avant fusion. Ne pas présumer qu'elles sont fusionnables.
- **Cloud/finance** : PR #6 architecture → #7 moteur financier → #8 schéma SQL → #9 grand livre/RLS. Ce sont des PR dépendantes, à intégrer dans cet ordre logique après revue, mise à jour éventuelle de leur base et contrôles.
- PR #7 : module financier et tests Node ; CI observée réussie sur le commit `f3e71d3e6019e1db79e11077e786a04ca810a2ba`. Ce résultat ne valide ni le backend ni les builds mobiles.
- PR #8 : schéma SQL de revue, non appliqué en base.
- PR #9 : grand livre, fonction d'écriture privilégiée, RLS et fixture SQL ; scripts **non exécutés** en PostgreSQL ; dépenses privées, annulations et concurrence restent incomplètes.

### Priorités immédiates et critères de sortie
1. **Gouvernance** : vérifier les PR réellement ouvertes, leurs bases, leurs conflits et leurs checks ; préserver l'historique et publier un état factuel. Aucun merge automatique.
2. **Accès Supabase DEV** : résoudre la permission SQL sans changer les autres projets ni exposer de secret. Critère : requête de lecture SQL effectivement réussie.
3. **Compatibilité du schéma** : confronter `schema.review.sql`, `ledger-rls.review.sql`, `ledger-writer.review.sql` et les fixtures, corriger sur branche. Critère : scripts applicables en base de développement isolée.
4. **Sécurité transactionnelle** : tests du double équilibre cash/budget, isolation inter-duos, utilisateurs anonymes, clés d'idempotence, écritures invalides, concurrence et dépenses privées. Critère : résultats de tests conservés, échecs bloquants corrigés.
5. **Intégration mobile** : raccorder progressivement les parcours validés au backend seulement après validation des droits, sans modifier Figma V3.0.7.

### Règle de fusion
- Ne fusionner que des PR dont la base est correcte, la CI pertinente est verte, la revue est documentée et les critères de sécurité/recette applicables sont satisfaits.
- Pour les changements SQL : test réel sur DEV, revue des grants/RLS, stratégie de migration et retour arrière, puis approbation humaine.
- Pour l'UI : tests sur appareils/tailles cibles, navigation, PIN/sessions, accessibilité et absence de régression V2.
- Une PR de documentation peut être fusionnée indépendamment après relecture, sans activer une fonctionnalité non testée.

### Prochain compte rendu automatisé
Rapporter : preuves GitHub nouvelles, état des PR #3 à #9, tests effectivement exécutés, blocage SQL Supabase, progression du sprint 1 (12–25 novembre), prochaine tâche limitée, décisions requises. Ne pas déduire qu'une fonctionnalité fonctionne d'une PR créée.
