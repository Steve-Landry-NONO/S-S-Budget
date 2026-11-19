-- Integration test for a disposable Supabase development database ONLY.
-- Requires schema.review.sql then ledger-rls.review.sql. NEVER run on production.
-- Tests are transaction-scoped and rolled back. No real customer data.
begin;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
values
('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v3-test-a@example.invalid','',now(),now()),
('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v3-test-b@example.invalid','',now(),now()),
('10000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v3-test-c@example.invalid','',now(),now());

insert into duo_v3_private.duos(id,name,currency_code) values
('20000000-0000-4000-8000-000000000001','Test Duo A','EUR'),
('20000000-0000-4000-8000-000000000002','Test Duo B','XAF');
insert into duo_v3_private.memberships(duo_id,user_id,role) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','owner');
insert into duo_v3_private.ledger_accounts(id,duo_id,book,kind,label) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','cash','cash','Cash'),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','cash','external','Outside'),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','cash','cash','Cash B');
insert into duo_v3_private.ledger_entries(id,duo_id,idempotency_key,kind,actor_user_id)
values ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','integration-key-0001','contribution','10000000-0000-4000-8000-000000000001');
insert into duo_v3_private.ledger_postings(duo_id,entry_id,account_id,amount_minor) values
('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',10000),
('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',-10000);
set constraints all immediate;

-- Run read assertions under the real authenticated SQL role, with simulated JWT.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from duo_v3_private.duos) <> 1 then
  raise exception 'RLS leaked a duo';
 end if;
 if (select count(*) from duo_v3_private.ledger_entries) <> 1 then
  raise exception 'RLS ledger entry visibility failed';
 end if;
 if (select count(*) from duo_v3_private.ledger_accounts) <> 2 then
  raise exception 'RLS ledger account visibility failed';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
 if (select count(*) from duo_v3_private.duos) <> 1 then
  raise exception 'RLS user C should see only duo B';
 end if;
 if (select count(*) from duo_v3_private.ledger_entries) <> 0 then
  raise exception 'RLS leaked duo A ledger entries';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from duo_v3_private.ledger_entries) <> 1 then
  raise exception 'Second partner cannot read shared ledger';
 end if;
end $$;
reset role;
-- These tests do not yet exercise concurrency, authenticated write APIs,
-- private expenses, replay rejection, or negative cases for deferred triggers.
rollback;
