-- GÉNÉRÉ par gen_lot2.py (mode dev) — ne pas éditer à la main. Une transaction, terminée par ROLLBACK.
begin;
-- Migration 006 exécutée DANS la transaction (non appliquée)
-- 0. Garde-fou : aucune transaction existante ne doit être déséquilibrée par livre.
do $$
begin
  if exists (
    select 1 from public.duo_v3_entries e
    join public.duo_v3_accounts a on a.id = e.account_id
    group by e.transaction_id,
      case when a.kind in ('cash','clearing') then 'cash' else 'budget' end
    having sum(e.amount_minor) <> 0
  ) then
    raise exception '006 : des transactions existantes mêlent trésorerie et budget ; migration à revoir'
      using errcode = '55000';
  end if;
end $$;

-- 1. Paramètres du duo (D-005, D-011, D-012)
alter table public.duo_v3_households
  add column currency text not null default 'EUR'
    check (currency in ('EUR','USD','GBP','XAF','XOF','JPY')),
  add column cycle_start_day smallint not null default 1
    check (cycle_start_day between 1 and 31),
  add column time_zone text not null default 'Europe/Paris'
    check (length(time_zone) between 1 and 64);

-- 2. Comptes : nouveaux types et livre dérivé
alter table public.duo_v3_accounts drop constraint duo_v3_accounts_kind_check;
alter table public.duo_v3_accounts add constraint duo_v3_accounts_kind_check
  check (kind in ('cash','clearing','envelope','reserve','budget_source','budget_spent'));
alter table public.duo_v3_accounts add column book text
  generated always as (case when kind in ('cash','clearing') then 'cash' else 'budget' end) stored;
-- Un seul compte système de chaque type par duo et par devise.
create unique index duo_v3_one_system_account on public.duo_v3_accounts(household_id, kind, currency)
  where kind in ('cash','clearing','reserve','budget_source','budget_spent');

-- 3. Périodes comptables (D-011, D-012, D-029)
create table public.duo_v3_periods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  starts_on date not null,                -- date locale incluse
  ends_on date not null,                  -- date locale exclue
  starts_at timestamptz not null,         -- bornes dans le fuseau du duo
  ends_at timestamptz not null,
  state text not null default 'open' check (state in ('open','closed')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, starts_on),
  check (ends_on > starts_on and ends_at > starts_at),
  check ((state = 'closed') = (closed_at is not null))
);
create unique index duo_v3_one_open_period on public.duo_v3_periods(household_id) where state = 'open';

-- 4. Enveloppes (D-013) et versions d'allocation (D-008, D-010)
create table public.duo_v3_envelopes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  account_id uuid not null unique,
  currency text not null,
  name text not null check (length(trim(name)) between 1 and 80),
  carry_positive boolean not null default true,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, household_id),
  check ((status = 'archived') = (archived_at is not null)),
  foreign key (account_id, household_id, currency)
    references public.duo_v3_accounts(id, household_id, currency) on delete restrict
);

-- Montant d'allocation en vigueur à partir d'une date de début de période (version, jamais réécrite).
create table public.duo_v3_allocation_versions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  envelope_id uuid not null,
  amount_minor numeric(38,0) not null check (amount_minor >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (envelope_id, effective_from),
  foreign key (envelope_id, household_id) references public.duo_v3_envelopes(id, household_id) on delete restrict
);

-- Allocation effectivement passée en écriture pour une période (une seule par enveloppe et période).
create table public.duo_v3_period_allocations (
  period_id uuid not null,
  envelope_id uuid not null,
  household_id uuid not null,
  amount_minor numeric(38,0) not null check (amount_minor >= 0),
  transaction_id uuid,
  primary key (period_id, envelope_id),
  foreign key (period_id, household_id) references public.duo_v3_periods(id, household_id) on delete restrict,
  foreign key (envelope_id, household_id) references public.duo_v3_envelopes(id, household_id) on delete restrict
);

-- Instantané de clôture par enveloppe : provenance des reports (D-013, D-014, D-017, D-018).
create table public.duo_v3_period_envelope_closes (
  period_id uuid not null,
  envelope_id uuid not null,
  household_id uuid not null,
  closing_balance_minor numeric(38,0) not null,
  carry_positive boolean not null,          -- règle appliquée à cette clôture
  to_reserve_minor numeric(38,0) not null check (to_reserve_minor >= 0),
  carried_minor numeric(38,0) not null,     -- positif conservé ou déficit reporté
  transaction_id uuid,
  primary key (period_id, envelope_id),
  check (closing_balance_minor = carried_minor + to_reserve_minor),
  check (to_reserve_minor = 0 or (closing_balance_minor > 0 and not carry_positive)),
  foreign key (period_id, household_id) references public.duo_v3_periods(id, household_id) on delete restrict,
  foreign key (envelope_id, household_id) references public.duo_v3_envelopes(id, household_id) on delete restrict
);

create table public.duo_v3_period_closes (
  period_id uuid primary key,
  household_id uuid not null,
  next_period_id uuid not null,
  closed_at timestamptz not null,
  envelopes_closed int not null,
  to_reserve_total_minor numeric(38,0) not null,
  allocations_total_minor numeric(38,0) not null,
  foreign key (period_id, household_id) references public.duo_v3_periods(id, household_id) on delete restrict,
  foreign key (next_period_id, household_id) references public.duo_v3_periods(id, household_id) on delete restrict
);

-- 5. Transactions : imputation, date réelle, origine système (D-029)
alter table public.duo_v3_transactions drop constraint duo_v3_transactions_kind_check;
alter table public.duo_v3_transactions add constraint duo_v3_transactions_kind_check
  check (kind in ('expense','income','contribution','transfer','allocation','carry','reversal'));
alter table public.duo_v3_transactions
  add column period_id uuid,
  add column occurred_on date,
  add column late_imputation boolean not null default false,
  add column origin text not null default 'member' check (origin in ('member','system')),
  alter column created_by drop not null,
  add constraint duo_v3_transactions_origin_actor check ((origin = 'system') = (created_by is null)),
  add constraint duo_v3_transactions_system_kinds check (origin = 'member' or kind in ('allocation','carry')),
  add constraint duo_v3_transactions_period_fkey foreign key (period_id, household_id)
    references public.duo_v3_periods(id, household_id) on delete restrict;
comment on column public.duo_v3_transactions.created_at is 'Date de réception serveur (D-029)';
comment on column public.duo_v3_transactions.occurred_on is 'Date de réalisation déclarée (D-029)';
comment on column public.duo_v3_transactions.period_id is 'Période comptable d''imputation (D-029)';

-- 6. Validation des écritures : équilibre PAR LIVRE et imputation à une période ouverte
create or replace function public.duo_v3_validate_posting()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_transaction_id uuid;
  v_household_id uuid;
  v_currency text;
  v_kind text;
  v_reverses uuid;
  v_period uuid;
  v_count bigint;
  v_total numeric;
begin
  if tg_table_name = 'duo_v3_transactions' then
    v_transaction_id := new.id;
  else
    v_transaction_id := new.transaction_id;
  end if;

  select t.household_id, t.currency, t.kind, t.reverses_transaction_id, t.period_id
    into v_household_id, v_currency, v_kind, v_reverses, v_period
  from public.duo_v3_transactions t where t.id = v_transaction_id;

  select count(*), coalesce(sum(e.amount_minor), 0)
    into v_count, v_total
  from public.duo_v3_entries e where e.transaction_id = v_transaction_id;

  if v_count < 2 or v_total <> 0 then
    raise exception 'Ledger posting requires at least two balanced entries'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.duo_v3_entries e
    join public.duo_v3_accounts a on a.id = e.account_id
    where e.transaction_id = v_transaction_id
    group by a.book having sum(e.amount_minor) <> 0
  ) then
    raise exception 'Ledger posting must balance within each book (cash, budget)'
      using errcode = '23514';
  end if;

  if v_period is null then
    raise exception 'Transaction must be imputed to an accounting period'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.duo_v3_periods p where p.id = v_period and p.state = 'open') then
    raise exception 'Accounting period is closed' using errcode = '23514';
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

-- 7. Immuabilité des nouvelles tables financières
create function duo_v3_private.reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Accounting history is immutable (%)', tg_table_name using errcode = '23514';
end;
$$;

-- Une période ne peut que passer de « ouverte » à « close » ; rien d'autre ne change.
create function duo_v3_private.guard_period_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'open' and new.state = 'closed' and new.closed_at is not null
     and (new.id, new.household_id, new.starts_on, new.ends_on, new.starts_at, new.ends_at, new.created_at)
       = (old.id, old.household_id, old.starts_on, old.ends_on, old.starts_at, old.ends_at, old.created_at) then
    return new;
  end if;
  raise exception 'Closed or historical accounting period cannot be modified' using errcode = '23514';
end;
$$;
create trigger duo_v3_periods_guard_update before update on public.duo_v3_periods
  for each row execute function duo_v3_private.guard_period_update();

-- Contiguïté : une nouvelle période commence exactement à la fin de la précédente.
create function duo_v3_private.guard_period_insert()
returns trigger language plpgsql set search_path = '' as $$
declare v_last date;
begin
  select max(p.ends_on) into v_last from public.duo_v3_periods p where p.household_id = new.household_id;
  if v_last is not null and new.starts_on <> v_last then
    raise exception 'Accounting periods must be contiguous (expected start %)', v_last using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger duo_v3_periods_contiguous before insert on public.duo_v3_periods
  for each row execute function duo_v3_private.guard_period_insert();

create trigger duo_v3_periods_no_delete before delete on public.duo_v3_periods
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_allocation_versions_immutable before update or delete on public.duo_v3_allocation_versions
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_allocations_immutable before update or delete on public.duo_v3_period_allocations
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_envelope_closes_immutable before update or delete on public.duo_v3_period_envelope_closes
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_closes_immutable before update or delete on public.duo_v3_period_closes
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_envelopes_no_delete before delete on public.duo_v3_envelopes
  for each row execute function duo_v3_private.reject_mutation();
create trigger duo_v3_periods_no_truncate before truncate on public.duo_v3_periods
  for each statement execute function duo_v3_private.reject_mutation();
create trigger duo_v3_envelopes_no_truncate before truncate on public.duo_v3_envelopes
  for each statement execute function duo_v3_private.reject_mutation();
create trigger duo_v3_allocation_versions_no_truncate before truncate on public.duo_v3_allocation_versions
  for each statement execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_allocations_no_truncate before truncate on public.duo_v3_period_allocations
  for each statement execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_envelope_closes_no_truncate before truncate on public.duo_v3_period_envelope_closes
  for each statement execute function duo_v3_private.reject_mutation();
create trigger duo_v3_period_closes_no_truncate before truncate on public.duo_v3_period_closes
  for each statement execute function duo_v3_private.reject_mutation();

-- Le compte d'une enveloppe est un compte « envelope » de la devise du duo.
create function duo_v3_private.guard_envelope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.duo_v3_accounts a join public.duo_v3_households h on h.id = a.household_id
    where a.id = new.account_id and a.kind = 'envelope' and a.currency = h.currency
  ) then
    raise exception 'Envelope account must be an envelope account in the household currency' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.account_id, new.household_id, new.currency, new.created_at)
       <> (old.account_id, old.household_id, old.currency, old.created_at) then
    raise exception 'Envelope identity cannot change' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'archived' and new.status = 'active' then
    raise exception 'Envelope reactivation is handled by D-023 (lot 5)' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.status <> 'active' then
    raise exception 'An envelope is created active' using errcode = '23514';
  end if;
  -- Arbitrage du 21/11/2026 : l'archivage ne déplace jamais d'argent ; solde exactement nul exigé.
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'archived'
     and (select coalesce(sum(x.amount_minor), 0) from public.duo_v3_entries x where x.account_id = new.account_id) <> 0 then
    raise exception 'Envelope balance must be exactly zero to archive (D-023)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger duo_v3_envelopes_guard before insert or update on public.duo_v3_envelopes
  for each row execute function duo_v3_private.guard_envelope();

-- Le jour de début et le fuseau ne changent plus une fois une période créée (D-011 : workflow dédié).
create function duo_v3_private.guard_household_calendar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.cycle_start_day, new.time_zone, new.currency) is distinct from (old.cycle_start_day, old.time_zone, old.currency)
     and exists (select 1 from public.duo_v3_periods p where p.household_id = old.id) then
    raise exception 'Calendar and currency are frozen once periods exist (D-005, D-011)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger duo_v3_households_calendar_guard before update on public.duo_v3_households
  for each row execute function duo_v3_private.guard_household_calendar();

-- 8. Calendrier (D-011, D-012) : début inclus, fin exclue, dans le fuseau du duo
create function duo_v3_private.cycle_boundary(p_day smallint, p_year int, p_month int)
returns date language sql immutable set search_path = '' as $$
  select make_date(p_year, p_month, least(p_day::int,
    extract(day from (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day'))::int));
$$;

create function duo_v3_private.cycle_containing(p_day smallint, p_local date, out starts_on date, out ends_on date)
language plpgsql immutable set search_path = '' as $$
declare m date := date_trunc('month', p_local)::date;
begin
  starts_on := duo_v3_private.cycle_boundary(p_day, extract(year from m)::int, extract(month from m)::int);
  if p_local < starts_on then
    m := (m - interval '1 month')::date;
    starts_on := duo_v3_private.cycle_boundary(p_day, extract(year from m)::int, extract(month from m)::int);
  end if;
  m := (date_trunc('month', starts_on) + interval '1 month')::date;
  ends_on := duo_v3_private.cycle_boundary(p_day, extract(year from m)::int, extract(month from m)::int);
end;
$$;

create function duo_v3_private.create_period(p_household uuid, p_starts_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; b record; v_id uuid;
begin
  select * into h from public.duo_v3_households where id = p_household;
  select * into b from duo_v3_private.cycle_containing(h.cycle_start_day, p_starts_on);
  if b.starts_on <> p_starts_on and exists (select 1 from public.duo_v3_periods where household_id = p_household) then
    raise exception 'Period start % is not a cycle boundary', p_starts_on using errcode = '23514';
  end if;
  insert into public.duo_v3_periods (household_id, starts_on, ends_on, starts_at, ends_at)
  values (p_household, b.starts_on, b.ends_on,
          b.starts_on::timestamp at time zone h.time_zone, b.ends_on::timestamp at time zone h.time_zone)
  returning id into v_id;
  return v_id;
end;
$$;

-- 9. Comptes système et enveloppes (fonctions serveur, non exposées aux clients)
create function duo_v3_private.account_of(p_household uuid, p_kind text)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.duo_v3_accounts a join public.duo_v3_households h on h.id = a.household_id
  where a.household_id = p_household and a.kind = p_kind and a.currency = h.currency;
$$;

create function duo_v3_private.bootstrap_household(p_household uuid, p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; k text; v_period uuid;
begin
  select * into h from public.duo_v3_households where id = p_household for update;
  if not found then raise exception 'Unknown household' using errcode = '23503'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = h.time_zone) then
    raise exception 'Unknown time zone %', h.time_zone using errcode = '22023';
  end if;
  foreach k in array array['cash','clearing','reserve','budget_source','budget_spent'] loop
    if duo_v3_private.account_of(p_household, k) is null then
      insert into public.duo_v3_accounts (household_id, label, kind, currency)
      values (p_household, k, k, h.currency);
    end if;
  end loop;
  select id into v_period from public.duo_v3_periods where household_id = p_household and state = 'open';
  if v_period is null and not exists (select 1 from public.duo_v3_periods where household_id = p_household) then
    v_period := duo_v3_private.create_period(p_household,
      (duo_v3_private.cycle_containing(h.cycle_start_day, (p_now at time zone h.time_zone)::date)).starts_on);
  end if;
  return v_period;
end;
$$;

create function duo_v3_private.create_envelope(p_household uuid, p_name text, p_carry_positive boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; v_account uuid; v_env uuid;
begin
  select * into h from public.duo_v3_households where id = p_household;
  insert into public.duo_v3_accounts (household_id, label, kind, currency)
  values (p_household, left(p_name, 120), 'envelope', h.currency) returning id into v_account;
  insert into public.duo_v3_envelopes (household_id, account_id, currency, name, carry_positive)
  values (p_household, v_account, h.currency, p_name, p_carry_positive) returning id into v_env;
  return v_env;
end;
$$;

-- Version d'allocation : s'applique à partir de la prochaine période (D-010) sauf si l'appelant
-- système fournit explicitement une date (création initiale, tests).
create function duo_v3_private.set_allocation(p_envelope uuid, p_amount_minor numeric, p_effective_from date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e record; v_id uuid;
begin
  if p_amount_minor is null or p_amount_minor < 0 or p_amount_minor <> trunc(p_amount_minor) then
    raise exception 'Invalid allocation amount' using errcode = '22023';
  end if;
  select * into e from public.duo_v3_envelopes where id = p_envelope;
  if not found then raise exception 'Unknown envelope' using errcode = '23503'; end if;
  if e.status <> 'active' then
    raise exception 'Archived envelope cannot receive an allocation (D-023)' using errcode = '23514';
  end if;
  insert into public.duo_v3_allocation_versions (household_id, envelope_id, amount_minor, effective_from)
  values (e.household_id, p_envelope, p_amount_minor, p_effective_from) returning id into v_id;
  return v_id;
end;
$$;

-- Exécution d'un archivage : sous le verrou du duo, atomique, refusée si le solde n'est pas
-- exactement nul au moment de l'exécution. Le workflow de demande (statut « À revoir ») relève
-- du lot 5 (D-028) : il appellera cette fonction et capturera son refus sans effet partiel.
create function duo_v3_private.archive_envelope(p_envelope uuid, p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  select * into e from public.duo_v3_envelopes where id = p_envelope;
  if not found then raise exception 'Unknown envelope' using errcode = '23503'; end if;
  perform 1 from public.duo_v3_households where id = e.household_id for update;
  select * into e from public.duo_v3_envelopes where id = p_envelope for update;
  if e.status = 'archived' then return e.id; end if;                       -- idempotent
  update public.duo_v3_envelopes set status = 'archived', archived_at = p_now where id = p_envelope;
  return e.id;
end;
$$;

-- Écriture système (allocation, report) : origine 'system', pas d'auteur membre.
create function duo_v3_private.post_system(p_household uuid, p_period uuid, p_kind text, p_key text,
  p_debit_account uuid, p_credit_account uuid, p_amount numeric, p_occurred_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; h record;
begin
  select * into h from public.duo_v3_households where id = p_household;
  select id into v_tx from public.duo_v3_transactions where household_id = p_household and idempotency_key = p_key;
  if found then return v_tx; end if;
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, origin, period_id, occurred_on)
  values (p_household, h.currency, p_key, p_kind, null, 'system', p_period, p_occurred_on) returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
  values (v_tx, p_household, p_debit_account, h.currency, -p_amount),
         (v_tx, p_household, p_credit_account, h.currency, p_amount);
  return v_tx;
end;
$$;

-- Allocations d'une période : une seule écriture par enveloppe active (idempotent).
create function duo_v3_private.post_period_allocations(p_household uuid, p_period uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare p record; e record; v_amount numeric; v_tx uuid; v_total numeric := 0;
begin
  select * into p from public.duo_v3_periods where id = p_period and household_id = p_household;
  for e in select * from public.duo_v3_envelopes where household_id = p_household and status = 'active' order by id loop
    if exists (select 1 from public.duo_v3_period_allocations where period_id = p_period and envelope_id = e.id) then
      continue;
    end if;
    select v.amount_minor into v_amount from public.duo_v3_allocation_versions v
     where v.envelope_id = e.id and v.effective_from <= p.starts_on
     order by v.effective_from desc limit 1;
    v_amount := coalesce(v_amount, 0);
    v_tx := null;
    if v_amount > 0 then
      v_tx := duo_v3_private.post_system(p_household, p_period, 'allocation',
        'alloc:' || p_period || ':' || e.id,
        duo_v3_private.account_of(p_household, 'budget_source'), e.account_id, v_amount, p.starts_on);
    end if;
    insert into public.duo_v3_period_allocations (period_id, envelope_id, household_id, amount_minor, transaction_id)
    values (p_period, e.id, p_household, v_amount, v_tx);
    v_total := v_total + v_amount;
  end loop;
  return v_total;
end;
$$;

-- 10. Clôture d'une période (D-029 étapes 1, 2, 5, 6 ; étapes 3–4 aux lots 4–5)
create function duo_v3_private.close_period(p_household uuid, p_period uuid, p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare p record; v_next uuid; e record; v_bal numeric; v_res numeric; v_tx uuid;
        v_count int := 0; v_res_total numeric := 0; v_alloc numeric;
begin
  perform 1 from public.duo_v3_households where id = p_household for update;   -- sérialise les clôtures du duo
  select * into p from public.duo_v3_periods where id = p_period and household_id = p_household for update;
  if not found then raise exception 'Unknown period' using errcode = '23503'; end if;
  if p.state = 'closed' then                                                     -- idempotence
    return (select next_period_id from public.duo_v3_period_closes where period_id = p_period);
  end if;
  if p_now < p.ends_at then
    raise exception 'Period % ends at %, cannot close at %', p_period, p.ends_at, p_now using errcode = '55000';
  end if;

  -- 1. Figer la période à l'instant serveur
  update public.duo_v3_periods set state = 'closed', closed_at = p_now where id = p_period;
  -- 6a. Ouvrir la période suivante (contiguë)
  v_next := duo_v3_private.create_period(p_household, p.ends_on);

  -- 5. Reports (D-013, D-014, D-017, D-018) : soldes cumulatifs
  for e in select * from public.duo_v3_envelopes where household_id = p_household and status = 'active' order by id loop
    select coalesce(sum(amount_minor), 0) into v_bal from public.duo_v3_entries where account_id = e.account_id;
    v_res := case when v_bal > 0 and not e.carry_positive then v_bal else 0 end;   -- jamais un déficit vers la réserve
    v_tx := null;
    if v_res > 0 then
      v_tx := duo_v3_private.post_system(p_household, v_next, 'carry',
        'carry:' || p_period || ':' || e.id, e.account_id,
        duo_v3_private.account_of(p_household, 'reserve'), v_res, p.ends_on);
    end if;
    insert into public.duo_v3_period_envelope_closes
      (period_id, envelope_id, household_id, closing_balance_minor, carry_positive, to_reserve_minor, carried_minor, transaction_id)
    values (p_period, e.id, p_household, v_bal, e.carry_positive, v_res, v_bal - v_res, v_tx);
    v_count := v_count + 1;
    v_res_total := v_res_total + v_res;
  end loop;

  -- 6b. Allocations de la nouvelle période
  v_alloc := duo_v3_private.post_period_allocations(p_household, v_next);

  insert into public.duo_v3_period_closes
    (period_id, household_id, next_period_id, closed_at, envelopes_closed, to_reserve_total_minor, allocations_total_minor)
  values (p_period, p_household, v_next, p_now, v_count, v_res_total, v_alloc);
  return v_next;
end;
$$;

-- Clôture paresseuse : avant toute écriture, rattrape les périodes échues (idempotent).
create function duo_v3_private.ensure_current_period(p_household uuid, p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare p record; v_guard int := 0;
begin
  loop
    select * into p from public.duo_v3_periods where household_id = p_household and state = 'open';
    if not found then
      raise exception 'Household has no open accounting period (bootstrap required)' using errcode = '55000';
    end if;
    exit when p.ends_at > p_now;
    perform duo_v3_private.close_period(p_household, p.id, p_now);
    v_guard := v_guard + 1;
    if v_guard > 120 then raise exception 'Too many periods to catch up' using errcode = '55000'; end if;
  end loop;
  return p.id;
end;
$$;

-- 11. RPC clientes (droits EXECUTE explicites, cf. 005)
-- 11a. Transfert (contrat conservé : même signature, mêmes codes d'erreur ; périmètre restreint)
create or replace function public.duo_v3_post_transfer(
  p_household uuid, p_from_account uuid, p_to_account uuid,
  p_amount_minor numeric, p_currency text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_transaction uuid;
  v_existing record;
  v_period uuid;
  v_from record;
  v_tz text;
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
  -- Lot 2 : toutes les écritures d'un duo sont sérialisées avec sa clôture et ses archivages
  -- (même verrou de ligne que close_period) ; une écriture ne peut pas échapper à un instantané.
  perform 1 from public.duo_v3_households where id = p_household for update;
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
  v_period := duo_v3_private.ensure_current_period(p_household);
  -- Lot 2 : un transfert est une réaffectation budgétaire (enveloppe ou réserve) ; il ne touche
  -- jamais la trésorerie. Les enveloppes archivées sont exclues.
  perform 1 from public.duo_v3_accounts a
   where a.id in (p_from_account, p_to_account)
     and a.household_id = p_household and a.currency = p_currency
     and a.kind in ('envelope','reserve')
     and not exists (select 1 from public.duo_v3_envelopes en where en.account_id = a.id and en.status <> 'active')
   order by a.id for update;
  if (select count(*) from public.duo_v3_accounts a
      where a.id in (p_from_account, p_to_account)
        and a.household_id = p_household and a.currency = p_currency
        and a.kind in ('envelope','reserve')
        and not exists (select 1 from public.duo_v3_envelopes en where en.account_id = a.id and en.status <> 'active')) <> 2 then
    raise exception 'Accounts not eligible in household/currency' using errcode = '23503';
  end if;
  select a.kind into v_from from public.duo_v3_accounts a where a.id = p_from_account;
  if v_from.kind = 'reserve'
     and (select coalesce(sum(e.amount_minor), 0) from public.duo_v3_entries e where e.account_id = p_from_account) < p_amount_minor then
    raise exception 'Insufficient unallocated reserve (D-015)' using errcode = '23514';
  end if;
  -- Arbitrage du 21/11/2026 : seul une dépense peut créer un dépassement ; un transfert ne rend
  -- jamais une enveloppe négative (ni ne prélève une enveloppe déjà négative).
  if v_from.kind = 'envelope'
     and (select coalesce(sum(e.amount_minor), 0) from public.duo_v3_entries e where e.account_id = p_from_account) < p_amount_minor then
    raise exception 'Insufficient envelope balance: a transfer cannot create a deficit' using errcode = '23514';
  end if;
  select h.time_zone into v_tz from public.duo_v3_households h where h.id = p_household;
  insert into public.duo_v3_transactions
    (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on)
    values (p_household, p_currency, p_idempotency_key, 'transfer', v_user, v_period,
            (now() at time zone v_tz)::date)
    returning id into v_transaction;
  insert into public.duo_v3_entries
    (transaction_id, household_id, account_id, currency, amount_minor)
    values (v_transaction, p_household, p_from_account, p_currency, -p_amount_minor),
           (v_transaction, p_household, p_to_account, p_currency, p_amount_minor);
  return v_transaction;
end;
$$;

-- 11b. Dépense commune réalisée (D-016 : dépassement autorisé ; D-029 : imputation tardive)
create function public.duo_v3_post_expense(
  p_household uuid, p_envelope uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_period record;
  v_period_id uuid;
  v_env record;
  h record;
  v_tx uuid;
  v_today date;
begin
  if v_user is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999
     or p_envelope is null or p_occurred_on is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid expense parameters' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household::text || ':' || p_idempotency_key, 0));
  -- Lot 2 : toutes les écritures d'un duo sont sérialisées avec sa clôture et ses archivages
  -- (même verrou de ligne que close_period) ; une écriture ne peut pas échapper à un instantané.
  perform 1 from public.duo_v3_households where id = p_household for update;
  select * into h from public.duo_v3_households where id = p_household;
  select * into v_env from public.duo_v3_envelopes where id = p_envelope and household_id = p_household;
  select t.id into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.idempotency_key = p_idempotency_key;
  if found then
    if not exists (select 1 from public.duo_v3_transactions t
                   join public.duo_v3_entries e on e.transaction_id = t.id
                   where t.id = v_existing and t.kind = 'expense' and t.occurred_on = p_occurred_on
                     and e.account_id = v_env.account_id and e.amount_minor = -p_amount_minor) then
      raise exception 'Idempotency key reused for different expense' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if v_env.id is null then
    raise exception 'Envelope not eligible in household' using errcode = '23503';
  end if;
  if v_env.status <> 'active' then   -- arbitrage : refus explicite, aucun reclassement silencieux
    raise exception 'Envelope is archived (D-023): choose an active envelope' using errcode = '23503',
      hint = 'choose_active_envelope';
  end if;
  v_today := (now() at time zone h.time_zone)::date;
  if p_occurred_on > v_today then
    raise exception 'A completed expense cannot be dated in the future' using errcode = '22023';
  end if;
  -- Deux instructions : la période éventuellement créée par le rattrapage doit être visible.
  v_period_id := duo_v3_private.ensure_current_period(p_household);
  select * into v_period from public.duo_v3_periods where id = v_period_id;
  insert into public.duo_v3_transactions
    (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, late_imputation)
  values (p_household, h.currency, p_idempotency_key, 'expense', v_user, v_period.id, p_occurred_on,
          p_occurred_on < v_period.starts_on)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),         h.currency, -p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'),     h.currency,  p_amount_minor),
    (v_tx, p_household, v_env.account_id,                                       h.currency, -p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'budget_spent'), h.currency,  p_amount_minor);
  return v_tx;
end;
$$;

-- 11c. Versement réel d'un membre au budget commun (trésorerie seule ; D-008 : distinct de l'attendu)
create function public.duo_v3_post_contribution(
  p_household uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_period record;
  v_period_id uuid;
  h record;
  v_tx uuid;
begin
  if v_user is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999 or p_occurred_on is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid contribution parameters' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household::text || ':' || p_idempotency_key, 0));
  -- Lot 2 : toutes les écritures d'un duo sont sérialisées avec sa clôture et ses archivages
  -- (même verrou de ligne que close_period) ; une écriture ne peut pas échapper à un instantané.
  perform 1 from public.duo_v3_households where id = p_household for update;
  select * into h from public.duo_v3_households where id = p_household;
  select t.id into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.idempotency_key = p_idempotency_key;
  if found then
    if not exists (select 1 from public.duo_v3_transactions t join public.duo_v3_entries e on e.transaction_id = t.id
                   where t.id = v_existing and t.kind = 'contribution' and t.created_by = v_user
                     and t.occurred_on = p_occurred_on
                     and e.account_id = duo_v3_private.account_of(p_household, 'cash') and e.amount_minor = p_amount_minor) then
      raise exception 'Idempotency key reused for different contribution' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if p_occurred_on > (now() at time zone h.time_zone)::date then
    raise exception 'A contribution cannot be dated in the future' using errcode = '22023';
  end if;
  -- Deux instructions : la période éventuellement créée par le rattrapage doit être visible.
  v_period_id := duo_v3_private.ensure_current_period(p_household);
  select * into v_period from public.duo_v3_periods where id = v_period_id;
  insert into public.duo_v3_transactions
    (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, late_imputation)
  values (p_household, h.currency, p_idempotency_key, 'contribution', v_user, v_period.id, p_occurred_on,
          p_occurred_on < v_period.starts_on)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),     h.currency,  p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'), h.currency, -p_amount_minor);
  return v_tx;
end;
$$;

-- 12. Lecture : vues calculées (security_invoker : la RLS des tables s'applique)
create view public.duo_v3_envelope_balances with (security_invoker = true) as
select e.id as envelope_id, e.household_id, e.name, e.status, e.carry_positive, e.currency,
       coalesce(sum(x.amount_minor), 0) as balance_minor
from public.duo_v3_envelopes e
left join public.duo_v3_entries x on x.account_id = e.account_id
group by e.id;

-- Position du duo : trésorerie réelle, budget affecté, et écart de financement
-- (écart = trésorerie − (enveloppes + réserve) = versements − allocations ; négatif = versements attendus manquants).
create view public.duo_v3_household_position with (security_invoker = true) as
select a.household_id, a.currency,
       coalesce(sum(x.amount_minor) filter (where a.kind = 'cash'), 0)          as cash_minor,
       coalesce(sum(x.amount_minor) filter (where a.kind = 'envelope'), 0)      as envelopes_minor,
       coalesce(sum(x.amount_minor) filter (where a.kind = 'reserve'), 0)       as reserve_minor,
       -coalesce(sum(x.amount_minor) filter (where a.kind = 'budget_source'), 0) as allocated_minor,
       coalesce(sum(x.amount_minor) filter (where a.kind = 'budget_spent'), 0)  as spent_minor,
       -coalesce(sum(x.amount_minor) filter (where a.kind = 'clearing'), 0)     as net_external_minor,
       coalesce(sum(x.amount_minor) filter (where a.kind = 'cash'), 0)
         - coalesce(sum(x.amount_minor) filter (where a.kind in ('envelope','reserve')), 0) as funding_gap_minor,
       -- Arbitrage : allocation supérieure aux versements autorisée, signalée par une alerte.
       (coalesce(sum(x.amount_minor) filter (where a.kind = 'cash'), 0)
         - coalesce(sum(x.amount_minor) filter (where a.kind in ('envelope','reserve')), 0)) < 0 as funding_alert
from public.duo_v3_accounts a
left join public.duo_v3_entries x on x.account_id = a.id
group by a.household_id, a.currency;

-- 13. Sécurité : RLS en lecture pour les membres, aucune écriture cliente, droits explicites
alter table public.duo_v3_periods enable row level security;
alter table public.duo_v3_envelopes enable row level security;
alter table public.duo_v3_allocation_versions enable row level security;
alter table public.duo_v3_period_allocations enable row level security;
alter table public.duo_v3_period_envelope_closes enable row level security;
alter table public.duo_v3_period_closes enable row level security;

create policy duo_v3_periods_member_read on public.duo_v3_periods for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
create policy duo_v3_envelopes_member_read on public.duo_v3_envelopes for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
create policy duo_v3_allocation_versions_member_read on public.duo_v3_allocation_versions for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
create policy duo_v3_period_allocations_member_read on public.duo_v3_period_allocations for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
create policy duo_v3_period_envelope_closes_member_read on public.duo_v3_period_envelope_closes for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
create policy duo_v3_period_closes_member_read on public.duo_v3_period_closes for select to authenticated
  using (duo_v3_private.is_current_member(household_id));

revoke all on public.duo_v3_periods, public.duo_v3_envelopes, public.duo_v3_allocation_versions,
  public.duo_v3_period_allocations, public.duo_v3_period_envelope_closes, public.duo_v3_period_closes,
  public.duo_v3_envelope_balances, public.duo_v3_household_position
  from public, anon, authenticated;
grant select on public.duo_v3_periods, public.duo_v3_envelopes, public.duo_v3_allocation_versions,
  public.duo_v3_period_allocations, public.duo_v3_period_envelope_closes, public.duo_v3_period_closes,
  public.duo_v3_envelope_balances, public.duo_v3_household_position
  to authenticated;

-- Fonctions serveur : jamais exécutables par les clients.
revoke all on function
  duo_v3_private.reject_mutation(), duo_v3_private.guard_period_update(), duo_v3_private.guard_period_insert(),
  duo_v3_private.guard_envelope(), duo_v3_private.guard_household_calendar(),
  duo_v3_private.cycle_boundary(smallint, int, int), duo_v3_private.cycle_containing(smallint, date),
  duo_v3_private.create_period(uuid, date), duo_v3_private.account_of(uuid, text),
  duo_v3_private.bootstrap_household(uuid, timestamptz), duo_v3_private.create_envelope(uuid, text, boolean),
  duo_v3_private.set_allocation(uuid, numeric, date), duo_v3_private.archive_envelope(uuid, timestamptz),
  duo_v3_private.post_system(uuid, uuid, text, text, uuid, uuid, numeric, date),
  duo_v3_private.post_period_allocations(uuid, uuid), duo_v3_private.close_period(uuid, uuid, timestamptz),
  duo_v3_private.ensure_current_period(uuid, timestamptz)
  from public, anon, authenticated;

-- RPC clientes : droits explicites, authenticated uniquement.
revoke all on function public.duo_v3_post_transfer(uuid, uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.duo_v3_post_expense(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.duo_v3_post_contribution(uuid, numeric, date, text) from public, anon;
grant execute on function public.duo_v3_post_transfer(uuid, uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.duo_v3_post_expense(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.duo_v3_post_contribution(uuid, numeric, date, text) to authenticated;
set local lot2.res = '[]';
create temp table ids(k text primary key, v uuid, n numeric) on commit drop;
grant select on ids to public;
create function pg_temp.u(p text) returns uuid language sql immutable as $f$ select v::uuid from (values ('ha','a0000000-0000-4000-8000-0000000000aa'),('hb','b0000000-0000-4000-8000-0000000000bb'),('hc','c0000000-0000-4000-8000-0000000000cc'),('hd','d0000000-0000-4000-8000-0000000000dd'),('he','e0000000-0000-4000-8000-0000000000ee'),('cam','a1000000-0000-4000-8000-0000000000a1'),('alex','a2000000-0000-4000-8000-0000000000a2'),('cla','c1000000-0000-4000-8000-0000000000c1'),('dom','d1000000-0000-4000-8000-0000000000d1')) m(k,v) where k=p $f$;
create function pg_temp.id(p text) returns uuid language sql stable as $f$ select v from ids where k=p $f$;
create function pg_temp.put(p text, v uuid) returns uuid language sql as $f$ insert into ids(k,v) values (p,v) on conflict (k) do update set v=excluded.v returning v $f$;
create function pg_temp.put_num(p text, v numeric) returns numeric language sql as $f$ select set_config('lot2.'||p, v::text, true)::numeric $f$;
create function pg_temp.rec(p_id text, p_s text, p_m text, p_c boolean, p_t timestamptz) returns void language sql as $f$ select set_config('lot2.res', (current_setting('lot2.res')::jsonb || jsonb_build_array(jsonb_build_object('id',p_id,'role',current_user,'sub',current_setting('request.jwt.claim.sub',true),'obtenu',p_s,'message',left(p_m,240),'controle',p_c,'ms',round(extract(epoch from clock_timestamp()-p_t)*1000,2))))::text, true) $f$;
create function pg_temp.ctx(p_role text, p_sub uuid, p_anon boolean) returns void language sql as $f$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role',p_role,'sub',p_sub,'is_anonymous',case when p_anon then true end))::text, true), set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true), case when p_role<>'postgres' then set_config('role', p_role, true) end $f$;
create function pg_temp.run(p_id text, p_role text, p_sub uuid, p_anon boolean, p_action text, p_check text) returns void language plpgsql as $f$ declare t timestamptz := clock_timestamp(); s text := 'OK'; m text := ''; c boolean; begin perform set_config('role', 'none', true); execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform pg_temp.ctx(p_role, p_sub, p_anon); begin execute 'do $y$ begin ' || p_action || ' end $y$'; execute 'set constraints all immediate'; exception when others then s := sqlstate; m := sqlerrm; end; begin execute 'select (' || p_check || ')' into c; exception when others then c := false; m := m || ' | contrôle : ' || sqlerrm; end; perform pg_temp.rec(p_id, s, m, c, t); perform set_config('role', 'none', true); execute 'set constraints all deferred'; end $f$;
grant execute on function pg_temp.u(text), pg_temp.id(text), pg_temp.put(text,uuid), pg_temp.put_num(text,numeric), pg_temp.rec(text,text,text,boolean,timestamptz), pg_temp.ctx(text,uuid,boolean) to public;
-- Jeu de données fictif
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values (pg_temp.u('cam'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot2-cam@example.invalid','',now(),now()),(pg_temp.u('alex'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot2-alex@example.invalid','',now(),now()),(pg_temp.u('cla'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot2-cla@example.invalid','',now(),now()),(pg_temp.u('dom'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot2-dom@example.invalid','',now(),now());
insert into public.duo_v3_households(id, cycle_start_day, time_zone) values (pg_temp.u('ha'),1,'Europe/Paris'),(pg_temp.u('hb'),1,'Europe/Paris'),(pg_temp.u('hc'),1,'Europe/Paris'),(pg_temp.u('hd'),29,'Europe/Paris'),(pg_temp.u('he'),31,'Europe/Paris');
insert into public.duo_v3_members(household_id,user_id,role) values (pg_temp.u('ha'),pg_temp.u('cam'),'owner'),(pg_temp.u('ha'),pg_temp.u('alex'),'partner'),(pg_temp.u('hb'),pg_temp.u('cla'),'owner'),(pg_temp.u('hc'),pg_temp.u('dom'),'owner');
select pg_temp.run('K01','postgres',null,false,$q$perform 1;$q$,$q$(select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(1::smallint, '2026-12-31')) = '(2026-12-01,2027-01-01)'$q$);
select pg_temp.run('K02','postgres',null,false,$q$perform 1;$q$,$q$(select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(5::smallint, '2026-11-20')) = '(2026-11-05,2026-12-05)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(5::smallint, '2026-11-04')) = '(2026-10-05,2026-11-05)'$q$);
select pg_temp.run('K03','postgres',null,false,$q$perform 1;$q$,$q$(select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(31::smallint, '2027-02-15')) = '(2027-01-31,2027-02-28)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(31::smallint, '2027-03-01')) = '(2027-02-28,2027-03-31)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(31::smallint, '2027-04-29')) = '(2027-03-31,2027-04-30)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(31::smallint, '2027-04-30')) = '(2027-04-30,2027-05-31)'$q$);
select pg_temp.run('K04','postgres',null,false,$q$perform 1;$q$,$q$(select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(29::smallint, '2027-02-28')) = '(2027-02-28,2027-03-29)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(29::smallint, '2028-02-29')) = '(2028-02-29,2028-03-29)' and (select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing(30::smallint, '2027-02-28')) = '(2027-02-28,2027-03-30)'$q$);
reset role;
select duo_v3_private.bootstrap_household(pg_temp.u('hd'), '2026-03-29 12:00+02');
select duo_v3_private.ensure_current_period(pg_temp.u('hd'), '2028-04-15 12:00+02');
select duo_v3_private.bootstrap_household(pg_temp.u('he'), '2027-01-10 12:00+01');
select duo_v3_private.ensure_current_period(pg_temp.u('he'), '2028-04-15 12:00+02');
select pg_temp.run('K05','postgres',null,false,$q$perform 1;$q$,$q$(select starts_at = '2026-03-28 23:00+00' and ends_at = '2026-04-28 22:00+00' from public.duo_v3_periods where household_id=pg_temp.u('hd') and starts_on='2026-03-29')$q$);
select pg_temp.run('K06','postgres',null,false,$q$perform 1;$q$,$q$(select count(*) from public.duo_v3_periods p where p.household_id=pg_temp.u('hd') and p.starts_on <> '2026-03-29' and not exists (select 1 from public.duo_v3_periods q where q.household_id=p.household_id and q.ends_on=p.starts_on))=0 and exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('hd') and starts_on='2027-02-28') and exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('hd') and starts_on='2028-02-29') and (select count(*) from public.duo_v3_periods where household_id=pg_temp.u('hd') and state='open')=1$q$);
select pg_temp.run('K07','postgres',null,false,$q$perform 1;$q$,$q$exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('he') and starts_on='2027-02-28' and ends_on='2027-03-31')$q$);
select pg_temp.run('K08','postgres',null,false,$q$insert into public.duo_v3_periods(household_id,starts_on,ends_on,starts_at,ends_at) values (pg_temp.u('he'),'2030-01-01','2030-02-01','2030-01-01','2030-02-01');$q$,$q$true$q$);
select pg_temp.run('K09','postgres',null,false,$q$update public.duo_v3_periods set state='open', closed_at=null where household_id=pg_temp.u('he') and state='closed' and starts_on='2027-02-28';$q$,$q$true$q$);
select pg_temp.run('K10','postgres',null,false,$q$update public.duo_v3_households set cycle_start_day=5 where id=pg_temp.u('he');$q$,$q$true$q$);
reset role;
select pg_temp.put('p1', duo_v3_private.bootstrap_household(pg_temp.u('ha'), now()));
select duo_v3_private.bootstrap_household(pg_temp.u('hb'), now());
select pg_temp.put('courses',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Courses',  true));
select pg_temp.put('vacances', duo_v3_private.create_envelope(pg_temp.u('ha'),'Vacances', true));
select pg_temp.put('loisirs',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Loisirs',  false));
select pg_temp.put('maison',   duo_v3_private.create_envelope(pg_temp.u('ha'),'Maison',   false));
select pg_temp.put('auto',     duo_v3_private.create_envelope(pg_temp.u('ha'),'Auto',     true));
select pg_temp.put('b_env',    duo_v3_private.create_envelope(pg_temp.u('hb'),'B Courses',true));
select duo_v3_private.set_allocation(pg_temp.id('courses'),  40000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('vacances'), 30000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('loisirs'),   8000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('loisirs'),  40000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('maison'),   10000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('auto'),     40000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select pg_temp.put_num('cash0', 0);
select pg_temp.put('acc_reserve', duo_v3_private.account_of(pg_temp.u('ha'),'reserve'));
select pg_temp.put('acc_cash', duo_v3_private.account_of(pg_temp.u('ha'),'cash'));
select duo_v3_private.post_period_allocations(pg_temp.u('ha'), pg_temp.id('p1'));
select pg_temp.run('C01','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=0 and (select envelopes_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=128000 and (select allocated_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=128000 and (select funding_gap_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=-128000 and (select funding_alert from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('vacances'))=30000$q$);
select pg_temp.run('C02','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_contribution(pg_temp.u('ha'),70000,(now() at time zone 'Europe/Paris')::date,'c-cam-1');$q$,$q$true$q$);
select pg_temp.run('C02b','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_contribution(pg_temp.u('ha'),58000,(now() at time zone 'Europe/Paris')::date,'c-alex-1');$q$,$q$(select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=128000 and (select envelopes_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=128000 and (select funding_gap_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=0 and not (select funding_alert from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')$q$);
select pg_temp.run('C03','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('loisirs'),11000,(now() at time zone 'Europe/Paris')::date,'e-lois-1');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('loisirs'))=-3000 and (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=117000$q$);
select pg_temp.run('C04','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),5000,(now() at time zone 'Europe/Paris')::date,'e-cou-1');perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('maison'),2000,(now() at time zone 'Europe/Paris')::date,'e-mai-1');perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('auto'),90000,(now() at time zone 'Europe/Paris')::date,'e-aut-1');perform pg_temp.put_num('cash_before_trf', (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR'));perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),2500,'EUR','trf-cv-1');$q$,$q$(select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=current_setting('lot2.cash_before_trf')::numeric and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('courses'))=32500 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('vacances'))=32500$q$);
select pg_temp.run('C05','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') = 128000 - (select spent_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') and (select envelopes_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')+(select reserve_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') = (select allocated_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') - (select spent_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') and (select funding_gap_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') = 128000 - (select allocated_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR') and (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=20000 and (select spent_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=108000$q$);
select pg_temp.run('C06','postgres',null,false,$q$insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id) values ('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),'EUR','x-book','transfer',pg_temp.u('cam'),pg_temp.id('p1'));insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values ('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),duo_v3_private.account_of(pg_temp.u('ha'),'cash'),'EUR',-100),('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),'EUR',100);execute 'set constraints all immediate';$q$,$q$true$q$);
select pg_temp.run('C07','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.id('acc_cash'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),100,'EUR','trf-cash-1');$q$,$q$true$q$);
select pg_temp.run('C08','postgres',null,false,$q$perform 1;$q$,$q$not exists (select 1 from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where e.household_id=pg_temp.u('ha') group by e.transaction_id, a.book having sum(e.amount_minor)<>0)$q$);
reset role;
select pg_temp.put_num('cash_before_close', (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR'));
select pg_temp.put('p2', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p1'),
  (select ends_at + interval '1 second' from public.duo_v3_periods where id=pg_temp.id('p1'))));
select pg_temp.put_num('ntx_after_close', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));
select pg_temp.run('R01','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select carried_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('courses'))=32500 and (select to_reserve_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('courses'))=0 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('courses'))=72500$q$);
select pg_temp.run('R02','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select to_reserve_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('maison'))=8000 and (select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR')=8000 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('maison'))=10000 and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha') and kind='carry')=1$q$);
select pg_temp.run('R03','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select closing_balance_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('loisirs'))=-3000 and (select carried_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('loisirs'))=-3000 and (select to_reserve_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('loisirs'))=0 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('loisirs'))=37000$q$);
select pg_temp.run('R04','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('auto'))=-10000 and (select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR')=8000$q$);
select pg_temp.run('R05','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=current_setting('lot2.cash_before_close')::numeric$q$);
select pg_temp.run('R06','postgres',null,false,$q$perform pg_temp.put('p2bis', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p1'), now() + interval '400 days'));$q$,$q$pg_temp.id('p2bis') = pg_temp.id('p2') and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')) = current_setting('lot2.ntx_after_close')::bigint$q$);
select pg_temp.run('R07','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select count(*) from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1'))=5 and (select carry_positive from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('maison'))=false and (select carry_positive from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('courses'))=true and (select to_reserve_total_minor from public.duo_v3_period_closes where period_id=pg_temp.id('p1'))=8000$q$);
select pg_temp.run('R08','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.id('acc_reserve'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),6000,'EUR','r-vac-1');$q$,$q$(select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR')=2000 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('vacances'))=68500 and (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=current_setting('lot2.cash_before_close')::numeric$q$);
select pg_temp.run('R09','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.id('acc_reserve'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),5000,'EUR','r-vac-2');$q$,$q$(select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR')=2000$q$);
select pg_temp.run('R10','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select allocated_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=288000 and (select funding_gap_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR')=128000-288000$q$);
select pg_temp.run('L01','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),1240,(now() at time zone 'Europe/Paris')::date,'e-late-1');$q$,$q$(select period_id = pg_temp.id('p2') and late_imputation and occurred_on = (now() at time zone 'Europe/Paris')::date and created_at = now() from public.duo_v3_transactions where household_id=pg_temp.u('ha') and idempotency_key='e-late-1')$q$);
select pg_temp.run('L02','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select closing_balance_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p1') and envelope_id=pg_temp.id('courses'))=32500 and (select state from public.duo_v3_periods where id=pg_temp.id('p1'))='closed'$q$);
select pg_temp.run('L03','postgres',null,false,$q$insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id) values ('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),'EUR','late-direct','transfer',pg_temp.u('cam'),pg_temp.id('p1'));insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values ('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),'EUR',-100),('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('vacances')),'EUR',100);execute 'set constraints all immediate';$q$,$q$true$q$);
select pg_temp.run('L04','postgres',null,false,$q$update public.duo_v3_periods set ends_on = ends_on + 1 where id=pg_temp.id('p1');$q$,$q$true$q$);
select pg_temp.run('L05','postgres',null,false,$q$delete from public.duo_v3_periods where id=pg_temp.id('p2');$q$,$q$true$q$);
select pg_temp.run('L06','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),100,(now() at time zone 'Europe/Paris')::date + 1,'e-fut-1');$q$,$q$true$q$);
reset role;
select duo_v3_private.bootstrap_household(pg_temp.u('hc'), now() - interval '75 days');
select pg_temp.run('L07','authenticated',pg_temp.u('dom'),false,$q$perform public.duo_v3_post_contribution(pg_temp.u('hc'),1000,(now() at time zone 'Europe/Paris')::date,'c-hc-1');$q$,$q$(select count(*) from public.duo_v3_period_closes where household_id=pg_temp.u('hc'))>=2 and (select p.starts_at <= now() and now() < p.ends_at and t.late_imputation = false from public.duo_v3_transactions t join public.duo_v3_periods p on p.id=t.period_id where t.household_id=pg_temp.u('hc') and t.idempotency_key='c-hc-1')$q$);
reset role;
select pg_temp.put('p3', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p2'),
  (select ends_at + interval '1 second' from public.duo_v3_periods where id=pg_temp.id('p2'))));
select pg_temp.run('R11','authenticated',pg_temp.u('cam'),false,$q$perform 1;$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('auto'))=30000 and (select to_reserve_minor from public.duo_v3_period_envelope_closes where period_id=pg_temp.id('p2') and envelope_id=pg_temp.id('loisirs'))=37000 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('loisirs'))=40000 and (select count(*) from public.duo_v3_period_envelope_closes where envelope_id=pg_temp.id('auto'))=2$q$);
select pg_temp.run('X01','authenticated',pg_temp.u('cam'),false,$q$insert into public.duo_v3_periods(household_id,starts_on,ends_on,starts_at,ends_at) values (pg_temp.u('ha'),'2031-01-01','2031-02-01','2031-01-01','2031-02-01');$q$,$q$true$q$);
select pg_temp.run('X02','authenticated',pg_temp.u('cam'),false,$q$insert into public.duo_v3_allocation_versions(household_id,envelope_id,amount_minor,effective_from) values (pg_temp.u('ha'),pg_temp.id('courses'),1,'2031-01-01');$q$,$q$true$q$);
select pg_temp.run('X03','authenticated',pg_temp.u('cla'),false,$q$perform 1;$q$,$q$(select count(*) from public.duo_v3_periods where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_envelope_balances where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_household_position where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_period_envelope_closes where household_id=pg_temp.u('ha'))=0 and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('hb'))=1$q$);
select pg_temp.run('X04','anon',null,false,$q$perform count(*) from public.duo_v3_household_position;$q$,$q$true$q$);
select pg_temp.run('X05','authenticated',pg_temp.u('cam'),false,$q$perform duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p3'), now() + interval '400 days');$q$,$q$true$q$);
select pg_temp.run('X06','authenticated',pg_temp.u('cam'),false,$q$perform duo_v3_private.set_allocation(pg_temp.id('courses'), 1, '2031-01-01');$q$,$q$true$q$);
select pg_temp.run('X07','anon',null,false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),100,(now() at time zone 'Europe/Paris')::date,'e-anon-1');$q$,$q$true$q$);
select pg_temp.run('X08','authenticated',pg_temp.u('cla'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),100,(now() at time zone 'Europe/Paris')::date,'e-cla-1');$q$,$q$true$q$);
select pg_temp.run('X09','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('b_env'),100,(now() at time zone 'Europe/Paris')::date,'e-xb-1');$q$,$q$true$q$);
select pg_temp.run('X10','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),777,(now() at time zone 'Europe/Paris')::date,'e-rep-1');perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),777,(now() at time zone 'Europe/Paris')::date,'e-rep-1');$q$,$q$(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha') and idempotency_key='e-rep-1')=1 and (select count(*) from public.duo_v3_entries e join public.duo_v3_transactions t on t.id=e.transaction_id where t.household_id=pg_temp.u('ha') and t.idempotency_key='e-rep-1')=4$q$);
select pg_temp.run('X11','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),778,(now() at time zone 'Europe/Paris')::date,'e-rep-1');$q$,$q$true$q$);
select pg_temp.run('X12','authenticated',pg_temp.u('cam'),true,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('courses'),100,(now() at time zone 'Europe/Paris')::date,'e-anonsess-1');$q$,$q$true$q$);
reset role;
select pg_temp.put('cadeaux',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Cadeaux',  true));
select pg_temp.put('ancienne', duo_v3_private.create_envelope(pg_temp.u('ha'),'Ancienne', true));
select pg_temp.put('temp',     duo_v3_private.create_envelope(pg_temp.u('ha'),'Temporaire', true));
select duo_v3_private.set_allocation(pg_temp.id('temp'),     10000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p3')));
select duo_v3_private.set_allocation(pg_temp.id('ancienne'),  5000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p3')));
select pg_temp.run('S01','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('cadeaux')),5000,'EUR','s-1');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=5000$q$);
reset role;
select pg_temp.put_num('cou_s2', (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('courses')));
select pg_temp.run('S02','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('cadeaux')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),6000,'EUR','s-2');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=5000 and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('courses'))=current_setting('lot2.cou_s2')::numeric$q$);
select pg_temp.run('S03','authenticated',pg_temp.u('alex'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('cadeaux')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),5000,'EUR','s-3');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=0$q$);
select pg_temp.run('S04','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('cadeaux'),3000,(now() at time zone 'Europe/Paris')::date,'s-4');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=-3000$q$);
select pg_temp.run('S05','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('cadeaux')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),100,'EUR','s-5');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=-3000$q$);
reset role;
select pg_temp.put_num('res_s6', (select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR'));
select pg_temp.run('S06','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),pg_temp.id('acc_reserve'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('cadeaux')),2000,'EUR','s-6');$q$,$q$(select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('cadeaux'))=-1000 and (select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id where a.household_id=pg_temp.u('ha') and a.kind='reserve' and a.currency='EUR')=current_setting('lot2.res_s6')::numeric-2000$q$);
reset role;
select pg_temp.put_num('ntx_a0', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));
select pg_temp.run('A01','postgres',null,false,$q$perform duo_v3_private.archive_envelope(pg_temp.id('vacances'));$q$,$q$(select status from public.duo_v3_envelopes where id=pg_temp.id('vacances'))='active' and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_a0')::bigint$q$);
select pg_temp.run('A02','postgres',null,false,$q$update public.duo_v3_envelopes set status='archived', archived_at=now() where id=pg_temp.id('cadeaux');$q$,$q$(select status from public.duo_v3_envelopes where id=pg_temp.id('cadeaux'))='active'$q$);
select pg_temp.run('A03','postgres',null,false,$q$perform duo_v3_private.archive_envelope(pg_temp.id('ancienne'));$q$,$q$(select status='archived' and archived_at is not null from public.duo_v3_envelopes where id=pg_temp.id('ancienne')) and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_a0')::bigint$q$);
select pg_temp.run('A04','postgres',null,false,$q$perform duo_v3_private.archive_envelope(pg_temp.id('ancienne'));$q$,$q$true$q$);
select pg_temp.run('A05','postgres',null,false,$q$perform duo_v3_private.set_allocation(pg_temp.id('ancienne'), 1000, '2031-01-01');$q$,$q$true$q$);
select pg_temp.run('X13','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_expense(pg_temp.u('ha'),pg_temp.id('ancienne'),100,(now() at time zone 'Europe/Paris')::date - 40,'e-arch-1');$q$,$q$(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_a0')::bigint$q$);
select pg_temp.run('X14','authenticated',pg_temp.u('cam'),false,$q$perform public.duo_v3_post_transfer(pg_temp.u('ha'),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('courses')),(select account_id from public.duo_v3_envelopes where id=pg_temp.id('ancienne')),100,'EUR','trf-arch-1');$q$,$q$true$q$);
reset role;
select pg_temp.put_num('ntx_g0', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));
select pg_temp.put_num('temp_before', (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('temp')));
select pg_temp.put_num('p3_end', extract(epoch from (select ends_at from public.duo_v3_periods where id=pg_temp.id('p3'))));
select pg_temp.run('G01','postgres',null,false,$q$perform duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p3'), to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second'); raise exception 'interruption simulée';$q$,$q$(select state from public.duo_v3_periods where id=pg_temp.id('p3'))='open' and not exists (select 1 from public.duo_v3_period_closes where period_id=pg_temp.id('p3')) and (select count(*) from public.duo_v3_periods where household_id=pg_temp.u('ha'))=3 and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_g0')::bigint$q$);
select pg_temp.run('G02','postgres',null,false,$q$perform pg_temp.put('p4', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p3'), to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second'));$q$,$q$(select count(*) from public.duo_v3_period_closes where period_id=pg_temp.id('p3'))=1 and (select count(*) from public.duo_v3_period_allocations where period_id=pg_temp.id('p4'))=7 and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('ha') and status='active')=7 and (select count(*) from public.duo_v3_transactions where period_id=pg_temp.id('p4') and kind='allocation')=6 and (select amount_minor=0 and transaction_id is null from public.duo_v3_period_allocations where period_id=pg_temp.id('p4') and envelope_id=pg_temp.id('cadeaux')) and not exists (select 1 from public.duo_v3_period_allocations where envelope_id=pg_temp.id('ancienne')) and not exists (select 1 from public.duo_v3_period_envelope_closes where envelope_id=pg_temp.id('ancienne')) and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('temp'))=10000$q$);
reset role;
select pg_temp.put_num('ntx_g2', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));
select pg_temp.run('G03','postgres',null,false,$q$perform pg_temp.put('p4b', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p3'), to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second'));perform duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p3'), to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second' + interval '1 hour');perform duo_v3_private.ensure_current_period(pg_temp.u('ha'), to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second');$q$,$q$pg_temp.id('p4b')=pg_temp.id('p4') and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_g2')::bigint and (select count(*) from (select idempotency_key from public.duo_v3_transactions where household_id=pg_temp.u('ha')      and kind in ('carry','allocation') group by 1 having count(*)>1) d)=0$q$);
select pg_temp.run('G04','postgres',null,false,$q$perform duo_v3_private.post_system(pg_temp.u('ha'), pg_temp.id('p4'), 'carry', (select idempotency_key from public.duo_v3_transactions where household_id=pg_temp.u('ha') and kind='carry' order by created_at limit 1), pg_temp.id('acc_reserve'), pg_temp.id('acc_reserve'), 1, current_date);$q$,$q$(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_g2')::bigint$q$);
select pg_temp.run('G05','postgres',null,false,$q$insert into public.duo_v3_period_allocations(period_id,household_id,envelope_id,amount_minor,transaction_id) select period_id,household_id,envelope_id,amount_minor,transaction_id from public.duo_v3_period_allocations where period_id=pg_temp.id('p4') and envelope_id=pg_temp.id('temp');$q$,$q$true$q$);
select pg_temp.run('A06','postgres',null,false,$q$perform duo_v3_private.archive_envelope(pg_temp.id('temp'));$q$,$q$current_setting('lot2.temp_before')::numeric=0 and (select status from public.duo_v3_envelopes where id=pg_temp.id('temp'))='active' and (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('temp'))=10000 and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))=current_setting('lot2.ntx_g2')::bigint$q$);
select pg_temp.run('X15','postgres',null,false,$q$execute 'truncate public.duo_v3_periods cascade';$q$,$q$true$q$);
select pg_temp.run('X16','postgres',null,false,$q$update public.duo_v3_period_envelope_closes set to_reserve_minor=0 where period_id=pg_temp.id('p1');$q$,$q$true$q$);
select pg_temp.run('X17','postgres',null,false,$q$perform 1;$q$,$q$not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where c.relname like 'duo_v3_%' and c.relkind in ('r','v') and (has_table_privilege('anon',c.oid,p) or (p<>'SELECT' and has_table_privilege('authenticated',c.oid,p))))$q$);
select pg_temp.run('X18','postgres',null,false,$q$perform 1;$q$,$q$(select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in  ('duo_v3_post_transfer','duo_v3_post_expense','duo_v3_post_contribution')) and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='duo_v3_private'  and p.proname not in ('is_member','is_current_member') and (has_function_privilege('authenticated',p.oid,'EXECUTE')  or has_function_privilege('anon',p.oid,'EXECUTE')))$q$);
reset role;
select jsonb_build_object('lot','2','horodatage_serveur', now(), 'pg', current_setting('server_version'),
  'schema_006', (select jsonb_build_object('empreinte', empreinte, 'objets', objets) from (select md5(string_agg(x, E'\n' order by x)) as empreinte, count(*) as objets from (
  select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'')||' '||coalesce(generation_expression,'') x
    from information_schema.columns where table_schema in ('public','duo_v3_private') and table_name like 'duo_v3%'
  union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text like '%duo_v3%'
  union all select 'idx '||indexdef from pg_indexes where tablename like 'duo_v3%'
  union all select 'trg '||tgrelid::regclass||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%duo_v3%'
  union all select 'pol '||tablename||' '||policyname||' '||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where tablename like 'duo_v3%'
  union all select 'fun '||n.nspname||'.'||p.proname||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','duo_v3_private') and (p.proname like 'duo_v3%' or n.nspname='duo_v3_private')
  union all select 'acl '||c.relname||' '||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'duo_v3%'
  union all select 'com '||c.relname||'.'||a.attname||' '||col_description(c.oid,a.attnum) from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relname like 'duo_v3%' and col_description(c.oid,a.attnum) is not null
) s) z),
  'resultats', current_setting('lot2.res')::jsonb) as lot2;
rollback;
