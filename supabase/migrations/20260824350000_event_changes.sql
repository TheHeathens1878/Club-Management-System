-- =============================================================================
-- "The details have changed" — flag it, and tell the households
-- =============================================================================
-- Adam, 2026-08-25, on what should happen to accept/decline answers when a
-- fixture is moved: "I think it should remain but a notification should be sent
-- to the parents and the fixture also flagged that the details have changed."
--
-- So the answers stand — an RSVP still means something after a move, and wiping
-- the squad's answers would only create chasing — but nobody is left believing
-- an old kickoff time:
--
--   1. `events.details_changed_at` + `change_note` — the flag, and the sentence
--      saying what actually changed ("Kickoff moved from Sat 12 Sep 10:00 to
--      14:00. Venue changed from Ashton Park to Weathercock Farm.").
--   2. A household notification, BATCHED. A bulk kickoff or venue change (the
--      parallel session's whole-season allocation) is one statement, so this
--      uses statement-level triggers with transition tables: more than three
--      changed events for a team becomes ONE "13 events updated" message
--      rather than thirteen. Same batching rule as new events.
--   3. Per-person staleness: a response given BEFORE the change is reported as
--      stale (`event_responses.updated_at < events.details_changed_at`), so the
--      event page can say "you answered before these details changed" to the
--      people it actually applies to. Re-answering clears it by itself — no
--      acknowledgement column, no second state to keep in step.
--
-- What counts as a change: the kickoff moving, or the venue changing —
-- including a venue being set for the first time, which is the moment a parent
-- learns where to drive to. Cancellation is NOT handled here; it already has
-- its own path through the status sync.
--
-- Both directions are covered: fixtures (matches) and bookings (training and
-- anything else the pitch diary moves).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (two columns on an existing
-- table, no policy change); data touched: none — existing events are unflagged
-- until something actually changes; rollback: end.
-- =============================================================================


-- =============================================================================
-- 1. THE FLAG
-- =============================================================================

alter table public.events
  add column if not exists details_changed_at timestamptz,
  add column if not exists change_note        text;

comment on column public.events.details_changed_at is
  'When the kickoff or venue last changed. A response older than this was given against different details.';
comment on column public.events.change_note is
  'What changed, in words, for the badge on the event. Overwritten by the next change — the audit trail is audit_log.';


-- =============================================================================
-- 2. WHAT CHANGED, IN WORDS
-- =============================================================================

create or replace function public.event_change_note(
  p_old_starts timestamptz, p_new_starts timestamptz,
  p_old_venue text, p_new_venue text
)
  returns text
  language sql
  immutable
as $$
  select nullif(btrim(concat_ws(' ',
    case when p_old_starts is distinct from p_new_starts then
      'Moved from ' || to_char(p_old_starts at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
        || ' to ' || to_char(p_new_starts at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || '.'
    end,
    case
      when p_old_venue is null and p_new_venue is not null then 'Venue confirmed: ' || p_new_venue || '.'
      when p_new_venue is null and p_old_venue is not null then 'The venue is no longer set.'
      when p_old_venue is distinct from p_new_venue then 'Venue changed from ' || p_old_venue || ' to ' || p_new_venue || '.'
    end)), '');
$$;

-- The venue as a person reads it: the pitch's name, else the free text.
create or replace function public.venue_label(p_resource_id uuid, p_venue_text text)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce((select r.name from public.resources r where r.id = p_resource_id),
                  nullif(btrim(coalesce(p_venue_text, '')), ''));
$$;


-- =============================================================================
-- 3. FIXTURES → THE FLAG (row level, so each event carries its own sentence)
-- =============================================================================

create or replace function public.fixtures_events_sync_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note text;
begin
  -- Only a move or a venue change is "the details changed". A score, a note or
  -- a status flip is not, and cancellation has its own path below.
  if new.kickoff_at is distinct from old.kickoff_at
     or new.venue_resource_id is distinct from old.venue_resource_id
     or new.venue_text is distinct from old.venue_text then
    v_note := public.event_change_note(
      old.kickoff_at, new.kickoff_at,
      public.venue_label(old.venue_resource_id, old.venue_text),
      public.venue_label(new.venue_resource_id, new.venue_text));
  end if;

  update public.events e
     set starts_at         = new.kickoff_at,
         ends_at           = new.kickoff_at + make_interval(mins => public.fixture_event_minutes(new.team_id)),
         venue_resource_id = new.venue_resource_id,
         venue_text        = new.venue_text,
         title             = 'vs ' || new.opponent || case when new.is_home then ' (H)' else ' (A)' end,
         type              = public.event_type_for_competition(new.competition),
         status            = case when new.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status,
         details_changed_at = case when v_note is not null then now() else e.details_changed_at end,
         change_note        = case when v_note is not null then v_note else e.change_note end
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


-- =============================================================================
-- 4. BOOKINGS → THE FLAG
-- =============================================================================

create or replace function public.bookings_events_sync_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note text;
begin
  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.resource_id is distinct from old.resource_id then
    v_note := public.event_change_note(
      old.starts_at, new.starts_at,
      public.venue_label(old.resource_id, null),
      public.venue_label(new.resource_id, null));
  end if;

  update public.events e
     set starts_at         = new.starts_at,
         ends_at           = new.ends_at,
         venue_resource_id = new.resource_id,
         status            = case when new.status = 'cancelled' then 'cancelled' else 'scheduled' end::public.event_status,
         details_changed_at = case when v_note is not null then now() else e.details_changed_at end,
         change_note        = case when v_note is not null then v_note else e.change_note end
   where e.booking_id = new.id;
  return null;
end;
$$;


-- =============================================================================
-- 5. TELLING THE HOUSEHOLDS (statement level, so a bulk change is one message)
-- =============================================================================

/**
 * Notify a team's households that events changed — ONE message per burst.
 *
 * Batching per statement is not enough here, and the reason is worth writing
 * down: the bulk allocation screen loops and allocates one fixture at a time,
 * so re-timing a whole season is ~15 separate UPDATE statements, not one. A
 * statement-level trigger fires fifteen times and a naive implementation sends
 * fifteen messages.
 *
 * So the coalescing key is TIME, not the statement. The count comes from the
 * events table itself — everything for this team whose details changed inside
 * the window — and an unread "Details changed" message for the same team,
 * raised inside that window, is UPDATED in place rather than joined by a
 * second one. Fifteen statements therefore leave one message per household
 * that ends up reading "15 events … have changed". Its timestamp moves with
 * the burst so a long allocation run keeps merging into that one message; once
 * the household has read it, the next change starts a fresh one.
 *
 * The recipient rule is the one new events already use: adults for themselves,
 * guardians for their minors, and never the person whose own action caused it.
 */
create or replace function public.notify_events_changed(p_team_id uuid, p_event_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_window  constant interval := interval '10 minutes';
  v_actor   uuid := public.current_person_id();
  v_team    text;
  v_recent  integer;
  v_one     record;
  v_subject text;
  v_body    text;
  v_link    text;
  v_person  uuid;
  v_existing uuid;
begin
  if coalesce(array_length(p_event_ids, 1), 0) = 0 then return; end if;
  select name into v_team from public.teams where id = p_team_id;

  -- Everything for this team that has changed in the window, however many
  -- statements it took to change it.
  select count(*) into v_recent
  from public.events e
  where e.team_id = p_team_id
    and e.details_changed_at is not null
    and e.details_changed_at > now() - v_window
    and e.status = 'scheduled'
    and e.starts_at > now();

  if v_recent <= 1 then
    select e.id, e.title, e.change_note into v_one
    from public.events e where e.id = any(p_event_ids) order by e.starts_at limit 1;
    v_subject := 'Details changed: ' || coalesce(v_one.title, coalesce(v_team, 'your team'));
    v_body    := coalesce(v_team || ' — ', '') || coalesce(v_one.change_note, 'The details have changed.')
                 || ' Your answer still stands; change it if you need to.';
    v_link    := '/events/' || coalesce(v_one.id::text, '');
  else
    v_subject := 'Details changed: ' || coalesce(v_team, 'your team');
    v_body    := v_recent || ' events for ' || coalesce(v_team, 'your team')
                 || ' have changed — check the new times and venues.'
                 || ' Your answers still stand; change them if you need to.';
    v_link    := '/events';
  end if;

  for v_person in
    select distinct coalesce(g.guardian_person_id, m.person_id)
    from public.team_memberships m
    left join public.guardianships g
      on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
    where m.team_id = p_team_id and m.left_at is null
  loop
    if v_person is distinct from v_actor then
      select id into v_existing
      from public.outbound_messages
      where person_id = v_person
        and channel = 'in_app'
        and read_at is null
        and entity = 'events'
        and entity_id = p_team_id::text
        and subject like 'Details changed:%'
        and created_at > now() - v_window
      order by created_at desc
      limit 1;

      if v_existing is not null then
        update public.outbound_messages
           set subject = v_subject, body = v_body, link = v_link, created_at = now()
         where id = v_existing;
      else
        perform public.notify(v_person, v_subject, v_body, v_link, 'events', p_team_id::text);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.fixtures_changed_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_team record;
begin
  for v_team in
    select e.team_id, array_agg(e.id) as event_ids
    from new_rows n
    join old_rows o on o.id = n.id
    join public.events e on e.fixture_id = n.id
    where (n.kickoff_at is distinct from o.kickoff_at
           or n.venue_resource_id is distinct from o.venue_resource_id
           or n.venue_text is distinct from o.venue_text)
      and e.status = 'scheduled'
      and e.starts_at > now()
    group by e.team_id
  loop
    perform public.notify_events_changed(v_team.team_id, v_team.event_ids);
  end loop;
  return null;
end;
$$;

create trigger trg_fixtures_changed_notify
  after update on public.fixtures
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.fixtures_changed_notify();

create or replace function public.bookings_changed_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_team record;
begin
  for v_team in
    select e.team_id, array_agg(e.id) as event_ids
    from new_rows n
    join old_rows o on o.id = n.id
    join public.events e on e.booking_id = n.id
    where (n.starts_at is distinct from o.starts_at
           or n.ends_at is distinct from o.ends_at
           or n.resource_id is distinct from o.resource_id)
      and e.status = 'scheduled'
      and e.starts_at > now()
    group by e.team_id
  loop
    perform public.notify_events_changed(v_team.team_id, v_team.event_ids);
  end loop;
  return null;
end;
$$;

create trigger trg_bookings_changed_notify
  after update on public.bookings
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.bookings_changed_notify();


-- =============================================================================
-- 6. THE READERS CARRY THE FLAG
-- =============================================================================

-- event_people gains `response_stale`: this person answered before the details
-- changed, so their "accepted" is against the old time. A new OUT column means
-- the row type changes, which CREATE OR REPLACE cannot do — hence the drop.
drop function if exists public.event_people(uuid);
create or replace function public.event_people(p_event_id uuid)
  returns table (
    person_id       uuid,
    full_name       text,
    team_role       text,
    is_organiser    boolean,
    response        text,
    responded_at    timestamptz,
    can_respond     boolean,
    note            text,
    response_stale  boolean
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_team    uuid;
  v_staff   boolean;
  v_changed timestamptz;
begin
  select e.team_id, e.details_changed_at into v_team, v_changed
    from public.events e where e.id = p_event_id;
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
         case when v_staff or public.can_act_for(m.person_id) then min(r.note) end,
         v_changed is not null and min(r.updated_at) is not null and min(r.updated_at) < v_changed
  from public.team_memberships m
  join public.people p on p.id = m.person_id and p.deleted_at is null
  left join public.event_responses r on r.event_id = p_event_id and r.person_id = m.person_id
  where m.team_id = v_team and m.left_at is null
  group by m.person_id, p.first_name, p.last_name
  order by 4 desc, p.last_name, p.first_name;
end;
$$;

-- event_detail carries the flag and the sentence.
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
    'details_changed_at', e.details_changed_at,
    'change_note', e.change_note,
    'created_by_name', case
      when f.source = 'fulltime' then 'FA Full-Time import'
      else coalesce((select pp.first_name || ' ' || pp.last_name
                     from public.profiles pr join public.people pp on pp.id = pr.person_id
                     where pr.id = e.created_by), 'the club')
    end,
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

-- my_events: the list badge, and per-person staleness so the prompt lands on
-- the people it applies to. Same row-type change, same drop.
drop function if exists public.my_events(integer);
create or replace function public.my_events(p_horizon_days integer default 90)
  returns table (
    event_id           uuid,
    team_id            uuid,
    team_name          text,
    type               text,
    title              text,
    status             text,
    starts_at          timestamptz,
    ends_at            timestamptz,
    venue              text,
    fixture_id         uuid,
    series_id          uuid,
    is_staff           boolean,
    details_changed_at timestamptz,
    change_note        text,
    people             jsonb
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
         e.details_changed_at, e.change_note,
         (select coalesce(jsonb_agg(jsonb_build_object(
            'person_id', mp.person_id,
            'name', p.first_name || ' ' || p.last_name,
            'is_self', mp.person_id = (select pid from me),
            'response', er.status,
            'stale', e.details_changed_at is not null
                     and er.updated_at is not null
                     and er.updated_at < e.details_changed_at) order by p.first_name), '[]'::jsonb)
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


-- =============================================================================
-- 7. GRANTS
-- =============================================================================

revoke all privileges on function public.event_change_note(timestamptz, timestamptz, text, text) from public, anon;
revoke all privileges on function public.venue_label(uuid, text)                                 from public, anon;
revoke all privileges on function public.notify_events_changed(uuid, uuid[])                     from public, anon, authenticated;
grant execute on function public.event_change_note(timestamptz, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.venue_label(uuid, text)                                 to authenticated, service_role;
grant execute on function public.notify_events_changed(uuid, uuid[])                     to service_role;
revoke all privileges on function public.fixtures_changed_notify() from public, anon, authenticated, service_role;
revoke all privileges on function public.bookings_changed_notify() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop trigger trg_fixtures_changed_notify on fixtures; drop trigger
-- trg_bookings_changed_notify on bookings; drop functions
-- fixtures_changed_notify, bookings_changed_notify, notify_events_changed,
-- venue_label, event_change_note; restore fixtures_events_sync_update and
-- bookings_events_sync_update from 20260824290000/310000, and event_people,
-- event_detail, my_events from 20260824310000; alter table events drop column
-- change_note, drop column details_changed_at.
