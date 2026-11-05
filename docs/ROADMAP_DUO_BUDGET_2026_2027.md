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

## Premier état connu
- Branche de fondations : `feature/v3-premium-duo-foundations` (non fusionnée).
- Lot 01 : `feature/duo-budget-v3-glance-first-screen`, PR #3 brouillon.
- Prochaine recette obligatoire : lancer Expo SDK 54, tester Duo Glance, vérifier PIN/session et revenir vers le prototype.
- Vérifier l'état des CI avant tout merge (aucun workflow détecté lors de la création du lot 01).
