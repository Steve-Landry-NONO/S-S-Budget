-- Duo Budget V3 ledger extension — DEVELOPMENT REVIEW, NOT A DEPLOYED MIGRATION.
-- Apply only after v3/database/schema.review.sql in an isolated Supabase dev DB.
-- Existing schema is private and must NOT be added to exposed Data API schemas.
-- This slice supports shared financial entries ONLY. Private transactions blocked.
-- All writes restricted to trusted backend/database administrator until a reviewed
-- authenticated transaction API exists. No service_role key in Expo.
create table duo_v3_private.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references duo_v3_private.duos(id),
  book text not null check (book in ('cash','budget')),
  kind text not null check (kind in ('cash','external','envelope','reserve','spent')),
  envelope_id uuid,
  label text not null,
  unique (duo_id,id),
  foreign key (duo_id,envelope_id) references duo_v3_private.envelopes(duo_id,id),
  check (
    (book='cash' and kind in ('cash','external') and envelope_id is null)
    or (book='budget' and kind in ('reserve','spent') and envelope_id is null)
    or (book='budget' and kind='envelope' and envelope_id is not null)
  )
);
create unique index ledger_one_cash_account_per_duo
  on duo_v3_private.ledger_accounts(duo_id) where kind='cash';
create unique index ledger_one_reserve_per_duo
  on duo_v3_private.ledger_accounts(duo_id) where kind='reserve';
create unique index ledger_one_envelope_account
  on duo_v3_private.ledger_accounts(duo_id,envelope_id) where kind='envelope';

create table duo_v3_private.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references duo_v3_private.duos(id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  kind text not null check (kind in ('contribution','expense','allocation','reallocation','reversal','adjustment')),
  actor_user_id uuid not null,
  original_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (duo_id,id),
  unique (duo_id,idempotency_key),
  foreign key (duo_id,actor_user_id) references duo_v3_private.memberships(duo_id,user_id),
  foreign key (duo_id,original_entry_id) references duo_v3_private.ledger_entries(duo_id,id)
);
create unique index ledger_one_reversal_per_entry
  on duo_v3_private.ledger_entries(duo_id,original_entry_id)
  where kind='reversal' and original_entry_id is not null;

create table duo_v3_private.ledger_postings (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (duo_id,entry_id) references duo_v3_private.ledger_entries(duo_id,id),
  foreign key (duo_id,account_id) references duo_v3_private.ledger_accounts(duo_id,id)
);
create index ledger_postings_entry_idx on duo_v3_private.ledger_postings(duo_id,entry_id);
create index ledger_postings_account_idx on duo_v3_private.ledger_postings(duo_id,account_id);

-- DEFERRABLE: all postings of an entry can be inserted in one transaction.
-- Both cash and budget books must independently sum to zero. At least two
-- postings required. Zero-value entries are forbidden.
create function duo_v3_private.check_ledger_entry() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare v_entry uuid; v_duo uuid; v_bad integer; v_count integer;
begin
  v_entry := coalesce(new.entry_id,old.entry_id);
  v_duo := coalesce(new.duo_id,old.duo_id);
  select count(*) into v_count from duo_v3_private.ledger_postings
   where duo_id=v_duo and entry_id=v_entry;
  if v_count < 2 then raise exception 'Ledger entry requires at least two postings'; end if;
  select count(*) into v_bad from (
    select a.book, sum(p.amount_minor) as total
    from duo_v3_private.ledger_postings p
    join duo_v3_private.ledger_accounts a
      on a.duo_id=p.duo_id and a.id=p.account_id
    where p.duo_id=v_duo and p.entry_id=v_entry
    group by a.book having sum(p.amount_minor) <> 0
  ) q;
  if v_bad <> 0 then raise exception 'Unbalanced ledger entry'; end if;
  return null;
end $$;
create constraint trigger ledger_balanced_after_posting
after insert on duo_v3_private.ledger_postings
deferrable initially deferred for each row
execute function duo_v3_private.check_ledger_entry();

-- An entry without postings must also be rejected at commit.
create function duo_v3_private.check_new_entry_postings() returns trigger
language plpgsql security invoker set search_path = ''
as $
begin
 if (select count(*) from duo_v3_private.ledger_postings
     where duo_id=new.duo_id and entry_id=new.id) < 2 then
   raise exception 'Ledger entry has no balanced postings';
 end if;
 return null;
end $;
create constraint trigger ledger_entry_has_postings
after insert on duo_v3_private.ledger_entries
deferrable initially deferred for each row
execute function duo_v3_private.check_new_entry_postings();

-- Append-only. Corrections use new compensating entries, never UPDATE/DELETE.
create function duo_v3_private.reject_ledger_mutation() returns trigger
language plpgsql security invoker set search_path = ''
as $$ begin raise exception 'Ledger is append-only'; end $$;
create trigger ledger_entries_immutable before update or delete
on duo_v3_private.ledger_entries for each row
execute function duo_v3_private.reject_ledger_mutation();
create trigger ledger_postings_immutable before update or delete
on duo_v3_private.ledger_postings for each row
execute function duo_v3_private.reject_ledger_mutation();
create trigger ledger_accounts_immutable before update or delete
on duo_v3_private.ledger_accounts for each row
execute function duo_v3_private.reject_ledger_mutation();

-- RLS read-only policies; membership policy uses self-only predicate, avoiding
-- recursive queries to memberships. No INSERT/UPDATE/DELETE policies.
alter table duo_v3_private.ledger_accounts enable row level security;
alter table duo_v3_private.ledger_entries enable row level security;
alter table duo_v3_private.ledger_postings enable row level security;
create policy membership_self_read on duo_v3_private.memberships
for select to authenticated using (user_id=(select auth.uid()));
create policy duos_member_read on duo_v3_private.duos
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=id and m.user_id=(select auth.uid()))
);
create policy envelopes_member_read on duo_v3_private.envelopes
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=envelopes.duo_id and m.user_id=(select auth.uid()))
);
create policy periods_member_read on duo_v3_private.periods
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=periods.duo_id and m.user_id=(select auth.uid()))
);
create policy ledger_accounts_member_read on duo_v3_private.ledger_accounts
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=ledger_accounts.duo_id and m.user_id=(select auth.uid()))
);
create policy ledger_entries_member_read on duo_v3_private.ledger_entries
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=ledger_entries.duo_id and m.user_id=(select auth.uid()))
);
create policy ledger_postings_member_read on duo_v3_private.ledger_postings
for select to authenticated using (
 exists (select 1 from duo_v3_private.memberships m
 where m.duo_id=ledger_postings.duo_id and m.user_id=(select auth.uid()))
);
-- The legacy review operations table is deliberately NOT exposed by policy:
-- it does not yet encode private ownership reliably.

revoke all on schema duo_v3_private from public, anon, authenticated;
revoke all on all tables in schema duo_v3_private from public, anon, authenticated;
revoke all on all functions in schema duo_v3_private from public, anon, authenticated;
-- Explicit read-only access for authenticated SQL roles, NOT via Data API.
-- Do not add duo_v3_private to exposed schemas.
grant usage on schema duo_v3_private to authenticated;
grant select on duo_v3_private.duos, duo_v3_private.memberships,
 duo_v3_private.envelopes, duo_v3_private.periods,
 duo_v3_private.ledger_accounts, duo_v3_private.ledger_entries,
 duo_v3_private.ledger_postings to authenticated;
