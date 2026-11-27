insert into auth.users(id) values ('a1000000-0000-4000-8000-0000000000a1');
insert into public.duo_v3_households(id) values ('a0000000-0000-4000-8000-00000000000a');
insert into public.duo_v3_members(household_id,user_id,role) values ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','owner');
select duo_v3_private.bootstrap_household('a0000000-0000-4000-8000-00000000000a', now() - interval '40 days');
select duo_v3_private.create_envelope('a0000000-0000-4000-8000-00000000000a','Courses',false) \gset env_
select duo_v3_private.set_allocation(e.id, 40000, p.starts_on) from public.duo_v3_envelopes e, public.duo_v3_periods p;
select duo_v3_private.post_period_allocations('a0000000-0000-4000-8000-00000000000a', id) from public.duo_v3_periods;
