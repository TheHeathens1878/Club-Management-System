-- The pitch calendar names both teams (2026-09-02).
--
-- Adam: "The home team still isn't showing on the pitch calendar." The match
-- diary was fixed in 20260902140000 (`fixture_event_title`); this is the
-- OTHER surface, and its own bug. `pitch_calendar()` built a fixture's label
-- as `t.name || ' v ' || opponent` with `t` joined on THE BOOKING's team_id —
-- and the newer allocation paths leave `bookings.team_id` null, so the label
-- came out " v Sale United U12 Mambas" with the home side missing.
--
-- A fixture always knows its team, so the team now comes from the booking OR
-- the fixture. The same fallback feeds the `team_id`/`team_name` columns,
-- which also repairs two quieter symptoms of the same null: the calendar's
-- "My teams" narrowing skipped these bookings, and a coach's manage link
-- never appeared on them.
--
-- Return type unchanged; both callers (web calendar, mobile sessions and the
-- coach desk) pick the fix up with no code change. Restated from the LIVE
-- definition (pg_get_functiondef, 2026-09-02).

create or replace function public.pitch_calendar(p_from timestamptz, p_to timestamptz)
  returns table(
    booking_id uuid, resource_id uuid, resource_name text, kind booking_kind,
    status booking_status, starts_at timestamptz, ends_at timestamptz,
    label text, team_id uuid, team_name text, fixture_id uuid, opponent text, is_home boolean,
    shared_team_ids uuid[], recurrence_group_id uuid
  )
  language sql stable security definer
  set search_path = public
as $function$
  select b.id, r.id, r.name, b.kind, b.status, b.starts_at, b.ends_at,
         case when b.kind = 'maintenance' then coalesce(b.occasion, 'Closed')
              when b.kind = 'fixture' then coalesce(tt.name, '') || ' v ' || coalesce(f.opponent, '')
              else coalesce(b.occasion, tt.name, b.kind::text) end,
         coalesce(b.team_id, f.team_id), tt.name, b.fixture_id, f.opponent, f.is_home,
         (select array_agg(bt.team_id) from public.booking_teams bt where bt.booking_id = b.id),
         b.recurrence_group_id
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  left join public.fixtures f on f.id = b.fixture_id
  left join public.teams tt on tt.id = coalesce(b.team_id, f.team_id)
  where r.type = 'pitch'
    and r.active
    and b.status in ('pending', 'confirmed')
    and b.ends_at > p_from and b.starts_at < p_to
    and (public.can_view_pitch_calendar() or public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  order by b.starts_at, r.sort_order, r.name;
$function$;
