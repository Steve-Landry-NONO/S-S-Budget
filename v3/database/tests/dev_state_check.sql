-- Relevé d'état DEV (lecture seule) : empreinte du schéma V3, volumes, migrations, horodatage.
with f as (
  select md5(string_agg(x, E'\n' order by x)) as empreinte, count(*) as objets from (
    select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'')||' '||coalesce(generation_expression,'') x
      from information_schema.columns where table_schema in ('public','duo_v3_private') and table_name like 'duo_v3%'
    union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text like '%duo_v3%'
    union all select 'idx '||indexdef from pg_indexes where tablename like 'duo_v3%'
    union all select 'trg '||tgrelid::regclass||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%duo_v3%'
    union all select 'pol '||tablename||' '||policyname||' '||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where tablename like 'duo_v3%'
    union all select 'fun '||n.nspname||'.'||p.proname||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','duo_v3_private') and (p.proname like 'duo_v3%' or n.nspname='duo_v3_private')
    union all select 'acl '||c.relname||' '||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'duo_v3%'
    union all select 'com '||c.relname||'.'||a.attname||' '||col_description(c.oid,a.attnum) from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relname like 'duo_v3%' and col_description(c.oid,a.attnum) is not null
  ) s)
select jsonb_build_object(
  'horodatage', now(), 'empreinte', f.empreinte, 'objets', f.objets,
  'relations_duo_v3', (select jsonb_object_agg(c.relname, c.relkind) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'duo_v3%' and c.relkind in ('r','v')),
  'lignes', jsonb_build_object(
     'households', (select count(*) from public.duo_v3_households), 'members', (select count(*) from public.duo_v3_members),
     'accounts', (select count(*) from public.duo_v3_accounts), 'transactions', (select count(*) from public.duo_v3_transactions),
     'entries', (select count(*) from public.duo_v3_entries), 'auth_users', (select count(*) from auth.users)),
  'migrations', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'fonctions_duo_v3_private', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='duo_v3_private')
) as etat from f;
