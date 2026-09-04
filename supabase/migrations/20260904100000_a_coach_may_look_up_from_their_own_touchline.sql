-- =============================================================================
-- The matchday desk learns a scope (Adam, 2026-09-04: "in Matches, the view
-- should default to the coach's team's matches but they should also be able
-- to view the whole club (with normal filters on etc)").
--
-- `matchday_fixtures()` gains `p_scope text default 'mine'`:
--
--   · 'mine'  — exactly what the function has always answered:
--               `matchday_team_ids()` (a coach's staffed teams; everything
--               for an administrator or committee member). Every existing
--               caller passes no scope and changes nothing.
--   · 'club'  — every team, but ONLY for callers who already hold a whole
--               team's matchday somewhere: club admins, committee, or anyone
--               who is live staff (coach / assistant coach / manager) on at
--               least one team. Anybody else asking for 'club' gets 'mine' —
--               the widening is for the club's own staff room, not a side
--               door for parents.
--
-- `matchday_team_ids()` itself is untouched: it still answers "whose desk is
-- this?", and every other consumer keeps that meaning.
--
-- The old two-argument function is DROPPED, not overloaded: with the third
-- argument defaulted, PostgREST could not choose between the two signatures
-- for a two-argument call (PGRST203), so exactly one function must exist.
-- The drop discards its ACL, so the grants are restated in full below —
-- revoke from PUBLIC too, not just anon (the 20260902 lesson), then grant to
-- authenticated and service_role, which is what prod holds today.
--
-- Restated from the LIVE definition (pg_get_functiondef on prod, 2026-09-04);
-- only the argument and the team-id case are new.
-- =============================================================================

drop function if exists public.matchday_fixtures(timestamptz, timestamptz);

create function public.matchday_fixtures(
  p_from timestamptz,
  p_to timestamptz,
  p_scope text default 'mine'
)
 returns table(
   fixture_id uuid, event_id uuid, team_id uuid, team_name text, opponent text,
   is_home boolean, competition text, kickoff_at timestamptz, status text,
   pitch_name text, venue_text text, allocated boolean,
   accepted integer, declined integer, squad integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
  where f.team_id = any(
    case
      when p_scope = 'club'
       and (public.is_club_admin()
            or exists (select 1 from public.profiles pr
                       where pr.id = auth.uid() and pr.role in ('committee', 'super_user'))
            or exists (select 1 from public.team_memberships m
                       where m.person_id = public.current_person_id()
                         and m.left_at is null
                         and m.role in ('coach', 'assistant_coach', 'manager')))
        then (select coalesce(array_agg(t2.id), '{}') from public.teams t2)
      else public.matchday_team_ids()
    end)
    and f.kickoff_at >= p_from and f.kickoff_at < p_to
  order by f.kickoff_at, t.name;
$function$;

revoke all on function public.matchday_fixtures(timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.matchday_fixtures(timestamptz, timestamptz, text)
  to authenticated, service_role;
