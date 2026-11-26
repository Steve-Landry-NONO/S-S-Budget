-- V3 DEV hardening: prevent unauthenticated/anonymous Auth identities and
-- reject transfers involving clearing accounts until business rules are reviewed.
begin;
create or replace function public.duo_v3_post_transfer(
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
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0
     or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999
     or p_from_account is null or p_to_account is null
     or p_from_account = p_to_account
     or p_currency is null or p_currency not in ('EUR','USD','GBP','XAF','XOF','JPY')
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid transfer parameters' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household::text || ':' || p_idempotency_key, 0)
  );
  select t.id, t.kind, t.currency into v_existing
    from public.duo_v3_transactions t
    where t.household_id = p_household and t.idempotency_key = p_idempotency_key;
  if found then
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
  perform 1 from public.duo_v3_accounts a
   where a.id in (p_from_account,p_to_account)
     and a.household_id = p_household and a.currency = p_currency
     and a.kind <> 'clearing'
   order by a.id for update;
  if (select count(*) from public.duo_v3_accounts a
      where a.id in (p_from_account,p_to_account)
        and a.household_id = p_household and a.currency = p_currency
        and a.kind <> 'clearing') <> 2 then
    raise exception 'Accounts not eligible in household/currency' using errcode = '23503';
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
revoke all on function public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text) from public, anon;
grant execute on function public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text) to authenticated;
commit;