-- =============================================================================
-- The clashes report skips central-venue teams (20260905140000)
-- =============================================================================
-- Adam, 2026-09-05: "remove the central venue teams from the pitch clash
-- table and introduce the ability for an admin to allocate a pitch from
-- there, and also click into fixture."
--
-- A team with `teams.central_venue_name` set plays at a ground the club does
-- not manage; its fixtures never occupy our pitches (20260824340000), and the
-- allocator's `unallocated_home_fixtures` view stopped listing them on
-- 2026-09-04 (20260904090000). The clashes report's "still waiting for a
-- pitch" section did not get the same predicate, so every central-venue home
-- fixture sat there as a thing to untangle. Same predicate, same place.
--
-- The flagged section also carries `venue_resource_id` now, so the report
-- page can offer the allocator control on a flagged fixture with its current
-- pitch pre-selected — the same control the allocator uses, not a second one.
--
-- The rest of the function is the 20260825000000 text unchanged.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n. One SECURITY DEFINER report
-- function restated; the administrator guard is unchanged. Data touched:
-- none. Rollback: restore the body from 20260825000000.
-- =============================================================================

create or replace function public.pitch_clash_report(p_horizon_days integer default 60)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_horizon     timestamptz;
  v_flagged     jsonb;
  v_overlaps    jsonb;
  v_drift       jsonb;
  v_unallocated jsonb;
begin
  if not (public.is_club_admin()
          or exists (select 1 from public.profiles pr
                     where pr.id = auth.uid() and pr.role in ('committee', 'super_user'))) then
    raise exception 'pitch_clash_report: the clashes report is for administrators'
      using errcode = 'P0001';
  end if;

  if p_horizon_days is null or p_horizon_days < 1 or p_horizon_days > 365 then
    raise exception 'pitch_clash_report: the horizon must be between 1 and 365 days'
      using errcode = 'P0001';
  end if;
  v_horizon := now() + make_interval(days => p_horizon_days);

  -- 1. Fixtures the Full-Time sync could not move ------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'fixture_id',        x.id,
           'team_id',           x.team_id,
           'team_name',         x.team_name,
           'opponent',          x.opponent,
           'competition',       x.competition,
           'kickoff_at',        x.kickoff_at,
           'pitch_name',        x.pitch_name,
           'venue_resource_id', x.venue_resource_id,
           'conflicts',         x.conflicts,
           'flagged_at',        x.flagged_at
         ) order by x.kickoff_at), '[]'::jsonb)
    into v_flagged
  from (
    select f.id, f.team_id, t.name as team_name, f.opponent, f.competition,
           f.kickoff_at, r.name as pitch_name, f.venue_resource_id,
           c.conflicts, c.created_at as flagged_at
    from public.fixtures f
    join public.teams t on t.id = f.team_id
    left join public.resources r on r.id = f.venue_resource_id
    left join lateral (
      select a.detail ->> 'conflicts' as conflicts, a.created_at
      from public.audit_log a
      where a.action = 'fixtures.allocation_conflict'
        and a.entity = 'fixtures'
        and a.entity_id = f.id::text
      order by a.created_at desc
      limit 1
    ) c on true
    where f.allocation_conflict
      and f.status = 'scheduled'
      and f.kickoff_at >= now() - interval '1 day'
  ) x;

  -- 2. One team, two places at once -------------------------------------------
  with team_bookings as (
    select b.id, b.kind, b.starts_at, b.ends_at, b.resource_id,
           coalesce(b.occasion, b.booker_name) as label, tb.team_id
    from public.bookings b
    cross join lateral (
      select b.team_id as team_id
      union
      select bt.team_id from public.booking_teams bt where bt.booking_id = b.id
      union
      select f2.team_id from public.fixtures f2 where f2.booking_id = b.id
    ) tb
    where tb.team_id is not null
      and b.status in ('pending', 'confirmed')
      and b.ends_at >= now()
      and b.starts_at < v_horizon
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id',   p.team_id,
           'team_name', t.name,
           'first',  jsonb_build_object(
             'booking_id', p.a_id, 'kind', p.a_kind, 'label', p.a_label,
             'pitch_name', ra.name, 'starts_at', p.a_starts, 'ends_at', p.a_ends),
           'second', jsonb_build_object(
             'booking_id', p.b_id, 'kind', p.b_kind, 'label', p.b_label,
             'pitch_name', rb.name, 'starts_at', p.b_starts, 'ends_at', p.b_ends)
         ) order by p.a_starts, t.name), '[]'::jsonb)
    into v_overlaps
  from (
    select a.team_id,
           a.id  as a_id, a.kind::text  as a_kind, a.label  as a_label,
           a.resource_id  as a_resource, a.starts_at  as a_starts, a.ends_at  as a_ends,
           b2.id as b_id, b2.kind::text as b_kind, b2.label as b_label,
           b2.resource_id as b_resource, b2.starts_at as b_starts, b2.ends_at as b_ends
    from team_bookings a
    join team_bookings b2
      on b2.team_id = a.team_id
     and b2.id > a.id
     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b2.starts_at, b2.ends_at, '[)')
  ) p
  join public.teams t on t.id = p.team_id
  left join public.resources ra on ra.id = p.a_resource
  left join public.resources rb on rb.id = p.b_resource;

  -- 3. A fixture and its booking out of step ----------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'fixture_id',         f.id,
           'team_id',            f.team_id,
           'team_name',          t.name,
           'opponent',           f.opponent,
           'kickoff_at',         f.kickoff_at,
           'booking_id',         b.id,
           'booking_starts_at',  b.starts_at,
           'booking_ends_at',    b.ends_at,
           'fixture_pitch_name', rf.name,
           'booking_pitch_name', rb2.name,
           'pitch_mismatch',     (b.resource_id is distinct from f.venue_resource_id),
           'time_mismatch',      (b.starts_at <> f.kickoff_at
                                  or b.ends_at <> f.kickoff_at
                                     + make_interval(mins => f.duration_minutes))
         ) order by f.kickoff_at), '[]'::jsonb)
    into v_drift
  from public.fixtures f
  join public.bookings b on b.id = f.booking_id
  join public.teams t on t.id = f.team_id
  left join public.resources rf  on rf.id  = f.venue_resource_id
  left join public.resources rb2 on rb2.id = b.resource_id
  where f.status = 'scheduled'
    and not f.allocation_conflict
    and b.status in ('pending', 'confirmed')
    and f.kickoff_at >= now() - interval '1 day'
    and f.kickoff_at < v_horizon
    and (b.resource_id is distinct from f.venue_resource_id
         or b.starts_at <> f.kickoff_at
         or b.ends_at <> f.kickoff_at + make_interval(mins => f.duration_minutes));

  -- 4. Home fixtures still waiting for a pitch --------------------------------
  -- A central-venue team is never waiting for one of ours (20260904090000).
  select coalesce(jsonb_agg(jsonb_build_object(
           'fixture_id',       f.id,
           'team_id',          f.team_id,
           'team_name',        t.name,
           'opponent',         f.opponent,
           'competition',      f.competition,
           'kickoff_at',       f.kickoff_at,
           'home_pitch_name',  hr.name,
           'home_resource_id', t.home_resource_id
         ) order by f.kickoff_at), '[]'::jsonb)
    into v_unallocated
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  left join public.resources hr on hr.id = t.home_resource_id
  where f.is_home
    and f.status = 'scheduled'
    and f.booking_id is null
    and not f.allocation_conflict
    and f.kickoff_at >= now() - interval '1 day'
    and f.kickoff_at < v_horizon
    and nullif(btrim(t.central_venue_name), '') is null;

  return jsonb_build_object(
    'horizon_days',  p_horizon_days,
    'generated_at',  now(),
    'flagged',       v_flagged,
    'team_overlaps', v_overlaps,
    'out_of_step',   v_drift,
    'unallocated',   v_unallocated
  );
end;
$$;

comment on function public.pitch_clash_report(integer) is
  'Everything the overlap constraint cannot see: flagged Full-Time reschedules, one team booked in two places, fixtures out of step with their booking, and home fixtures still without a pitch (central-venue teams excluded — they never need one of ours). Administrators only.';

notify pgrst, 'reload schema';
