-- =============================================================================
-- P2.5 — pitch allocation: a home fixture ↔ a booking on a pitch resource
-- =============================================================================
-- PLAN.md task P2.5 ("club admin allocates a home fixture to a pitch — this
-- creates a linked booking on that pitch resource (kickoff + configurable
-- pre/post buffer), running the same conflict-check as all bookings … Reschedule
-- from Full-Time moves the linked booking and flags conflicts to admin rather
-- than silently double-booking"; acceptance: "Allocation blocks a conflicting
-- hire booking and vice versa; reschedule test moves booking; unallocated-
-- fixtures view accurate"). Linear TH1-22.
--
-- SHAPE
--   * `fixtures.booking_id` → `bookings(id)` (unique, `on delete set null`):
--     the linked booking. `fixtures.duration_minutes` (default 90, admin
--     editable per fixture) and the resource's `default_pre/post_buffer_minutes`
--     give the booked window. `fixtures.allocation_conflict boolean` is the
--     flag an admin sees when a reschedule could not move the booking.
--   * `allocate_fixture(fixture_id, resource_id, pre?, post?)` — SECURITY
--     DEFINER, club_admin only (checked inside; `service_role` passes). Creates
--     or moves the linked booking (kind `fixture`, status `confirmed`,
--     booker = the team) through the ordinary INSERT/UPDATE, so
--     `bookings_no_overlap` is the arbiter: a collision raises with the
--     conflicting bookings named, and nothing is written. Sets
--     `fixtures.venue_resource_id` and clears `allocation_conflict`.
--   * `unallocate_fixture(fixture_id)` — cancels the linked booking (status
--     `cancelled`, so history survives) and clears the link + venue.
--   * `fixtures_sync_booking()` AFTER UPDATE OF kickoff_at, status,
--     duration_minutes: when a linked booking exists, tries to move it inside
--     a sub-transaction. Success → booking moved. `23P01` → the fixture row
--     keeps its new kickoff, the booking keeps its old slot, and
--     `allocation_conflict` is set with an `audit_log` row
--     (`fixtures.allocation_conflict`) — flagged, never double-booked. A
--     fixture going postponed/cancelled cancels its booking; back to scheduled
--     re-books (same conflict handling).
--   * `bookings_fixture_guard()` BEFORE DELETE / UPDATE OF status on bookings of
--     kind `fixture`: a linked fixture booking cannot be cancelled or deleted
--     directly — use `unallocate_fixture()` — so the link never dangles.
--   * `unallocated_home_fixtures` view (security_invoker) and
--     `pitch_grid(from, to)` function: the admin dashboard's two reads.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (columns on existing tables;
-- two SECURITY DEFINER functions; one view); data touched: none; rollback: §8.
-- =============================================================================


-- =============================================================================
-- 1. COLUMNS
-- =============================================================================

alter table public.fixtures
  add column booking_id uuid unique references public.bookings (id) on delete set null,
  add column duration_minutes integer not null default 90 check (duration_minutes between 10 and 600),
  add column allocation_conflict boolean not null default false;

comment on column public.fixtures.booking_id is 'The pitch booking this fixture occupies (P2.5). Set via allocate_fixture().';
comment on column public.fixtures.allocation_conflict is 'True when a reschedule could not move the linked booking because the slot is taken. Admin must re-allocate.';

-- Bookings of kind fixture point back (denormalised so bookings screens can
-- show "U13s v Angel FC" without a join through fixtures).
alter table public.bookings
  add column fixture_id uuid unique references public.fixtures (id) on delete set null;


-- =============================================================================
-- 2. INTERNAL: compute + write the booking window
-- =============================================================================

create or replace function public.fixture_booking_window(
  p_fixture_id uuid,
  out starts_at timestamptz,
  out ends_at timestamptz
)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select f.kickoff_at, f.kickoff_at + make_interval(mins => f.duration_minutes)
  from public.fixtures f where f.id = p_fixture_id;
$$;

create or replace function public.fixture_conflict_message(
  p_resource_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_pre integer, p_post integer, p_exclude uuid
)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(string_agg(
           format('%s %s–%s (%s)', c.booker_name,
                  to_char(c.starts_at at time zone 'Europe/London', 'DD/MM HH24:MI'),
                  to_char(c.ends_at   at time zone 'Europe/London', 'HH24:MI'),
                  c.kind), '; ' order by c.starts_at), '')
  from public.booking_conflicts(p_resource_id, p_starts_at, p_ends_at, p_pre, p_post, p_exclude) c;
$$;


-- =============================================================================
-- 3. allocate_fixture() / unallocate_fixture()
-- =============================================================================

create or replace function public.allocate_fixture(
  p_fixture_id   uuid,
  p_resource_id  uuid,
  p_pre_buffer_minutes  integer default null,
  p_post_buffer_minutes integer default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  f   public.fixtures%rowtype;
  r   public.resources%rowtype;
  t   public.teams%rowtype;
  v_pre  integer;
  v_post integer;
  v_start timestamptz;
  v_end   timestamptz;
  v_booking_id uuid;
  v_msg text;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'allocate_fixture: club_admin only' using errcode = '42501';
  end if;
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then raise exception 'allocate_fixture: unknown fixture %', p_fixture_id using errcode = 'P0001'; end if;
  if not f.is_home then
    raise exception 'allocate_fixture: only home fixtures are allocated to a pitch' using errcode = 'P0001';
  end if;
  if f.status not in ('scheduled', 'played') then
    raise exception 'allocate_fixture: a % fixture has no pitch slot', f.status using errcode = 'P0001';
  end if;
  select * into r from public.resources where id = p_resource_id;
  if not found or r.type = 'function_room' then
    raise exception 'allocate_fixture: % is not a pitch', p_resource_id using errcode = 'P0001';
  end if;
  if not r.active then
    raise exception 'allocate_fixture: pitch "%" is inactive', r.name using errcode = 'P0001';
  end if;
  select * into t from public.teams where id = f.team_id;

  v_pre  := coalesce(p_pre_buffer_minutes,  r.default_pre_buffer_minutes);
  v_post := coalesce(p_post_buffer_minutes, r.default_post_buffer_minutes);
  select starts_at, ends_at into v_start, v_end from public.fixture_booking_window(p_fixture_id);

  -- Say which bookings collide before the constraint says "conflict".
  v_msg := public.fixture_conflict_message(p_resource_id, v_start, v_end, v_pre, v_post, f.booking_id);
  if v_msg <> '' then
    raise exception 'allocate_fixture: pitch "%" is already booked: %', r.name, v_msg using errcode = '23P01';
  end if;

  if f.booking_id is null then
    insert into public.bookings (resource_id, kind, status, starts_at, ends_at, pre_buffer_minutes, post_buffer_minutes,
                                 booker_name, booker_email, occasion, fixture_id, created_by)
    values (p_resource_id, 'fixture', 'confirmed', v_start, v_end, v_pre, v_post,
            t.name, '—', format('%s v %s (%s)', t.name, f.opponent, coalesce(f.competition, 'fixture')),
            f.id, auth.uid())
    returning id into v_booking_id;
  else
    perform set_config('app.fixture_booking_managed', 'true', true);
    update public.bookings
       set resource_id = p_resource_id, starts_at = v_start, ends_at = v_end,
           pre_buffer_minutes = v_pre, post_buffer_minutes = v_post, status = 'confirmed',
           occasion = format('%s v %s (%s)', t.name, f.opponent, coalesce(f.competition, 'fixture'))
     where id = f.booking_id
    returning id into v_booking_id;
    perform set_config('app.fixture_booking_managed', '', true);
  end if;

  update public.fixtures
     set booking_id = v_booking_id, venue_resource_id = p_resource_id, allocation_conflict = false
   where id = p_fixture_id;

  return v_booking_id;
end;
$$;

create or replace function public.unallocate_fixture(p_fixture_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_booking uuid;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'unallocate_fixture: club_admin only' using errcode = '42501';
  end if;
  select booking_id into v_booking from public.fixtures where id = p_fixture_id;
  update public.fixtures set booking_id = null, venue_resource_id = null, allocation_conflict = false
   where id = p_fixture_id;
  if v_booking is not null then
    perform set_config('app.fixture_booking_managed', 'true', true);
    update public.bookings set status = 'cancelled', fixture_id = null where id = v_booking;
    perform set_config('app.fixture_booking_managed', '', true);
  end if;
end;
$$;


-- =============================================================================
-- 4. RESCHEDULE → MOVE OR FLAG
-- =============================================================================

create or replace function public.fixtures_sync_booking()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  b   public.bookings%rowtype;
  v_start timestamptz;
  v_end   timestamptz;
  v_msg   text;
begin
  if new.booking_id is null then
    return new;
  end if;
  select * into b from public.bookings where id = new.booking_id;
  if not found then
    return new;
  end if;

  -- Postponed / cancelled / abandoned: free the pitch, keep the link so a
  -- return to 'scheduled' can re-book.
  if new.status in ('postponed', 'cancelled', 'abandoned') then
    if b.status <> 'cancelled' then
      perform set_config('app.fixture_booking_managed', 'true', true);
      update public.bookings set status = 'cancelled' where id = b.id;
      perform set_config('app.fixture_booking_managed', '', true);
    end if;
    return new;
  end if;

  select starts_at, ends_at into v_start, v_end from public.fixture_booking_window(new.id);
  if b.status = 'confirmed' and b.starts_at = v_start and b.ends_at = v_end then
    return new;  -- nothing moved
  end if;

  v_msg := public.fixture_conflict_message(b.resource_id, v_start, v_end, b.pre_buffer_minutes, b.post_buffer_minutes, b.id);
  if v_msg <> '' then
    update public.fixtures set allocation_conflict = true where id = new.id;
    insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (auth.uid(), (select email from auth.users where id = auth.uid()),
            'fixtures.allocation_conflict', 'fixtures', new.id::text,
            jsonb_build_object('booking_id', b.id, 'resource_id', b.resource_id,
                               'wanted_starts_at', v_start, 'wanted_ends_at', v_end, 'conflicts', v_msg));
    return new;
  end if;

  perform set_config('app.fixture_booking_managed', 'true', true);
  update public.bookings set starts_at = v_start, ends_at = v_end, status = 'confirmed' where id = b.id;
  perform set_config('app.fixture_booking_managed', '', true);
  update public.fixtures set allocation_conflict = false where id = new.id and allocation_conflict;
  return new;
end;
$$;

create trigger trg_fixtures_sync_booking
  after update of kickoff_at, status, duration_minutes on public.fixtures
  for each row execute function public.fixtures_sync_booking();


-- =============================================================================
-- 5. A linked fixture booking is managed through the fixture
-- =============================================================================

create or replace function public.bookings_fixture_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if coalesce(current_setting('app.fixture_booking_managed', true), '') = 'true' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.fixture_id is not null then
      raise exception 'bookings: this booking belongs to a fixture — use unallocate_fixture()' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.fixture_id is not null and (new.status <> old.status or new.starts_at <> old.starts_at
     or new.ends_at <> old.ends_at or new.resource_id <> old.resource_id or new.fixture_id is distinct from old.fixture_id) then
    raise exception 'bookings: this booking belongs to a fixture — change the fixture or use allocate_fixture()/unallocate_fixture()'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_bookings_fixture_guard
  before delete or update of status, starts_at, ends_at, resource_id, fixture_id on public.bookings
  for each row execute function public.bookings_fixture_guard();


-- =============================================================================
-- 6. DASHBOARD READS
-- =============================================================================

create or replace view public.unallocated_home_fixtures
  with (security_invoker = true) as
  select f.id, f.team_id, t.name as team_name, f.season_id, f.opponent, f.competition,
         f.kickoff_at, f.duration_minutes, f.status, f.allocation_conflict
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  where f.is_home
    and f.status = 'scheduled'
    and (f.booking_id is null or f.allocation_conflict)
    and f.kickoff_at >= now() - interval '1 day'
  order by f.kickoff_at;

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
         coalesce(b.occasion, b.booker_name), b.fixture_id, f.team_id
  from public.resources r
  left join public.bookings b on b.resource_id = r.id
     and b.status in ('pending', 'confirmed')
     and b.blocked_until > p_from and b.blocked_from < p_to
  left join public.fixtures f on f.id = b.fixture_id
  where r.type <> 'function_room' and r.active
  order by r.sort_order, r.name, b.starts_at;
$$;


-- =============================================================================
-- 7. GRANTS
-- =============================================================================

revoke all privileges on function public.allocate_fixture(uuid, uuid, integer, integer) from public, anon;
revoke all privileges on function public.unallocate_fixture(uuid)                        from public, anon;
grant execute on function public.allocate_fixture(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.unallocate_fixture(uuid)                        to authenticated, service_role;
revoke all privileges on function public.fixture_booking_window(uuid) from public, anon;
revoke all privileges on function public.fixture_conflict_message(uuid, timestamptz, timestamptz, integer, integer, uuid) from public, anon;
grant execute on function public.fixture_booking_window(uuid) to authenticated, service_role;
grant execute on function public.fixture_conflict_message(uuid, timestamptz, timestamptz, integer, integer, uuid) to authenticated, service_role;
revoke all privileges on function public.pitch_grid(timestamptz, timestamptz) from public, anon;
grant execute on function public.pitch_grid(timestamptz, timestamptz) to authenticated, service_role;
revoke all privileges on function public.fixtures_sync_booking()  from public, anon, authenticated, service_role;
revoke all privileges on function public.bookings_fixture_guard() from public, anon, authenticated, service_role;
grant select on public.unallocated_home_fixtures to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop view unallocated_home_fixtures; drop function pitch_grid, allocate_fixture,
-- unallocate_fixture, fixtures_sync_booking (+trigger), bookings_fixture_guard
-- (+trigger), fixture_conflict_message, fixture_booking_window; alter table
-- bookings drop column fixture_id; alter table fixtures drop column booking_id,
-- duration_minutes, allocation_conflict. Fixture bookings already created stay
-- as ordinary kind=fixture bookings.
