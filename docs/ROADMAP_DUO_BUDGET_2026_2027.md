# Duo Budget — Plan de développement et pilotage V1
**Date de départ : 5 novembre 2026**  
**Référence visuelle : Figma V3.0.7 (gelée)**  
**Repository :** Steve-Landry-NONO/S-S-Budget  
**Stratégie :** sprints de 2 semaines, démos régulières, PR, tests et fusion autonome à faible risque selon les règles du 24/11/2026.

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
- Pas de modification de la baseline Figma ni des données de production ; fusion dans `main` selon la gouvernance du 24/11.
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
- Tâche automatisée « Duo Budget — Développement quotidien » active, tous les jours à 19 h Europe/Paris. Elle doit lire cette roadmap sur la branche où elle est présente, les PR et les preuves CI ; appliquer la gouvernance du 24/11 et vérifier les protections avant fusion.

### Chaînes de travaux et dépendances
- **UI/mobile** : PR #3 (Duo Glance), #4 (incrément UI) et #5 (Expo SDK 58) : revue des bases, compatibilité, tests appareil et validation avant fusion. Ne pas présumer qu'elles sont fusionnables.
- **Cloud/finance** : PR #6 architecture → #7 moteur financier → #8 schéma SQL → #9 grand livre/RLS. Ce sont des PR dépendantes, à intégrer dans cet ordre logique après revue, mise à jour éventuelle de leur base et contrôles.
- PR #7 : module financier et tests Node ; CI observée réussie sur le commit `f3e71d3e6019e1db79e11077e786a04ca810a2ba`. Ce résultat ne valide ni le backend ni les builds mobiles.
- PR #8 : schéma SQL de revue, non appliqué en base.
- PR #9 : grand livre, fonction d'écriture privilégiée, RLS et fixture SQL ; scripts **non exécutés** en PostgreSQL ; dépenses privées, annulations et concurrence restent incomplètes.

### Priorités immédiates et critères de sortie
1. **Gouvernance** : vérifier les PR réellement ouvertes, leurs bases, leurs conflits et leurs checks ; préserver l'historique et publier un état factuel. Appliquer la gouvernance du 24/11.
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


## Décisions validées — 24 novembre 2026

### Gouvernance
- Fusion autonome à faible risque (documentation, tests, maintenance, corrections mineures, CI) seulement après revue du diff, dépendances intégrées, checks pertinents verts, absence de conflit, régression et déploiement involontaire. Un check absent n'est pas un succès.
- Pour une intégration majeure, un changement d'architecture ou des PR concurrentes, soumettre une recommandation motivée et une demande de validation ciblée.
- Production, sécurité financière, migrations sensibles, promotion de V3.0.9 : validation explicite. V3.0.7 reste gelée. Les restrictions spécifiques aux lots backend 1/2 prévalent : audit complet avant push, aucune fusion, aucune application de 006, aucune PR de ces lots sans accord. Ne pas modifier la matrice de recette.

### Smart Transaction Identity (STI)
Source : dossier de revue passe 2 du 24/11 et [page 11 Figma](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/?node-id=297-62). Les huit décisions sont validées par le propriétaire ; identifiants STI distincts du registre D-001 à D-029 jusqu'à réconciliation.
- STI-01 : monogrammes et icônes autonomes ; logos autorisés optionnels, interrupteur et repli automatique.
- STI-02 : direction C Duo Signature, forme déterminée par effet comptable réel, légende initiale ; ordre de priorité en six niveaux : système, logo autorisé, monogramme identifié, icône d'enveloppe, catégorie, générique.
- STI-03 : icône et couleur d'enveloppe modifiables par un partenaire sans accord, parmi 26 catégories.
- STI-04 : alias privés et communs isolés ; partage explicite par copie indépendante sans historique privé.
- STI-05 : encres #177A61, #9A5B12, #3F5BD0 et rouge clair #FDECEE à ajouter lors de la promotion.
- STI-06 : bibliothèque unique de 40 icônes dans la future version intégrée uniquement ; jamais de modification de V3.0.7.
- STI-07 : suggestions locales, 3 occurrences et 60 %, seuils configurables à confirmer en recette ; aucune table d'habitudes serveur, aucune application automatique.
- STI-08 : pastille = auteur de saisie uniquement ; payeur et affectation distincts.
- Payeur informatif en V3.0 : aucune dette automatique entre partenaires. Ne pas déduire d'écriture financière supplémentaire.
- Passe 2 : 8 corrections livrées, 12 tests maquette (9 réussis, 1 avec réserve, 2 partiels) ; 41 IDV dont 30 bloquants selon le rapport, volets app/backend non validés. Ne pas promouvoir V3.0.9 ou le design system sans porte de validation.

### Rattrapage Sprint 1
Échéance originale : 25/11/2026. Pré-bilan de rattrapage proposé le 29/11, pas de changement officiel de date ni clôture fictive. Critères originaux : navigation 4 onglets, tokens, safe areas, composants réutilisables, 360/390/430 px, accessibilité, aucun écran ancien perdu. STI et backend avancent en parallèle sans élargir silencieusement ces critères.
- PR #3–#5 : vérifier bases, CI, appareils, PIN, accessibilité, navigation et coexistence V2.
- PR #6–#9, #11–#12 : examiner graphe, redondances, tests et sécurité avant toute intégration ; ne pas fusionner en bloc.
- PR #10 : consolider la roadmap et les décisions ; vérifier absence de déploiement involontaire avant fusion.
- Lots backend transmis : 005 déclarée appliquée sur DEV (57 réussis, 0 échec, 4 constats selon rapport fourni), 006 testée en transaction annulée (72/72 selon rapport), non-régression locale 58 réussis et 4 constats. Pas de nouvelle exécution DEV. Base distante 4d41286 vérifiée le 24/11 ; publication des bundles conditionnée à audit complet. Aucun push constaté à ce stade.
- Tâche quotidienne 19 h : consolidation prioritaire, état réel PR/branches/CI, preuves, registre des décisions, critères de sortie, actions à faible risque autonomes et demandes explicites pour arbitrages. Pas de nouvelle fonctionnalité hors chemin critique sans justification. Revenir au développement courant après clôture vérifiée.
