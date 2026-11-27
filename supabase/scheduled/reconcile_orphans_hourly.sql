-- Duo Budget V3 — réconciliation horaire des appartenances orphelines (R-C2). OPT-IN.
-- Ce fichier n'est PAS une migration : il est hors de supabase/migrations et n'est jamais appliqué
-- automatiquement. Il suppose l'extension pg_cron (gratuite, incluse dans Supabase). Le déclencheur
-- AFTER DELETE ON auth.users reste le mécanisme principal ; ce filet ne traite que les suppressions qui
-- contournent les déclencheurs. À exécuter manuellement, après autorisation, sur l'environnement visé.
create extension if not exists pg_cron;
select cron.schedule('duo-v3-reconcile-orphans', '0 * * * *', $$select duo_v3_private.reconcile_orphan_memberships()$$);
-- Retrait : select cron.unschedule('duo-v3-reconcile-orphans');
