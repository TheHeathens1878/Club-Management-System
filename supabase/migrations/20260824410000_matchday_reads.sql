-- =============================================================================
-- Matchday reads — the Matches, Training and Social screens in one call each
-- =============================================================================
-- The Club CRM design's Matchday section (spec §2: matches, training, social).
-- Read-only SECURITY DEFINER shapes over what already exists — fixtures, the
-- events RSVP, training bookings, the attendance register. Nothing new is
-- written and no authority widens:
--
--   * matchday_fixtures(from, to) — fixtures with their pitch, whether the
--     booking is confirmed, and the RSVP arithmetic (accepted / declined /
--     asked) from the events mirror. Team staff see their teams; club admins
--     and committee the whole club — the same scoping the teams pages use.
--   * training_sessions(from, to) — kind='training' bookings with team, pitch,
--     who booked them and the same arithmetic from the mirrored practice
--     events. Same scoping.
--   * training_attendance_term() — the design's per-team bars: of everyone
--     MARKED on a register this season, how many were there (present or
--     late — a late child still trained). Registers are booking_attendance;
--     unmarked people are absent from the denominator on purpose, a register
--     half-taken must not read as half-attended.
--   * social_events(limit) — social-type events, soonest first, with the
--     reply arithmetic. Any signed-in member: a social is club-public and the
--     numbers carry no names ("31 attending" is the design's own rendering).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no tables, no policy
-- changes; every function gates itself); data touched: none; rollback: end.
-- =============================================================================

-- Which teams may this caller see the matchday desk for?
create or replace function public.matchday_team_ids()
  returns uuid[]
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when public.is_club_admin()
      or exists (select 1 from public.profiles pr
                 where pr.id = auth.uid() and pr.role in ('committee', 'super_user'))
      then (select coalesce(array_agg(t.id), '{}') from public.teams t)
    else (select coalesce(array_agg(distinct m.team_id), '{}')
          from public.team_memberships m
          where m.person_id = public.current_person_id() and m.left_at is null
            and m.role in ('coach', 'assistant_coach', 'manager'))
  end;
$$;

create or replace function public.matchday_fixtures(p_from timestamptz, p_to timestamptz)
  returns table (
    fixture_id uuid, event_id uuid, team_id uuid, team_name text,
    opponent text, is_home boolean, competition text, kickoff_at timestamptz,
    status text, pitch_name text, venue_text text, allocated boolean,
    accepted integer, declined integer, squad integer
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select f.id, e.id, f.team_id, t.name,
         f.opponent, f.is_home, f.competition, f.kickoff_at,
         f.status::text, r.name, f.venue_text,
         exists (select 1 from public.bookings b
                 where b.fixture_id = f.id and b.status = 'confirmed'),
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'accepted'), 0)::integer,
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'declined'), 0)::integer,
         (select count(*) from public.team_memberships m
          where m.team_id = f.team_id and m.left_at is null and m.role = 'player')::integer
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  left join public.events e on e.fixture_id = f.id
  left join public.resources r on r.id = f.venue_resource_id
  where f.team_id = any(public.matchday_team_ids())
    and f.kickoff_at >= p_from and f.kickoff_at < p_to
  order by f.kickoff_at, t.name;
$$;

create or replace function public.training_sessions(p_from timestamptz, p_to timestamptz)
  returns table (
    booking_id uuid, event_id uuid, team_id uuid, team_name text,
    starts_at timestamptz, ends_at timestamptz, pitch_name text,
    booked_by text, status text,
    accepted integer, declined integer, squad integer
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select b.id, e.id, b.team_id, t.name,
         b.starts_at, b.ends_at, r.name,
         b.booker_name, b.status::text,
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'accepted'), 0)::integer,
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'declined'), 0)::integer,
         (select count(*) from public.team_memberships m
          where m.team_id = b.team_id and m.left_at is null and m.role = 'player')::integer
  from public.bookings b
  join public.teams t on t.id = b.team_id
  left join public.events e on e.booking_id = b.id
  left join public.resources r on r.id = b.resource_id
  where b.kind = 'training'
    and b.team_id = any(public.matchday_team_ids())
    and b.status in ('pending', 'confirmed')
    and b.starts_at >= p_from and b.starts_at < p_to
  order by b.starts_at, t.name;
$$;

create or replace function public.training_attendance_term()
  returns table (team_id uuid, team_name text, marked integer, there integer)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select t.id, t.name,
         count(*)::integer,
         count(*) filter (where ba.status in ('present', 'late'))::integer
  from public.booking_attendance ba
  join public.bookings b on b.id = ba.booking_id and b.kind = 'training'
  join public.teams t on t.id = b.team_id
  join public.seasons s on s.is_current
  where b.team_id = any(public.matchday_team_ids())
    and b.starts_at >= s.starts_on::timestamptz
  group by t.id, t.name
  order by t.name;
$$;

create or replace function public.social_events(p_limit integer default 12)
  returns table (
    event_id uuid, team_id uuid, team_name text, title text,
    starts_at timestamptz, ends_at timestamptz, venue text, notes text,
    status text, accepted integer, declined integer, squad integer,
    can_manage boolean
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select e.id, e.team_id, t.name, e.title,
         e.starts_at, e.ends_at, coalesce(r.name, e.venue_text), e.notes,
         e.status::text,
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'accepted'), 0)::integer,
         coalesce((select count(*) from public.event_responses er
                   where er.event_id = e.id and er.status = 'declined'), 0)::integer,
         (select count(*) from public.team_memberships m
          where m.team_id = e.team_id and m.left_at is null)::integer,
         public.is_club_admin() or public.is_team_staff(e.team_id)
  from public.events e
  join public.teams t on t.id = e.team_id
  left join public.resources r on r.id = e.venue_resource_id
  where e.type = 'social'
    and e.status = 'scheduled'
    and e.starts_at > now() - interval '6 hours'
  order by e.starts_at
  limit greatest(least(p_limit, 50), 1);
$$;

revoke all privileges on function public.matchday_team_ids()                          from public, anon;
revoke all privileges on function public.matchday_fixtures(timestamptz, timestamptz)  from public, anon;
revoke all privileges on function public.training_sessions(timestamptz, timestamptz)  from public, anon;
revoke all privileges on function public.training_attendance_term()                   from public, anon;
revoke all privileges on function public.social_events(integer)                       from public, anon;
grant execute on function
  public.matchday_team_ids(), public.matchday_fixtures(timestamptz, timestamptz),
  public.training_sessions(timestamptz, timestamptz), public.training_attendance_term(),
  public.social_events(integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the five functions. Nothing else exists.
