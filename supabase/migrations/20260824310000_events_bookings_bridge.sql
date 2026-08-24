-- =============================================================================
-- Events ↔ pitch bookings bridge
-- =============================================================================
-- After the events module (20260824290000) the club had two systems describing
-- the same real-world session:
--
--   * a Practice created at /events/new collected RSVPs but reserved NO pitch,
--     so a coach could schedule a practice on a pitch already booked;
--   * training booked at /pitches/book reserved the pitch but never appeared on
--     /events — members answered through `booking_availability` instead;
--   * a fixture had TWO answer stores (`availability`, read by the selection
--     screens and the team-page headcount chips, and `event_responses`), so a
--     parent's answer on the event page was invisible to the coach's chips.
--
-- This migration joins them:
--
--   1. `events.booking_id` — the hard link for practice/social/training rows
--      (fixture events already link through `fixture_id`).
--   2. Event → booking: `create_team_event()` and an extended
--      `create_event_series()` reserve the pitch through the ordinary bookings
--      path, so `bookings_no_overlap` stays the single arbiter. A coach's
--      booking lands `pending`; a club admin's lands `confirmed`, exactly as
--      /pitches/book behaves. `cancel_team_event()` cancels both sides.
--   3. Booking → event: a statement-level AFTER INSERT on `bookings` mirrors
--      team training into a practice event (so /pitches/book needs no change
--      at all, and a 10-week series is ONE statement → one summary
--      notification), and an AFTER UPDATE keeps time/venue/cancellation in
--      step.
--   4. One answer per player: `event_responses` ↔ `availability` /
--      `booking_availability` sync in both directions, so every existing
--      reader (headcount chips, marker pages, selection, attendance panels)
--      keeps working with no UI change.
--
-- THE THREE SYNC RULES (agreed with the parallel session that owns the
-- availability readers):
--   · loop guard — every sync write is skipped when the counterpart already
--     holds the mapped value, so availability → event_responses → availability
--     terminates on the second hop. Direct writes from the marker pages and
--     the mobile toggles fire these triggers too, and must settle.
--   · guard failures are swallowed. `availability_guard()` demands a live
--     membership for the fixture's season; someone who answered and then left
--     the team mid-season would otherwise have their PRIMARY write refused by
--     a mirror we chose to attempt. The member's own click always wins; the
--     mirror is best-effort.
--   · `maybe` has no event_responses equivalent, so it REMOVES the response
--     row (the event then reads "No response"). Mapping is otherwise
--     accepted ↔ available and declined ↔ unavailable.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new column, policies
-- unchanged — the new RPCs are SECURITY DEFINER and gate themselves); data
-- touched: backfills events for future training bookings and event_responses
-- from existing availability (both idempotent); rollback: end.
-- =============================================================================


-- =============================================================================
-- 1. THE LINK COLUMN
-- =============================================================================

alter table public.events
  add column if not exists booking_id uuid references public.bookings (id) on delete set null;

create unique index if not exists events_booking_idx
  on public.events (booking_id) where booking_id is not null;

comment on column public.events.booking_id is
  'The pitch booking that reserves this event''s venue. Set by create_team_event/create_event_series, or by the bookings→events mirror for team training.';


-- =============================================================================
-- 2. HELPERS
-- =============================================================================

-- Is this resource a pitch we can reserve?
create or replace function public.is_bookable_pitch(p_resource_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource_id and r.active and r.type = 'pitch');
$$;

-- "Sat 12 Sep 18:00–19:00" — the label a clash is reported with.
create or replace function public.event_slot_label(p_starts_at timestamptz, p_ends_at timestamptz)
  returns text
  language sql
  immutable
as $$
  select to_char(p_starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
      || '–' || to_char(p_ends_at at time zone 'Europe/London', 'HH24:MI');
$$;

-- The booker snapshot `bookings` requires, for the calling coach.
create or replace function public.event_booker(out person_id uuid, out profile_id uuid, out full_name text, out email text)
  returns record
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id,
         pr.id,
         coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'Club member'),
         coalesce(p.email, u.email)
  from public.profiles pr
  join public.people p on p.id = pr.person_id
  join auth.users u on u.id = pr.id
  where pr.id = auth.uid();
$$;

/**
 * Reserve a pitch for an event. Returns the booking id, or null when the slot
 * is taken (the caller decides whether that is fatal — a one-off says so, a
 * series skips the week and carries on).
 *
 * The row is shaped exactly as /pitches/book writes it, so both paths produce
 * the same thing and `bookings_no_overlap` remains the single arbiter.
 */
create or replace function public.book_event_pitch(
  p_team_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_occasion text,
  p_recurrence_group_id uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_booker  record;
  v_status  public.booking_status;
  v_id      uuid;
begin
  if not public.is_bookable_pitch(p_resource_id) then
    return null;
  end if;
  if public.booking_has_conflict(p_resource_id, p_starts_at, p_ends_at) then
    return null;
  end if;

  select * into v_booker from public.event_booker();
  if v_booker.person_id is null or v_booker.email is null then
    raise exception 'This event cannot reserve a pitch: your sign-in is not linked to a member record with an email address. Ask a club administrator to link it.'
      using errcode = 'P0001';
  end if;

  -- Only a club administrator may hold a confirmed pitch; a coach's booking is
  -- a request, exactly as /pitches/book behaves.
  v_status := case when public.is_club_admin() then 'confirmed' else 'pending' end;

  insert into public.bookings
    (resource_id, team_id, kind, status, starts_at, ends_at,
     booker_person_id, booker_profile_id, booker_name, booker_email,
     occasion, recurrence_group_id)
  values
    (p_resource_id, p_team_id, 'training', v_status, p_starts_at, p_ends_at,
     v_booker.person_id, v_booker.profile_id, v_booker.full_name, v_booker.email,
     nullif(btrim(coalesce(p_occasion, '')), ''), p_recurrence_group_id)
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    -- Two coaches submitting at once: the constraint, not the pre-check, is
    -- what makes this safe. Treat it as "taken".
    return null;
end;
$$;


-- =============================================================================
-- 3. EVENT → BOOKING
-- =============================================================================

/**
 * Create a one-off event, optionally reserving its pitch.
 *
 * Replaces the raw INSERT the /events/new form used to do, so the booking and
 * the event are written in one transaction: an event never exists claiming a
 * pitch it did not get.
 */
create or replace function public.create_team_event(
  p_team_id uuid,
  p_type text,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_venue_resource_id uuid default null,
  p_venue_text text default null,
  p_notes text default null,
  p_book boolean default false
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_ends_at timestamptz;
  v_booking uuid;
  v_event   uuid;
begin
  if not (public.is_club_admin() or public.is_team_staff(p_team_id)) then
    raise exception 'create_team_event: only the team''s staff or a club admin may create events' using errcode = 'P0001';
  end if;
  if p_type not in ('league_match', 'cup_match', 'friendly', 'practice', 'social') then
    raise exception 'create_team_event: unknown event type' using errcode = 'P0001';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'create_team_event: the length must be between 15 minutes and 8 hours' using errcode = 'P0001';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);

  -- Set BEFORE the booking: the mirror is an AFTER STATEMENT trigger on the
  -- INSERT inside book_event_pitch, so it fires while we are still in here and
  -- would otherwise create its own event for the booking we are about to link.
  perform set_config('club.skip_booking_event', '1', true);

  if p_book and p_venue_resource_id is not null then
    v_booking := public.book_event_pitch(p_team_id, p_venue_resource_id, p_starts_at, v_ends_at, p_title);
    if v_booking is null then
      perform set_config('club.skip_booking_event', '', true);
      raise exception 'That pitch is already booked for % — nothing has been saved. Choose another time, date or pitch, or create the event without reserving the pitch.',
        public.event_slot_label(p_starts_at, v_ends_at) using errcode = 'P0001';
    end if;
  end if;

  insert into public.events
    (team_id, type, title, starts_at, ends_at, venue_resource_id, venue_text, notes, booking_id, created_by)
  values
    (p_team_id, p_type::public.event_type, btrim(p_title), p_starts_at, v_ends_at,
     p_venue_resource_id, nullif(btrim(coalesce(p_venue_text, '')), ''), p_notes, v_booking, auth.uid())
  returning id into v_event;

  perform set_config('club.skip_booking_event', '', true);
  return v_event;
end;
$$;

/**
 * The weekly series, now able to reserve each week's pitch.
 *
 * A clashing week keeps its EVENT and skips only the booking: the practice
 * still happens (a coach can move it, or play elsewhere), and the caller is
 * told which weeks are unreserved rather than losing the whole series.
 */
create or replace function public.create_event_series(
  p_team_id uuid,
  p_type text,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_repeat_until date,
  p_venue_resource_id uuid default null,
  p_venue_text text default null,
  p_notes text default null,
  p_book boolean default false
)
  returns table (series_id uuid, occurrences integer, booked integer, clashes text[])
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_series   uuid;
  v_n        integer;
  v_local    timestamp;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_booking  uuid;
  v_group    uuid := gen_random_uuid();
  v_booked   integer := 0;
  v_clashes  text[] := '{}';
  v_starts_all   timestamptz[] := '{}';
  v_ends_all     timestamptz[] := '{}';
  v_bookings_all uuid[] := '{}';
  k          integer;
begin
  if not (public.is_club_admin() or public.is_team_staff(p_team_id)) then
    raise exception 'create_event_series: only the team''s staff or a club admin may create events' using errcode = 'P0001';
  end if;
  if p_type not in ('league_match', 'cup_match', 'friendly', 'practice', 'social') then
    raise exception 'create_event_series: unknown event type' using errcode = 'P0001';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'create_event_series: the length must be between 15 minutes and 8 hours' using errcode = 'P0001';
  end if;
  v_local := p_starts_at at time zone 'Europe/London';
  if p_repeat_until < v_local::date then
    raise exception 'create_event_series: the until-date is before the first event' using errcode = 'P0001';
  end if;
  v_n := floor((p_repeat_until - v_local::date) / 7.0) + 1;
  if v_n > 60 then
    raise exception 'create_event_series: at most 60 occurrences (that is over a year of weekly events)' using errcode = 'P0001';
  end if;

  insert into public.event_series
    (team_id, type, title, venue_resource_id, venue_text, first_starts_at, duration_minutes, repeat_until, notes, created_by)
  values
    (p_team_id, p_type::public.event_type, btrim(p_title), p_venue_resource_id,
     nullif(btrim(coalesce(p_venue_text, '')), ''), p_starts_at, p_duration_minutes, p_repeat_until, p_notes, auth.uid())
  returning id into v_series;

  -- Bookings first, week by week: each occurrence learns whether it has a
  -- pitch before any event row is written.
  perform set_config('club.skip_booking_event', '1', true);

  for k in 0 .. v_n - 1 loop
    -- Weekly steps in London wall clock: an 18:00 practice stays 18:00 across
    -- the October change.
    v_starts := (v_local + make_interval(days => 7 * k)) at time zone 'Europe/London';
    v_ends   := (v_local + make_interval(days => 7 * k, mins => p_duration_minutes)) at time zone 'Europe/London';

    v_booking := null;
    if p_book and p_venue_resource_id is not null then
      v_booking := public.book_event_pitch(p_team_id, p_venue_resource_id, v_starts, v_ends, p_title, v_group);
      if v_booking is null then
        v_clashes := v_clashes || public.event_slot_label(v_starts, v_ends);
      else
        v_booked := v_booked + 1;
      end if;
    end if;

    v_starts_all   := v_starts_all   || v_starts;
    v_ends_all     := v_ends_all     || v_ends;
    v_bookings_all := array_append(v_bookings_all, v_booking);
  end loop;

  -- ONE insert for the whole series: the events notification trigger is
  -- statement-level, so the team gets a single "6 new events" summary rather
  -- than one message per week.
  insert into public.events
    (team_id, type, title, series_id, starts_at, ends_at, venue_resource_id, venue_text, notes, booking_id, created_by)
  select p_team_id, p_type::public.event_type, btrim(p_title), v_series,
         w.starts_at, w.ends_at,
         p_venue_resource_id, nullif(btrim(coalesce(p_venue_text, '')), ''), p_notes,
         w.booking_id, auth.uid()
  from unnest(v_starts_all, v_ends_all, v_bookings_all) as w(starts_at, ends_at, booking_id);

  perform set_config('club.skip_booking_event', '', true);

  return query select v_series, v_n, v_booked, v_clashes;
end;
$$;

/**
 * Cancel an event and, when it holds one, its pitch booking — so a cancelled
 * practice hands the pitch back instead of sitting on it.
 */
create or replace function public.cancel_team_event(p_event_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_event record;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'cancel_team_event: no such event' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin() or public.is_team_staff(v_event.team_id)) then
    raise exception 'cancel_team_event: only the team''s staff or a club admin may cancel events' using errcode = 'P0001';
  end if;
  if v_event.fixture_id is not null then
    raise exception 'This event mirrors a fixture — cancel or postpone the fixture instead.' using errcode = 'P0001';
  end if;

  update public.events set status = 'cancelled' where id = p_event_id;
  if v_event.booking_id is not null then
    update public.bookings set status = 'cancelled'
     where id = v_event.booking_id and status <> 'cancelled';
  end if;
end;
$$;


-- =============================================================================
-- 4. BOOKING → EVENT
-- =============================================================================

-- Statement-level, so a weekly series booked at /pitches/book arrives as ONE
-- insert into events and the >3-per-statement summary batching applies.
create or replace function public.bookings_events_sync_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if coalesce(current_setting('club.skip_booking_event', true), '') = '1' then
    return null;
  end if;
  insert into public.events
    (team_id, type, title, status, booking_id, starts_at, ends_at, venue_resource_id, created_by)
  select b.team_id,
         'practice'::public.event_type,
         coalesce(nullif(btrim(b.occasion), ''), 'Training'),
         'scheduled'::public.event_status,
         b.id,
         b.starts_at,
         b.ends_at,
         b.resource_id,
         -- The booker is the event's creator, so they are not notified about
         -- the training they just booked. Some paths set only the person.
         coalesce(b.booker_profile_id,
                  (select pr.id from public.profiles pr where pr.person_id = b.booker_person_id))
  from new_rows b
  where b.kind = 'training'
    and b.team_id is not null
    and b.status <> 'cancelled'
    and b.starts_at > now()
  on conflict (booking_id) where booking_id is not null do nothing;
  return null;
end;
$$;

create trigger trg_bookings_events_sync_insert
  after insert on public.bookings
  referencing new table as new_rows
  for each statement execute function public.bookings_events_sync_insert();

create or replace function public.bookings_events_sync_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.events e
     set starts_at         = new.starts_at,
         ends_at           = new.ends_at,
         venue_resource_id = new.resource_id,
         status            = case when new.status = 'cancelled' then 'cancelled' else 'scheduled' end::public.event_status
   where e.booking_id = new.id;
  return null;
end;
$$;

create trigger trg_bookings_events_sync_update
  after update on public.bookings
  for each row execute function public.bookings_events_sync_update();


-- =============================================================================
-- 5. ONE ANSWER PER PLAYER — event_responses ↔ availability
-- =============================================================================

create or replace function public.availability_for_response(p_status public.event_response_status)
  returns public.availability_status
  language sql
  immutable
as $$
  select case p_status when 'accepted' then 'available' else 'unavailable' end::public.availability_status;
$$;

/**
 * An RSVP on the event page, mirrored into the table the coach's screens read.
 *
 * Best-effort by design: `availability_guard()` refuses a person who has left
 * the team's season, and a mirror we chose to attempt must never cost the
 * member their own answer.
 */
create or replace function public.event_responses_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event record;
  v_mapped public.availability_status := public.availability_for_response(new.status);
begin
  select e.fixture_id, e.booking_id into v_event from public.events e where e.id = new.event_id;

  begin
    if v_event.fixture_id is not null then
      -- Skip when it already says this: the loop terminator.
      if exists (select 1 from public.availability a
                  where a.fixture_id = v_event.fixture_id and a.person_id = new.person_id
                    and a.status = v_mapped) then
        return null;
      end if;
      insert into public.availability (fixture_id, person_id, status, note, set_by)
      values (v_event.fixture_id, new.person_id, v_mapped, new.note, new.responded_by)
      on conflict (fixture_id, person_id) do update
        set status = excluded.status, note = excluded.note, set_by = excluded.set_by;

    elsif v_event.booking_id is not null then
      if exists (select 1 from public.booking_availability a
                  where a.booking_id = v_event.booking_id and a.person_id = new.person_id
                    and a.status = v_mapped) then
        return null;
      end if;
      insert into public.booking_availability (booking_id, person_id, status, note, set_by)
      values (v_event.booking_id, new.person_id, v_mapped, new.note, new.responded_by)
      on conflict (booking_id, person_id) do update
        set status = excluded.status, note = excluded.note, set_by = excluded.set_by;
    end if;
  exception
    when others then
      -- The member's own answer stands; the mirror is not worth their write.
      null;
  end;
  return null;
end;
$$;

create trigger trg_event_responses_sync
  after insert or update on public.event_responses
  for each row execute function public.event_responses_sync();

/**
 * The other direction: a coach's marker page, the mobile toggle, or the
 * /pitches/[id] panel writing availability directly updates the event RSVP.
 *
 * `maybe` has no RSVP equivalent, so it REMOVES the response: the event page
 * then reads "No response", which is the truthful rendering of "maybe" in a
 * two-way control.
 */
create or replace function public.availability_events_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event_id uuid;
  v_mapped   public.event_response_status;
begin
  if tg_table_name = 'availability' then
    select e.id into v_event_id from public.events e where e.fixture_id = new.fixture_id;
  else
    select e.id into v_event_id from public.events e where e.booking_id = new.booking_id;
  end if;
  if v_event_id is null then return null; end if;

  if new.status = 'maybe' then
    delete from public.event_responses r where r.event_id = v_event_id and r.person_id = new.person_id;
    return null;
  end if;

  v_mapped := case new.status when 'available' then 'accepted' else 'declined' end::public.event_response_status;
  -- Skip when it already says this: the loop terminator.
  if exists (select 1 from public.event_responses r
              where r.event_id = v_event_id and r.person_id = new.person_id and r.status = v_mapped) then
    return null;
  end if;

  begin
    insert into public.event_responses (event_id, person_id, status, note, responded_by)
    values (v_event_id, new.person_id, v_mapped, new.note, new.set_by)
    on conflict (event_id, person_id) do update
      set status = excluded.status, note = excluded.note, responded_by = excluded.responded_by;
  exception
    when others then null;
  end;
  return null;
end;
$$;

create trigger trg_availability_events_sync
  after insert or update on public.availability
  for each row execute function public.availability_events_sync();

create trigger trg_booking_availability_events_sync
  after insert or update on public.booking_availability
  for each row execute function public.availability_events_sync();


-- =============================================================================
-- 5b. NOBODY IS TOLD ABOUT THEIR OWN EVENT
-- =============================================================================
-- `events_guard` stamped `created_by := coalesce(auth.uid(), new.created_by)`,
-- which was right while every event was made by the person in the session. The
-- mirrors know better: a booking's event was created by its BOOKER and a
-- fixture's by whoever entered the fixture, whatever session the trigger
-- happens to run in. An explicit creator therefore wins, and auth.uid() fills
-- in only when none was supplied (every ordinary insert).
create or replace function public.events_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'authenticated' and old.fixture_id is not null then
      raise exception 'events: this event mirrors a fixture — cancel or delete the fixture instead' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if current_user = 'authenticated' and new.fixture_id is not null then
      raise exception 'events: fixture events are created automatically — create the fixture instead' using errcode = 'P0001';
    end if;
  elsif current_user = 'authenticated' and new.fixture_id is distinct from old.fixture_id then
    raise exception 'events: fixture_id is owned by the fixtures sync' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all privileges on function public.events_guard() from public, anon, authenticated, service_role;

-- `events_notify` skipped the acting session (`current_person_id()`), which
-- covered a coach creating an event in the app. A booking-mirrored event is
-- different: the trigger can fire from a definer path, a cron import or a
-- service role, where the actor is not the person who made the booking. Skip
-- the event's own creator as well, so a coach booking training is not told
-- about the training they just booked.
create or replace function public.events_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := public.current_person_id();
  v_team record;
  v_event record;
  v_person uuid;
  v_creator uuid;
  v_creators uuid[];
begin
  for v_team in
    select e.team_id, t.name, count(*) as n
    from new_rows e
    join public.teams t on t.id = e.team_id
    where e.status = 'scheduled' and e.starts_at > now()
    group by e.team_id, t.name
  loop
    if v_team.n > 3 then
      -- One summary per recipient (season import, whole series).
      select array_agg(distinct pr.person_id) into v_creators
        from new_rows e join public.profiles pr on pr.id = e.created_by
       where e.team_id = v_team.team_id and e.status = 'scheduled' and e.starts_at > now();
      for v_person in
        select distinct coalesce(g.guardian_person_id, m.person_id)
        from public.team_memberships m
        left join public.guardianships g
          on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
        where m.team_id = v_team.team_id and m.left_at is null
      loop
        if v_person is distinct from v_actor
           and not (coalesce(array_length(v_creators, 1), 0) = 1 and v_person = v_creators[1]) then
          perform public.notify(
            v_person,
            'New events: ' || v_team.name,
            v_team.n || ' new events have been added for ' || v_team.name
              || '. Open the events page to accept or decline.',
            '/events', 'events', v_team.team_id::text);
        end if;
      end loop;
    else
      for v_event in
        select e.* from new_rows e
        where e.team_id = v_team.team_id and e.status = 'scheduled' and e.starts_at > now()
      loop
        select pr.person_id into v_creator from public.profiles pr where pr.id = v_event.created_by;
        for v_person in
          select distinct coalesce(g.guardian_person_id, m.person_id)
          from public.team_memberships m
          left join public.guardianships g
            on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
          where m.team_id = v_team.team_id and m.left_at is null
        loop
          if v_person is distinct from v_actor and v_person is distinct from v_creator then
            perform public.notify(
              v_person,
              'New event: ' || v_event.title,
              v_team.name || ' — ' || replace(v_event.type::text, '_', ' ') || ' on '
                || to_char(v_event.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                || '. Accept or decline in the app.',
              '/events/' || v_event.id, 'events', v_event.id::text);
          end if;
        end loop;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;
revoke all privileges on function public.events_notify() from public, anon, authenticated, service_role;


-- =============================================================================
-- 6. event_detail — the booked badge now reads the hard link
-- =============================================================================

create or replace function public.event_detail(p_event_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'team_id', e.team_id,
    'team_name', t.name,
    'type', e.type,
    'title', e.title,
    'status', e.status,
    'fixture_id', e.fixture_id,
    'booking_id', e.booking_id,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'venue', coalesce(r.name, e.venue_text),
    'venue_is_home', e.venue_resource_id is not null,
    'notes', e.notes,
    'created_at', e.created_at,
    'created_by_name', case
      when f.source = 'fulltime' then 'FA Full-Time import'
      else coalesce((select pp.first_name || ' ' || pp.last_name
                     from public.profiles pr join public.people pp on pp.id = pr.person_id
                     where pr.id = e.created_by), 'the club')
    end,
    -- 'booked' (confirmed) / 'requested' (pending) / false. The hard link is
    -- the authority; the overlap search remains for events whose venue was
    -- booked separately.
    'booking_status', coalesce(
      (select b.status::text from public.bookings b where b.id = e.booking_id),
      (select b.status::text from public.bookings b
        where b.fixture_id = e.fixture_id and e.fixture_id is not null
          and b.status <> 'cancelled' order by b.status limit 1),
      (select b.status::text from public.bookings b
        where e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
          and b.status = 'confirmed'
          and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
          and b.ends_at > e.starts_at
          and (b.team_id = e.team_id
               or exists (select 1 from public.booking_teams bt
                          where bt.booking_id = b.id and bt.team_id = e.team_id))
        limit 1)),
    'booked', coalesce(
      (select b.status = 'confirmed' from public.bookings b where b.id = e.booking_id),
      exists (select 1 from public.bookings b
               where e.fixture_id is not null and b.fixture_id = e.fixture_id and b.status = 'confirmed'),
      false)
      or exists (select 1 from public.bookings b
                  where e.booking_id is null and e.fixture_id is null
                    and e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
                    and b.status = 'confirmed'
                    and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
                    and b.ends_at > e.starts_at
                    and (b.team_id = e.team_id
                         or exists (select 1 from public.booking_teams bt
                                    where bt.booking_id = b.id and bt.team_id = e.team_id))),
    'series', case when s.id is not null then jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'weekday', trim(to_char(s.first_starts_at at time zone 'Europe/London', 'Day')),
      'time', to_char(s.first_starts_at at time zone 'Europe/London', 'HH24:MI'),
      'repeat_until', s.repeat_until,
      'occurrences', (select count(*) from public.events se where se.series_id = s.id)
    ) end)
  from public.events e
  join public.teams t on t.id = e.team_id
  left join public.resources r on r.id = e.venue_resource_id
  left join public.fixtures f on f.id = e.fixture_id
  left join public.event_series s on s.id = e.series_id
  where e.id = p_event_id;
$$;


-- =============================================================================
-- 7. BACKFILL (notification trigger disabled — nobody is told about history)
-- =============================================================================

alter table public.events disable trigger trg_events_notify;

insert into public.events
  (team_id, type, title, status, booking_id, starts_at, ends_at, venue_resource_id, created_by)
select b.team_id, 'practice'::public.event_type,
       coalesce(nullif(btrim(b.occasion), ''), 'Training'),
       'scheduled'::public.event_status,
       b.id, b.starts_at, b.ends_at, b.resource_id,
       coalesce(b.booker_profile_id,
                (select pr.id from public.profiles pr where pr.person_id = b.booker_person_id))
from public.bookings b
where b.kind = 'training' and b.team_id is not null
  and b.status <> 'cancelled' and b.starts_at > now()
on conflict (booking_id) where booking_id is not null do nothing;

alter table public.events enable trigger trg_events_notify;

-- Answers already given, so nobody has to say it twice. `maybe` has no RSVP
-- equivalent and is left out; the membership join keeps the guard happy.
insert into public.event_responses (event_id, person_id, status, note, responded_by)
select e.id, a.person_id,
       (case a.status when 'available' then 'accepted' else 'declined' end)::public.event_response_status,
       a.note, a.set_by
from public.availability a
join public.events e on e.fixture_id = a.fixture_id
join public.team_memberships m on m.team_id = e.team_id and m.person_id = a.person_id and m.left_at is null
where a.status <> 'maybe' and e.starts_at > now()
on conflict (event_id, person_id) do nothing;

insert into public.event_responses (event_id, person_id, status, note, responded_by)
select e.id, a.person_id,
       (case a.status when 'available' then 'accepted' else 'declined' end)::public.event_response_status,
       a.note, a.set_by
from public.booking_availability a
join public.events e on e.booking_id = a.booking_id
join public.team_memberships m on m.team_id = e.team_id and m.person_id = a.person_id and m.left_at is null
where a.status <> 'maybe' and e.starts_at > now()
on conflict (event_id, person_id) do nothing;


-- =============================================================================
-- 8. GRANTS
-- =============================================================================

revoke all privileges on function public.is_bookable_pitch(uuid)                          from public, anon;
revoke all privileges on function public.event_slot_label(timestamptz, timestamptz)       from public, anon;
revoke all privileges on function public.event_booker()                                   from public, anon;
revoke all privileges on function public.book_event_pitch(uuid, uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
revoke all privileges on function public.availability_for_response(public.event_response_status) from public, anon;
revoke all privileges on function public.create_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, boolean) from public, anon;
revoke all privileges on function public.create_event_series(uuid, text, text, timestamptz, integer, date, uuid, text, text, boolean) from public, anon;
revoke all privileges on function public.cancel_team_event(uuid)                          from public, anon;

grant execute on function
  public.is_bookable_pitch(uuid), public.event_slot_label(timestamptz, timestamptz),
  public.event_booker(), public.availability_for_response(public.event_response_status),
  public.create_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, boolean),
  public.create_event_series(uuid, text, text, timestamptz, integer, date, uuid, text, text, boolean),
  public.cancel_team_event(uuid)
  to authenticated, service_role;
grant execute on function public.book_event_pitch(uuid, uuid, timestamptz, timestamptz, text, uuid) to service_role;

revoke all privileges on function public.bookings_events_sync_insert() from public, anon, authenticated, service_role;
revoke all privileges on function public.bookings_events_sync_update() from public, anon, authenticated, service_role;
revoke all privileges on function public.event_responses_sync()        from public, anon, authenticated, service_role;
revoke all privileges on function public.availability_events_sync()    from public, anon, authenticated, service_role;

-- The nine-argument create_event_series is replaced by the ten-argument one.
drop function if exists public.create_event_series(uuid, text, text, timestamptz, integer, date, uuid, text, text);

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the four triggers (bookings x2, availability, booking_availability) and
-- trg_event_responses_sync; drop functions availability_events_sync,
-- event_responses_sync, bookings_events_sync_update, bookings_events_sync_insert,
-- cancel_team_event, create_team_event, book_event_pitch, event_booker,
-- event_slot_label, is_bookable_pitch, availability_for_response; restore the
-- nine-argument create_event_series and the previous event_detail from
-- 20260824290000; alter table events drop column booking_id. Events and
-- responses created by the bridge stay (they are real answers).
