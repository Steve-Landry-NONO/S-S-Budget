-- DUO BUDGET V3: REVIEW-ONLY MODEL, NOT A DEPLOYABLE MIGRATION.
-- This is a proposed data contract, not an authorized deployment script.
-- No grants, RLS policies, or exposed RPC are provided. Deny by default.
-- IMPORTANT: run only in a disposable development DB after security review.

create schema if not exists duo_v3_private;

create table duo_v3_private.duos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  budget_start_day smallint not null default 1 check (budget_start_day between 1 and 31),
  lifecycle text not null default 'active' check (lifecycle in ('active','archived')),
  created_at timestamptz not null default now()
);

create table duo_v3_private.memberships (
  duo_id uuid not null references duo_v3_private.duos(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (duo_id,user_id)
);
-- A simple row-count constraint cannot guarantee max 2 under concurrency.
-- The invitation-acceptance transaction MUST lock the parent duo row, count
-- active members and reject the third seat. Direct INSERT must remain revoked.

create table duo_v3_private.periods (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references duo_v3_private.duos(id),
  start_on date not null,
  end_on date not null,
  state text not null default 'open' check (state in ('open','closed')),
  closed_at timestamptz,
  unique (duo_id,id),
  unique (duo_id,start_on),
  check (end_on > start_on)
);
-- Prevent overlapping periods transactionally before activation.

create table duo_v3_private.envelopes (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references duo_v3_private.duos(id),
  name text not null check (length(trim(name)) > 0),
  carry_positive boolean not null default true,
  active boolean not null default true,
  unique (duo_id,id)
);

-- Integer minor units are exact for the supported currency scale.
-- Keep all real financial movements in a journal; do not store a mutable
-- balance as the only source of truth.
create table duo_v3_private.operations (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references duo_v3_private.duos(id),
  envelope_id uuid,
  actor_user_id uuid not null,
  operation_type text not null check (operation_type in ('expense','contribution','reserve_reallocation','period_adjustment')),
  status text not null check (status in ('planned','done','cancelled')),
  amount_minor bigint not null check (amount_minor > 0),
  operation_date date not null,
  idempotency_key text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (duo_id,id),
  unique (duo_id,idempotency_key),
  foreign key (duo_id,envelope_id) references duo_v3_private.envelopes(duo_id,id),
  foreign key (duo_id,actor_user_id) references duo_v3_private.memberships(duo_id,user_id)
);
-- A single operations row is NOT sufficient for double-entry accounting.
-- Design balanced journal postings before enabling reserve transfers.

create table duo_v3_private.operation_revisions (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null,
  operation_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  actor_user_id uuid not null,
  change_type text not null check (change_type in ('create','edit','cancel','restore')),
  previous_snapshot jsonb,
  next_snapshot jsonb,
  recorded_at timestamptz not null default now(),
  unique (operation_id,revision_number),
  foreign key (duo_id,operation_id) references duo_v3_private.operations(duo_id,id),
  foreign key (duo_id,actor_user_id) references duo_v3_private.memberships(duo_id,user_id)
);
-- Audit append-only permissions/triggers must be designed and tested.

create table duo_v3_private.period_envelope_carries (
  duo_id uuid not null references duo_v3_private.duos(id),
  target_period_id uuid not null,
  envelope_id uuid not null,
  source_period_id uuid not null,
  carry_minor bigint not null,
  created_at timestamptz not null default now(),
  primary key (duo_id,target_period_id,envelope_id),
  foreign key (duo_id,target_period_id) references duo_v3_private.periods(duo_id,id),
  foreign key (duo_id,source_period_id) references duo_v3_private.periods(duo_id,id),
  foreign key (duo_id,envelope_id) references duo_v3_private.envelopes(duo_id,id)
);

alter table duo_v3_private.duos enable row level security;
alter table duo_v3_private.memberships enable row level security;
alter table duo_v3_private.periods enable row level security;
alter table duo_v3_private.envelopes enable row level security;
alter table duo_v3_private.operations enable row level security;
alter table duo_v3_private.operation_revisions enable row level security;
alter table duo_v3_private.period_envelope_carries enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies; no GRANT to anon/authenticated.
-- Never expose this private schema through Supabase Data API.
