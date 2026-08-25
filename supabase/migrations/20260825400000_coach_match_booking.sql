-- =============================================================================
-- The team path is a REQUEST desk, and a coach may ask for a match
-- =============================================================================
-- Adam, 2026-08-25, looking at /pitches/book while wearing the Coach hat:
--   1. "I can still book a pitch as confirmed using my coach login … remove
--      this functionality."
--   3. "In what is the pitch for, match should be an option."
--   4. "If match is selected, it should ask if the opposition is internal (and
--      then choose the team) or external (free type)."
--
-- WHY 20260825170000 WAS NOT ENOUGH
--   `bookings_team_guard()` pins a non-admin's pitch booking to `pending`, but
--   its first branch EXEMPTS `has_any_role(['staff','club_admin'])`. Adam's
--   sign-in is committee, which maps to club_admin, so wearing the coach hat
--   changed the screen and nothing else: the row he posted said `confirmed`
--   and the database had no reason to argue.
--
--   The exemption itself is deliberate and STAYS. Read 20260825170000's header:
--   narrowing it would take pitch closures and the diary away from the staff
--   who run the function-room desk. A hat is a cookie; the database cannot see
--   it and must not be asked to guess at it from a role.
--
-- WHAT THIS MIGRATION DOES INSTEAD — pin the PATH, not the person
--   `request_team_pitch_booking()` is the team path made explicit. It writes
--   `status = 'pending'` unconditionally: there is no argument, no default and
--   no branch that can produce a confirmed row, so a client calling it cannot
--   get one whatever role it holds. It is `security invoker` on purpose — RLS
--   still decides whether the row may exist at all (`bookings_team_staff_insert`
--   for a coach, `bookings_staff_insert` for an administrator), and
--   `bookings_team_guard()` still runs. The function adds one guarantee and
--   takes none away.
--
--   The screen picks the path from the hat: Coach hat -> this function, admin
--   hat -> the direct insert an administrator has always had. An administrator
--   who reaches past the screen still holds the role that may confirm — the hat
--   is a working convention, not a privilege boundary, and this migration does
--   not pretend otherwise.
--
-- MATCH BOOKINGS (asks 3 and 4)
--   A match is `booking_kind = 'fixture'`. `bookings_team_staff_insert` allowed
--   only `('block','training')`, so it is widened to allow `'fixture'` too, and
--   `bookings_team_guard()` gains the fence that makes that safe:
--     * a coach's INSERT may not carry a `fixture_id` — links to a real fixture
--       row are `allocate_fixture()`'s alone;
--     * a coach may not touch a booking that ALREADY has a `fixture_id`, so the
--       allocator's own slots stay the club administrator's to move or cancel.
--   The opposition (internal team or free-typed club) is carried in `occasion`,
--   the label the calendar already shows — no column is added, and no fixture
--   row is created (see the PR body).
--
-- WHAT IS UNCHANGED: every policy on `bookings` except the one INSERT policy
-- named below; the staff/club_admin exemption in `bookings_team_guard()`;
-- `book_event_pitch()`, `allocate_fixture()` and the events path.
--
-- DATA: none touched. No existing booking's status, kind, times or resource
-- changes.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one INSERT policy widened by
-- one enum value); data touched: none; rollback:
--   `drop function if exists public.request_team_pitch_booking(uuid, uuid,
--      public.booking_kind, timestamptz[], timestamptz[], text, text, text,
--      text, uuid);`
--   then re-create `bookings_team_staff_insert` with
--      `kind in ('block','training')` and `create or replace function
--      public.bookings_team_guard()` from 20260825170000.
-- =============================================================================


-- 1. A coach may ask for a match ----------------------------------------------
-- One enum value wider, and nothing else in the policy moves: still a pitch,
-- still a team they staff, still `pending`, still booked as themselves.

drop policy if exists "bookings_team_staff_insert" on public.bookings;
create policy "bookings_team_staff_insert" on public.bookings
  for insert to authenticated
  with check (
    public.is_pitch_resource(resource_id)
    and team_id is not null and public.is_team_staff(team_id)
    and kind in ('block', 'training', 'fixture')
    and status = 'pending'
    and booker_person_id = public.current_person_id()
  );


-- 2. The guard: match yes, the allocator's fixtures no -------------------------

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
    -- Everything below is about a PITCH. A non-pitch row from a caller with no
    -- staff role is not this guard's to explain — `bookings_team_staff_insert`
    -- refuses it with the 42501 it has always given, and stepping in front of
    -- that with a sentence about coaches would only mislead.
    if public.is_pitch_resource(new.resource_id) then
      if new.kind not in ('block', 'training', 'fixture') then
        raise exception 'bookings: coaches may only request training, match or other-use slots'
          using errcode = 'P0001';
      end if;
      -- A match REQUEST is not a fixture allocation. The link between a booking
      -- and a `fixtures` row is `allocate_fixture()`'s to make.
      if new.fixture_id is not null then
        raise exception 'bookings: a fixture''s pitch slot is allocated on Pitches, not requested here'
          using errcode = 'P0001';
      end if;
      -- A pitch booking made by anyone who is not a club administrator is a
      -- REQUEST. Whatever the client posted, it lands on the requests desk.
      if coalesce(new.status, 'pending'::public.booking_status) <> 'pending'::public.booking_status then
        new.status := 'pending'::public.booking_status;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'cancelled' then
    raise exception 'bookings: a cancelled booking cannot be changed' using errcode = 'P0001';
  end if;
  -- The allocator's own slots: a coach cancelling their team's league game out
  -- of the diary is exactly the surprise the pitch diary must not have.
  if old.fixture_id is not null then
    raise exception 'bookings: that slot belongs to a fixture — a club administrator unallocates it on Pitches'
      using errcode = 'P0001';
  end if;
  if new.status <> old.status and new.status <> 'cancelled' then
    raise exception 'bookings: only a club administrator can confirm a pitch booking — it is waiting on Pitch requests'
      using errcode = 'P0001';
  end if;
  if new.status = old.status and old.status <> 'pending' then
    raise exception 'bookings: a confirmed booking can only be cancelled — ask a club administrator to change it' using errcode = 'P0001';
  end if;
  if new.resource_id <> old.resource_id and not public.is_pitch_resource(new.resource_id) then
    raise exception 'bookings: coaches may only book pitches' using errcode = 'P0001';
  end if;
  if new.kind not in ('block', 'training', 'fixture') then
    raise exception 'bookings: coaches may only request training, match or other-use slots'
      using errcode = 'P0001';
  end if;
  if new.fixture_id is distinct from old.fixture_id then
    raise exception 'bookings: fixture links are managed through allocate_fixture()' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all privileges on function public.bookings_team_guard() from public, anon, authenticated, service_role;

comment on function public.bookings_team_guard() is
  'What a non-admin may do to a pitch booking: request a future training, match or other-use slot (pinned to pending, whatever was posted), edit it while it is pending, cancel it. Confirming is a club administrator''s alone, and so is anything already linked to a fixture.';

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE, per row) — it is
-- re-declared only so a fresh database gets it in one place.
drop trigger if exists trg_bookings_team_guard on public.bookings;
create trigger trg_bookings_team_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_team_guard();


-- 3. The team path, made explicit ---------------------------------------------
-- Called by /pitches/book whenever the person is acting as a coach — including
-- an administrator wearing the Coach hat. `status` is not a parameter, so this
-- function cannot produce a confirmed booking for anybody.
--
-- `security invoker`: RLS is still the door. A coach gets in through
-- `bookings_team_staff_insert` (their own team, pitch, pending, themselves); an
-- administrator through `bookings_staff_insert`; anyone else gets the ordinary
-- 42501 and no row.
--
-- One INSERT statement, not a loop: a weekly repeat is atomic, and the
-- statement-level `trg_pitch_request_notify` sends the desk ONE message for the
-- whole series rather than one per week.

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
  p_recurrence_group_id uuid default null
)
  -- `returns table` rather than `setof uuid`: PostgREST then hands the client
  -- rows with a named column, which is what `.rpc()` and the generated types
  -- expect, instead of a bare array whose shape depends on the version. The
  -- column is `booking_id`, not `id`, because a `returns table` column IS a
  -- plpgsql variable — one called `id` would shadow `bookings.id` in the query
  -- below and make the reference ambiguous.
  returns table (booking_id uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_person uuid := public.current_person_id();
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

  return query
  with inserted as (
    insert into public.bookings (
      resource_id, team_id, kind, status,
      starts_at, ends_at, blocked_from, blocked_until,
      booker_person_id, booker_profile_id, booker_name, booker_email,
      occasion, notes, recurrence_group_id
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
           p_recurrence_group_id
      from unnest(p_starts, p_ends) as slot(starts_at, ends_at)
    returning bookings.id
  )
  select inserted.id from inserted;
end;
$$;

revoke all privileges on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid)
  from public, anon;
grant execute on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid)
  to authenticated, service_role;

comment on function public.request_team_pitch_booking(
  uuid, uuid, public.booking_kind, timestamptz[], timestamptz[], text, text, text, text, uuid) is
  'The team pitch-booking path: always pending, whoever calls it. RLS still decides whether the row may exist; this only decides that it is a request.';


-- 4. Audit the schema change itself -------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260825400000_coach_match_booking',
                           'changes', array['request_team_pitch_booking() always writes pending',
                                            'bookings_team_staff_insert allows kind = fixture',
                                            'bookings_team_guard fences fixture_id off from the coach path']));

notify pgrst, 'reload schema';
