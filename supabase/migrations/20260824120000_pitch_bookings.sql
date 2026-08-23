-- =============================================================================
-- Gap 3 (post-P3.4) — pitch bookings by team: coaches book, admins confirm
-- =============================================================================
-- What the cutover left out (gap analysis 2026-08-23): nothing in the app let a
-- coach ask for a pitch, nothing created a training session, and the only
-- pitch write path was allocate_fixture(). This migration gives the data model
-- what those screens need:
--
--   1. `bookings.team_id` — the team a pitch booking is for (fixtures already
--      carry it via fixture_id; this covers friendlies, training, anything
--      else). Backfilled from the Neon import where neon_legacy is present.
--   2. `booking_teams` — extra teams sharing one training session (the Neon
--      TrainingSessionTeam model). The owning team stays on bookings.team_id.
--   3. `can_view_pitch_calendar()` — anyone with a live team membership, a
--      guardian of such a person, or a club app role (admin, lead, coach, staff).
--   4. RLS for coaches (team staff, who are NOT `staff`/`club_admin` app
--      roles): insert a pending block/training booking on a pitch for a team
--      they staff; read and update their own team's pitch bookings. Everyone
--      else reads through pitch_calendar(). Admin policies are unchanged.
--   5. `bookings_team_guard()` — what a coach may change: status only to
--      cancelled, other edits only while pending, team must be one they staff,
--      resource must be a pitch. club_admin / staff app roles are exempt.
--   6. `pitch_calendar(from, to)` — SECURITY DEFINER, no booker PII, for the
--      calendar every member sees; `pitch_grid()` gains bookings.team_id.
--
-- Rollback (documented, not shipped): drop function pitch_calendar,
-- can_view_pitch_calendar, bookings_team_guard + trigger; drop the four coach
-- policies; drop table booking_teams; alter table bookings drop column team_id;
-- re-create pitch_grid from 20260823160000.
-- =============================================================================


-- 1. bookings.team_id -------------------------------------------------------
alter table public.bookings
  add column if not exists team_id uuid references public.teams (id) on delete set null;
create index if not exists bookings_team_idx on public.bookings (team_id) where team_id is not null;
comment on column public.bookings.team_id is
  'The team this pitch booking is for. Fixtures also carry fixture_id; training/friendlies carry only this.';

-- Backfill from the Neon import when the legacy schema holds rows (prod; the
-- stub tables elsewhere are empty so this is a no-op there).
update public.bookings b
   set team_id = t.id
  from neon_legacy."Booking" nb
  join public.teams t on t.legacy_neon_team_id = nb."teamId"
 where b.legacy_neon_ref = 'booking:' || nb.id
   and b.team_id is null;

update public.bookings b
   set team_id = f.team_id
  from public.fixtures f
 where f.id = b.fixture_id and b.team_id is null;


-- 2. booking_teams ------------------------------------------------------------
create table if not exists public.booking_teams (
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (booking_id, team_id)
);
comment on table public.booking_teams is
  'Additional teams sharing a training session or block booking. The owning team is bookings.team_id.';

-- Backfill shared training sessions from the Neon import.
insert into public.booking_teams (booking_id, team_id)
select b.id, t.id
  from public.bookings b
  join neon_legacy."TrainingSessionTeam" tst on 'training:' || tst."trainingSessionId" = b.legacy_neon_ref
  join public.teams t on t.legacy_neon_team_id = tst."teamId"
 where b.team_id is distinct from t.id
on conflict do nothing;

-- Owning team for imported training sessions: the first linked team.
update public.bookings b
   set team_id = x.team_id
  from (
    select bt.booking_id, min(bt.team_id::text)::uuid as team_id
      from public.booking_teams bt
     group by bt.booking_id
  ) x
 where x.booking_id = b.id and b.team_id is null;
delete from public.booking_teams bt
 using public.bookings b
 where b.id = bt.booking_id and b.team_id = bt.team_id;


-- 3. Who may see the pitch calendar ------------------------------------------
create or replace function public.can_view_pitch_calendar()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select true from public.person_roles pr
      where pr.person_id = public.current_person_id() and pr.revoked_at is null
        and pr.role in ('club_admin', 'safeguarding_lead', 'coach', 'staff') limit 1),
    (select true from public.team_memberships m
      where m.person_id = public.current_person_id() and m.left_at is null limit 1),
    (select true from public.guardianships g
      join public.team_memberships m on m.person_id = g.child_person_id and m.left_at is null
      where g.guardian_person_id = public.current_person_id() and g.ended_at is null limit 1),
    false);
$$;
revoke all privileges on function public.can_view_pitch_calendar() from public, anon;
grant execute on function public.can_view_pitch_calendar() to authenticated, service_role;

create or replace function public.is_pitch_resource(p_resource_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.resources r where r.id = p_resource_id and r.type = 'pitch');
$$;
revoke all privileges on function public.is_pitch_resource(uuid) from public, anon;
grant execute on function public.is_pitch_resource(uuid) to authenticated, service_role;


-- 4. Coach policies -----------------------------------------------------------
-- Coaches read their own team's pitch bookings (full row, incl. booker contact
-- — it is their own or a colleague's). Everyone else reads the PII-free
-- pitch_calendar() below; there is deliberately no broad member-read policy.
create policy "bookings_team_staff_read" on public.bookings
  for select to authenticated
  using (public.is_pitch_resource(resource_id) and team_id is not null and public.is_team_staff(team_id));

create policy "bookings_team_staff_insert" on public.bookings
  for insert to authenticated
  with check (
    public.is_pitch_resource(resource_id)
    and team_id is not null and public.is_team_staff(team_id)
    and kind in ('block', 'training')
    and status = 'pending'
    and booker_person_id = public.current_person_id()
  );

create policy "bookings_team_staff_update" on public.bookings
  for update to authenticated
  using (public.is_pitch_resource(resource_id) and team_id is not null and public.is_team_staff(team_id))
  with check (public.is_pitch_resource(resource_id) and team_id is not null and public.is_team_staff(team_id));

alter table public.booking_teams enable row level security;
create policy "booking_teams_read" on public.booking_teams
  for select to authenticated
  using (public.can_view_pitch_calendar() or public.has_any_role(array['staff', 'club_admin']::public.app_role[]));
create policy "booking_teams_admin_write" on public.booking_teams
  for all to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));
create policy "booking_teams_owner_write" on public.booking_teams
  for all to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_teams.booking_id and b.team_id is not null and public.is_team_staff(b.team_id)))
  with check (exists (select 1 from public.bookings b where b.id = booking_teams.booking_id and b.team_id is not null and public.is_team_staff(b.team_id)));
revoke all privileges on public.booking_teams from anon, authenticated, service_role;
grant select, insert, delete on public.booking_teams to authenticated;
grant select, insert, update, delete on public.booking_teams to service_role;


-- 5. What a coach may change ---------------------------------------------------
create or replace function public.bookings_team_guard()
  returns trigger
  language plpgsql
  security invoker   -- deliberately: current_user must be the caller's role, see below
  set search_path = public
as $$
begin
  -- Only the coach path is constrained: a row written directly by an
  -- authenticated client that holds no staff/club_admin app role. Service
  -- paths, the owner, and SECURITY DEFINER functions (inside which current_user
  -- is the function owner, not 'authenticated') are governed by their own rules.
  if current_user <> 'authenticated'
     or auth.uid() is null
     or public.has_any_role(array['staff', 'club_admin']::public.app_role[]) then
    return new;
  end if;

  -- From here the actor is a coach acting through the team-staff policies.
  if tg_op = 'INSERT' then
    if new.ends_at <= new.starts_at or new.starts_at < now() - interval '1 day' then
      raise exception 'bookings: a coach may only request future slots' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'cancelled' then
    raise exception 'bookings: a cancelled booking cannot be changed' using errcode = 'P0001';
  end if;
  if new.status <> old.status and new.status <> 'cancelled' then
    raise exception 'bookings: only a club administrator can confirm a pitch booking' using errcode = 'P0001';
  end if;
  if new.status = old.status and old.status <> 'pending' then
    raise exception 'bookings: a confirmed booking can only be cancelled — ask a club administrator to change it' using errcode = 'P0001';
  end if;
  if new.resource_id <> old.resource_id and not public.is_pitch_resource(new.resource_id) then
    raise exception 'bookings: coaches may only book pitches' using errcode = 'P0001';
  end if;
  if new.kind not in ('block', 'training') then
    raise exception 'bookings: coaches may only create block or training bookings' using errcode = 'P0001';
  end if;
  if new.fixture_id is distinct from old.fixture_id then
    raise exception 'bookings: fixture links are managed through allocate_fixture()' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all privileges on function public.bookings_team_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_bookings_team_guard on public.bookings;
create trigger trg_bookings_team_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_team_guard();


-- 6. Calendar accessors --------------------------------------------------------
create or replace function public.pitch_calendar(p_from timestamptz, p_to timestamptz)
  returns table (
    booking_id uuid, resource_id uuid, resource_name text, kind public.booking_kind,
    status public.booking_status, starts_at timestamptz, ends_at timestamptz,
    label text, team_id uuid, team_name text, fixture_id uuid, opponent text, is_home boolean,
    shared_team_ids uuid[]
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select b.id, r.id, r.name, b.kind, b.status, b.starts_at, b.ends_at,
         case when b.kind = 'maintenance' then coalesce(b.occasion, 'Closed')
              when b.kind = 'fixture' then coalesce(t.name, '') || ' v ' || coalesce(f.opponent, '')
              else coalesce(b.occasion, t.name, b.kind::text) end,
         b.team_id, t.name, b.fixture_id, f.opponent, f.is_home,
         (select array_agg(bt.team_id) from public.booking_teams bt where bt.booking_id = b.id)
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  left join public.teams t on t.id = b.team_id
  left join public.fixtures f on f.id = b.fixture_id
  where r.type = 'pitch'
    and b.status in ('pending', 'confirmed')
    and b.ends_at > p_from and b.starts_at < p_to
    and (public.can_view_pitch_calendar() or public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  order by b.starts_at, r.sort_order, r.name;
$$;
comment on function public.pitch_calendar(timestamptz, timestamptz) is
  'Every live pitch booking in a window with no booker PII. For members, guardians and staff (can_view_pitch_calendar()).';
revoke all privileges on function public.pitch_calendar(timestamptz, timestamptz) from public, anon;
grant execute on function public.pitch_calendar(timestamptz, timestamptz) to authenticated, service_role;

-- pitch_grid(): team_id now comes from the booking itself, falling back to the fixture.
create or replace function public.pitch_grid(p_from timestamptz, p_to timestamptz)
  returns table (
    resource_id uuid, resource_name text, booking_id uuid, kind public.booking_kind,
    status public.booking_status, starts_at timestamptz, ends_at timestamptz,
    blocked_from timestamptz, blocked_until timestamptz, label text,
    fixture_id uuid, team_id uuid
  )
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select r.id, r.name, b.id, b.kind, b.status, b.starts_at, b.ends_at, b.blocked_from, b.blocked_until,
         coalesce(b.occasion, b.booker_name), b.fixture_id, coalesce(b.team_id, f.team_id)
  from public.resources r
  left join public.bookings b on b.resource_id = r.id
     and b.status in ('pending', 'confirmed')
     and b.blocked_until > p_from and b.blocked_from < p_to
  left join public.fixtures f on f.id = b.fixture_id
  where r.type <> 'function_room' and r.active
  order by r.sort_order, r.name, b.starts_at;
$$;

-- Audit the schema change itself.
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260824120000_pitch_bookings',
                           'adds', array['bookings.team_id', 'booking_teams', 'coach policies', 'pitch_calendar']));
