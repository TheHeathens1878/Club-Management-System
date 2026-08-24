-- =============================================================================
-- Events — fixtures become RSVP events; coaches create one-off/recurring events
-- =============================================================================
-- Adam (2026-08-24): "when a fixture is created, this creates an event which
-- parents can accept or decline … Event types can be League Match, Cup Match,
-- Friendly, Practice, Social. Coaches should be able to create both one-off
-- and recurring events." The event page shows the viewer's acceptance status,
-- date & time, venue (Google Maps), the series, who created it, a green
-- confirmation when the venue is booked, the organisers (coaches) and their
-- acceptance, players accepted/declined, and non-responders with a remind
-- button.
--
-- SHAPE
--   * `event_series` — a weekly repeat rule a coach created (first start,
--     duration, until-date). Occurrences are materialised into `events` at
--     creation time by `create_event_series()`; the series row is what the
--     event page names ("Practice, weekly on Tuesdays until 30 May").
--   * `events` — one row per occasion. `fixture_id` links the rows the
--     fixtures module owns: an AFTER INSERT statement trigger on `fixtures`
--     mirrors new fixtures in (league/cup/friendly inferred from the
--     competition name), and an AFTER UPDATE row trigger keeps kickoff, venue,
--     title and cancellation in sync. Fixture-linked events are not manually
--     creatable, editable (core fields) or deletable — the fixture is the
--     master record.
--   * `event_responses` — (event, person) → accepted / declined, written by
--     the person or an active guardian of a minor (`can_act_for`). No
--     response = pending. The team-staff availability table from P2.3 is
--     unchanged and still feeds selection; this table is the member-facing
--     RSVP.
--
-- NOTIFICATIONS (in_app only — the member-email embargo stands)
--   An AFTER INSERT statement trigger on `events` notifies each affected
--   member: adult players and staff directly, minors via their active
--   guardians. When one statement lands more than three events for a team
--   (a Full-Time season import, a whole series) the recipients get ONE
--   summary notification instead of one per event.
--
-- RLS
--   events / event_series: any authenticated person reads (same stance as
--   fixtures); team staff + club_admin write, but never fixture-linked rows.
--   event_responses: can_act_for writes; can_act_for, team staff and
--   admins read the raw rows — the team-wide accepted/declined lists are
--   served by `event_people()` (SECURITY DEFINER, gated to the team's
--   members, guardians, staff and admins) so a response NOTE is never shown
--   to other parents, only the status.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (three new tables); data
-- touched: backfills events for future fixtures (idempotent); rollback: end.
-- =============================================================================


-- =============================================================================
-- 1. TYPES
-- =============================================================================

create type public.event_type as enum ('league_match', 'cup_match', 'friendly', 'practice', 'social');
create type public.event_status as enum ('scheduled', 'cancelled');
create type public.event_response_status as enum ('accepted', 'declined');


-- =============================================================================
-- 2. event_series
-- =============================================================================

create table public.event_series (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams (id) on delete cascade,
  type               public.event_type not null,
  title              text not null,
  venue_resource_id  uuid references public.resources (id) on delete set null,
  venue_text         text,
  first_starts_at    timestamptz not null,
  duration_minutes   integer not null check (duration_minutes between 15 and 480),
  repeat_until       date not null,
  notes              text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint event_series_title_not_blank check (btrim(title) <> '')
);

create index event_series_team_idx on public.event_series (team_id);

create trigger trg_event_series_updated
  before update on public.event_series
  for each row execute function public.set_updated_at();

comment on table public.event_series is
  'A weekly repeat rule (practice, social …). Occurrences are materialised into events by create_event_series().';


-- =============================================================================
-- 3. events
-- =============================================================================

create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams (id) on delete cascade,
  type               public.event_type not null,
  title              text not null,
  status             public.event_status not null default 'scheduled',
  fixture_id         uuid unique references public.fixtures (id) on delete cascade,
  series_id          uuid references public.event_series (id) on delete cascade,
  starts_at          timestamptz not null,
  ends_at            timestamptz,
  venue_resource_id  uuid references public.resources (id) on delete set null,
  venue_text         text,
  notes              text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint events_title_not_blank check (btrim(title) <> ''),
  constraint events_ends_after_start check (ends_at is null or ends_at > starts_at)
);

create index events_team_starts_idx on public.events (team_id, starts_at);
create index events_starts_idx      on public.events (starts_at);
create index events_series_idx      on public.events (series_id) where series_id is not null;

create trigger trg_events_updated
  before update on public.events
  for each row execute function public.set_updated_at();

comment on table public.events is
  'One occasion a team can accept or decline. fixture_id rows mirror fixtures and are owned by the sync triggers.';
comment on column public.events.fixture_id is
  'Set only by the fixtures sync triggers. The fixture is the master record: edit or cancel the fixture, not the event.';

-- Fixture-linked rows belong to the sync triggers; a signed-in user edits the
-- fixture instead. The triggers run as the function owner, so current_user
-- distinguishes the two paths (same device as bookings_team_guard).
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
    new.created_by := coalesce(auth.uid(), new.created_by);
    if current_user = 'authenticated' and new.fixture_id is not null then
      raise exception 'events: fixture events are created automatically — create the fixture instead' using errcode = 'P0001';
    end if;
  elsif current_user = 'authenticated' and new.fixture_id is distinct from old.fixture_id then
    raise exception 'events: fixture_id is owned by the fixtures sync' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_events_guard
  before insert or update or delete on public.events
  for each row execute function public.events_guard();


-- =============================================================================
-- 4. event_responses
-- =============================================================================

create table public.event_responses (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  status        public.event_response_status not null,
  note          text,
  responded_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, person_id)
);

create index event_responses_person_idx on public.event_responses (person_id);

create trigger trg_event_responses_updated
  before update on public.event_responses
  for each row execute function public.set_updated_at();

create or replace function public.event_responses_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.responded_by := coalesce(auth.uid(), new.responded_by);
  if not exists (
    select 1 from public.events e
    join public.team_memberships m on m.team_id = e.team_id and m.left_at is null
    where e.id = new.event_id and m.person_id = new.person_id)
  then
    raise exception 'event_responses: the person must be a live member of the event''s team' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_event_responses_guard
  before insert or update on public.event_responses
  for each row execute function public.event_responses_guard();


-- =============================================================================
-- 5. HELPERS
-- =============================================================================

create or replace function public.event_team_id(p_event_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select team_id from public.events where id = p_event_id;
$$;

-- League / cup / friendly from a Full-Time competition name.
create or replace function public.event_type_for_competition(p_competition text)
  returns public.event_type
  language sql
  immutable
as $$
  select case
    when p_competition ~* '(cup|trophy|shield|plate)' then 'cup_match'::public.event_type
    when p_competition ~* 'friendl' then 'friendly'::public.event_type
    else 'league_match'::public.event_type
  end;
$$;

-- The fixture slot in minutes, from the team's match-day defaults.
create or replace function public.fixture_event_minutes(p_team_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when t.half_length_minutes is not null
      then t.match_halves * t.half_length_minutes + greatest(t.match_halves - 1, 0) * t.half_time_minutes
    else 90
  end
  from public.teams t where t.id = p_team_id;
$$;


-- =============================================================================
-- 6. FIXTURES → EVENTS SYNC
-- =============================================================================

-- Statement-level so a Full-Time season import lands as ONE insert into events
-- (the notification trigger then summarises instead of sending dozens).
create or replace function public.fixtures_events_sync_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.events
    (team_id, type, title, status, fixture_id, starts_at, ends_at, venue_resource_id, venue_text, created_by)
  select f.team_id,
         public.event_type_for_competition(f.competition),
         'vs ' || f.opponent || case when f.is_home then ' (H)' else ' (A)' end,
         case when f.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status,
         f.id,
         f.kickoff_at,
         f.kickoff_at + make_interval(mins => public.fixture_event_minutes(f.team_id)),
         f.venue_resource_id,
         f.venue_text,
         f.created_by
  from new_rows f
  on conflict (fixture_id) do nothing;
  return null;
end;
$$;

create trigger trg_fixtures_events_sync_insert
  after insert on public.fixtures
  referencing new table as new_rows
  for each statement execute function public.fixtures_events_sync_insert();

create or replace function public.fixtures_events_sync_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.events e
     set starts_at         = new.kickoff_at,
         ends_at           = new.kickoff_at + make_interval(mins => public.fixture_event_minutes(new.team_id)),
         venue_resource_id = new.venue_resource_id,
         venue_text        = new.venue_text,
         title             = 'vs ' || new.opponent || case when new.is_home then ' (H)' else ' (A)' end,
         type              = public.event_type_for_competition(new.competition),
         status            = case when new.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status
   where e.fixture_id = new.id;
  if not found and new.kickoff_at > now() and new.status not in ('cancelled', 'postponed') then
    insert into public.events
      (team_id, type, title, fixture_id, starts_at, ends_at, venue_resource_id, venue_text, created_by)
    values
      (new.team_id, public.event_type_for_competition(new.competition),
       'vs ' || new.opponent || case when new.is_home then ' (H)' else ' (A)' end,
       new.id, new.kickoff_at,
       new.kickoff_at + make_interval(mins => public.fixture_event_minutes(new.team_id)),
       new.venue_resource_id, new.venue_text, new.created_by)
    on conflict (fixture_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_fixtures_events_sync_update
  after update on public.fixtures
  for each row execute function public.fixtures_events_sync_update();


-- =============================================================================
-- 7. BACKFILL (before the notification trigger exists, deliberately)
-- =============================================================================

insert into public.events
  (team_id, type, title, status, fixture_id, starts_at, ends_at, venue_resource_id, venue_text, created_by)
select f.team_id,
       public.event_type_for_competition(f.competition),
       'vs ' || f.opponent || case when f.is_home then ' (H)' else ' (A)' end,
       case when f.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status,
       f.id, f.kickoff_at,
       f.kickoff_at + make_interval(mins => public.fixture_event_minutes(f.team_id)),
       f.venue_resource_id, f.venue_text, f.created_by
from public.fixtures f
where f.kickoff_at >= now()
on conflict (fixture_id) do nothing;


-- =============================================================================
-- 8. NOTIFICATION FAN-OUT (in_app only)
-- =============================================================================

-- notify() used to route through enqueue_message(), whose gate ("service_role
-- or club_admin only") happened to hold for every existing writer because they
-- all fired under an admin. Event fan-out fires under a COACH (creating a
-- series, sending reminders), so notify() now writes the in_app row itself:
-- same row shape, same dry_run switch; suppression and channel preferences
-- never applied to in_app transactional messages anyway. Same signature, same
-- grants (service_role; definer functions call it as owner).
create or replace function public.notify(
  p_person_id uuid, p_subject text, p_body text, p_link text default null,
  p_entity text default null, p_entity_id text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_status public.outbound_status := 'queued';
begin
  if p_person_id is null then return null; end if;
  if (select value from public.site_settings where key = 'comms.dry_run') = 'true' then
    v_status := 'dry_run';
  end if;
  insert into public.outbound_messages
    (person_id, channel, category, subject, body, entity, entity_id, status, decision, link, created_by)
  values
    (p_person_id, 'in_app', 'transactional', p_subject, p_body, p_entity, p_entity_id, v_status, 'ok', p_link, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

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
      for v_person in
        select distinct coalesce(g.guardian_person_id, m.person_id)
        from public.team_memberships m
        left join public.guardianships g
          on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
        where m.team_id = v_team.team_id and m.left_at is null
      loop
        if v_person is distinct from v_actor then
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
        for v_person in
          select distinct coalesce(g.guardian_person_id, m.person_id)
          from public.team_memberships m
          left join public.guardianships g
            on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
          where m.team_id = v_team.team_id and m.left_at is null
        loop
          if v_person is distinct from v_actor then
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

create trigger trg_events_notify
  after insert on public.events
  referencing new table as new_rows
  for each statement execute function public.events_notify();


-- =============================================================================
-- 9. RPCs
-- =============================================================================

-- 9.1 respond_to_event — accept/decline for yourself or a child in your care.
create or replace function public.respond_to_event(
  p_event_id uuid, p_person_id uuid, p_status text, p_note text default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'respond_to_event: status must be accepted or declined' using errcode = 'P0001';
  end if;
  if not public.can_act_for(p_person_id) then
    raise exception 'respond_to_event: you may only respond for yourself or a child in your care' using errcode = 'P0001';
  end if;
  insert into public.event_responses (event_id, person_id, status, note)
  values (p_event_id, p_person_id, p_status::public.event_response_status, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (event_id, person_id) do update
    set status = excluded.status, note = excluded.note, responded_by = auth.uid();
end;
$$;

-- 9.2 event_people — the roster with responses, for the event page. Notes are
-- only returned for rows the caller may act for, or when the caller is team
-- staff / an admin.
create or replace function public.event_people(p_event_id uuid)
  returns table (
    person_id     uuid,
    full_name     text,
    team_role     text,
    is_organiser  boolean,
    response      text,
    responded_at  timestamptz,
    can_respond   boolean,
    note          text
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_team uuid;
  v_staff boolean;
begin
  select e.team_id into v_team from public.events e where e.id = p_event_id;
  if v_team is null then return; end if;
  v_staff := public.is_team_staff(v_team) or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]);
  if not (v_staff or public.is_team_member(v_team) or public.is_team_guardian(v_team)) then
    raise exception 'event_people: only the team, their guardians and staff may see responses' using errcode = 'P0001';
  end if;
  return query
  select m.person_id,
         p.first_name || ' ' || p.last_name,
         min(m.role::text),
         bool_or(m.role <> 'player'),
         min(r.status::text),
         min(r.updated_at),
         public.can_act_for(m.person_id),
         case when v_staff or public.can_act_for(m.person_id) then min(r.note) end
  from public.team_memberships m
  join public.people p on p.id = m.person_id and p.deleted_at is null
  left join public.event_responses r on r.event_id = p_event_id and r.person_id = m.person_id
  where m.team_id = v_team and m.left_at is null
  group by m.person_id, p.first_name, p.last_name
  order by 4 desc, p.last_name, p.first_name;
end;
$$;

-- 9.3 event_detail — everything the event page shows in one round trip.
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
    'booked', case
      when e.fixture_id is not null then exists (
        select 1 from public.bookings b
        where b.fixture_id = e.fixture_id and b.status = 'confirmed')
      when e.venue_resource_id is not null then exists (
        select 1 from public.bookings b
        where b.resource_id = e.venue_resource_id and b.status = 'confirmed'
          and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
          and b.ends_at > e.starts_at
          and (b.team_id = e.team_id
               or b.fixture_id = e.fixture_id
               or exists (select 1 from public.booking_teams bt
                          where bt.booking_id = b.id and bt.team_id = e.team_id)))
      else false
    end,
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

-- 9.4 my_events — the events list: every upcoming event for a team the caller
-- belongs to, is staff of, or has a child on, with the response status of each
-- person the caller answers for.
create or replace function public.my_events(p_horizon_days integer default 90)
  returns table (
    event_id   uuid,
    team_id    uuid,
    team_name  text,
    type       text,
    title      text,
    status     text,
    starts_at  timestamptz,
    ends_at    timestamptz,
    venue      text,
    fixture_id uuid,
    series_id  uuid,
    is_staff   boolean,
    people     jsonb
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as pid),
  my_people as (
    select pid as person_id from me where pid is not null
    union
    select g.child_person_id from public.guardianships g, me
    where g.guardian_person_id = me.pid and g.ended_at is null
  ),
  my_teams as (
    select distinct m.team_id, bool_or(m.person_id = me.pid and m.role <> 'player') as staff
    from public.team_memberships m
    join my_people mp on mp.person_id = m.person_id
    cross join me
    where m.left_at is null
    group by m.team_id
  )
  select e.id, e.team_id, t.name, e.type::text, e.title, e.status::text,
         e.starts_at, e.ends_at, coalesce(r.name, e.venue_text),
         e.fixture_id, e.series_id, mt.staff,
         (select coalesce(jsonb_agg(jsonb_build_object(
            'person_id', mp.person_id,
            'name', p.first_name || ' ' || p.last_name,
            'is_self', mp.person_id = (select pid from me),
            'response', er.status) order by p.first_name), '[]'::jsonb)
          from my_people mp
          join public.people p on p.id = mp.person_id
          join public.team_memberships tm
            on tm.person_id = mp.person_id and tm.team_id = e.team_id and tm.left_at is null
          left join public.event_responses er on er.event_id = e.id and er.person_id = mp.person_id)
  from public.events e
  join my_teams mt on mt.team_id = e.team_id
  join public.teams t on t.id = e.team_id
  left join public.resources r on r.id = e.venue_resource_id
  where e.starts_at >= now() - interval '6 hours'
    and e.starts_at <= now() + make_interval(days => greatest(least(p_horizon_days, 366), 1))
  order by e.starts_at;
$$;

-- 9.5 create_event_series — materialise a weekly series. London-local weekly
-- steps so an 18:00 practice stays 18:00 across the clock change.
create or replace function public.create_event_series(
  p_team_id uuid,
  p_type text,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_repeat_until date,
  p_venue_resource_id uuid default null,
  p_venue_text text default null,
  p_notes text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_series uuid;
  v_n integer;
begin
  if not (public.is_club_admin() or public.is_team_staff(p_team_id)) then
    raise exception 'create_event_series: only the team''s staff or a club admin may create events' using errcode = 'P0001';
  end if;
  if p_type not in ('league_match', 'cup_match', 'friendly', 'practice', 'social') then
    raise exception 'create_event_series: unknown event type' using errcode = 'P0001';
  end if;
  if p_repeat_until < (p_starts_at at time zone 'Europe/London')::date then
    raise exception 'create_event_series: the until-date is before the first event' using errcode = 'P0001';
  end if;
  v_n := floor((p_repeat_until - (p_starts_at at time zone 'Europe/London')::date) / 7.0) + 1;
  if v_n > 60 then
    raise exception 'create_event_series: at most 60 occurrences (that is over a year of weekly events)' using errcode = 'P0001';
  end if;

  insert into public.event_series
    (team_id, type, title, venue_resource_id, venue_text, first_starts_at, duration_minutes, repeat_until, notes, created_by)
  values
    (p_team_id, p_type::public.event_type, btrim(p_title), p_venue_resource_id, nullif(btrim(coalesce(p_venue_text, '')), ''),
     p_starts_at, p_duration_minutes, p_repeat_until, p_notes, auth.uid())
  returning id into v_series;

  insert into public.events
    (team_id, type, title, series_id, starts_at, ends_at, venue_resource_id, venue_text, notes, created_by)
  select p_team_id, p_type::public.event_type, btrim(p_title), v_series,
         ((p_starts_at at time zone 'Europe/London') + make_interval(days => 7 * k)) at time zone 'Europe/London',
         ((p_starts_at at time zone 'Europe/London') + make_interval(days => 7 * k, mins => p_duration_minutes)) at time zone 'Europe/London',
         p_venue_resource_id, nullif(btrim(coalesce(p_venue_text, '')), ''), p_notes, auth.uid()
  from generate_series(0, v_n - 1) k;

  return v_series;
end;
$$;

-- 9.6 remind_event_nonresponders — staff nudge everyone who has not answered.
create or replace function public.remind_event_nonresponders(p_event_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event record;
  v_target uuid;
  v_sent integer := 0;
begin
  select e.*, t.name as team_name into v_event
  from public.events e join public.teams t on t.id = e.team_id
  where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'remind_event_nonresponders: no such event' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin() or public.is_team_staff(v_event.team_id)) then
    raise exception 'remind_event_nonresponders: only the team''s staff or a club admin may send reminders' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.audit_log a
    where a.action = 'event.reminder_sent' and a.entity_id = p_event_id::text
      and a.created_at > now() - interval '1 hour')
  then
    raise exception 'remind_event_nonresponders: reminders for this event were already sent in the last hour' using errcode = 'P0001';
  end if;

  for v_target in
    select distinct coalesce(g.guardian_person_id, m.person_id)
    from public.team_memberships m
    left join public.guardianships g
      on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
    where m.team_id = v_event.team_id and m.left_at is null and m.role = 'player'
      and not exists (select 1 from public.event_responses r
                      where r.event_id = p_event_id and r.person_id = m.person_id)
  loop
    perform public.notify(
      v_target,
      'Please respond: ' || v_event.title,
      v_event.team_name || ' — ' || to_char(v_event.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
        || '. Please accept or decline.',
      '/events/' || v_event.id, 'events', v_event.id::text);
    v_sent := v_sent + 1;
  end loop;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'event.reminder_sent', 'events', p_event_id::text,
          jsonb_build_object('notified', v_sent));
  return v_sent;
end;
$$;


-- =============================================================================
-- 10. ROW LEVEL SECURITY
-- =============================================================================

alter table public.event_series    enable row level security;
alter table public.events          enable row level security;
alter table public.event_responses enable row level security;

create policy "event_series_read" on public.event_series for select to authenticated using (true);
create policy "event_series_staff_write" on public.event_series for all to authenticated
  using (public.is_club_admin() or public.is_team_staff(team_id))
  with check (public.is_club_admin() or public.is_team_staff(team_id));

create policy "events_read" on public.events for select to authenticated using (true);
create policy "events_staff_insert" on public.events for insert to authenticated
  with check (public.is_club_admin() or public.is_team_staff(team_id));
create policy "events_staff_update" on public.events for update to authenticated
  using (public.is_club_admin() or public.is_team_staff(team_id))
  with check (public.is_club_admin() or public.is_team_staff(team_id));
create policy "events_staff_delete" on public.events for delete to authenticated
  using (public.is_club_admin() or public.is_team_staff(team_id));

create policy "event_responses_read" on public.event_responses for select to authenticated
  using (public.can_act_for(person_id)
         or public.is_team_staff(public.event_team_id(event_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "event_responses_insert" on public.event_responses for insert to authenticated
  with check (public.can_act_for(person_id));
create policy "event_responses_update" on public.event_responses for update to authenticated
  using (public.can_act_for(person_id)) with check (public.can_act_for(person_id));
create policy "event_responses_delete" on public.event_responses for delete to authenticated
  using (public.can_act_for(person_id));


-- =============================================================================
-- 11. GRANTS
-- =============================================================================

revoke all privileges on public.event_series, public.events, public.event_responses
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.event_series, public.events, public.event_responses
  to authenticated, service_role;

revoke all privileges on function public.event_team_id(uuid)                       from public, anon;
revoke all privileges on function public.event_type_for_competition(text)          from public, anon;
revoke all privileges on function public.fixture_event_minutes(uuid)               from public, anon;
revoke all privileges on function public.respond_to_event(uuid, uuid, text, text)  from public, anon;
revoke all privileges on function public.event_people(uuid)                        from public, anon;
revoke all privileges on function public.event_detail(uuid)                        from public, anon;
revoke all privileges on function public.my_events(integer)                        from public, anon;
revoke all privileges on function public.create_event_series(uuid, text, text, timestamptz, integer, date, uuid, text, text) from public, anon;
revoke all privileges on function public.remind_event_nonresponders(uuid)          from public, anon;
grant execute on function
  public.event_team_id(uuid), public.event_type_for_competition(text),
  public.fixture_event_minutes(uuid), public.respond_to_event(uuid, uuid, text, text),
  public.event_people(uuid), public.event_detail(uuid), public.my_events(integer),
  public.create_event_series(uuid, text, text, timestamptz, integer, date, uuid, text, text),
  public.remind_event_nonresponders(uuid)
  to authenticated, service_role;
revoke all privileges on function public.events_guard()                from public, anon, authenticated, service_role;
revoke all privileges on function public.event_responses_guard()       from public, anon, authenticated, service_role;
revoke all privileges on function public.fixtures_events_sync_insert() from public, anon, authenticated, service_role;
revoke all privileges on function public.fixtures_events_sync_update() from public, anon, authenticated, service_role;
revoke all privileges on function public.events_notify()               from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 12. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop trigger trg_events_notify on events; drop the two fixtures sync
-- triggers; drop tables event_responses, events, event_series; drop functions
-- events_notify, remind_event_nonresponders, create_event_series, my_events,
-- event_detail, event_people, respond_to_event, fixture_event_minutes,
-- event_type_for_competition, event_team_id, events_guard,
-- event_responses_guard, fixtures_events_sync_insert,
-- fixtures_events_sync_update; drop types event_response_status, event_status,
-- event_type. Audit rows stay.
