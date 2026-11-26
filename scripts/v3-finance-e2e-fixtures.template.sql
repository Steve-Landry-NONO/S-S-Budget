-- DEV-only fixture. Replace the two user IDs with real Supabase Auth UUIDs.
-- Run AFTER creating and verifying two users through Supabase Auth.
-- Do not execute against production. No secrets are stored in this file.
begin;
insert into public.duo_v3_households(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.duo_v3_members(household_id,user_id,role) values
  ('11111111-1111-4111-8111-111111111111','REPLACE_WITH_REAL_AUTH_USER_A_UUID','owner'),
  ('22222222-2222-4222-8222-222222222222','REPLACE_WITH_REAL_AUTH_USER_B_UUID','owner');
insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values
  ('11111111-aaaa-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','E2E A cash','cash','EUR'),
  ('11111111-bbbb-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','E2E A envelope','envelope','EUR'),
  ('22222222-aaaa-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','E2E B cash','cash','EUR'),
  ('22222222-bbbb-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','E2E B envelope','envelope','EUR');
commit;
