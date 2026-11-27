begin;
select 'A clôture ->', duo_v3_private.ensure_current_period('a0000000-0000-4000-8000-00000000000a', now());
select pg_sleep(3);
commit;
select 'A fin', clock_timestamp();
