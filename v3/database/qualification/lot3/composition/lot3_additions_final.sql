-- =====================================================================================================
-- PROTOTYPE LOT 3 — VERSION 3 : ajouts au prototype v2 (POST006-02, POST006-05, POST006-06)
-- Appliqué juste après le corps v2, dans la même transaction (voir build_lot3_v3.py).
-- PROTOTYPE NON PROMU : environnement PostgreSQL jetable uniquement.
-- =====================================================================================================

-- C1. Espaces : commun (duo, 2 sièges) ou personnel (1 siège, jamais partageable). Duo archivable.
alter table public.duo_v3_households
  add column kind text not null default 'duo' check (kind in ('duo','personal')),
  add column archived_at timestamptz;
alter table public.duo_v3_members add column space text not null default 'duo' check (space in ('duo','personal'));

create function duo_v3_private.guard_household_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then raise exception 'Space kind cannot change' using errcode = '23514'; end if;
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'An archived household stays archived (POST006-06)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger duo_v3_households_guard_kind before update of kind, archived_at on public.duo_v3_households
  for each row execute function duo_v3_private.guard_household_kind();

-- CF-05 ne porte que sur les duos ; un compte a au plus un espace personnel actif.
drop index public.duo_v3_one_active_duo_per_user;
create unique index duo_v3_one_active_duo_per_user on public.duo_v3_members(user_id) where status = 'active' and space = 'duo';
create unique index duo_v3_one_personal_space_per_user on public.duo_v3_members(user_id) where status = 'active' and space = 'personal';

create or replace function duo_v3_private.enforce_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.duo_v3_households where id = new.household_id;
  new.space := h.kind;                                                            -- dénormalisé, non falsifiable
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    perform 1 from public.duo_v3_households x where x.id = new.household_id for update;   -- dernier siège sérialisé
    if h.archived_at is not null then
      raise exception 'Household is archived' using errcode = '55000', detail = 'HOUSEHOLD_ARCHIVED';
    end if;
    if (select count(*) from public.duo_v3_members m where m.household_id = new.household_id
          and m.status = 'active' and m.user_id <> new.user_id) >= (case h.kind when 'personal' then 1 else 2 end) then
      raise exception 'Household is full' using errcode = '23514', detail = 'DUO_FULL';
    end if;
    if not exists (select 1 from auth.users u where u.id = new.user_id) then
      raise exception 'Unknown account' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
drop trigger duo_v3_members_enforce on public.duo_v3_members;
create trigger duo_v3_members_enforce before insert or update of status, space on public.duo_v3_members
  for each row execute function duo_v3_private.enforce_membership();

-- Un espace personnel ou archivé ne reçoit aucune invitation.
create function duo_v3_private.guard_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.duo_v3_households where id = new.household_id;
  if h.kind = 'personal' then raise exception 'A personal space cannot be shared' using errcode = '23514', detail = 'PERSONAL_SPACE'; end if;
  if h.archived_at is not null then raise exception 'Household is archived' using errcode = '55000', detail = 'HOUSEHOLD_ARCHIVED'; end if;
  return new;
end $$;
create trigger duo_v3_invitations_guard before insert on public.duo_v3_invitations
  for each row execute function duo_v3_private.guard_invitation();

create function public.duo_v3_create_personal_space(p_currency text default 'EUR')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := duo_v3_private.require_user(); v_h uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal:' || v_user::text, 0));
  select m.household_id into v_h from public.duo_v3_members m where m.user_id = v_user and m.status = 'active' and m.space = 'personal';
  if found then return v_h; end if;                                                -- idempotent
  insert into public.duo_v3_households(kind, currency) values ('personal', p_currency) returning id into v_h;
  insert into public.duo_v3_members(household_id, user_id, role) values (v_h, v_user, 'owner');
  perform duo_v3_private.bootstrap_household(v_h);
  return v_h;
end $$;

-- C2. Journal des évènements d'appartenance (append-only) : départs, transferts de rôle, archivage.
create table public.duo_v3_membership_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.duo_v3_households(id) on delete restrict,
  user_id uuid,
  event text not null check (event in ('left','owner_transferred','household_archived','orphan_reconciled','member_returned')),
  reason text check (reason in ('left','account_deleted','auth_orphan')),
  at timestamptz not null default clock_timestamp()
);
create trigger duo_v3_membership_events_immutable before update or delete on public.duo_v3_membership_events
  for each row execute function duo_v3_private.reject_mutation();
alter table public.duo_v3_membership_events enable row level security;
create policy duo_v3_membership_events_member_read on public.duo_v3_membership_events for select to authenticated
  using (duo_v3_private.is_current_member(household_id));
revoke all on public.duo_v3_membership_events from public, anon, authenticated;
grant select on public.duo_v3_membership_events to authenticated;

-- C3. Départ unique (volontaire, suppression de compte, orphelin) : continuité du duo (POST006-06).
create function duo_v3_private.depart(p_household uuid, p_user uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_next uuid;
begin
  perform 1 from public.duo_v3_households h where h.id = p_household for update;        -- même verrou que les écritures (F7)
  -- Horodatage pris APRÈS le verrou (clock_timestamp) : toute écriture acceptée avant le départ a un created_at
  -- antérieur (elle a obtenu le verrou plus tôt) ; avec now() (début de transaction) l'ordre pouvait s'inverser.
  update public.duo_v3_members m set status = 'left', left_at = pg_catalog.clock_timestamp()
   where m.household_id = p_household and m.user_id = p_user and m.status = 'active' returning m.role into v_role;
  if not found then return false; end if;
  insert into public.duo_v3_membership_events(household_id, user_id, event, reason)
  values (p_household, p_user, case when p_reason = 'auth_orphan' then 'orphan_reconciled' else 'left' end, p_reason);
  update public.duo_v3_invitations set status = 'revoked', decided_by = p_user, decided_at = now()
   where household_id = p_household and status = 'pending';
  select m.user_id into v_next from public.duo_v3_members m
   where m.household_id = p_household and m.status = 'active' order by m.joined_at, m.user_id limit 1;
  if v_next is null then
    update public.duo_v3_households set archived_at = now() where id = p_household and archived_at is null;
    insert into public.duo_v3_membership_events(household_id, user_id, event) values (p_household, null, 'household_archived');
  elsif v_role = 'owner' then
    update public.duo_v3_members set role = 'owner' where household_id = p_household and user_id = v_next;
    insert into public.duo_v3_membership_events(household_id, user_id, event) values (p_household, v_next, 'owner_transferred');
  end if;
  return true;
end $$;

create or replace function public.duo_v3_leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := duo_v3_private.require_user();
begin
  if not duo_v3_private.depart(p_household, v_user, 'left') then
    raise exception 'Not authorized for this household' using errcode = '42501';
  end if;
end $$;

-- C4. Suppression de compte contrôlée (CF-09, POST006-05) et réconciliation des orphelins.
create or replace function duo_v3_private.prepare_account_deletion(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account:' || p_user::text, 0));
  for r in select household_id from public.duo_v3_members where user_id = p_user and status = 'active' order by household_id loop
    if duo_v3_private.depart(r.household_id, p_user, 'account_deleted') then n := n + 1; end if;
  end loop;
  update public.duo_v3_invitations set status = 'revoked', decided_at = now()
   where created_by = p_user and status = 'pending';
  return n;
end $$;

-- Filet : une suppression Auth faite hors procédure (console, script) est réconciliée dans la même transaction.
create function duo_v3_private.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform duo_v3_private.prepare_account_deletion(old.id);
  return old;
end $$;
create trigger duo_v3_on_auth_user_deleted after delete on auth.users
  for each row execute function duo_v3_private.on_auth_user_deleted();

create function duo_v3_private.reconcile_orphan_memberships() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select m.household_id, m.user_id from public.duo_v3_members m
           where m.status = 'active' and not exists (select 1 from auth.users u where u.id = m.user_id)
           order by m.household_id, m.user_id loop
    if duo_v3_private.depart(r.household_id, r.user_id, 'auth_orphan') then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- C5. POST006-02 : soldes et instantanés communs ÉGAUX pour les membres actifs (calculés sur tout le livre) ;
-- le DÉTAIL (transactions, lignes) reste filtré par épisodes. Divulgation indirecte assumée et documentée :
-- un membre revenu voit l'effet net de la période d'absence dans les soldes, jamais les opérations.
-- Les rôles serveur (postgres, service_role), qui contournaient déjà la RLS, gardent leur lecture complète.
create or replace view public.duo_v3_envelope_balances with (security_invoker = false) as
select e.id as envelope_id, e.household_id, e.name, e.status, e.carry_positive, e.currency,
       coalesce(sum(x.amount_minor), 0) as balance_minor
from public.duo_v3_envelopes e left join public.duo_v3_entries x on x.account_id = e.account_id
where current_user not in ('authenticated','anon') or duo_v3_private.is_current_member(e.household_id) group by e.id;
create or replace view public.duo_v3_household_position with (security_invoker = false) as
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
from public.duo_v3_accounts a left join public.duo_v3_entries x on x.account_id = a.id
where current_user not in ('authenticated','anon') or duo_v3_private.is_current_member(a.household_id) group by a.household_id, a.currency;

-- Instantanés : la fonction de calcul passe en privé (SECURITY DEFINER), l'accès public vérifie l'appartenance.
do $$
declare f text;
begin
  foreach f in array array['duo_v3_get_envelope_snapshot', 'duo_v3_get_funds_snapshot'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then
      execute format('alter function public.%I(uuid) rename to %I', f, f || '_all');
      execute format('alter function public.%I(uuid) set schema duo_v3_private', f || '_all');
      execute format('alter function duo_v3_private.%I(uuid) security definer', f || '_all');
      execute format('revoke all on function duo_v3_private.%I(uuid) from public, anon, authenticated', f || '_all');
      execute format($f$create function public.%I(p_household uuid) returns jsonb language sql stable security definer set search_path = '' as $b$
          select case when duo_v3_private.is_current_member(p_household) then duo_v3_private.%I(p_household)
                 else pg_catalog.jsonb_build_object('householdId', p_household, 'scope', 'common', 'period', null, 'position', null,
                        'household', null, 'envelopes', '[]'::jsonb) end $b$ $f$, f, f || '_all');
      execute format('revoke all on function public.%I(uuid) from public, anon', f);
      execute format('grant execute on function public.%I(uuid) to authenticated', f);
    end if;
  end loop;
end $$;

revoke all on function duo_v3_private.guard_household_kind(), duo_v3_private.guard_invitation(), duo_v3_private.depart(uuid, uuid, text),
  duo_v3_private.on_auth_user_deleted(), duo_v3_private.reconcile_orphan_memberships() from public, anon, authenticated;
revoke all on function public.duo_v3_create_personal_space(text) from public, anon;
grant execute on function public.duo_v3_create_personal_space(text) to authenticated;

-- ======================================================================================== R-A3 × CF-07
-- Frontières d'épisodes et écritures comparées sur la même horloge, prise sous verrou :
-- left_at / joined_at (clock_timestamp dans depart() et track_episode) et posted_at (R-A3, 006r1).
alter policy duo_v3_transactions_member_read on public.duo_v3_transactions
  using (duo_v3_private.can_read_at(household_id, coalesce(posted_at, created_at)));

-- ======================================================================================== R-C2
-- Aucune autorisation active pour un compte supprimé, même avant réconciliation : l'appartenance
-- exige l'existence du compte Auth (auth.users), vérifiée à chaque appel.
create or replace function duo_v3_private.is_current_member(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.duo_v3_members m
    where m.household_id = p_household and m.user_id = auth.uid() and m.status = 'active')
    and exists (select 1 from auth.users u where u.id = auth.uid());
$$;
create or replace function duo_v3_private.is_member(p_household uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (select 1 from public.duo_v3_members m
    where m.household_id = p_household and m.user_id = p_user and m.status = 'active')
    and exists (select 1 from auth.users u where u.id = p_user);
$$;

-- ======================================================================================== R-C1
-- Retour d'un ancien membre : évènement journalisé, avis présenté aux DEUX partenaires.
create function duo_v3_private.on_member_return() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'left' and new.status = 'active' then
    insert into public.duo_v3_membership_events(household_id, user_id, event) values (new.household_id, new.user_id, 'member_returned');
  end if;
  return null;
end $$;
create trigger duo_v3_members_return after update of status on public.duo_v3_members
  for each row execute function duo_v3_private.on_member_return();

create function public.duo_v3_list_membership_notices(p_household uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not duo_v3_private.is_current_member(p_household) then '[]'::jsonb else coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code', 'RETURN_VISIBILITY_NOTICE', 'at', e.at, 'returningUserId', e.user_id,
      'audience', case when e.user_id = auth.uid() then 'returning_member' else 'partner' end,
      'facts', pg_catalog.jsonb_build_array('current_common_balances_visible', 'absence_operations_not_visible'))
      order by e.id)
    from public.duo_v3_membership_events e
    where e.household_id = p_household and e.event = 'member_returned'
      and exists (select 1 from public.duo_v3_member_episodes ep where ep.household_id = p_household
                  and ep.user_id = auth.uid() and ep.left_at is null and ep.joined_at <= e.at + interval '1 second')), '[]'::jsonb) end;
$$;
revoke all on function public.duo_v3_list_membership_notices(uuid) from public, anon;
grant execute on function public.duo_v3_list_membership_notices(uuid) to authenticated;

-- ======================================================================================== R-C3
-- Pas de réouverture automatique. Droits archivés : aucun accès applicatif (aucun membre actif) ;
-- export intégral réservé aux rôles serveur (support, obligations de conservation), jamais aux clients.
create function duo_v3_private.export_archived_household(p_household uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from public.duo_v3_households where id = p_household;
  if not found or h.archived_at is null then raise exception 'Household is not archived' using errcode = '55000'; end if;
  return pg_catalog.jsonb_build_object('householdId', h.id, 'archivedAt', h.archived_at, 'currency', h.currency,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role, 'leftAt', m.left_at) order by m.joined_at), '[]') from public.duo_v3_members m where m.household_id = h.id),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.duo_v3_membership_events e where e.household_id = h.id),
    'transactions', (select count(*) from public.duo_v3_transactions t where t.household_id = h.id),
    'ledgerChecksum', (select md5(coalesce(string_agg(x.id::text || ':' || x.amount_minor::text, ',' order by x.id), '')) from public.duo_v3_entries x where x.household_id = h.id));
end $$;
revoke all on function duo_v3_private.on_member_return(), duo_v3_private.export_archived_household(uuid) from public, anon, authenticated;
