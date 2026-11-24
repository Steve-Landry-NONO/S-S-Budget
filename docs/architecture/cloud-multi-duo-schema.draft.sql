-- DRAFT ONLY — DO NOT APPLY TO PRODUCTION
-- Conceptual PostgreSQL/Supabase schema; no grants or client write policies.
-- Review invitation, ownership and RLS strategy before execution.

create table public.duos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.duo_memberships (
  duo_id uuid not null references public.duos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (duo_id, user_id)
);
create index duo_memberships_user_idx on public.duo_memberships(user_id, duo_id);

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  name text not null,
  monthly_target numeric(18,2) not null default 0 check (monthly_target >= 0),
  locked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (duo_id, id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  envelope_id uuid not null,
  label text not null,
  amount numeric(18,2) not null check (amount > 0),
  paid_by_user_id uuid not null,
  created_by_user_id uuid not null,
  operation_date date not null,
  status text not null check (status in ('planned', 'done')),
  created_at timestamptz not null default now(),
  foreign key (duo_id, envelope_id) references public.envelopes(duo_id, id),
  foreign key (duo_id, paid_by_user_id) references public.duo_memberships(duo_id, user_id),
  foreign key (duo_id, created_by_user_id) references public.duo_memberships(duo_id, user_id)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  envelope_id uuid not null,
  amount numeric(18,2) not null check (amount > 0),
  member_user_id uuid not null,
  created_by_user_id uuid not null,
  operation_date date not null,
  status text not null check (status in ('planned', 'done')),
  created_at timestamptz not null default now(),
  foreign key (duo_id, envelope_id) references public.envelopes(duo_id, id),
  foreign key (duo_id, member_user_id) references public.duo_memberships(duo_id, user_id),
  foreign key (duo_id, created_by_user_id) references public.duo_memberships(duo_id, user_id)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (duo_id, actor_user_id) references public.duo_memberships(duo_id, user_id)
);

create index expenses_duo_date_idx on public.expenses(duo_id, operation_date);
create index contributions_duo_date_idx on public.contributions(duo_id, operation_date);
create index activity_logs_duo_date_idx on public.activity_logs(duo_id, created_at);

alter table public.duos enable row level security;
alter table public.duo_memberships enable row level security;
alter table public.envelopes enable row level security;
alter table public.expenses enable row level security;
alter table public.contributions enable row level security;
alter table public.activity_logs enable row level security;

-- DENY BY DEFAULT: intentionally no policies and no GRANT statements.
-- SECURITY DESIGN TODO: avoid membership-policy recursion, guard invitations,
-- disallow role escalation, and validate all writes with cross-duo tests.
-- Never execute this draft as a production migration.
