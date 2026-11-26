# Collaboration Duo Budget
## Rôles
Le propriétaire approuve règles métier et actions sensibles. ChatGPT pilote, conçoit et assure la revue/intégration. Claude travaille sur les lots backend isolés. Gemini prépare la qualification mobile et la distribution à partir de sources contrôlées ; pas d'accès direct présumé.
## Workflow
Lire README, PROJECT_STATUS, roadmap et registres product avant modification. Un responsable par périmètre, branche dédiée, base et SHA identifiés, PR brouillon avec critères d'acceptation, preuves, risques, rollback et dépendances. Pas de modification simultanée des mêmes fichiers. Ne pas falsifier l'historique ni supprimer les tests historiques en cas d'évolution métier. Garder les fichiers de migration historiques hors chemin actif lorsqu'incompatibles.
## Autorisations
Préparation des PR backend autorisée après audit conformément à #20. Aucune migration DEV/prod sans validation distincte ; aucune fusion majeure, force push, déploiement implicite, dépense ou données réelles. Les fusions documentaires à faible risque suivent la gouvernance roadmap : diff, conflits, checks pertinents et déclencheurs vérifiés. Un check absent n'est pas un succès. Préserver V3.0.7 et les branches en cours de Claude.
## Qualité
Tests reproductibles, montants exacts, confidentialité, autorisations serveur, états indisponibles explicites. Distinguer test réellement exécuté, fixture, résultat rapporté et hypothèse. Ne jamais présenter un solde optimiste comme confirmé. Tester builds autonomes avant bêta. Les scénarios Maestro restent candidats jusqu'à adaptation et exécution.
## Passation
Fournir PR, SHA, base, commandes, résultats bruts, limites et décisions. Exclure secrets, .env, données réelles et identifiants sensibles des exports. Toute automatisation doit consulter les sources à jour et ne pas supposer la fusion des branches.
