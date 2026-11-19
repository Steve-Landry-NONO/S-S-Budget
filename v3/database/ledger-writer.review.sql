-- Trusted-server-only transactional writer. NOT exposed to mobile / Data API.
-- Run after ledger-rls.review.sql, in an isolated dev database only.
-- This function intentionally has NO GRANT EXECUTE to authenticated/anon/public.
-- Trusted backend must pass an authenticated user context (auth.uid()).
-- Uses SECURITY DEFINER only because tables are write-revoked to clients;
-- all membership and account ownership checks are repeated explicitly.
create function duo_v3_private.post_shared_ledger_entry(
  p_duo_id uuid,
  p_key text,
  p_kind text,
  p_lines jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry uuid;
  v_line jsonb;
  v_account uuid;
  v_amount bigint;
  v_count integer := 0;
  v_book text;
  v_cash_sum numeric := 0;
  v_budget_sum numeric := 0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_key is null or length(p_key) not between 8 and 160 then
    raise exception 'Invalid idempotency key';
  end if;
  if p_kind not in ('contribution','expense','allocation','reallocation','adjustment') then
    raise exception 'Unsupported entry kind';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 2 and 12 then
    raise exception 'Expected 2 to 12 postings';
  end if;
  -- Serialize all writes per duo to prevent concurrent duplicate/misaligned
  -- posting, and validate membership against the authoritative table.
  perform 1 from duo_v3_private.duos
    where id=p_duo_id and lifecycle='active' for update;
  if not found then raise exception 'Duo not active'; end if;
  perform 1 from duo_v3_private.memberships
    where duo_id=p_duo_id and user_id=v_actor;
  if not found then raise exception 'Not a duo member'; end if;
  select id into v_entry from duo_v3_private.ledger_entries
    where duo_id=p_duo_id and idempotency_key=p_key;
  if found then
    -- Reuse requires comparing the complete original request; until that
    -- fingerprint exists, reject rather than silently accepting altered input.
    raise exception 'Duplicate idempotency key';
  end if;
  -- Validate the complete request BEFORE creating the entry.
  for v_line in select value from jsonb_array_elements(p_lines) as x(value) loop
    if jsonb_typeof(v_line) <> 'object'
       or (v_line->>'account_id') is null
       or (v_line->>'amount_minor') !~ '^-?[0-9]+$' then
      raise exception 'Invalid posting payload';
    end if;
    v_account := (v_line->>'account_id')::uuid;
    v_amount := (v_line->>'amount_minor')::bigint;
    if v_amount=0 then raise exception 'Zero posting'; end if;
    select book into v_book from duo_v3_private.ledger_accounts
      where duo_id=p_duo_id and id=v_account;
    if not found then raise exception 'Account outside duo'; end if;
    if v_book='cash' then v_cash_sum := v_cash_sum + v_amount;
    else v_budget_sum := v_budget_sum + v_amount; end if;
    v_count := v_count + 1;
  end loop;
  if v_count<2 or v_cash_sum<>0 or v_budget_sum<>0 then
    raise exception 'Unbalanced posting set';
  end if;
  insert into duo_v3_private.ledger_entries
    (duo_id,idempotency_key,kind,actor_user_id)
    values (p_duo_id,p_key,p_kind,v_actor)
    returning id into v_entry;
  for v_line in select value from jsonb_array_elements(p_lines) as x(value) loop
    insert into duo_v3_private.ledger_postings
      (duo_id,entry_id,account_id,amount_minor)
    values (p_duo_id,v_entry,(v_line->>'account_id')::uuid,
            (v_line->>'amount_minor')::bigint);
  end loop;
  return v_entry;
end $$;
revoke all on function duo_v3_private.post_shared_ledger_entry(uuid,text,text,jsonb)
  from public,anon,authenticated;
-- Security review TODO: this is a trusted backend primitive, not yet a complete
-- public financial API. Validate account-type patterns per operation kind,
-- cash overdraft rules, replay fingerprint, audit metadata, reversal workflow,
-- and private operation model before production.
