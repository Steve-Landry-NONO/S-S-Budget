-- Duo Budget V3 / DEV only. Schema draft; do not apply to production.
-- Money is stored in integer minor units. No floating-point monetary columns.
-- Security-first: RLS enabled and no client policies yet (deny by default).
begin;

create table public.duo_v3_households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.duo_v3_members (
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','partner')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create unique index duo_v3_one_owner_per_household
  on public.duo_v3_members(household_id) where role = 'owner';

create table public.duo_v3_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  label text not null check (length(trim(label)) between 1 and 120),
  kind text not null check (kind in ('cash','envelope','reserve','clearing')),
  currency text not null check (currency in ('EUR','USD','GBP','XAF','XOF','JPY')),
  created_at timestamptz not null default now(),
  unique (id, household_id, currency)
);

create table public.duo_v3_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  currency text not null check (currency in ('EUR','USD','GBP','XAF','XOF','JPY')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  kind text not null check (kind in ('expense','income','transfer','allocation','reversal')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  reverses_transaction_id uuid references public.duo_v3_transactions(id) on delete restrict,
  unique (household_id, idempotency_key),
  unique (id, household_id, currency),
  foreign key (household_id, created_by)
    references public.duo_v3_members(household_id, user_id) on delete restrict,
  check (reverses_transaction_id is null or reverses_transaction_id <> id),
  check ((kind = 'reversal') = (reverses_transaction_id is not null))
);
create unique index duo_v3_single_reversal
  on public.duo_v3_transactions(reverses_transaction_id)
  where reverses_transaction_id is not null;

create table public.duo_v3_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  household_id uuid not null,
  account_id uuid not null,
  currency text not null,
  amount_minor numeric(38,0) not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (transaction_id, household_id, currency)
    references public.duo_v3_transactions(id, household_id, currency) on delete restrict,
  foreign key (account_id, household_id, currency)
    references public.duo_v3_accounts(id, household_id, currency) on delete restrict
);
create index duo_v3_entries_by_account on public.duo_v3_entries(account_id, created_at);
create index duo_v3_entries_by_transaction on public.duo_v3_entries(transaction_id);

alter table public.duo_v3_households enable row level security;
alter table public.duo_v3_members enable row level security;
alter table public.duo_v3_accounts enable row level security;
alter table public.duo_v3_transactions enable row level security;
alter table public.duo_v3_entries enable row level security;

-- No grants/policies to anon or authenticated until RLS integration tests pass.
-- TODO before any client writes: atomic posting RPC with balanced-entry check,
-- immutable posted transactions, cross-household reversal validation,
-- authenticated membership policies, and concurrent idempotency tests.
commit;
