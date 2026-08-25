-- =============================================================================
-- "Meet at" — an event has an arrival time, not just a kick-off
-- =============================================================================
-- Adam, 2026-08-25: "When creating an event, there needs to be a 'Meet at'
-- time and not just the KO time. This should default to 30 mins before KO."
--
-- Stored as MINUTES BEFORE START, not as a timestamp, deliberately: when a
-- fixture is rescheduled (kickoff moves, the sync moves the event) the meet
-- time moves with it — "half an hour before kick-off" survives every
-- reschedule, where a stored clock time would quietly point at the old
-- morning. The page renders `starts_at - meet_minutes_before`.
--
-- Defaults: matches (league, cup, friendly) get 30 minutes unless the coach
-- says otherwise — including every fixture the Full-Time import mirrors in.
-- Practices and socials default to none; a coach can set one on any event.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (one column, staff update
-- policy already covers it); data touched: future match events backfilled to
-- 30 minutes; rollback: end.
-- =============================================================================

alter table public.events
  add column if not exists meet_minutes_before integer
    check (meet_minutes_before is null or meet_minutes_before between 0 and 240);

comment on column public.events.meet_minutes_before is
  'Arrive this many minutes before starts_at. Relative, so a reschedule carries it. Null = no separate meet time.';

-- Matches default to 30 minutes at insert — the fixtures sync and the coach
-- form both pass through here, so neither needs to know the rule.
create or replace function public.events_meet_default()
  returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  if new.meet_minutes_before is null
     and new.type in ('league_match', 'cup_match', 'friendly') then
    new.meet_minutes_before := 30;
  end if;
  return new;
end;
$$;

create trigger trg_events_meet_default
  before insert on public.events
  for each row execute function public.events_meet_default();

revoke all privileges on function public.events_meet_default() from public, anon, authenticated, service_role;

-- The matches already in the diary get the same default.
update public.events
   set meet_minutes_before = 30
 where meet_minutes_before is null
   and type in ('league_match', 'cup_match', 'friendly')
   and status = 'scheduled'
   and starts_at > now();

-- event_detail() carries the computed meet time for the page.
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
    'meet_minutes_before', e.meet_minutes_before,
    'meet_at', case when e.meet_minutes_before is not null
                    then e.starts_at - make_interval(mins => e.meet_minutes_before) end,
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

notify pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop trigger trg_events_meet_default on events; drop function
-- events_meet_default; restore event_detail from 20260824350000; alter table
-- events drop column meet_minutes_before.
