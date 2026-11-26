-- =====================================================================================================
-- Duo Budget V3 — MIGRATION 006 RÉVISÉE · CANDIDATE rev1 (26/11/2026)
-- STATUT : CANDIDATE, NON VALIDÉE, NON APPLIQUÉE. Testée uniquement sur réplique PostgreSQL 17.12 jetable.
-- Ne pas appliquer sur DEV ni en production sans revue indépendante et décision explicite (POST006-01).
--
-- Composition (vérifiable par diff) :
--   1. Corps de la migration 006 ORIGINALE, octet pour octet, sans son « commit; » final
--      (fichier source archivé : supabase/archive/006-original/20261121_006_duo_v3_financial_model.sql, sha256 cd16cf266b4443c0f32321639759e19603d12413bc4ac886e74dea0f630b730e).
--   2. Section « RÉVISION 1 » : correctifs F1 à F7 et compléments R-A2 (récupération administrative) / R-A3 (ordre sous verrou)
--      (aucun nouveau modèle de financement : POST006-03 est traité à part, lot B).
--   3. « commit; » unique : l'ensemble est atomique.
--   F1 rattrapage multi-cycles · F2 clés d'idempotence par auteur, système isolé (CF-06, D6-02)
--   F3 devise du duo garantie, modifiable avant toute opération (CF-11, L14) · F4 unités mineures exactes (P01)
--   F5 scellement des transactions validées (L15) · F6 instantané atomique (C04) · F7 autorisation revérifiée sous verrou
-- =====================================================================================================
-- Duo Budget V3 — Lot 2 : modèle financier (périodes, enveloppes, trésorerie / budget, reports, journal).
-- PROPOSITION NON APPLIQUÉE. Testée uniquement sur une réplique locale PostgreSQL 17.12
-- (v3/database/tests/lot2_*). Ne pas appliquer sur DEV avant validation ; jamais en production.
--
-- Principes
--   * Deux livres dans le même grand livre :
--       trésorerie (book = 'cash')   : cash (argent réel du duo), clearing (monde extérieur)
--       budget     (book = 'budget') : envelope, reserve (réserve commune non affectée, D-014),
--                                     budget_source (allocations de période), budget_spent (dépenses)
--     Chaque transaction s'équilibre DANS CHAQUE LIVRE. Une allocation ou un report ne touche
--     que le livre budget : il ne peut pas créer de trésorerie.
--   * Les soldes d'enveloppe sont cumulatifs : un report positif conservé (D-013) ou un déficit
--     (D-017, D-018) se prolonge naturellement ; seul le reliquat positif sans report part
--     en réserve par une écriture explicite (D-014).
--   * Toute écriture est imputée à une période comptable ouverte ; une période close ne reçoit
--     plus rien (D-029). Une opération tardive est imputée à la période ouverte et garde sa
--     date réelle déclarée (occurred_on), la date de réception serveur (created_at) et son
--     indicateur late_imputation.
--   * Étend 001–005 sans les remplacer ; la RPC duo_v3_post_transfer garde sa signature.
begin;

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

-- =====================================================================================================
-- RÉVISION 1 — correctifs F1 à F7, compléments R-A2 et R-A3 (registre du 26/11, PR #20) (ajoutés après le corps original, dans la même transaction)
-- =====================================================================================================
alter table public.duo_v3_transactions add column posting_xid xid8;
comment on column public.duo_v3_transactions.posting_xid is
  'Sceau F5 : transaction SQL (xid8) ayant créé l''écriture ; seules ses propres lignes peuvent y être ajoutées.';
-- Le contrôle différé ne vérifie plus l'état de la période (elle peut être close plus loin dans la
-- même transaction par un rattrapage légitime) ; l'état est vérifié à l'insertion de l'en-tête.
create or replace function public.duo_v3_validate_posting()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_transaction_id uuid; v_household_id uuid; v_currency text; v_kind text; v_reverses uuid; v_period uuid;
  v_count bigint; v_total numeric;
begin
  if tg_table_name = 'duo_v3_transactions' then v_transaction_id := new.id; else v_transaction_id := new.transaction_id; end if;
  select t.household_id, t.currency, t.kind, t.reverses_transaction_id, t.period_id
    into v_household_id, v_currency, v_kind, v_reverses, v_period
  from public.duo_v3_transactions t where t.id = v_transaction_id;
  select count(*), coalesce(sum(e.amount_minor), 0) into v_count, v_total
  from public.duo_v3_entries e where e.transaction_id = v_transaction_id;
  if v_count < 2 or v_total <> 0 then
    raise exception 'Ledger posting requires at least two balanced entries' using errcode = '23514';
  end if;
  if exists (select 1 from public.duo_v3_entries e join public.duo_v3_accounts a on a.id = e.account_id
             where e.transaction_id = v_transaction_id group by a.book having sum(e.amount_minor) <> 0) then
    raise exception 'Ledger posting must balance within each book (cash, budget)' using errcode = '23514';
  end if;
  if v_period is null then
    raise exception 'Transaction must be imputed to an accounting period' using errcode = '23514';
  end if;
  if v_kind = 'reversal' then
    if not exists (select 1 from public.duo_v3_transactions original
                   where original.id = v_reverses and original.household_id = v_household_id
                     and original.currency = v_currency and original.kind <> 'reversal') then
      raise exception 'Reversal must reference an original in the same household and currency' using errcode = '23514';
    end if;
    if exists (select account_id from (
                 select account_id, amount_minor from public.duo_v3_entries where transaction_id = v_transaction_id
                 union all
                 select account_id, amount_minor from public.duo_v3_entries where transaction_id = v_reverses) combined
               group by account_id having sum(amount_minor) <> 0) then
      raise exception 'Reversal must exactly negate original entries by account' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

create function duo_v3_private.guard_transaction_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- F1 : la période d'imputation doit être ouverte AU MOMENT de l'écriture (même message que 006).
  if new.period_id is not null and not exists (
       select 1 from public.duo_v3_periods p where p.id = new.period_id and p.state = 'open') then
    raise exception 'Accounting period is closed' using errcode = '23514';
  end if;
  -- F5 : l'horodatage de réception est celui de la transaction SQL courante (D-029 : date serveur).
  if new.created_at is distinct from pg_catalog.transaction_timestamp() then
    raise exception 'Transaction reception time is assigned by the server' using errcode = '23514';
  end if;
  -- F5 (scellement) : identifiant 64 bits de la transaction SQL qui crée l'en-tête, imposé par le serveur.
  -- Après le COMMIT, aucune autre transaction ne porte ce numéro : l'écriture est scellée.
  new.posting_xid := pg_catalog.pg_current_xact_id();
  return new;
end;
$$;
create trigger duo_v3_transactions_guard_insert before insert on public.duo_v3_transactions
  for each row execute function duo_v3_private.guard_transaction_insert();

-- ======================================================================================== F5
create function duo_v3_private.guard_entry_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.duo_v3_transactions t
                 where t.id = new.transaction_id and t.posting_xid = pg_catalog.pg_current_xact_id()) then
    raise exception 'Posted transaction cannot receive new entries' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger duo_v3_entries_guard_insert before insert on public.duo_v3_entries
  for each row execute function duo_v3_private.guard_entry_insert();

-- ======================================================================================== F4
-- Domaine sans échelle : une valeur 1.5 est refusée telle quelle, avant tout arrondi.
create domain duo_v3_private.minor_units as numeric
  check (value = trunc(value) and abs(value) <= 99999999999999999999999999999999999999);
drop view public.duo_v3_household_position;
drop view public.duo_v3_envelope_balances;
alter table public.duo_v3_entries alter column amount_minor type duo_v3_private.minor_units;
alter table public.duo_v3_allocation_versions alter column amount_minor type duo_v3_private.minor_units;
alter table public.duo_v3_period_allocations alter column amount_minor type duo_v3_private.minor_units;
alter table public.duo_v3_period_closes alter column allocations_total_minor type duo_v3_private.minor_units,
  alter column to_reserve_total_minor type duo_v3_private.minor_units;
alter table public.duo_v3_period_envelope_closes alter column closing_balance_minor type duo_v3_private.minor_units,
  alter column carried_minor type duo_v3_private.minor_units, alter column to_reserve_minor type duo_v3_private.minor_units;
create view public.duo_v3_envelope_balances with (security_invoker = true) as
select e.id as envelope_id, e.household_id, e.name, e.status, e.carry_positive, e.currency,
       coalesce(sum(x.amount_minor), 0) as balance_minor
from public.duo_v3_envelopes e left join public.duo_v3_entries x on x.account_id = e.account_id group by e.id;
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
       (coalesce(sum(x.amount_minor) filter (where a.kind = 'cash'), 0)
         - coalesce(sum(x.amount_minor) filter (where a.kind in ('envelope','reserve')), 0)) < 0 as funding_alert
from public.duo_v3_accounts a left join public.duo_v3_entries x on x.account_id = a.id group by a.household_id, a.currency;
revoke all on public.duo_v3_envelope_balances, public.duo_v3_household_position from public, anon, authenticated;
grant select on public.duo_v3_envelope_balances, public.duo_v3_household_position to authenticated;

-- ======================================================================================== F3
alter table public.duo_v3_households add constraint duo_v3_households_id_currency_key unique (id, currency);
alter table public.duo_v3_accounts add constraint duo_v3_accounts_household_currency_fkey
  foreign key (household_id, currency) references public.duo_v3_households(id, currency) on update cascade;
alter table public.duo_v3_envelopes drop constraint duo_v3_envelopes_account_id_household_id_currency_fkey;
alter table public.duo_v3_envelopes add constraint duo_v3_envelopes_account_id_household_id_currency_fkey
  foreign key (account_id, household_id, currency) references public.duo_v3_accounts(id, household_id, currency)
  on update cascade on delete restrict;

-- La propagation de la devise (CF-11) ne doit pas être prise pour un changement d'identité d'enveloppe.
create or replace function duo_v3_private.guard_envelope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.duo_v3_accounts a join public.duo_v3_households h on h.id = a.household_id
    where a.id = new.account_id and a.kind = 'envelope' and a.currency = h.currency
  ) then
    raise exception 'Envelope account must be an envelope account in the household currency' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.account_id, new.household_id, new.created_at) <> (old.account_id, old.household_id, old.created_at) then
    raise exception 'Envelope identity cannot change' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency
     and new.currency is distinct from (select h.currency from public.duo_v3_households h where h.id = new.household_id) then
    raise exception 'Envelope identity cannot change' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'archived' and new.status = 'active' then
    raise exception 'Envelope reactivation is handled by D-023 (lot 5)' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.status <> 'active' then
    raise exception 'An envelope is created active' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'archived'
     and (select coalesce(sum(x.amount_minor), 0) from public.duo_v3_entries x where x.account_id = new.account_id) <> 0 then
    raise exception 'Envelope balance must be exactly zero to archive (D-023)' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function duo_v3_private.guard_household_calendar()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- D-011 : calendrier figé dès la première période (inchangé).
  if (new.cycle_start_day, new.time_zone) is distinct from (old.cycle_start_day, old.time_zone)
     and exists (select 1 from public.duo_v3_periods p where p.household_id = old.id) then
    raise exception 'Calendar and currency are frozen once periods exist (D-005, D-011)' using errcode = '23514';
  end if;
  -- CF-11 : devise modifiable tant qu'aucune opération ni allocation non nulle n'existe ; aucune conversion.
  if new.currency is distinct from old.currency and (
       exists (select 1 from public.duo_v3_transactions t where t.household_id = old.id)
       or exists (select 1 from public.duo_v3_allocation_versions v where v.household_id = old.id and v.amount_minor > 0)) then
    raise exception 'Currency is frozen once financial history exists (CF-11)' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ======================================================================================== F2
-- Clés : membres par (duo, auteur, clé) ; système par (duo, clé). Empreinte canonique stockée.
alter table public.duo_v3_transactions add column request_sha256 bytea
  check (request_sha256 is null or length(request_sha256) = 32);
alter table public.duo_v3_transactions drop constraint duo_v3_transactions_household_id_idempotency_key_key;
create unique index duo_v3_member_idempotency on public.duo_v3_transactions(household_id, created_by, idempotency_key)
  where origin = 'member';
create unique index duo_v3_system_idempotency on public.duo_v3_transactions(household_id, idempotency_key)
  where origin = 'system';

create function duo_v3_private.request_hash(p_parts text[])
returns bytea language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.array_to_string(p_parts, chr(31), '∅'), 'UTF8'));
$$;

create or replace function duo_v3_private.post_system(p_household uuid, p_period uuid, p_kind text, p_key text,
  p_debit_account uuid, p_credit_account uuid, p_amount numeric, p_occurred_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; h record;
begin
  select * into h from public.duo_v3_households where id = p_household;
  select id into v_tx from public.duo_v3_transactions
   where household_id = p_household and idempotency_key = p_key and origin = 'system';     -- F2 : jamais une clé membre
  if found then return v_tx; end if;
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, origin, period_id, occurred_on)
  values (p_household, h.currency, p_key, p_kind, null, 'system', p_period, p_occurred_on) returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
  values (v_tx, p_household, p_debit_account, h.currency, -p_amount),
         (v_tx, p_household, p_credit_account, h.currency, p_amount);
  return v_tx;
end;
$$;

-- Les trois RPC : mêmes signatures, mêmes codes et messages qu'en 006 ; seules changent la portée
-- de la clé (auteur) et la comparaison de la charge (empreinte).
create or replace function public.duo_v3_post_transfer(
  p_household uuid, p_from_account uuid, p_to_account uuid, p_amount_minor numeric, p_currency text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_transaction uuid; v_existing record; v_period uuid; v_from record; v_tz text; v_hash bytea;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999
     or p_from_account is null or p_to_account is null or p_from_account = p_to_account
     or p_currency is null or p_currency not in ('EUR','USD','GBP','XAF','XOF','JPY')
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid transfer parameters' using errcode = '22023';
  end if;
  v_hash := duo_v3_private.request_hash(array['transfer', p_from_account::text, p_to_account::text, p_amount_minor::numeric(38,0)::text, p_currency]);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household::text || ':' || v_user::text || ':' || p_idempotency_key, 0));
  perform 1 from public.duo_v3_households where id = p_household for update;
  -- F7 : l'appartenance est revérifiée sous le verrou du duo (un départ concurrent prend le même verrou).
  if not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  select t.id, t.request_sha256 into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.created_by = v_user and t.origin = 'member' and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_sha256 is distinct from v_hash then
      raise exception 'Idempotency key reused for different transfer' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  v_period := duo_v3_private.ensure_current_period(p_household);
  perform 1 from public.duo_v3_accounts a
   where a.id in (p_from_account, p_to_account) and a.household_id = p_household and a.currency = p_currency
     and a.kind in ('envelope','reserve')
     and not exists (select 1 from public.duo_v3_envelopes en where en.account_id = a.id and en.status <> 'active')
   order by a.id for update;
  if (select count(*) from public.duo_v3_accounts a
      where a.id in (p_from_account, p_to_account) and a.household_id = p_household and a.currency = p_currency
        and a.kind in ('envelope','reserve')
        and not exists (select 1 from public.duo_v3_envelopes en where en.account_id = a.id and en.status <> 'active')) <> 2 then
    raise exception 'Accounts not eligible in household/currency' using errcode = '23503';
  end if;
  select a.kind into v_from from public.duo_v3_accounts a where a.id = p_from_account;
  if v_from.kind = 'reserve' and (select coalesce(sum(e.amount_minor), 0) from public.duo_v3_entries e where e.account_id = p_from_account) < p_amount_minor then
    raise exception 'Insufficient unallocated reserve (D-015)' using errcode = '23514';
  end if;
  if v_from.kind = 'envelope' and (select coalesce(sum(e.amount_minor), 0) from public.duo_v3_entries e where e.account_id = p_from_account) < p_amount_minor then
    raise exception 'Insufficient envelope balance: a transfer cannot create a deficit' using errcode = '23514';
  end if;
  select h.time_zone into v_tz from public.duo_v3_households h where h.id = p_household;
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, request_sha256)
  values (p_household, p_currency, p_idempotency_key, 'transfer', v_user, v_period, (now() at time zone v_tz)::date, v_hash)
  returning id into v_transaction;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor)
  values (v_transaction, p_household, p_from_account, p_currency, -p_amount_minor),
         (v_transaction, p_household, p_to_account, p_currency, p_amount_minor);
  return v_transaction;
end;
$$;

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
  -- F7 : l'appartenance est revérifiée sous le verrou du duo (un départ concurrent prend le même verrou).
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
  return v_tx;
end;
$$;

create or replace function public.duo_v3_post_contribution(
  p_household uuid, p_amount_minor numeric, p_occurred_on date, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_existing record; v_period record; v_period_id uuid; h record; v_tx uuid; v_hash bytea;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor <> trunc(p_amount_minor)
     or p_amount_minor > 99999999999999999999999999999999999999 or p_occurred_on is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'Invalid contribution parameters' using errcode = '22023';
  end if;
  v_hash := duo_v3_private.request_hash(array['contribution', p_amount_minor::numeric(38,0)::text, p_occurred_on::text]);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household::text || ':' || v_user::text || ':' || p_idempotency_key, 0));
  perform 1 from public.duo_v3_households where id = p_household for update;
  -- F7 : l'appartenance est revérifiée sous le verrou du duo (un départ concurrent prend le même verrou).
  if not duo_v3_private.is_member(p_household, v_user) then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
  select * into h from public.duo_v3_households where id = p_household;
  select t.id, t.request_sha256 into v_existing from public.duo_v3_transactions t
   where t.household_id = p_household and t.created_by = v_user and t.origin = 'member' and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_sha256 is distinct from v_hash then
      raise exception 'Idempotency key reused for different contribution' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  if p_occurred_on > (now() at time zone h.time_zone)::date then
    raise exception 'A contribution cannot be dated in the future' using errcode = '22023';
  end if;
  v_period_id := duo_v3_private.ensure_current_period(p_household);
  select * into v_period from public.duo_v3_periods where id = v_period_id;
  insert into public.duo_v3_transactions (household_id, currency, idempotency_key, kind, created_by, period_id, occurred_on, late_imputation, request_sha256)
  values (p_household, h.currency, p_idempotency_key, 'contribution', v_user, v_period.id, p_occurred_on, p_occurred_on < v_period.starts_on, v_hash)
  returning id into v_tx;
  insert into public.duo_v3_entries (transaction_id, household_id, account_id, currency, amount_minor) values
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'cash'),     h.currency,  p_amount_minor),
    (v_tx, p_household, duo_v3_private.account_of(p_household, 'clearing'), h.currency, -p_amount_minor);
  return v_tx;
end;
$$;

-- ======================================================================================== F6
-- Un seul énoncé SQL = un seul instantané ; RLS des tables appliquée (security invoker).
create function public.duo_v3_get_envelope_snapshot(p_household uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
with p as (select * from public.duo_v3_periods where household_id = p_household and state = 'open'),
prev as (select pc.period_id from public.duo_v3_period_closes pc, p where pc.next_period_id = p.id),
env as (select e.* from public.duo_v3_envelopes e where e.household_id = p_household),
mv as (
  select x.account_id, t.kind, t.period_id, x.amount_minor
  from public.duo_v3_entries x join public.duo_v3_transactions t on t.id = x.transaction_id
  where x.household_id = p_household),
lines as (
  select env.id as envelope_id, env.name, env.status, env.carry_positive,
    coalesce((select sum(amount_minor) from mv where mv.account_id = env.account_id), 0) as actual,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = env.account_id and mv.period_id <> p.id), 0)
      + coalesce((select sum(amount_minor) from mv, p where mv.account_id = env.account_id and mv.period_id = p.id and mv.kind = 'carry'), 0) as carry_over,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = env.account_id and mv.period_id = p.id and mv.kind = 'allocation'), 0) as allocated,
    coalesce((select v.amount_minor from public.duo_v3_allocation_versions v, p where v.envelope_id = env.id and v.effective_from <= p.starts_on
              order by v.effective_from desc limit 1), 0) as target,
    coalesce((select -sum(amount_minor) from mv, p where mv.account_id = env.account_id and mv.period_id = p.id and mv.kind = 'expense'), 0) as spent,
    coalesce((select sum(amount_minor) from mv, p where mv.account_id = env.account_id and mv.period_id = p.id and mv.kind in ('transfer','reversal')), 0) as internal
  from env)
select pg_catalog.jsonb_build_object(
  'householdId', p_household, 'scope', 'common', 'asOf', pg_catalog.now(),
  'ledgerVersion', (select pg_catalog.count(*) from public.duo_v3_transactions t where t.household_id = p_household),
  'period', (select pg_catalog.jsonb_build_object('periodId', p.id, 'startsOn', p.starts_on, 'endsBefore', p.ends_on) from p),
  'currency', (select h.currency from public.duo_v3_households h where h.id = p_household),
  'position', (select pg_catalog.to_jsonb(pos) - 'household_id' - 'currency' from public.duo_v3_household_position pos
               join public.duo_v3_households h on h.id = pos.household_id and h.currency = pos.currency where pos.household_id = p_household),
  'envelopes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'envelopeId', l.envelope_id, 'name', l.name, 'status', l.status, 'carryPositive', l.carry_positive,
      'target', l.target::text, 'allocated', l.allocated::text, 'carryOver', l.carry_over::text, 'realizedExpenses', l.spent::text,
      'netInternalMovements', l.internal::text, 'budgetBalance', l.actual::text,
      'realAvailable', null, 'realAvailableState', 'not_available',   -- POST006-04 : 006 ne modélise pas les fonds réels par enveloppe
      'remainingBudget', (l.carry_over + l.target - l.spent)::text,
      'plannedContributions', null, 'plannedExpenses', null, 'forecastBalance', null, 'protectionState', 'unsupported')
      order by l.name) from lines l), '[]'::jsonb));
$$;
revoke all on function public.duo_v3_get_envelope_snapshot(uuid) from public, anon;
grant execute on function public.duo_v3_get_envelope_snapshot(uuid) to authenticated;

revoke all on function duo_v3_private.guard_transaction_insert(), duo_v3_private.guard_entry_insert(),
  duo_v3_private.request_hash(text[]) from public, anon, authenticated;
-- ======================================================================================== R-A3
-- Ordre temporel établi SOUS VERROU (registre 26/11, R-A3). created_at reste la date de réception
-- (début de la transaction SQL, D-029) ; posted_at est l'instant d'inscription, pris au moment de
-- l'INSERT, c'est-à-dire après le verrou du duo dans les RPC ; ledger_seq donne un ordre total
-- cohérent avec l'ordre de validation pour les écritures d'un même duo (sérialisées par ce verrou).
alter table public.duo_v3_transactions
  add column posted_at timestamptz,
  add column ledger_seq bigint generated always as identity;
comment on column public.duo_v3_transactions.posted_at is
  'R-A3 : instant d''inscription sous verrou (clock_timestamp), base des frontières d''épisodes d''appartenance';
comment on column public.duo_v3_transactions.ledger_seq is
  'R-A3 : ordre total d''inscription ; monotone par duo pour les écritures passées par les RPC';
create or replace function duo_v3_private.guard_transaction_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.period_id is not null and not exists (
       select 1 from public.duo_v3_periods p where p.id = new.period_id and p.state = 'open') then
    raise exception 'Accounting period is closed' using errcode = '23514';
  end if;
  if new.created_at is distinct from pg_catalog.transaction_timestamp() then
    raise exception 'Transaction reception time is assigned by the server' using errcode = '23514';
  end if;
  new.posting_xid := pg_catalog.pg_current_xact_id();
  new.posted_at := pg_catalog.clock_timestamp();            -- R-A3 : jamais fourni par l'appelant
  return new;
end;
$$;

-- ======================================================================================== R-A2
-- Plafond conservé : une écriture membre rattrape au plus 120 cycles (inchangé). Au-delà, le refus
-- porte un indice explicite et la récupération est administrative, par lots, hors chemin membre.
create or replace function duo_v3_private.ensure_current_period(p_household uuid, p_now timestamptz default now())
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
    if v_guard > 120 then
      raise exception 'Too many periods to catch up' using errcode = '55000', hint = 'admin_catch_up_required';
    end if;
  end loop;
  return p.id;
end;
$$;

-- Récupération administrative (R-A2) : réservée aux rôles serveur ; idempotente ; p_max cycles par appel.
create function duo_v3_private.admin_catch_up(p_household uuid, p_max int default 120)
returns int language plpgsql security definer set search_path = '' as $$
declare p record; n int := 0;
begin
  if p_max is null or p_max < 1 or p_max > 120 then
    raise exception 'p_max must be between 1 and 120' using errcode = '22023';
  end if;
  perform 1 from public.duo_v3_households where id = p_household for update;
  loop
    exit when n >= p_max;
    select * into p from public.duo_v3_periods where household_id = p_household and state = 'open';
    if not found then raise exception 'Household has no open accounting period' using errcode = '55000'; end if;
    exit when p.ends_at > now();
    perform duo_v3_private.close_period(p_household, p.id, now());
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function duo_v3_private.admin_catch_up(uuid, int) from public, anon, authenticated;

commit;
