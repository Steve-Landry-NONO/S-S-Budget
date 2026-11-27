-- Vérification de la migration 20261121_005 (non appliquée) : migration + tests dans une transaction annulée.
-- Supabase DEV eetnzdvjfzexgvqbtyrj UNIQUEMENT. Une transaction, terminée par ROLLBACK.
begin;
set local lot1.res = '[]';
create function pg_temp.rec(p_id text, p_s text, p_m text, p_c boolean, p_t timestamptz) returns void language sql as $f$ select set_config('lot1.res', (current_setting('lot1.res')::jsonb || jsonb_build_array(jsonb_build_object('id',p_id,'role',current_user,'sub',current_setting('request.jwt.claim.sub',true),'obtenu',p_s,'message',left(p_m,240),'controle',p_c,'ms',round(extract(epoch from clock_timestamp()-p_t)*1000,2))))::text, true) $f$;
create function pg_temp.ctx(p_role text, p_sub uuid, p_anon boolean) returns void language sql as $f$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role',p_role,'sub',p_sub,'is_anonymous',case when p_anon then true end))::text, true), set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true), case when p_role<>'postgres' then set_config('role', p_role, true) end $f$;
create function pg_temp.run(p_id text, p_role text, p_sub uuid, p_anon boolean, p_action text, p_check text) returns void language plpgsql as $f$ declare t timestamptz := clock_timestamp(); s text := 'OK'; m text := ''; c boolean; begin perform set_config('role', 'none', true); execute 'set constraints all deferred'; perform pg_temp.ctx(p_role, p_sub, p_anon); begin execute 'do $y$ begin ' || p_action || ' end $y$'; exception when others then s := sqlstate; m := sqlerrm; end; begin execute 'select (' || p_check || ')' into c; exception when others then c := false; m := m || ' | contrôle : ' || sqlerrm; end; perform pg_temp.rec(p_id, s, m, c, t); perform set_config('role', 'none', true); end $f$;
create function pg_temp.u(p text) returns uuid language sql immutable as $f$ select v::uuid from (values ('ha','a0000000-0000-4000-8000-00000000000a'),('hb','b0000000-0000-4000-8000-00000000000b'),('cam','a1000000-0000-4000-8000-0000000000a1'),('alex','a2000000-0000-4000-8000-0000000000a2'),('cla','c1000000-0000-4000-8000-0000000000c1'),('dan','d1000000-0000-4000-8000-0000000000d1'),('cashA','a0c00000-0000-4000-8000-000000000001'),('resA','a0c00000-0000-4000-8000-000000000002'),('envA','a0c00000-0000-4000-8000-000000000003'),('clrA','a0c00000-0000-4000-8000-000000000004'),('usdA','a0c00000-0000-4000-8000-000000000005'),('usdA2','a0c00000-0000-4000-8000-000000000006'),('cashB','b0c00000-0000-4000-8000-000000000001'),('resB','b0c00000-0000-4000-8000-000000000002'),('t1','e0000000-0000-4000-8000-000000000001'),('t2','e0000000-0000-4000-8000-000000000002'),('t3','e0000000-0000-4000-8000-000000000003'),('t4','e0000000-0000-4000-8000-000000000004'),('t5','e0000000-0000-4000-8000-000000000005'),('t6','e0000000-0000-4000-8000-000000000006'),('t7','e0000000-0000-4000-8000-000000000007'),('t8','e0000000-0000-4000-8000-000000000008'),('t9','e0000000-0000-4000-8000-000000000009'),('t10','e0000000-0000-4000-8000-000000000010'),('t11','e0000000-0000-4000-8000-000000000011'),('t12','e0000000-0000-4000-8000-000000000012'),('t13','e0000000-0000-4000-8000-000000000013'),('t14','e0000000-0000-4000-8000-000000000014'),('t15','e0000000-0000-4000-8000-000000000015'),('t16','e0000000-0000-4000-8000-000000000016'),('t17','e0000000-0000-4000-8000-000000000017'),('t18','e0000000-0000-4000-8000-000000000018'),('t19','e0000000-0000-4000-8000-000000000019'),('t20','e0000000-0000-4000-8000-000000000020')) m(k,v) where k=p $f$;
-- Garde-fou : refuser toute base qui n’a pas le schéma attendu.
do $g$ begin if to_regprocedure('public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text)') is null then raise exception 'Schéma V3 absent'; end if; end $g$;
-- Jeu de données fictif (annulé en fin de script)
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values (pg_temp.u('cam'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot1-camille@example.invalid','',now(),now()),(pg_temp.u('alex'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot1-alex@example.invalid','',now(),now()),(pg_temp.u('cla'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot1-claire@example.invalid','',now(),now());
insert into public.duo_v3_households(id) values (pg_temp.u('ha')),(pg_temp.u('hb'));
insert into public.duo_v3_members(household_id,user_id,role) values (pg_temp.u('ha'),pg_temp.u('cam'),'owner'),(pg_temp.u('ha'),pg_temp.u('alex'),'partner'),(pg_temp.u('hb'),pg_temp.u('cla'),'owner');
insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values (pg_temp.u('cashA'),pg_temp.u('ha'),'A cash','cash','EUR'),(pg_temp.u('resA'),pg_temp.u('ha'),'A réserve','reserve','EUR'),(pg_temp.u('envA'),pg_temp.u('ha'),'A Loisirs','envelope','EUR'),(pg_temp.u('clrA'),pg_temp.u('ha'),'A compensation','clearing','EUR'),(pg_temp.u('usdA'),pg_temp.u('ha'),'A cash USD','cash','USD'),(pg_temp.u('usdA2'),pg_temp.u('ha'),'A réserve USD','reserve','USD'),(pg_temp.u('cashB'),pg_temp.u('hb'),'B cash','cash','EUR'),(pg_temp.u('resB'),pg_temp.u('hb'),'B réserve','reserve','EUR');
-- Original utilisé par L10/L11 (duo A, EUR)
insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,reverses_transaction_id) values (pg_temp.u('t11'),pg_temp.u('ha'),'EUR','orig-11','transfer',pg_temp.u('cam'),null);insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (pg_temp.u('t11'),pg_temp.u('ha'),pg_temp.u('cashA'),'EUR',-50),(pg_temp.u('t11'),pg_temp.u('ha'),pg_temp.u('resA'),'EUR',50);
set constraints all immediate; set constraints all deferred;
-- Migration 005 appliquée DANS la transaction
-- 1. anon n'a aucun usage légitime des tables V3 : retrait complet.
revoke all on public.duo_v3_households, public.duo_v3_members, public.duo_v3_accounts,
  public.duo_v3_transactions, public.duo_v3_entries from anon;

-- 2. authenticated garde uniquement SELECT (filtré par RLS).
revoke truncate, references, trigger on public.duo_v3_households, public.duo_v3_members,
  public.duo_v3_accounts, public.duo_v3_transactions, public.duo_v3_entries from authenticated;

-- 3. Les futures tables du schéma public ne reçoivent plus de droits implicites
--    pour anon/authenticated (projet DEV dédié à V3 ; chaque table devra déclarer ses droits).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 4. Le registre ne peut pas être vidé, même par un rôle privilégié.
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

select pg_temp.run('H01','authenticated',pg_temp.u('cam'),false,$q$truncate public.duo_v3_entries;$q$,$q$true$q$);
select pg_temp.run('H02','anon',null,false,$q$truncate public.duo_v3_entries;$q$,$q$true$q$);
select pg_temp.run('H03','postgres',null,false,$q$truncate public.duo_v3_entries;$q$,$q$true$q$);
select pg_temp.run('H04','anon',null,false,$q$perform count(*) from public.duo_v3_entries;$q$,$q$true$q$);
select pg_temp.run('H05','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select count(*) from public.duo_v3_accounts where household_id=pg_temp.u('ha'))=6 and (select count(*) from public.duo_v3_entries where household_id=pg_temp.u('ha'))=2$q$);
select pg_temp.run('H06','authenticated',pg_temp.u('cla'),false,$q$perform 1;$q$,$q$(select count(*) from public.duo_v3_accounts where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_households)=1$q$);
select pg_temp.run('H07','authenticated',pg_temp.u('cla'),false,$q$perform duo_v3_private.is_member(pg_temp.u('ha'),pg_temp.u('cam'));$q$,$q$true$q$);
select pg_temp.run('H08','authenticated',pg_temp.u('cam'),false,$q$if not duo_v3_private.is_current_member(pg_temp.u('ha')) then raise exception 'non membre' using errcode='P0001'; end if;$q$,$q$true$q$);
select pg_temp.run('H09','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.u('cashA'),pg_temp.u('envA'),2500,'EUR','h-trf-25');$q$,$q$(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha') and idempotency_key='h-trf-25')=1$q$);
select pg_temp.run('H10','authenticated',pg_temp.u('cla'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.u('cashA'),pg_temp.u('envA'),100,'EUR','h-cla');$q$,$q$true$q$);
select pg_temp.run('H11','authenticated',pg_temp.u('cam'),false,$q$insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values (pg_temp.u('t11'),pg_temp.u('ha'),pg_temp.u('cashA'),'EUR',1);$q$,$q$true$q$);
reset role;
select jsonb_build_object('horodatage_serveur', now(), 'resultats', current_setting('lot1.res')::jsonb,
  'privileges_apres', (select jsonb_agg(jsonb_build_object('table',c.relname,'role',r,'droits',(select string_agg(p,',') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r,c.oid,p)))) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' cross join unnest(array['anon','authenticated']) r where c.relname like 'duo_v3_%' and c.relkind='r')) as verification;
rollback;
