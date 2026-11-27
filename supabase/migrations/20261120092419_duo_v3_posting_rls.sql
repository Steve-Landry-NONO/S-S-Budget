-- Duo Budget V3 DEV: authenticated, atomic, membership-scoped ledger posting.
begin;
create schema if not exists duo_v3_private;
revoke all on schema duo_v3_private from public, anon, authenticated;

-- Security-definer helper in a NON-exposed schema to avoid RLS recursion.
create function duo_v3_private.is_member(p_household uuid, p_user uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.duo_v3_members m
    where m.household_id = p_household and m.user_id = p_user
  );
$$;
revoke all on function duo_v3_private.is_member(uuid,uuid) from public, anon;
grant usage on schema duo_v3_private to authenticated;
grant execute on function duo_v3_private.is_member(uuid,uuid) to authenticated;

-- Read-only membership-scoped access. No direct INSERT/UPDATE/DELETE for clients.
grant select on public.duo_v3_households, public.duo_v3_members,
  public.duo_v3_accounts, public.duo_v3_transactions, public.duo_v3_entries
  to authenticated;
revoke insert, update, delete on public.duo_v3_households, public.duo_v3_members,
  public.duo_v3_accounts, public.duo_v3_transactions, public.duo_v3_entries
  from anon, authenticated;

create policy duo_v3_households_member_read on public.duo_v3_households
for select to authenticated
using (duo_v3_private.is_member(id, (select auth.uid())));
create policy duo_v3_members_member_read on public.duo_v3_members
for select to authenticated
using (duo_v3_private.is_member(household_id, (select auth.uid())));
create policy duo_v3_accounts_member_read on public.duo_v3_accounts
for select to authenticated
using (duo_v3_private.is_member(household_id, (select auth.uid())));
create policy duo_v3_transactions_member_read on public.duo_v3_transactions
for select to authenticated
using (duo_v3_private.is_member(household_id, (select auth.uid())));
create policy duo_v3_entries_member_read on public.duo_v3_entries
for select to authenticated
using (duo_v3_private.is_member(household_id, (select auth.uid())));

-- Authenticated RPC. Inserts transaction + two entries in a single SQL transaction.
-- All amounts are signed integer minor units. Accounts must be distinct.
-- SECURITY DEFINER is necessary because direct client writes are prohibited.
-- Authorization is rechecked explicitly using auth.uid() and membership.
create function public.duo_v3_post_transfer(
  p_household uuid, p_from_account uuid, p_to_account uuid,
  p_amount_minor numeric, p_currency text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_transaction uuid;
  v_existing record;
begin
  if v_user is null
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0
     or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999
     or p_from_account is null or p_to_account is null
     or p_from_account = p_to_account
     or p_currency not in ('EUR','USD','GBP','XAF','XOF','JPY')
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid transfer parameters' using errcode = '22023';
  end if;
  -- Serialization of concurrent requests for a household + idempotency key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household::text || ':' || p_idempotency_key, 0)
  );
  select t.id, t.kind, t.currency into v_existing
    from public.duo_v3_transactions t
    where t.household_id = p_household and t.idempotency_key = p_idempotency_key;
  if found then
    -- Never silently reuse a key for a different transfer.
    if v_existing.kind <> 'transfer' or v_existing.currency <> p_currency
       or not exists (
         select 1 from public.duo_v3_entries e
         where e.transaction_id = v_existing.id
           and e.account_id = p_from_account and e.amount_minor = -p_amount_minor
       ) or not exists (
         select 1 from public.duo_v3_entries e
         where e.transaction_id = v_existing.id
           and e.account_id = p_to_account and e.amount_minor = p_amount_minor
       ) then
      raise exception 'Idempotency key reused for different transfer' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  -- Lock accounts in stable order to prevent races with future balance rules.
  perform 1 from public.duo_v3_accounts a
   where a.id in (p_from_account,p_to_account)
     and a.household_id = p_household and a.currency = p_currency
   order by a.id for update;
  if (select count(*) from public.duo_v3_accounts a
      where a.id in (p_from_account,p_to_account)
        and a.household_id = p_household and a.currency = p_currency) <> 2 then
    raise exception 'Accounts not found in household/currency' using errcode = '23503';
  end if;
  insert into public.duo_v3_transactions
    (household_id,currency,idempotency_key,kind,created_by)
    values (p_household,p_currency,p_idempotency_key,'transfer',v_user)
    returning id into v_transaction;
  insert into public.duo_v3_entries
    (transaction_id,household_id,account_id,currency,amount_minor)
    values (v_transaction,p_household,p_from_account,p_currency,-p_amount_minor),
           (v_transaction,p_household,p_to_account,p_currency,p_amount_minor);
  return v_transaction;
end;
$$;
revoke all on function public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text)
  from public, anon;
grant execute on function public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text)
  to authenticated;
commit;
