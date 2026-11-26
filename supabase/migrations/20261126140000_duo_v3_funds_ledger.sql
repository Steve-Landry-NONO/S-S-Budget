-- =====================================================================================================
-- Duo Budget V3 — MIGRATION CANDIDATE : troisième livre « fonds réels » (modèle M2, R-B0)
-- STATUT : CANDIDATE, NON APPLIQUÉE. Distincte de la 006 révisée, dont elle dépend, ainsi que de la
-- migration lot 3 (espaces personnels, appartenances actives). Environnements jetables uniquement.
-- Décisions appliquées (PR #20) : R-B0 M2 · R-B1 balayage des reliquats réels sans report · R-B3 répartition
-- hybride des contributions attendues · R-B4 soldes d'ouverture V2 · R-B5 annulation après libération ·
-- R-B6 double accord (commun) / propriétaire seul (personnel). R-B2 (prévu) : lot distinct, non inclus.
--
-- Livres (chacun équilibré par transaction) : cash (trésorerie) · budget (planification) · funds (fonds réels).
-- Invariant : trésorerie = fonds non affectés + Σ fonds affectés (signés), contrôlé à chaque transaction.
-- Une affectation ne touche que le livre funds : ni recette, ni trésorerie, ni double compte.
-- =====================================================================================================
begin;

do $$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.duo_v3_transactions'::regclass and attname = 'posting_xid') then
    raise exception 'Fonds réels : la 006 révisée (posting_xid, F1–F7) est requise' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.duo_v3_households'::regclass and attname = 'kind') then
    raise exception 'Fonds réels : la migration lot 3 (espaces, appartenances) est requise' using errcode = '55000';
  end if;
end $$;

-- B1. Comptes du livre « funds »
alter table public.duo_v3_accounts drop constraint duo_v3_accounts_kind_check;
alter table public.duo_v3_accounts add constraint duo_v3_accounts_kind_check
  check (kind in ('cash','clearing','envelope','reserve','budget_source','budget_spent',
                  'funds_external','funds_unassigned','funds_envelope'));
alter table public.duo_v3_accounts alter column book set expression as (
  case when kind in ('cash','clearing') then 'cash'
       when kind in ('funds_external','funds_unassigned','funds_envelope') then 'funds'
       else 'budget' end);
drop index public.duo_v3_one_system_account;
create unique index duo_v3_one_system_account on public.duo_v3_accounts(household_id, kind, currency)
  where kind in ('cash','clearing','reserve','budget_source','budget_spent','funds_external','funds_unassigned');

alter table public.duo_v3_households add column funds_tracking boolean not null default false;
alter table public.duo_v3_envelopes
  add column funds_account_id uuid unique,
  add column protected boolean not null default false,
  add constraint duo_v3_envelopes_funds_account_fkey foreign key (funds_account_id, household_id, currency)
    references public.duo_v3_accounts(id, household_id, currency) on update cascade on delete restrict;

-- B2. Transactions : affectation, ouverture des fonds, restauration
alter table public.duo_v3_transactions drop constraint duo_v3_transactions_kind_check;
alter table public.duo_v3_transactions add constraint duo_v3_transactions_kind_check
  check (kind in ('expense','income','contribution','transfer','allocation','carry','reversal','assignment','funds_opening','funds_sweep'));
alter table public.duo_v3_transactions drop constraint duo_v3_transactions_system_kinds;
alter table public.duo_v3_transactions add constraint duo_v3_transactions_system_kinds
  check (origin = 'member' or kind in ('allocation','carry','funds_opening','funds_sweep'));
alter table public.duo_v3_transactions add column restores_transaction_id uuid
  references public.duo_v3_transactions(id) on delete restrict;
create unique index duo_v3_single_restore on public.duo_v3_transactions(restores_transaction_id)
  where restores_transaction_id is not null;

-- Historique de protection (append-only)
create table public.duo_v3_envelope_protection_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  envelope_id uuid not null,
  protected boolean not null,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  foreign key (envelope_id, household_id) references public.duo_v3_envelopes(id, household_id) on delete restrict,
  foreign key (household_id, changed_by) references public.duo_v3_members(household_id, user_id) on delete restrict
);
create trigger duo_v3_protection_events_immutable before update or delete on public.duo_v3_envelope_protection_events
  for each row execute function duo_v3_private.reject_mutation();
alter table public.duo_v3_envelope_protection_events enable row level security;
create policy duo_v3_protection_events_member_read on public.duo_v3_envelope_protection_events for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
revoke all on public.duo_v3_envelope_protection_events from public, anon, authenticated;
grant select on public.duo_v3_envelope_protection_events to authenticated;

-- B3. Invariants (contrôle différé, à la validation, comme l'équilibre par livre)
-- SECURITY DEFINER : le contrôle différé s'exécute au COMMIT sous le rôle appelant (authenticated) ;
-- il doit lire tout le livre du duo, sans dépendre des droits ni de la RLS de l'appelant.
create function duo_v3_private.validate_funds()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t record; v_cash numeric; v_funds numeric; v_unassigned numeric;
begin
  select tx.id, tx.household_id, tx.kind, h.funds_tracking into t
  from public.duo_v3_transactions tx join public.duo_v3_households h on h.id = tx.household_id where tx.id = new.id;
  if exists (select 1 from public.duo_v3_entries e join public.duo_v3_accounts a on a.id = e.account_id
             where e.transaction_id = t.id and a.book = 'funds') and not t.funds_tracking then
    raise exception 'Funds book is not activated for this household' using errcode = '23514';
  end if;
  if not t.funds_tracking then return null; end if;
  select coalesce(sum(e.amount_minor) filter (where a.kind = 'cash'), 0),
         coalesce(sum(e.amount_minor) filter (where a.kind in ('funds_unassigned','funds_envelope')), 0)
    into v_cash, v_funds
  from public.duo_v3_entries e join public.duo_v3_accounts a on a.id = e.account_id where e.transaction_id = t.id;
  if v_cash <> v_funds and t.kind <> 'funds_opening' then
    raise exception 'Real funds must follow treasury (Δcash = Δfunds)' using errcode = '23514';
  end if;
  select coalesce(sum(e.amount_minor), 0) into v_unassigned from public.duo_v3_entries e
   where e.account_id = duo_v3_private.account_of(t.household_id, 'funds_unassigned');
  if v_unassigned < 0 then
    raise exception 'Unassigned real funds cannot be negative' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger duo_v3_validate_funds after insert on public.duo_v3_transactions
  deferrable initially deferred for each row execute function duo_v3_private.validate_funds();

create function duo_v3_private.balance(p_account uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_minor), 0) from public.duo_v3_entries where account_id = p_account;
$$;

-- Archivage : les fonds réels d'une enveloppe doivent aussi être nuls (rien ne disparaît).
create function duo_v3_private.guard_envelope_funds()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'active' and new.status = 'archived' and new.funds_account_id is not null
     and duo_v3_private.balance(new.funds_account_id) <> 0 then
    raise exception 'Envelope real funds must be zero to archive (reassign them first)' using errcode = '23514';
  end if;
  if new.funds_account_id is distinct from old.funds_account_id and old.funds_account_id is not null then
    raise exception 'Envelope funds account cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger duo_v3_envelopes_guard_funds before update on public.duo_v3_envelopes
  for each row execute function duo_v3_private.guard_envelope_funds();

-- B4. Activation (migration d'un duo 006 existant ou création d'un duo neuf)
create function duo_v3_private.ensure_funds_account(p_envelope uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e record; v uuid;
begin
  select * into e from public.duo_v3_envelopes where id = p_envelope;
  if e.funds_account_id is not null then return e.funds_account_id; end if;
  insert into public.duo_v3_accounts (household_id, label, kind, currency)
  values (e.household_id, left('fonds ' || e.name, 120), 'funds_envelope', e.currency) returning id into v;
  update public.duo_v3_envelopes set funds_account_id = v where id = p_envelope;
  return v;
end;
$$;

create function duo_v3_private.activate_funds(p_household uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h record; k text; e record; v_cash numeric; v_period uuid; v_tx uuid;
begin
  select * into h from public.duo_v3_households where id = p_household for update;
  if h.funds_tracking then return null; end if;                                 -- idempotent
  foreach k in array array['funds_external','funds_unassigned'] loop
    if duo_v3_private.account_of(p_household, k) is null then
      insert into public.duo_v3_accounts (household_id, label, kind, currency) values (p_household, k, k, h.currency);
    end if;
  end loop;
  for e in select id from public.duo_v3_envelopes where household_id = p_household loop
    perform duo_v3_private.ensure_funds_account(e.id);
  end loop;
  update public.duo_v3_households set funds_tracking = true where id = p_household;
  v_cash := duo_v3_private.balance(duo_v3_private.account_of(p_household, 'cash'));
  if v_cash < 0 then
    raise exception 'Treasury is negative: opening real funds needs an explicit decision' using errcode = '55000';
  end if;
  if v_cash > 0 then
    v_period := duo_v3_private.ensure_current_period(p_household);
    v_tx := duo_v3_private.post_system(p_household, v_period, 'funds_opening', 'funds-opening',
      duo_v3_private.account_of(p_household, 'funds_external'), duo_v3_private.account_of(p_household, 'funds_unassigned'),
      v_cash, (now() at time zone h.time_zone)::date);
  end if;
  return v_tx;
end;
$$;

-- Les enveloppes créées après activation reçoivent leur compte de fonds.
create or replace function duo_v3_private.create_envelope(p_household uuid, p_name text, p_carry_positive boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_account uuid; v_env uuid;
begin
  select * into h from public.duo_v3_households where id = p_household;
  insert into public.duo_v3_accounts (household_id, label, kind, currency)
  values (p_household, left(p_name, 120), 'envelope', h.currency) returning id into v_account;
  insert into public.duo_v3_envelopes (household_id, account_id, currency, name, carry_positive)
  values (p_household, v_account, h.currency, p_name, p_carry_positive) returning id into v_env;
  if h.funds_tracking then perform duo_v3_private.ensure_funds_account(v_env); end if;
  return v_env;
end;
$$;

-- B5. Préambule commun des RPC membres (autorisation, verrou, F7, idempotence)
create function duo_v3_private.member_preamble(p_household uuid, p_key text, p_hash bytea, out v_user uuid, out v_existing uuid)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  v_user := auth.uid();
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_key is null or length(p_key) not between 1 and 128 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household::text || ':' || v_user::text || ':' || p_key, 0));
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if not (select funds_tracking from public.duo_v3_households where id = p_household) then
    raise exception 'Real funds are not activated for this household' using errcode = '55000';
  end if;
  select t.id, t.request_sha256 into r from public.duo_v3_transactions t
   where t.household_id = p_household and t.created_by = v_user and t.origin = 'member' and t.idempotency_key = p_key;
  if found then
    if r.request_sha256 is distinct from p_hash then
      raise exception 'Idempotency key reused for a different request' using errcode = '23505';
    end if;
    v_existing := r.id;
  end if;
end;
$$;

create function duo_v3_private.active_envelope(p_household uuid, p_envelope uuid) returns public.duo_v3_envelopes
language plpgsql security definer set search_path = '' as $$
declare e public.duo_v3_envelopes;
begin
  select * into e from public.duo_v3_envelopes where id = p_envelope and household_id = p_household;
  if not found or e.status <> 'active' or e.funds_account_id is null then
    raise exception 'Envelope not eligible in household' using errcode = '23503';
  end if;
  return e;
end;
$$;

-- B6. RPC existantes : mêmes signatures ; lignes du livre funds ajoutées si le duo est activé.
create or replace function public.duo_v3_post_contribution(
  p_household uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return public.duo_v3_post_contribution_assigned(p_household, p_amount_minor, p_occurred_on, p_idempotency_key, '[]'::jsonb);
end;
$$;

-- Contribution réalisée, éventuellement affectée en tout ou partie dès sa saisie.
create function public.duo_v3_post_contribution_assigned(
  p_household uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text, p_assignments jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_existing uuid; v_period uuid; h record; v_tx uuid; v_hash bytea; a record; e public.duo_v3_envelopes;
        v_assigned numeric := 0; v_tracking boolean;
begin
  v_user := auth.uid();
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999 or p_occurred_on is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128
     or p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Invalid contribution parameters' using errcode = '22023';
  end if;
  select funds_tracking into v_tracking from public.duo_v3_households where id = p_household;
  if not coalesce(v_tracking, false) then
    if p_assignments <> '[]'::jsonb then raise exception 'Real funds are not activated for this household' using errcode = '55000'; end if;
  end if;
  v_hash := duo_v3_private.request_hash(array['contribution', p_amount_minor::numeric(38,0)::text, p_occurred_on::text]
            || case when p_assignments = '[]'::jsonb then array[]::text[] else array[p_assignments::text] end);
  -- verrous et F7 (sans exiger l'activation pour le chemin historique non affecté)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household::text || ':' || v_user::text || ':' || p_idempotency_key, 0));
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  select t.id into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.created_by = v_user and t.origin = 'member' and t.idempotency_key = p_idempotency_key
     and t.request_sha256 = v_hash;
  if found then return v_existing; end if;
  if exists (select 1 from public.duo_v3_transactions t where t.household_id = p_household and t.created_by = v_user
             and t.origin = 'member' and t.idempotency_key = p_idempotency_key) then
    raise exception 'Idempotency key reused for different contribution' using errcode = '23505';
  end if;
  select * into h from public.duo_v3_households where id = p_household;
  if p_occurred_on > (now() at time zone h.time_zone)::date then
    raise exception 'A contribution cannot be dated in the future' using errcode = '22023';
  end if;
  v_period := duo_v3_private.ensure_current_period(p_household);
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, late_imputation, request_sha256)
  values (p_household, h.currency, p_idempotency_key, 'contribution', v_user, v_period, p_occurred_on,
          p_occurred_on < (select starts_on from public.duo_v3_periods where id = v_period), v_hash) returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),     h.currency,  p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'), h.currency, -p_amount_minor);
  if h.funds_tracking then
    for a in select (x ->> 'envelopeId')::uuid as env, (x ->> 'amount')::numeric as amt from jsonb_array_elements(p_assignments) x loop
      if a.amt is null or a.amt <= 0 or a.amt <> trunc(a.amt) then raise exception 'Invalid assignment amount' using errcode = '22023'; end if;
      e := duo_v3_private.active_envelope(p_household, a.env);
      insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
      values (v_tx, p_household, e.funds_account_id, h.currency, a.amt);
      v_assigned := v_assigned + a.amt;
    end loop;
    if v_assigned > p_amount_minor then
      raise exception 'Assignments exceed the contribution: assignment never creates revenue' using errcode = '23514';
    end if;
    insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
      (v_tx, p_household, duo_v3_private.account_of(p_household, 'funds_external'), h.currency, -p_amount_minor);
    if p_amount_minor - v_assigned > 0 then
      insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
        (v_tx, p_household, duo_v3_private.account_of(p_household, 'funds_unassigned'), h.currency, p_amount_minor - v_assigned);
    end if;
  end if;
  return v_tx;
end;
$$;

-- Dépense : les fonds réels sortent de l'enveloppe ; un dépassement crée un déficit réel visible.
create or replace function public.duo_v3_post_expense(
  p_household uuid, p_envelope uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_existing record; v_period record; v_period_id uuid; v_env record; h record; v_tx uuid; v_today date; v_hash bytea;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999 or p_envelope is null or p_occurred_on is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid expense parameters' using errcode = '22023';
  end if;
  v_hash := duo_v3_private.request_hash(array['expense', p_envelope::text, p_amount_minor::numeric(38,0)::text, p_occurred_on::text]);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household::text || ':' || v_user::text || ':' || p_idempotency_key, 0));
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  select * into h from public.duo_v3_households where id = p_household;
  select * into v_env from public.duo_v3_envelopes where id = p_envelope and household_id = p_household;
  select t.id, t.request_sha256 into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.created_by = v_user and t.origin = 'member' and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_sha256 is distinct from v_hash then
      raise exception 'Idempotency key reused for different expense' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  if v_env.id is null then raise exception 'Envelope not eligible in household' using errcode = '23503'; end if;
  if v_env.status <> 'active' then
    raise exception 'Envelope is archived (D-023): choose an active envelope' using errcode = '23503', hint = 'choose_active_envelope';
  end if;
  v_today := (now() at time zone h.time_zone)::date;
  if p_occurred_on > v_today then raise exception 'A completed expense cannot be dated in the future' using errcode = '22023'; end if;
  v_period_id := duo_v3_private.ensure_current_period(p_household);
  select * into v_period from public.duo_v3_periods where id = v_period_id;
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, late_imputation, request_sha256)
  values (p_household, h.currency, p_idempotency_key, 'expense', v_user, v_period.id, p_occurred_on, p_occurred_on < v_period.starts_on, v_hash)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),         h.currency, -p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'),     h.currency,  p_amount_minor),
    (v_tx, p_household, v_env.account_id,                                       h.currency, -p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'budget_spent'), h.currency,  p_amount_minor);
  if h.funds_tracking then
    insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
      (v_tx, p_household, v_env.funds_account_id,                                   h.currency, -p_amount_minor),
      (v_tx, p_household, duo_v3_private.account_of(p_household, 'funds_external'), h.currency,  p_amount_minor);
  end if;
  return v_tx;
end;
$$;

-- B7. Mouvements internes de fonds réels (affectation, désaffectation, transfert entre enveloppes).
-- p_from / p_to : identifiant d'enveloppe, ou null pour « fonds non affectés ».
create function public.duo_v3_move_funds(p_household uuid, p_from_envelope uuid, p_to_envelope uuid,
  p_amount_minor numeric, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p record; v_hash bytea; v_from uuid; v_to uuid; ef public.duo_v3_envelopes; et public.duo_v3_envelopes; h record; v_period uuid; v_tx uuid;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999
     or (p_from_envelope is null and p_to_envelope is null) or p_from_envelope = p_to_envelope then
    raise exception 'Invalid funds movement parameters' using errcode = '22023';
  end if;
  v_hash := duo_v3_private.request_hash(array['move_funds', p_from_envelope::text, p_to_envelope::text, p_amount_minor::numeric(38,0)::text]);
  p := duo_v3_private.member_preamble(p_household, p_idempotency_key, v_hash);
  if p.v_existing is not null then return p.v_existing; end if;
  select * into h from public.duo_v3_households where id = p_household;
  if p_from_envelope is null then v_from := duo_v3_private.account_of(p_household, 'funds_unassigned');
  else
    ef := duo_v3_private.active_envelope(p_household, p_from_envelope); v_from := ef.funds_account_id;
    if ef.protected then
      raise exception 'Protected envelope: its real funds cannot be moved (unprotect explicitly first)' using errcode = '23514', hint = 'envelope_protected';
    end if;
  end if;
  if p_to_envelope is null then v_to := duo_v3_private.account_of(p_household, 'funds_unassigned');
  else et := duo_v3_private.active_envelope(p_household, p_to_envelope); v_to := et.funds_account_id; end if;
  if duo_v3_private.balance(v_from) < p_amount_minor then
    raise exception 'Insufficient real funds: an internal movement cannot create a deficit' using errcode = '23514', hint = 'insufficient_real_funds';
  end if;
  v_period := duo_v3_private.ensure_current_period(p_household);
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, request_sha256)
  values (p_household, h.currency, p_idempotency_key, 'assignment', p.v_user, v_period, (now() at time zone h.time_zone)::date, v_hash)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, v_from, h.currency, -p_amount_minor), (v_tx, p_household, v_to, h.currency, p_amount_minor);
  return v_tx;
end;
$$;

-- B8. Protection (R-B6) : poser = immédiat ; lever = double accord dans un espace commun,
-- propriétaire seul dans un espace personnel. Toute levée effective est journalisée.
create table public.duo_v3_protection_lift_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  envelope_id uuid not null,
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending','approved','cancelled')),
  decided_by uuid, decided_at timestamptz,
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'approved' or decided_by is distinct from requested_by),
  foreign key (envelope_id, household_id) references public.duo_v3_envelopes(id, household_id) on delete restrict
);
create unique index duo_v3_one_pending_lift on public.duo_v3_protection_lift_requests(envelope_id) where status = 'pending';
alter table public.duo_v3_protection_lift_requests enable row level security;
create policy duo_v3_protection_lift_requests_member_read on public.duo_v3_protection_lift_requests for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
revoke all on public.duo_v3_protection_lift_requests from public, anon, authenticated;
grant select on public.duo_v3_protection_lift_requests to authenticated;

create function public.duo_v3_set_envelope_protection(p_household uuid, p_envelope uuid, p_protected boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); e public.duo_v3_envelopes; v_kind text; r record;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_protected is null then raise exception 'Invalid protection parameters' using errcode = '22023'; end if;
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  e := duo_v3_private.active_envelope(p_household, p_envelope);
  select kind into v_kind from public.duo_v3_households where id = p_household;
  if p_protected then
    update public.duo_v3_protection_lift_requests set status = 'cancelled', decided_by = v_user, decided_at = clock_timestamp()
     where envelope_id = p_envelope and status = 'pending';
    if not e.protected then
      update public.duo_v3_envelopes set protected = true where id = p_envelope;
      insert into public.duo_v3_envelope_protection_events (household_id, envelope_id, protected, changed_by) values (p_household, p_envelope, true, v_user);
    end if;
    return 'protected';
  end if;
  if not e.protected then return 'none'; end if;
  if v_kind = 'personal' then                                        -- propriétaire seul (seul membre de l'espace)
    update public.duo_v3_envelopes set protected = false where id = p_envelope;
    insert into public.duo_v3_envelope_protection_events (household_id, envelope_id, protected, changed_by) values (p_household, p_envelope, false, v_user);
    return 'none';
  end if;
  select * into r from public.duo_v3_protection_lift_requests where envelope_id = p_envelope and status = 'pending';
  if not found then
    insert into public.duo_v3_protection_lift_requests (household_id, envelope_id, requested_by) values (p_household, p_envelope, v_user);
    return 'lift_pending';
  end if;
  if r.requested_by = v_user then return 'lift_pending'; end if;     -- le demandeur ne peut pas s'approuver
  update public.duo_v3_protection_lift_requests set status = 'approved', decided_by = v_user, decided_at = clock_timestamp() where id = r.id;
  update public.duo_v3_envelopes set protected = false where id = p_envelope;
  insert into public.duo_v3_envelope_protection_events (household_id, envelope_id, protected, changed_by) values (p_household, p_envelope, false, v_user);
  return 'none';
end;
$$;

-- B9. Annulation réversible et restauration
-- Annulation : contre-passation exacte (tous livres) dans la période ouverte ; l'original reste intact.
-- Restauration : nouvelle écriture identique à l'original (restores_transaction_id), elle-même annulable.
create function duo_v3_private.check_internal_debits(p_tx uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Toute sortie de fonds non liée à une dépense réelle ne peut rendre un compte de fonds négatif ni
  -- toucher une enveloppe protégée.
  for r in select e.account_id, a.kind from public.duo_v3_entries e join public.duo_v3_accounts a on a.id = e.account_id
           where e.transaction_id = p_tx and a.kind in ('funds_unassigned','funds_envelope') and e.amount_minor < 0 loop
    if duo_v3_private.balance(r.account_id) < 0 then
      raise exception 'Insufficient real funds: release the corresponding funds first' using errcode = '23514', hint = 'release_funds_first';
    end if;
    if r.kind = 'funds_envelope' and exists (select 1 from public.duo_v3_envelopes en where en.funds_account_id = r.account_id and en.protected) then
      raise exception 'Protected envelope: its real funds cannot be moved (unprotect explicitly first)' using errcode = '23514', hint = 'envelope_protected';
    end if;
  end loop;
end;
$$;

create function public.duo_v3_cancel_transaction(p_household uuid, p_transaction uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p record; o record; h record; v_period uuid; v_tx uuid; v_hash bytea;
begin
  v_hash := duo_v3_private.request_hash(array['cancel', p_transaction::text]);
  p := duo_v3_private.member_preamble(p_household, p_idempotency_key, v_hash);
  if p.v_existing is not null then return p.v_existing; end if;
  select * into o from public.duo_v3_transactions where id = p_transaction and household_id = p_household;
  if not found or o.origin <> 'member' or o.kind not in ('contribution','expense','assignment') then
    raise exception 'Transaction cannot be cancelled' using errcode = '23503';
  end if;
  if exists (select 1 from public.duo_v3_transactions where reverses_transaction_id = p_transaction) then
    raise exception 'Transaction already cancelled' using errcode = '23505';
  end if;
  select * into h from public.duo_v3_households where id = p_household;
  v_period := duo_v3_private.ensure_current_period(p_household);
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, reverses_transaction_id, request_sha256)
  values (p_household, o.currency, p_idempotency_key, 'reversal', p.v_user, v_period, (now() at time zone h.time_zone)::date, p_transaction, v_hash)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
  select v_tx, p_household, account_id, currency, -amount_minor from public.duo_v3_entries where transaction_id = p_transaction;
  perform duo_v3_private.check_internal_debits(v_tx);
  return v_tx;
end;
$$;

create function public.duo_v3_restore_transaction(p_household uuid, p_reversal uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p record; r record; o record; h record; v_period uuid; v_tx uuid; v_hash bytea;
begin
  v_hash := duo_v3_private.request_hash(array['restore', p_reversal::text]);
  p := duo_v3_private.member_preamble(p_household, p_idempotency_key, v_hash);
  if p.v_existing is not null then return p.v_existing; end if;
  select * into r from public.duo_v3_transactions where id = p_reversal and household_id = p_household and kind = 'reversal';
  if not found then raise exception 'Not a cancellation of this household' using errcode = '23503'; end if;
  select * into o from public.duo_v3_transactions where id = r.reverses_transaction_id;
  if o.kind not in ('contribution','expense','assignment') then raise exception 'Transaction cannot be restored' using errcode = '23503'; end if;
  if exists (select 1 from public.duo_v3_transactions where restores_transaction_id = o.id) then
    raise exception 'Transaction already restored' using errcode = '23505';
  end if;
  if o.kind = 'expense' and exists (select 1 from public.duo_v3_entries x join public.duo_v3_envelopes en on en.account_id = x.account_id
                                    where x.transaction_id = o.id and en.status <> 'active') then
    raise exception 'Envelope is archived (D-023): choose an active envelope' using errcode = '23503';
  end if;
  select * into h from public.duo_v3_households where id = p_household;
  v_period := duo_v3_private.ensure_current_period(p_household);
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, restores_transaction_id, request_sha256)
  values (p_household, o.currency, p_idempotency_key, o.kind, p.v_user, v_period, o.occurred_on, o.id, v_hash)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
  select v_tx, p_household, account_id, currency, amount_minor from public.duo_v3_entries where transaction_id = o.id;
  if o.kind <> 'expense' then perform duo_v3_private.check_internal_debits(v_tx); end if;   -- une dépense réelle peut créer un déficit
  return v_tx;
end;
$$;

-- ======================================================================================== R-B3
-- Contributions ATTENDUES (jamais de l'argent, jamais imposées) : répartition globale par défaut et
-- exceptions par enveloppe (CF-02), en points de base (10 000 = 100 %). Proposition par un membre,
-- acceptation par l'autre (accord mutuel). Première répartition : cycle courant (CF-10) ; modifications
-- ultérieures : cycle suivant (D-009/D-010). Sans accord : la proposition est affichée « provisoire ».
-- Les versements réels restent libres.
create table public.duo_v3_contribution_splits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  proposed_by uuid not null,
  proposed_at timestamptz not null default clock_timestamp(),
  status text not null default 'proposed' check (status in ('proposed','active','withdrawn')),
  accepted_by uuid, accepted_at timestamptz,
  effective_from date,
  default_shares jsonb not null,
  envelope_shares jsonb not null default '{}'::jsonb,
  check ((status = 'active') = (accepted_by is not null and effective_from is not null)),
  check (accepted_by is distinct from proposed_by),
  foreign key (household_id, proposed_by) references public.duo_v3_members(household_id, user_id) on delete restrict
);
create unique index duo_v3_one_pending_split on public.duo_v3_contribution_splits(household_id) where status = 'proposed';
create trigger duo_v3_contribution_splits_no_delete before delete on public.duo_v3_contribution_splits
  for each row execute function duo_v3_private.reject_mutation();
alter table public.duo_v3_contribution_splits enable row level security;
create policy duo_v3_contribution_splits_member_read on public.duo_v3_contribution_splits for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
revoke all on public.duo_v3_contribution_splits from public, anon, authenticated;
grant select on public.duo_v3_contribution_splits to authenticated;

create function duo_v3_private.valid_shares(p_household uuid, p_shares jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select jsonb_typeof(p_shares) = 'object'
     and (select count(*) from jsonb_object_keys(p_shares)) = (select count(*) from public.duo_v3_members m where m.household_id = p_household and m.status = 'active')
     and not exists (select 1 from jsonb_each_text(p_shares) kv where kv.value !~ '^[0-9]{1,5}$'
                     or not exists (select 1 from public.duo_v3_members m where m.household_id = p_household and m.status = 'active' and m.user_id::text = kv.key))
     and (select sum(kv.value::int) from jsonb_each_text(p_shares) kv) = 10000;
$$;

create function public.duo_v3_propose_contribution_split(p_household uuid, p_default_shares jsonb, p_envelope_shares jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid; k text; v jsonb;
begin
  if v_user is null or not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  if (select kind from public.duo_v3_households where id = p_household) <> 'duo' then
    raise exception 'A personal space has no contribution split' using errcode = '23514';
  end if;
  if p_default_shares is null or not duo_v3_private.valid_shares(p_household, p_default_shares)
     or p_envelope_shares is null or jsonb_typeof(p_envelope_shares) <> 'object' then
    raise exception 'Invalid split: one share per active member, total 10000 basis points' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_envelope_shares) loop
    if not exists (select 1 from public.duo_v3_envelopes e where e.id::text = k and e.household_id = p_household and e.status = 'active')
       or not duo_v3_private.valid_shares(p_household, v) then
      raise exception 'Invalid envelope exception %', k using errcode = '22023';
    end if;
  end loop;
  update public.duo_v3_contribution_splits set status = 'withdrawn' where household_id = p_household and status = 'proposed';
  insert into public.duo_v3_contribution_splits(household_id, proposed_by, default_shares, envelope_shares)
  values (p_household, v_user, p_default_shares, p_envelope_shares) returning id into v_id;
  return v_id;
end $$;

create function public.duo_v3_accept_contribution_split(p_household uuid, p_split uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); r record; p record; v_from date;
begin
  if v_user is null or not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  perform 1 from public.duo_v3_households where id = p_household for update;
  if not duo_v3_private.is_member(p_household, v_user) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  select * into r from public.duo_v3_contribution_splits where id = p_split and household_id = p_household and status = 'proposed';
  if not found then raise exception 'No pending split proposal' using errcode = 'P0002'; end if;
  if r.proposed_by = v_user then raise exception 'Mutual agreement: the other member must accept' using errcode = '42501', hint = 'second_member_required'; end if;
  if not duo_v3_private.valid_shares(p_household, r.default_shares) then
    raise exception 'Split no longer matches the active members' using errcode = '23514';
  end if;
  perform duo_v3_private.ensure_current_period(p_household);
  select * into p from public.duo_v3_periods where household_id = p_household and state = 'open';
  v_from := case when exists (select 1 from public.duo_v3_contribution_splits s where s.household_id = p_household and s.status = 'active')
                 then p.ends_on else p.starts_on end;                 -- CF-10 puis D-010
  update public.duo_v3_contribution_splits set status = 'active', accepted_by = v_user, accepted_at = clock_timestamp(), effective_from = v_from where id = p_split;
  return v_from;
end $$;

-- Attendu par membre pour la période ouverte : Σ enveloppes cible × part, arrondi au centime inférieur ;
-- le reliquat d'arrondi de chaque enveloppe va à la plus grande partie fractionnaire (égalité : plus petit userId).
create function duo_v3_private.expected_contributions(p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p record; s record; v_state text; e record; sh jsonb; acc jsonb := '{}'::jsonb; m record; v_rem numeric; v_first text;
begin
  select * into p from public.duo_v3_periods where household_id = p_household and state = 'open';
  if not found then return jsonb_build_object('state', 'not_configured', 'byMember', '[]'::jsonb, 'total', '0'); end if;
  select * into s from public.duo_v3_contribution_splits where household_id = p_household and status = 'active' and effective_from <= p.starts_on
   order by effective_from desc, accepted_at desc limit 1;
  v_state := 'agreed';
  if not found then
    select * into s from public.duo_v3_contribution_splits where household_id = p_household and status = 'proposed';
    v_state := 'provisional';
    if not found then return jsonb_build_object('state', 'not_configured', 'byMember', '[]'::jsonb, 'total', '0'); end if;
  end if;
  for e in select en.id, coalesce((select v.amount_minor from public.duo_v3_allocation_versions v where v.envelope_id = en.id and v.effective_from <= p.starts_on
                                   order by v.effective_from desc limit 1), 0) as target
           from public.duo_v3_envelopes en where en.household_id = p_household and en.status = 'active' order by en.id loop
    sh := coalesce(s.envelope_shares -> e.id::text, s.default_shares);
    v_rem := e.target; v_first := null;
    for m in select key as uid, (value)::int as bp, trunc(e.target * (value)::int / 10000) as part, (e.target * (value)::int) % 10000 as frac
             from jsonb_each_text(sh) order by (e.target * (value)::int) % 10000 desc, key loop
      acc := jsonb_set(acc, array[m.uid], to_jsonb(coalesce((acc ->> m.uid)::numeric, 0) + m.part));
      v_rem := v_rem - m.part; if v_first is null then v_first := m.uid; end if;
    end loop;
    if v_first is not null and v_rem <> 0 then acc := jsonb_set(acc, array[v_first], to_jsonb((acc ->> v_first)::numeric + v_rem)); end if;
  end loop;
  return jsonb_build_object('state', v_state, 'splitId', s.id,
    'byMember', coalesce((select jsonb_agg(jsonb_build_object('userId', key, 'amount', value) order by key) from jsonb_each(acc)), '[]'::jsonb),
    'total', coalesce((select sum(value::numeric) from jsonb_each_text(acc)), 0)::text);
end $$;

-- ======================================================================================== R-B1
-- À la clôture : le reliquat RÉEL positif d'une enveloppe sans report revient aux fonds non affectés
-- (symétrie de D-014) ; un déficit réel reste dans l'enveloppe ; réserve réelle et réserve budgétaire
-- restent distinctes. Exécuté dans la transaction de clôture (déclencheur sur l'instantané de clôture).
create function duo_v3_private.sweep_real_funds() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e record; v numeric; p record;
begin
  if not (select funds_tracking from public.duo_v3_households where id = new.household_id) then return null; end if;
  select * into p from public.duo_v3_periods where id = new.period_id;
  for e in select * from public.duo_v3_envelopes where household_id = new.household_id and status = 'active'
             and not carry_positive and funds_account_id is not null order by id loop
    v := duo_v3_private.balance(e.funds_account_id);
    if v > 0 then
      perform duo_v3_private.post_system(new.household_id, new.next_period_id, 'funds_sweep', 'fsweep:' || new.period_id || ':' || e.id,
        e.funds_account_id, duo_v3_private.account_of(new.household_id, 'funds_unassigned'), v, p.ends_on);
    end if;
  end loop;
  return null;
end $$;
create trigger duo_v3_period_closes_sweep after insert on public.duo_v3_period_closes
  for each row execute function duo_v3_private.sweep_real_funds();

-- ======================================================================================== R-B5
-- Parcours guidé : ce qu'il faut libérer avant d'annuler une contribution affectée.
create function public.duo_v3_contribution_release_plan(p_household uuid, p_transaction uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; items jsonb := '[]'::jsonb; ok boolean := true; avail numeric; v_prot boolean;
begin
  if not duo_v3_private.is_current_member(p_household) then raise exception 'Not authorized for this household' using errcode = '42501'; end if;
  if not exists (select 1 from public.duo_v3_transactions where id = p_transaction and household_id = p_household and kind = 'contribution' and origin = 'member') then
    raise exception 'Not a contribution of this household' using errcode = '23503';
  end if;
  for r in select x.account_id, a.kind, x.amount_minor, en.id as envelope_id, coalesce(en.protected, false) as prot
           from public.duo_v3_entries x join public.duo_v3_accounts a on a.id = x.account_id
           left join public.duo_v3_envelopes en on en.funds_account_id = a.id
           where x.transaction_id = p_transaction and a.kind in ('funds_unassigned','funds_envelope') order by a.kind, en.id loop
    avail := duo_v3_private.balance(r.account_id);
    items := items || jsonb_build_object('account', case when r.kind = 'funds_unassigned' then 'unassigned' else 'envelope' end,
      'envelopeId', r.envelope_id, 'required', r.amount_minor::text, 'available', avail::text,
      'toRelease', greatest(r.amount_minor - avail, 0)::text, 'protected', r.prot);
    if avail < r.amount_minor or r.prot then ok := false; end if;
  end loop;
  return jsonb_build_object('transactionId', p_transaction, 'cancellable', ok and not exists
           (select 1 from public.duo_v3_transactions where reverses_transaction_id = p_transaction), 'items', items);
end $$;

-- ======================================================================================== R-B4
-- Solde d'ouverture par enveloppe (migration V2) : écriture système qui crée la trésorerie et les fonds
-- réels de l'enveloppe à l'identique (montant signé ; un déficit V2 reste un déficit). Idempotente par clé.
create function duo_v3_private.post_opening_balance(p_household uuid, p_envelope uuid, p_amount numeric, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h record; e record; v_tx uuid; v_period uuid;
begin
  select * into h from public.duo_v3_households where id = p_household for update;
  if not h.funds_tracking then raise exception 'Real funds are not activated for this household' using errcode = '55000'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> trunc(p_amount) then raise exception 'Invalid opening amount' using errcode = '22023'; end if;
  select id into v_tx from public.duo_v3_transactions where household_id = p_household and origin = 'system' and idempotency_key = p_key;
  if found then return v_tx; end if;
  select * into e from public.duo_v3_envelopes where id = p_envelope and household_id = p_household and status = 'active';
  if not found or e.funds_account_id is null then raise exception 'Envelope not eligible in household' using errcode = '23503'; end if;
  v_period := duo_v3_private.ensure_current_period(p_household);
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, origin, period_id, occurred_on)
  values (p_household, h.currency, p_key, 'funds_opening', null, 'system', v_period, (now() at time zone h.time_zone)::date) returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),           h.currency,  p_amount),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'),       h.currency, -p_amount),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'funds_external'), h.currency, -p_amount),
    (v_tx, p_household, e.funds_account_id,                                       h.currency,  p_amount);
  return v_tx;
end $$;

-- B11. Lecture : les dix notions en un seul énoncé. Calcul privé (SECURITY DEFINER, tout le livre : soldes
-- communs égaux, POST006-02) ; accès public réservé aux membres actifs (enveloppe ci-dessous).
create function duo_v3_private.funds_snapshot_all(p_household uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
with h as (select * from public.duo_v3_households where id = p_household),
p as (select * from public.duo_v3_periods where household_id = p_household and state = 'open'),
acc as (select a.id, a.kind from public.duo_v3_accounts a, h where a.household_id = h.id and a.currency = h.currency),
mv as (select x.account_id, t.kind, t.period_id, t.id as tx, x.amount_minor,
              coalesce(o.kind, t.kind) as nature   -- nature de l'opération d'origine pour une annulation
       from public.duo_v3_entries x join public.duo_v3_transactions t on t.id = x.transaction_id
       left join public.duo_v3_transactions o on o.id = t.reverses_transaction_id
       where x.household_id = p_household),
bal as (select acc.id, acc.kind, coalesce(sum(mv.amount_minor), 0) as b from acc left join mv on mv.account_id = acc.id group by acc.id, acc.kind),
xc as (select duo_v3_private.expected_contributions(p_household) as j),
xm as (select (m ->> 'userId')::uuid as member_id, (m ->> 'amount')::numeric as amount from xc, jsonb_array_elements(xc.j -> 'byMember') m),
realized_m as (select t.created_by as member_id, coalesce(sum(mv.amount_minor), 0) as v from mv join public.duo_v3_transactions t on t.id = mv.tx, p, acc
             where mv.account_id = acc.id and acc.kind = 'cash' and mv.period_id = p.id and mv.nature = 'contribution' group by t.created_by),
realized as (select coalesce(sum(mv.amount_minor), 0) as v from mv, p, acc
             where mv.account_id = acc.id and acc.kind = 'cash' and mv.period_id = p.id and mv.nature = 'contribution'),
lines as (
  select e.id, e.name, e.status, e.protected, e.carry_positive,
    coalesce((select v.amount_minor from public.duo_v3_allocation_versions v, p where v.envelope_id = e.id and v.effective_from <= p.starts_on
              order by v.effective_from desc limit 1), 0) as target,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = e.account_id and mv.period_id = p.id and mv.kind = 'allocation'), 0) as allocated,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = e.account_id and (mv.period_id <> p.id or mv.kind = 'carry')), 0) as carry_over,
    coalesce((select -sum(amount_minor) from mv, p where mv.account_id = e.account_id and mv.period_id = p.id and mv.nature = 'expense'), 0) as spent,
    coalesce((select sum(amount_minor) from mv where mv.account_id = e.account_id), 0) as budget_balance,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = e.funds_account_id and mv.period_id = p.id and mv.nature <> 'expense'), 0) as assigned_period,
    coalesce((select sum(amount_minor) from mv where mv.account_id = e.funds_account_id and mv.nature <> 'expense'), 0) as assigned_cumulative,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = e.funds_account_id and mv.period_id <> p.id), 0) as real_carry_over,
    coalesce((select sum(amount_minor) from mv where mv.account_id = e.funds_account_id), 0) as real_available
  from public.duo_v3_envelopes e where e.household_id = p_household)
select pg_catalog.jsonb_build_object(
  'householdId', p_household, 'asOf', pg_catalog.now(), 'currency', (select currency from h),
  'fundsTracking', (select funds_tracking from h),
  'ledgerVersion', (select pg_catalog.count(*) from public.duo_v3_transactions t where t.household_id = p_household),
  'period', (select pg_catalog.jsonb_build_object('periodId', p.id, 'startsOn', p.starts_on, 'endsBefore', p.ends_on) from p),
  'household', pg_catalog.jsonb_build_object(
     'realTreasury',          (select b::text from bal where kind = 'cash'),
     'unassignedRealFunds',   (select b::text from bal where kind = 'funds_unassigned'),
     'assignedRealFunds',     (select coalesce(sum(b), 0)::text from bal where kind = 'funds_envelope'),
     'invariantHolds',        (select coalesce(sum(b) filter (where kind = 'cash'), 0) = coalesce(sum(b) filter (where kind in ('funds_unassigned','funds_envelope')), 0) from bal),
     'budgetReserve',         (select b::text from bal where kind = 'reserve'),
     'expectedContributions', (select case when xc.j ->> 'state' = 'not_configured' then null else xc.j ->> 'total' end from xc),
     'expectedContributionsState', (select xc.j ->> 'state' from xc),
     'expectedByMember', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId', xm.member_id, 'expected', xm.amount::text,
                            'realized', coalesce((select v from realized_m r where r.member_id = xm.member_id), 0)::text) order by xm.member_id), '[]'::jsonb) from xm),
     'realizedContributions', (select v::text from realized),
     'forecastTreasury',      (select case when xc.j ->> 'state' = 'not_configured' then null
                                  else ((select b from bal where kind = 'cash') + coalesce((select sum(greatest(xm.amount - coalesce((select v from realized_m r where r.member_id = xm.member_id), 0), 0)) from xm), 0))::text end from xc),
     'forecastState',         (select case when xc.j ->> 'state' = 'not_configured' then 'not_available' else 'contributions_only' end from xc)),
  'envelopes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'envelopeId', l.id, 'name', l.name, 'status', l.status, 'protectionState', case when l.protected then 'protected' else 'none' end,
      'target', l.target::text, 'budgetAllocation', l.allocated::text, 'carryOver', l.carry_over::text,
      'realizedExpenses', l.spent::text, 'remainingBudget', (l.carry_over + l.target - l.spent)::text, 'budgetBalance', l.budget_balance::text,
      'assignedRealFunds', l.assigned_period::text, 'assignedRealFundsCumulative', l.assigned_cumulative::text,
      'realCarryOver', l.real_carry_over::text, 'realAvailable', l.real_available::text, 'unfundedTarget', greatest(l.target - l.assigned_period, 0)::text,
      'forecastBalance', null, 'forecastState', 'not_available',
      'flags', pg_catalog.to_jsonb(array_remove(array[
          case when l.assigned_period < l.target then 'unfunded_target' end,
          case when l.real_available < 0 then 'real_deficit' end,
          case when l.carry_over + l.target - l.spent < 0 then 'budget_overrun' end,
          case when l.protected then 'protected' end,
          case when l.status = 'archived' then 'archived' end], null)))
      order by l.protected, l.name) from lines l), '[]'::jsonb));
$$;


create function public.duo_v3_get_funds_snapshot(p_household uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when duo_v3_private.is_current_member(p_household) then duo_v3_private.funds_snapshot_all(p_household)
         else pg_catalog.jsonb_build_object('householdId', p_household, 'period', null, 'household', null, 'envelopes', '[]'::jsonb) end;
$$;


-- B12. Droits
revoke all on function duo_v3_private.validate_funds(), duo_v3_private.balance(uuid), duo_v3_private.guard_envelope_funds(),
  duo_v3_private.ensure_funds_account(uuid), duo_v3_private.activate_funds(uuid), duo_v3_private.member_preamble(uuid, text, bytea),
  duo_v3_private.active_envelope(uuid, uuid), duo_v3_private.check_internal_debits(uuid), duo_v3_private.funds_snapshot_all(uuid),
  duo_v3_private.valid_shares(uuid, jsonb), duo_v3_private.expected_contributions(uuid), duo_v3_private.sweep_real_funds(),
  duo_v3_private.post_opening_balance(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.duo_v3_post_contribution_assigned(uuid, numeric, date, text, jsonb), public.duo_v3_move_funds(uuid, uuid, uuid, numeric, text),
  public.duo_v3_set_envelope_protection(uuid, uuid, boolean), public.duo_v3_cancel_transaction(uuid, uuid, text),
  public.duo_v3_restore_transaction(uuid, uuid, text), public.duo_v3_get_funds_snapshot(uuid),
  public.duo_v3_propose_contribution_split(uuid, jsonb, jsonb), public.duo_v3_accept_contribution_split(uuid, uuid),
  public.duo_v3_contribution_release_plan(uuid, uuid) from public, anon;
grant execute on function public.duo_v3_post_contribution_assigned(uuid, numeric, date, text, jsonb), public.duo_v3_move_funds(uuid, uuid, uuid, numeric, text),
  public.duo_v3_set_envelope_protection(uuid, uuid, boolean), public.duo_v3_cancel_transaction(uuid, uuid, text),
  public.duo_v3_restore_transaction(uuid, uuid, text), public.duo_v3_get_funds_snapshot(uuid),
  public.duo_v3_propose_contribution_split(uuid, jsonb, jsonb), public.duo_v3_accept_contribution_split(uuid, uuid),
  public.duo_v3_contribution_release_plan(uuid, uuid) to authenticated;
commit;
