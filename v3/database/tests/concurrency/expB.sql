\set QUIET on
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-0000000000a1"}',false);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1',false);
set role authenticated;
\set QUIET off
select 'B début', clock_timestamp();
select 'B dépense ->', public.duo_v3_post_expense('a0000000-0000-4000-8000-00000000000a',
  (select id from public.duo_v3_envelopes limit 1), 1500, (now() at time zone 'Europe/Paris')::date - 35, 'conc-b-1');
select 'B fin', clock_timestamp();
