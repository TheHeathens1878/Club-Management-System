-- =============================================================================
-- An internal match is one game on two teams' pages
-- =============================================================================
-- Adam, 2026-08-26: a match between two of the club's own teams should show up
-- on BOTH teams' fixture lists, not only on the one that happened to book the
-- pitch.
--
-- WHERE 20260825400000 LEFT IT
--   That migration let a coach ask for a match and ask whether the opposition
--   is internal (a club team, picked from a list) or external (free text). It
--   deliberately stored the answer nowhere but `bookings.occasion` — the label
--   the pitch diary shows — and created no fixture row at all. A label is
--   enough to read; it is not enough to build two fixtures from, because
--   "U14 Mavericks v U18 Cobras" is a sentence, not a foreign key.
--
--   So this migration adds the smallest honest column for it:
--   `bookings.opponent_team_id`. It is set by `request_team_pitch_booking()`
--   (which gains a parameter) and by the administrator's direct insert, and it
--   is null for every external match and every training or block booking — a
--   CHECK constraint says so, rather than a comment hoping so.
--
-- WHY TWO ROWS AND NOT ONE
--   `fixtures` is per team: `team_id`, `is_home`, `opponent` (text). Every
--   screen in the app — the team page, matchday, availability, selections,
--   lineups, match stats — reads fixtures by `team_id`. One row can only
--   belong to one team, so one row can only ever appear on one team's page.
--   Two mirrored rows is not duplication of a match; it is the same shape the
--   FA Full-Time importer already produces when two of our teams are in the
--   same league and drawn against each other.
--
-- THE 1:1 CONSTRAINT THAT SHAPES THE PAIR
--   `fixtures.booking_id` is UNIQUE and `bookings.fixture_id` is UNIQUE
--   (20260823160000). That is a strict one-to-one, and it is not negotiable
--   here: `fixtures_sync_booking()`, `allocate_fixture()`,
--   `unallocate_fixture()` and `bookings_fixture_guard()` all assume a booking
--   has at most one fixture and a fixture at most one booking. Both mirrors
--   therefore CANNOT hold the booking. The split is the same one
--   `allocate_fixture()` already enforces ("only home fixtures are allocated to
--   a pitch"):
--
--     * the booking's OWN team is the HOME side. Its fixture takes
--       `booking_id`, `venue_resource_id` and the pitch slot — exactly the row
--       `allocate_fixture()` would have produced.
--     * the opposition team gets the AWAY mirror: same kickoff, same duration,
--       same `venue_resource_id`, `is_home = false`, `booking_id` null.
--
--   That is also true on the pitch: the team that asked for the pitch is
--   playing at home, and the other team is travelling to it.
--
-- WHY A SELF-REFERENCE AND NOT A JOIN TABLE
--   `fixtures.mirror_fixture_id uuid references public.fixtures(id)`, set on
--   both rows so either one can find the other in a single column read.
--
--   A join table (`match_pairs(home_fixture_id, away_fixture_id)`) would be the
--   right shape for a many-to-many, or for a set of any size — a triangular
--   tournament, a fixture with three teams. This is neither. A match has
--   exactly two sides, forever; the cardinality is in the problem, not in the
--   data. A self-reference puts that fact in the column definition where the
--   triggers below can read it without a join, gets `on delete set null` for
--   free, and cannot drift out of step with itself the way two rows in a
--   separate table can. The one thing it does not give is a database-enforced
--   guarantee that the two pointers agree; `create_internal_match_fixtures()`
--   is the only thing that ever sets them, and it sets both in one statement
--   each, inside one transaction.
--
-- WHEN THE PAIR IS CREATED — ON CONFIRMATION, NOT ON REQUEST
--   Not at request time. A pending request must not put a fixture on two
--   teams' pages: the coach of the opposition would find a game on their
--   matchday tab that no administrator has agreed to yet, and availability
--   requests would go out for it. `create_internal_match_fixtures()` refuses a
--   booking that is not `confirmed`, and the administrator's desk
--   (`/pitches/requests`) calls it immediately after the confirming UPDATE.
--
--   It is club_admin only and SECURITY DEFINER for the same reason
--   `allocate_fixture()` is: it writes `fixtures` rows on a team the caller may
--   not staff (the opposition's), and it sets the `bookings.fixture_id` link
--   that `bookings_team_guard()` keeps away from coaches.
--
-- WHICH SEASON
--   `seasons.is_current`, which is what every other season lookup in this
--   schema does — `allocate_team_fixtures()`, the Full-Time importer's
--   `import_fulltime_fixtures` caller, `neon_import`, `join_flow`,
--   `club_overview`, `account_requests`. There is no starts_on/ends_on
--   bracketing rule anywhere in the codebase and this migration does not
--   invent a third one. If there is no current season the function refuses
--   with a sentence rather than guessing.
--
-- CANCELLING — BOTH SIDES, NEVER A DELETE
--   Three routes in, one outcome:
--     1. cancel either FIXTURE  -> `fixtures_cancel_mirror()` cancels the other
--     2. cancel the HOME fixture -> `fixtures_sync_booking()` (unchanged, from
--        20260823160000) already cancels the booking
--     3. cancel the BOOKING     -> `bookings_cancel_internal_match()` cancels
--        the home fixture, and (1) takes the mirror with it
--   Status only. Nothing is deleted: the rows are the record the calendar, the
--   audit trail and next season's history read.
--
--   `bookings_fixture_guard()` refuses a status change on any booking that has
--   a `fixture_id`, because for a LEAGUE fixture the booking is a slot for a
--   game that exists whether or not the pitch does — cancelling the slot must
--   not silently cancel the game, so the administrator unallocates instead.
--   An internal match is the other case: the booking IS the match. The two
--   fixtures exist only because that request was confirmed, so cancelling it
--   cancels them. The guard is widened by exactly that one case — a pure
--   status-to-cancelled change on a booking whose fixture has a mirror — and
--   refuses everything else it always refused.
--
-- IDEMPOTENCY
--   `create_internal_match_fixtures()` takes a row lock on the booking, then
--   returns the existing pair unchanged if `fixtures.booking_id` already points
--   at it. Confirming twice — two clicks, a retried POST, two administrators at
--   once — creates two rows, not four.
--
-- EXTERNAL MATCHES ARE UNCHANGED
--   A free-typed opponent leaves `opponent_team_id` null, the web action never
--   calls the function, and the function refuses if it is called anyway. An
--   external match creates no fixture today and creates none after this.
--
-- SG-6 AND THE FIXTURE GUARDS ARE UNTOUCHED
--   A mirror is an ordinary `fixtures` row on the opposition's team. It reads
--   through `fixtures_read`, is written through `fixtures_staff_update`, is
--   selected for and reported on like any other. No policy on `fixtures`
--   changes in this migration.
--
-- DATA: none touched. No existing booking or fixture changes status, times,
-- team or resource. Two nullable columns are added and are null everywhere.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- widened; two SECURITY DEFINER functions and two AFTER triggers are added and
-- one BEFORE trigger function is widened by one case); data touched: none;
-- rollback:
--   drop trigger trg_bookings_cancel_internal_match on public.bookings;
--   drop trigger trg_fixtures_cancel_mirror on public.fixtures;
--   drop function public.bookings_cancel_internal_match();
--   drop function public.fixtures_cancel_mirror();
--   drop function public.create_internal_match_fixtures(uuid);
--   drop function public.request_team_pitch_booking(uuid, uuid,
--     public.booking_kind, timestamptz[], timestamptz[], text, text, text,
--     text, uuid, uuid);
--   then re-create `request_team_pitch_booking` and `bookings_fixture_guard`
--   from 20260825400000 / 20260823160000, re-create trg_bookings_fixture_guard
--   without `opponent_team_id` in its UPDATE OF list, and
--   `alter table public.fixtures drop column mirror_fixture_id;`
--   `alter table public.bookings drop column opponent_team_id;`
-- =============================================================================


-- =============================================================================
-- 1. COLUMNS
-- =============================================================================

-- Where the opposition TEAM lives. Before this, the only record of an internal
-- opponent was the sentence in `occasion`.
alter table public.bookings
  add column opponent_team_id uuid references public.teams (id) on delete set null;

-- Two facts, said as constraints rather than as hopes:
--   * only a match has an opposition team;
--   * a team does not play itself.
alter table public.bookings
  add constraint bookings_opponent_team_is_a_match
    check (opponent_team_id is null or kind = 'fixture'),
  add constraint bookings_opponent_team_not_self
    check (opponent_team_id is null or team_id is null or opponent_team_id <> team_id);

create index bookings_opponent_team_idx on public.bookings (opponent_team_id)
  where opponent_team_id is not null;

comment on column public.bookings.opponent_team_id is
  'The club team this match is against, when the opposition is internal. Null for an external opponent (whose name is only ever text) and for every non-match booking. Set at request time; read by create_internal_match_fixtures() when the request is confirmed.';


-- The other half of the pair. Set on BOTH rows — see the header for why a
-- self-reference beat a join table for a strictly-paired row.
alter table public.fixtures
  add column mirror_fixture_id uuid references public.fixtures (id) on delete set null;

create index fixtures_mirror_idx on public.fixtures (mirror_fixture_id)
  where mirror_fixture_id is not null;

comment on column public.fixtures.mirror_fixture_id is
  'The same match seen from the other club team''s side (an internal match creates two rows because fixtures.booking_id and bookings.fixture_id are both UNIQUE, so only one of them can hold the pitch booking). Set both ways by create_internal_match_fixtures(); cancelling either row cancels the other.';


-- =============================================================================
-- 2. fixtures_guard(): a fixture is not its own mirror
-- =============================================================================
-- Body identical to 20260823140000 apart from the third check. Kept in the
-- guard rather than as a CHECK constraint so the refusal is a sentence.

create or replace function public.fixtures_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.venue_resource_id is not null
     and exists (select 1 from public.resources r where r.id = new.venue_resource_id and r.type = 'function_room') then
    raise exception 'fixtures: venue_resource_id must be a pitch, not a function room' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.source = 'fulltime' and old.source = 'fulltime'
     and new.external_ref is distinct from old.external_ref then
    raise exception 'fixtures: external_ref of an imported fixture is immutable' using errcode = 'P0001';
  end if;
  if new.mirror_fixture_id = new.id then
    raise exception 'fixtures: a fixture cannot be the other side of itself' using errcode = 'P0001';
  end if;
  return new;
end;
$$;


-- =============================================================================
-- 3. The request carries the opposition team
-- =============================================================================
-- The old ten-argument signature is DROPPED rather than left beside the new
-- one. Two overloads differing only by a defaulted trailing parameter are
-- ambiguous to PostgREST when called with the original ten named arguments,
-- and an ambiguous RPC is a 300, not a booking.

drop function if exists public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid);

create or replace function public.request_team_pitch_booking(
  p_team_id uuid,
  p_resource_id uuid,
  p_kind public.booking_kind,
  p_starts timestamptz[],
  p_ends timestamptz[],
  p_booker_name text,
  p_booker_email text,
  p_occasion text default null,
  p_notes text default null,
  p_recurrence_group_id uuid default null,
  p_opponent_team_id uuid default null
)
  returns table (booking_id uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_person uuid := public.current_person_id();
  v_opponent uuid;
begin
  if v_person is null then
    raise exception 'bookings: your sign-in is not linked to a member record yet, so the club cannot record who is booking'
      using errcode = 'P0001';
  end if;
  if p_team_id is null then
    raise exception 'bookings: a pitch request is always for a team' using errcode = 'P0001';
  end if;
  if not public.is_pitch_resource(p_resource_id) then
    raise exception 'bookings: coaches may only book pitches' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('block', 'training', 'fixture') then
    raise exception 'bookings: a pitch request is training, a match or another use of the pitch'
      using errcode = 'P0001';
  end if;
  if p_starts is null or p_ends is null
     or coalesce(array_length(p_starts, 1), 0) = 0
     or array_length(p_starts, 1) <> array_length(p_ends, 1) then
    raise exception 'bookings: every session needs a start and an end' using errcode = 'P0001';
  end if;

  -- An opposition team only means anything on a match. Passed on anything
  -- else it is dropped rather than refused: the CHECK constraint would refuse
  -- it, and a training session is not made wrong by a stray parameter.
  v_opponent := case when p_kind = 'fixture' then p_opponent_team_id else null end;
  if v_opponent is not null and v_opponent = p_team_id then
    raise exception 'bookings: a team cannot play itself — choose the other team, or say the opposition is from outside the club'
      using errcode = 'P0001';
  end if;
  if v_opponent is not null and not exists (select 1 from public.teams t where t.id = v_opponent) then
    raise exception 'bookings: the opposition team does not exist' using errcode = 'P0001';
  end if;

  return query
  with inserted as (
    insert into public.bookings (
      resource_id, team_id, kind, status,
      starts_at, ends_at, blocked_from, blocked_until,
      booker_person_id, booker_profile_id, booker_name, booker_email,
      occasion, notes, recurrence_group_id, opponent_team_id
    )
    select p_resource_id,
           p_team_id,
           p_kind,
           'pending'::public.booking_status,   -- not a parameter. On purpose.
           slot.starts_at,
           slot.ends_at,
           slot.starts_at,
           slot.ends_at,
           v_person,
           auth.uid(),
           p_booker_name,
           p_booker_email,
           nullif(btrim(coalesce(p_occasion, '')), ''),
           nullif(btrim(coalesce(p_notes, '')), ''),
           p_recurrence_group_id,
           v_opponent
      from unnest(p_starts, p_ends) as slot(starts_at, ends_at)
    returning bookings.id
  )
  select inserted.id from inserted;
end;
$$;

revoke all privileges on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid, uuid)
  to authenticated, service_role;

comment on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid, uuid) is
  'The team pitch-booking path: always pending, whoever calls it. RLS still decides whether the row may exist; this only decides that it is a request. An internal match carries the opposition team id, which is what create_internal_match_fixtures() builds the mirrored pair from when an administrator confirms it.';


-- =============================================================================
-- 4. The pair itself
-- =============================================================================
-- The OUT columns are `match_fixture_id` / `match_team_id` / `at_home` and not
-- the obvious `fixture_id` / `team_id` / `is_home`: a `returns table` column IS
-- a plpgsql variable, and `bookings` has a `fixture_id` and a `team_id` while
-- `fixtures` has a `team_id` and an `is_home`. Naming them the obvious way
-- makes every query in the body ambiguous.

create or replace function public.create_internal_match_fixtures(p_booking_id uuid)
  returns table (match_fixture_id uuid, match_team_id uuid, at_home boolean)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  b         public.bookings%rowtype;
  v_season  uuid;
  v_minutes integer;
  v_home_name text;
  v_away_name text;
  v_home    uuid;
  v_away    uuid;
begin
  -- club_admin only, the same test `allocate_fixture()` applies. `auth.uid()
  -- is null` is the migration/service path, which has always been trusted here.
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'create_internal_match_fixtures: club_admin only' using errcode = '42501';
  end if;

  -- FOR UPDATE is the idempotency lock. Two administrators confirming the same
  -- request at the same moment queue here; the second one then sees the first
  -- one's fixtures below and returns them instead of making a second pair.
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'create_internal_match_fixtures: unknown booking %', p_booking_id using errcode = 'P0001';
  end if;
  if b.kind <> 'fixture' then
    raise exception 'create_internal_match_fixtures: that booking is not a match, so there is no fixture to create'
      using errcode = 'P0001';
  end if;
  if b.team_id is null then
    raise exception 'create_internal_match_fixtures: that match is not against a club team on either side'
      using errcode = 'P0001';
  end if;
  if b.opponent_team_id is null then
    raise exception 'create_internal_match_fixtures: that match is against a club from outside, which has no team page to put a fixture on'
      using errcode = 'P0001';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'create_internal_match_fixtures: fixtures are created when the request is confirmed, and that booking is %', b.status
      using errcode = 'P0001';
  end if;

  -- Already done. Confirming twice creates nothing the second time.
  select f.id into v_home from public.fixtures f where f.booking_id = p_booking_id;
  if v_home is not null then
    return query
      select f.id, f.team_id, f.is_home
        from public.fixtures f
       where f.id = v_home
          or f.id = (select m.mirror_fixture_id from public.fixtures m where m.id = v_home)
       order by f.is_home desc;
    return;
  end if;

  select s.id into v_season from public.seasons s where s.is_current limit 1;
  if v_season is null then
    raise exception 'create_internal_match_fixtures: the club has no current season, so a fixture has nowhere to go'
      using errcode = 'P0001';
  end if;

  -- The pitch slot's own length, clamped to what `fixtures.duration_minutes`
  -- allows. Taken from starts_at/ends_at, not blocked_from/blocked_until: the
  -- buffers are pitch time, not playing time.
  v_minutes := greatest(10, least(600,
    (extract(epoch from (b.ends_at - b.starts_at)) / 60)::integer));

  select t.name into v_home_name from public.teams t where t.id = b.team_id;
  select t.name into v_away_name from public.teams t where t.id = b.opponent_team_id;

  -- The HOME side: the team that asked for the pitch. This row takes the
  -- booking link, exactly the row `allocate_fixture()` would have written.
  insert into public.fixtures (
    team_id, season_id, opponent, is_home, kickoff_at, duration_minutes,
    venue_resource_id, status, source, created_by)
  values (b.team_id, v_season, coalesce(v_away_name, 'Club team'), true,
          b.starts_at, v_minutes, b.resource_id, 'scheduled', 'manual', auth.uid())
  returning id into v_home;

  -- The AWAY mirror on the opposition's team: same kickoff, same duration,
  -- same venue, and no booking — `fixtures.booking_id` is UNIQUE and the home
  -- row has it.
  insert into public.fixtures (
    team_id, season_id, opponent, is_home, kickoff_at, duration_minutes,
    venue_resource_id, status, source, created_by)
  values (b.opponent_team_id, v_season, coalesce(v_home_name, 'Club team'), false,
          b.starts_at, v_minutes, b.resource_id, 'scheduled', 'manual', auth.uid())
  returning id into v_away;

  -- `fixtures_default_duration()` (20260824200000) replaces a duration of
  -- exactly 90 with the team's matchday default. That is the right rule for a
  -- fixture typed in by hand; it is the wrong one here, because the pitch is
  -- booked for the slot the coach asked for and the two must describe the same
  -- window or `fixtures_sync_booking()` will later try to move the booking.
  -- Put back at a moment when `booking_id` is still null, so that trigger
  -- returns early and no booking is touched.
  update public.fixtures set duration_minutes = v_minutes
   where id in (v_home, v_away) and duration_minutes <> v_minutes;

  -- Each row learns about the other.
  update public.fixtures set mirror_fixture_id = v_away where id = v_home;
  update public.fixtures set mirror_fixture_id = v_home where id = v_away;

  -- The 1:1 link, both ways. `mirror_fixture_id` and `booking_id` are not in
  -- `trg_fixtures_sync_booking`'s UPDATE OF list, so neither of these fires it.
  update public.fixtures set booking_id = p_booking_id where id = v_home;

  -- `bookings_fixture_guard()` refuses a fixture_id change from outside; this
  -- is the inside, and it says so the way every other fixture write does.
  perform set_config('app.fixture_booking_managed', 'true', true);
  update public.bookings set fixture_id = v_home where id = p_booking_id;
  perform set_config('app.fixture_booking_managed', '', true);

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'fixtures.internal_match', 'bookings', p_booking_id::text,
          jsonb_build_object('home_fixture_id', v_home, 'away_fixture_id', v_away,
                             'home_team_id', b.team_id, 'away_team_id', b.opponent_team_id,
                             'kickoff_at', b.starts_at, 'season_id', v_season));

  return query
    select f.id, f.team_id, f.is_home
      from public.fixtures f
     where f.id in (v_home, v_away)
     order by f.is_home desc;
end;
$$;

revoke all privileges on function public.create_internal_match_fixtures(uuid) from public, anon;
grant execute on function public.create_internal_match_fixtures(uuid) to authenticated, service_role;

comment on function public.create_internal_match_fixtures(uuid) is
  'Turns a CONFIRMED internal-match pitch booking into two mirrored fixtures — home on the booking''s own team (which keeps the booking link), away on bookings.opponent_team_id — so both teams see the game on their own page. club_admin only. Idempotent: called again it returns the pair it already made.';


-- =============================================================================
-- 5. CANCELLING TAKES BOTH SIDES
-- =============================================================================

-- 5a. Either fixture cancels the other -----------------------------------------
-- Recursion terminates on the `status <> 'cancelled'` filter: the mirror's own
-- firing finds this row already cancelled and updates nothing.

create or replace function public.fixtures_cancel_mirror()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.mirror_fixture_id is null then return null; end if;
  if new.status <> 'cancelled' or old.status = 'cancelled' then return null; end if;
  update public.fixtures set status = 'cancelled'
   where id = new.mirror_fixture_id and status <> 'cancelled';
  return null;
end;
$$;
revoke all privileges on function public.fixtures_cancel_mirror() from public, anon, authenticated, service_role;

comment on function public.fixtures_cancel_mirror() is
  'An internal match is one game on two teams'' pages: cancelling either row cancels the other. Status only — nothing is deleted.';

drop trigger if exists trg_fixtures_cancel_mirror on public.fixtures;
create trigger trg_fixtures_cancel_mirror
  after update of status on public.fixtures
  for each row execute function public.fixtures_cancel_mirror();


-- 5b. Cancelling the booking cancels the pair ----------------------------------
-- Only for an internal match, and only when the fixture side is not already
-- driving: `app.fixture_booking_managed` is set by `fixtures_sync_booking()`
-- when a cancelled fixture cancels its booking, and by `unallocate_fixture()`,
-- which takes a game OFF a pitch without calling it off.

create or replace function public.bookings_cancel_internal_match()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if coalesce(current_setting('app.fixture_booking_managed', true), '') = 'true' then
    return null;
  end if;
  if new.fixture_id is null or new.status <> 'cancelled' or old.status = 'cancelled' then
    return null;
  end if;
  -- `mirror_fixture_id is not null` is what makes this an INTERNAL match. A
  -- league fixture's allocated slot never reaches here — `bookings_fixture_guard()`
  -- refuses that status change before this trigger could run.
  update public.fixtures set status = 'cancelled'
   where id = new.fixture_id and mirror_fixture_id is not null and status <> 'cancelled';
  return null;
end;
$$;
revoke all privileges on function public.bookings_cancel_internal_match() from public, anon, authenticated, service_role;

comment on function public.bookings_cancel_internal_match() is
  'For an internal match the booking IS the match: cancelling it cancels the home fixture, and fixtures_cancel_mirror() takes the away mirror with it.';

drop trigger if exists trg_bookings_cancel_internal_match on public.bookings;
create trigger trg_bookings_cancel_internal_match
  after update of status on public.bookings
  for each row execute function public.bookings_cancel_internal_match();


-- 5c. The guard lets that one change through -----------------------------------
-- Body identical to 20260823160000 apart from the two blocks marked NEW.

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

  -- NEW: the opposition of a match that already has its fixtures is not an
  -- editable field. Changing it here would leave two fixture rows describing a
  -- game against somebody else.
  if new.fixture_id is not null and new.opponent_team_id is distinct from old.opponent_team_id then
    raise exception 'bookings: this match already has its fixtures — cancel it and request the match again to change the opposition'
      using errcode = 'P0001';
  end if;

  -- NEW: an internal match's booking may be cancelled, and cancelling it is
  -- what calls the game off on both teams' pages (see the migration header for
  -- why a league fixture's slot is the opposite case). Nothing else about the
  -- row may move on the way through.
  if new.fixture_id is not null
     and new.status = 'cancelled' and old.status <> 'cancelled'
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at
     and new.resource_id = old.resource_id
     and new.fixture_id is not distinct from old.fixture_id
     and exists (select 1 from public.fixtures f
                  where f.id = new.fixture_id and f.mirror_fixture_id is not null) then
    return new;
  end if;

  if new.fixture_id is not null and (new.status <> old.status or new.starts_at <> old.starts_at
     or new.ends_at <> old.ends_at or new.resource_id <> old.resource_id or new.fixture_id is distinct from old.fixture_id) then
    raise exception 'bookings: this booking belongs to a fixture — change the fixture or use allocate_fixture()/unallocate_fixture()'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.bookings_fixture_guard() is
  'A booking linked to a fixture is managed through the fixture — except an internal match, whose booking IS the match and may be cancelled outright.';

-- `opponent_team_id` joins the UPDATE OF list so the new refusal can fire.
drop trigger if exists trg_bookings_fixture_guard on public.bookings;
create trigger trg_bookings_fixture_guard
  before delete or update of status, starts_at, ends_at, resource_id, fixture_id, opponent_team_id
  on public.bookings
  for each row execute function public.bookings_fixture_guard();


-- =============================================================================
-- 6. Audit the schema change itself
-- =============================================================================

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'fixtures',
        jsonb_build_object('migration', '20260825410000_internal_match_fixtures',
                           'changes', array['bookings.opponent_team_id records an internal opposition',
                                            'fixtures.mirror_fixture_id pairs the two sides of one match',
                                            'create_internal_match_fixtures() builds the pair on confirmation',
                                            'cancelling either fixture or the booking cancels both']));

notify pgrst, 'reload schema';
