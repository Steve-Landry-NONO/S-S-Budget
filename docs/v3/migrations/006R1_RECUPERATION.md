# Procédure de récupération — 006 révisée

| Situation | Action |
|---|---|
| Échec pendant l'application | La migration est atomique (`begin … commit` unique) : rien n'est appliqué. Vérifier que la version 20261126120000 est **absente** de `schema_migrations`. |
| Appliquée, **aucune donnée 006** et duos aux paramètres par défaut | Exécuter `supabase/rollback/20261126120000_duo_v3_financial_model_r1.down.sql`, puis supprimer la ligne de version **dans la même transaction**. Résultat qualifié : catalogue identique à 001→005 (RB1 ×3, RB4). |
| Appliquée, avec données ou paramètres de duo | Le rollback **refuse** (55000), volontairement, pour ne détruire aucune donnée (RB2, RB3). Il faut alors restaurer depuis la sauvegarde ou un point de restauration, ou écrire une migration corrective vers l'avant. Ne jamais forcer le rollback. |
| Duo bloqué au-delà de 120 cycles | Ce n'est pas une panne : appliquer R-A2 avec `select duo_v3_private.admin_catch_up('<duo>', 120);` (rôle serveur), autant de fois que nécessaire. |
| Désaccord entre l'historique des versions et le dépôt | Arrêt. Inventaire (CF-12), puis décision explicite. Pas de `migration repair` à l'aveugle. |
