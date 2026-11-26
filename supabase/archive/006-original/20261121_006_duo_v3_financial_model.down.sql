-- Retour arrière de 20261121_006_duo_v3_financial_model.sql (DEV uniquement).
-- Rétablit exactement l'état 005 : fonctions de 002 et 004 recopiées à l'identique.
-- Refuse de s'exécuter si des données du modèle 006 existent : le registre étant immuable,
-- un retour arrière avec données exige une procédure de réinitialisation DEV revue.
begin;
do $$
begin
  if exists (select 1 from public.duo_v3_periods) or exists (select 1 from public.duo_v3_envelopes)
     or exists (select 1 from public.duo_v3_accounts where kind in ('budget_source','budget_spent'))
     or exists (select 1 from public.duo_v3_transactions
                where period_id is not null or kind in ('contribution','carry') or origin = 'system') then
    raise exception '006 down : données du modèle 006 présentes ; retour arrière refusé' using errcode = '55000';
  end if;
end $$;

drop view public.duo_v3_household_position;
drop view public.duo_v3_envelope_balances;
drop function public.duo_v3_post_expense(uuid, uuid, numeric, date, text);
drop function public.duo_v3_post_contribution(uuid, numeric, date, text);

-- RPC de transfert : version 004 à l'identique
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

-- Validation des écritures : version 002 à l'identique
create or replace function public.duo_v3_validate_posting()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_transaction_id uuid;
  v_household_id uuid;
  v_currency text;
  v_kind text;
  v_reverses uuid;
  v_count bigint;
  v_total numeric;
begin
  if tg_table_name = 'duo_v3_transactions' then
    v_transaction_id := new.id;
  else
    v_transaction_id := new.transaction_id;
  end if;

  select t.household_id, t.currency, t.kind, t.reverses_transaction_id
    into v_household_id, v_currency, v_kind, v_reverses
  from public.duo_v3_transactions t where t.id = v_transaction_id;

  select count(*), coalesce(sum(e.amount_minor), 0)
    into v_count, v_total
  from public.duo_v3_entries e where e.transaction_id = v_transaction_id;

  if v_count < 2 or v_total <> 0 then
    raise exception 'Ledger posting requires at least two balanced entries'
      using errcode = '23514';
  end if;

  if v_kind = 'reversal' then
    if not exists (
      select 1 from public.duo_v3_transactions original
      where original.id = v_reverses
        and original.household_id = v_household_id
        and original.currency = v_currency
        and original.kind <> 'reversal'
    ) then
      raise exception 'Reversal must reference an original in the same household and currency'
        using errcode = '23514';
    end if;

    if exists (
      select account_id, sum(amount_minor) as total
      from (
        select account_id, amount_minor
          from public.duo_v3_entries where transaction_id = v_transaction_id
        union all
        select account_id, amount_minor
          from public.duo_v3_entries where transaction_id = v_reverses
      ) combined
      group by account_id having sum(amount_minor) <> 0
    ) then
      raise exception 'Reversal must exactly negate original entries by account'
        using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

drop table public.duo_v3_period_closes;
drop table public.duo_v3_period_envelope_closes;
drop table public.duo_v3_period_allocations;
drop table public.duo_v3_allocation_versions;
drop table public.duo_v3_envelopes;
alter table public.duo_v3_transactions
  drop constraint duo_v3_transactions_period_fkey,
  drop constraint duo_v3_transactions_system_kinds,
  drop constraint duo_v3_transactions_origin_actor,
  drop column period_id, drop column occurred_on, drop column late_imputation, drop column origin,
  alter column created_by set not null;
alter table public.duo_v3_transactions drop constraint duo_v3_transactions_kind_check;
alter table public.duo_v3_transactions add constraint duo_v3_transactions_kind_check
  check (kind in ('expense','income','transfer','allocation','reversal'));
comment on column public.duo_v3_transactions.created_at is null;
drop table public.duo_v3_periods;
drop index public.duo_v3_one_system_account;
alter table public.duo_v3_accounts drop column book;
alter table public.duo_v3_accounts drop constraint duo_v3_accounts_kind_check;
alter table public.duo_v3_accounts add constraint duo_v3_accounts_kind_check
  check (kind in ('cash','envelope','reserve','clearing'));
drop trigger duo_v3_households_calendar_guard on public.duo_v3_households;
alter table public.duo_v3_households drop column currency, drop column cycle_start_day, drop column time_zone;

drop function duo_v3_private.ensure_current_period(uuid, timestamptz);
drop function duo_v3_private.close_period(uuid, uuid, timestamptz);
drop function duo_v3_private.post_period_allocations(uuid, uuid);
drop function duo_v3_private.post_system(uuid, uuid, text, text, uuid, uuid, numeric, date);
drop function duo_v3_private.set_allocation(uuid, numeric, date);
drop function duo_v3_private.archive_envelope(uuid, timestamptz);
drop function duo_v3_private.create_envelope(uuid, text, boolean);
drop function duo_v3_private.bootstrap_household(uuid, timestamptz);
drop function duo_v3_private.account_of(uuid, text);
drop function duo_v3_private.create_period(uuid, date);
drop function duo_v3_private.cycle_containing(smallint, date);
drop function duo_v3_private.cycle_boundary(smallint, int, int);
drop function duo_v3_private.guard_household_calendar();
drop function duo_v3_private.guard_envelope();
drop function duo_v3_private.guard_period_insert();
drop function duo_v3_private.guard_period_update();
drop function duo_v3_private.reject_mutation();
commit;
