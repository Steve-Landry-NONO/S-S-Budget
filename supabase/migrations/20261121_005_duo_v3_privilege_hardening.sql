-- Duo Budget V3 / DEV — durcissement des privilèges (lot 1 backend, 21 nov. 2026).
-- Appliquée sur DEV uniquement le 21 nov. 2026 après vérifications préalables (voir docs/V3_BACKEND_LOT1_DEV.md).
-- Jamais en production sans nouvelle revue.
--
-- Corrige les constats de v3/database/tests/results/2026-11-21_lot1_dev_rapport.md :
--   S12/S13  TRUNCATE du registre accordé à anon et authenticated (privilèges par défaut Supabase).
--   S12      TRUNCATE contourne les triggers d'immuabilité ligne à ligne, même pour un rôle privilégié.
--   R19      duo_v3_private.is_member(duo, utilisateur) permet à un membre de tester l'appartenance
--            de n'importe qui à n'importe quel duo.
begin;

-- 1. anon n'a aucun usage légitime des tables V3 : retrait complet.
revoke all on public.duo_v3_households, public.duo_v3_members, public.duo_v3_accounts,
  public.duo_v3_transactions, public.duo_v3_entries from anon;

-- 2. authenticated garde uniquement SELECT (filtré par RLS).
revoke truncate, references, trigger on public.duo_v3_households, public.duo_v3_members,
  public.duo_v3_accounts, public.duo_v3_transactions, public.duo_v3_entries from authenticated;

-- 3. Les futurs objets créés par le rôle postgres (propriétaire de toutes les tables et
--    fonctions V3, vérifié le 21 nov.) ne reçoivent plus de droits implicites.
--    Chaque table, séquence et RPC devra accorder ses droits explicitement.
--    Limite : les règles par défaut du rôle supabase_admin (objets de la plateforme)
--    ne sont pas modifiables par postgres et restent en place.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction ; anon et authenticated
-- en héritent. Ce retrait global (tous schémas, objets créés par postgres) rend les droits
-- d'exécution volontaires.
alter default privileges revoke execute on functions from public;

-- 4. Le registre ne peut pas être vidé, même par postgres ou service_role (vérifié le 21 nov.).
--    Limite : le propriétaire peut désactiver les triggers (session_replication_role = replica)
--    ou les supprimer ; ce garde-fou protège des erreurs, pas d'un administrateur malveillant.
create trigger duo_v3_transactions_no_truncate
before truncate on public.duo_v3_transactions
for each statement execute function public.duo_v3_reject_ledger_mutation();
create trigger duo_v3_entries_no_truncate
before truncate on public.duo_v3_entries
for each statement execute function public.duo_v3_reject_ledger_mutation();

-- 5. Plus d'oracle d'appartenance : le test porte sur l'utilisateur du JWT uniquement.
create function duo_v3_private.is_current_member(p_household uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.duo_v3_members m
    where m.household_id = p_household and m.user_id = auth.uid()
  );
$$;
revoke all on function duo_v3_private.is_current_member(uuid) from public, anon;
grant execute on function duo_v3_private.is_current_member(uuid) to authenticated;

alter policy duo_v3_households_member_read on public.duo_v3_households
  using (duo_v3_private.is_current_member(id));
alter policy duo_v3_members_member_read on public.duo_v3_members
  using (duo_v3_private.is_current_member(household_id));
alter policy duo_v3_accounts_member_read on public.duo_v3_accounts
  using (duo_v3_private.is_current_member(household_id));
alter policy duo_v3_transactions_member_read on public.duo_v3_transactions
  using (duo_v3_private.is_current_member(household_id));
alter policy duo_v3_entries_member_read on public.duo_v3_entries
  using (duo_v3_private.is_current_member(household_id));

-- is_member(duo, utilisateur) reste utilisée par la RPC (SECURITY DEFINER, propriétaire postgres)
-- mais n'est plus appelable par les clients.
revoke execute on function duo_v3_private.is_member(uuid, uuid) from authenticated;
commit;
