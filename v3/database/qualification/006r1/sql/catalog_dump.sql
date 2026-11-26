-- Relevé complet (texte, trié) du schéma V3 et des privilèges : sert à comparer deux bases.
\pset format unaligned
\pset tuples_only on
select 'COL|'||table_schema||'.'||table_name||'.'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','duo_v3_private') order by 1;
select 'CON|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace) or conrelid::regclass::text like 'duo_v3_private.%' order by 1;
select 'IDX|'||schemaname||'.'||indexname||'|'||indexdef from pg_indexes where schemaname in ('public','duo_v3_private') order by 1;
select 'TRG|'||tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1;
select 'POL|'||schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies order by 1;
select 'RLS|'||n.nspname||'.'||c.relname||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','duo_v3_private') and c.relkind in ('r','p') order by 1;
select 'TACL|'||n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'NULL') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','duo_v3_private') and c.relkind in ('r','p','v','S') order by 1;
select 'CACL|'||attrelid::regclass::text||'.'||attname||'|'||attacl::text from pg_attribute where attacl is not null and attrelid::regclass::text not like 'pg_%' order by 1;
select 'FN|'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|secdef='||p.prosecdef||'|'||coalesce(p.proacl::text,'NULL')||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','duo_v3_private') order by 1;
select 'NSP|'||nspname||'|'||coalesce(nspacl::text,'NULL') from pg_namespace where nspname in ('public','duo_v3_private','auth') order by 1;
select 'DACL|'||defaclrole::regrole::text||'|'||coalesce(defaclnamespace::regnamespace::text,'*')||'|'||defaclobjtype::text||'|'||defaclacl::text from pg_default_acl order by 1;
