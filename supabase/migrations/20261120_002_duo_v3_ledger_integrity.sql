-- Duo Budget V3: integrity guards. Review and test in DEV before deployment.
begin;

-- Block any mutation of ledger history. Corrections use a new reversal transaction.
create function public.duo_v3_reject_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Posted ledger history is immutable' using errcode = '23514';
end;
$$;

create trigger duo_v3_transactions_immutable
before update or delete on public.duo_v3_transactions
for each row execute function public.duo_v3_reject_ledger_mutation();

create trigger duo_v3_entries_immutable
before update or delete on public.duo_v3_entries
for each row execute function public.duo_v3_reject_ledger_mutation();

-- Deferred check: transaction and its entries can be inserted in one DB transaction,
-- but COMMIT must fail if it has fewer than two nonzero entries or is unbalanced.
create function public.duo_v3_validate_posting()
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
  v_transaction_id := new.transaction_id;
  if tg_table_name = 'duo_v3_transactions' then
    v_transaction_id := new.id;
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

create constraint trigger duo_v3_validate_transaction_posting
after insert on public.duo_v3_transactions
deferrable initially deferred
for each row execute function public.duo_v3_validate_posting();

create constraint trigger duo_v3_validate_entry_posting
after insert on public.duo_v3_entries
deferrable initially deferred
for each row execute function public.duo_v3_validate_posting();

-- No client writes until a carefully scoped authenticated RPC and RLS policies exist.
revoke all on function public.duo_v3_reject_ledger_mutation() from public, anon, authenticated;
revoke all on function public.duo_v3_validate_posting() from public, anon, authenticated;
commit;
