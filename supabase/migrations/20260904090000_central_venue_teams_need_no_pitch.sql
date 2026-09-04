-- =============================================================================
-- A central-venue team never needs a pitch (Adam, 2026-09-04: "Teams using a
-- central venue shouldn't appear in the Home fixture with no pitch list").
--
-- A team with `teams.central_venue_name` set plays its home games at a ground
-- the club does not manage, so no pitch booking is ever made for it (that has
-- been the rule since 20260824; the team page says it in as many words). Two
-- places still counted those fixtures as work to do:
--
--   · `unallocated_home_fixtures` — the list on /pitches, and
--   · `club_overview()`'s `unallocated_home_fixtures` counter — the lobby nag.
--
-- Both now leave central-venue teams alone. A name that is only whitespace is
-- treated as no central venue, matching what the team form saves.
--
-- Restated from the LIVE definitions (pg_get_viewdef / pg_get_functiondef on
-- prod, 2026-09-04), not from older migration files. The view keeps
-- `security_invoker = true` — prod has it and CREATE OR REPLACE VIEW would
-- silently drop it if left unsaid. Grants and RLS are untouched; both objects
-- keep the ACLs they have.
-- =============================================================================

create or replace view public.unallocated_home_fixtures
  with (security_invoker = true) as
 select f.id,
    f.team_id,
    t.name as team_name,
    f.season_id,
    f.opponent,
    f.competition,
    f.kickoff_at,
    f.duration_minutes,
    f.status,
    f.allocation_conflict
   from public.fixtures f
   join public.teams t on t.id = f.team_id
  where f.is_home
    and f.status = 'scheduled'::public.fixture_status
    and (f.booking_id is null or f.allocation_conflict)
    and f.kickoff_at >= (now() - interval '1 day')
    and nullif(btrim(t.central_venue_name), '') is null
  order by f.kickoff_at;

create or replace function public.club_overview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_season uuid;
  v_result jsonb;
begin
  if not (public.is_club_admin()
          or exists (select 1 from public.profiles pr
                     where pr.id = auth.uid() and pr.role in ('committee', 'super_user'))) then
    raise exception 'club_overview: the club overview is for administrators' using errcode = 'P0001';
  end if;

  select id into v_season from public.seasons where is_current limit 1;

  select jsonb_build_object(
    'season_name', (select name from public.seasons where id = v_season),
    'players', (
      select count(distinct m.person_id) from public.team_memberships m
      where m.left_at is null and m.role = 'player'),
    'players_this_month', (
      select count(distinct m.person_id) from public.team_memberships m
      where m.left_at is null and m.role = 'player'
        and m.joined_at >= date_trunc('month', now())),
    'teams_active', (select count(*) from public.teams t where t.active),
    'age_groups', (select count(distinct t.age_group) from public.teams t where t.active and t.age_group is not null),
    'subs_collected_pence', coalesce((
      select sum(a.paid_pence) from public.subscription_arrears a
      where a.season_id = v_season and a.status <> 'cancelled'), 0),
    'subs_due_pence', coalesce((
      select sum(a.amount_due_pence) from public.subscription_arrears a
      where a.season_id = v_season and a.status <> 'cancelled'), 0),
    'arrears_pence', coalesce((
      select sum(a.outstanding_pence) from public.subscription_arrears a
      where a.season_id = v_season and a.status in ('active', 'past_due')
        and a.outstanding_pence > 0), 0),
    'arrears_count', (
      select count(*) from public.subscription_arrears a
      where a.season_id = v_season and a.status in ('active', 'past_due')
        and a.outstanding_pence > 0),
    'arrears_60_count', (
      select count(*) from public.subscription_arrears a
      where a.season_id = v_season and a.status in ('active', 'past_due')
        and a.outstanding_pence > 0 and a.days_since_start >= 60),
    'pending_account_requests', (
      select count(*) from public.account_requests r where r.status = 'pending'),
    'oldest_request_days', (
      select greatest(0, (current_date - min(r.created_at)::date))::integer
      from public.account_requests r where r.status = 'pending'),
    'unallocated_home_fixtures', (
      select count(*) from public.fixtures f
      join public.teams t on t.id = f.team_id
      where f.is_home and f.status = 'scheduled'
        and nullif(btrim(t.central_venue_name), '') is null
        and f.kickoff_at between now() and now() + interval '14 days'
        and not exists (select 1 from public.bookings b
                        where b.fixture_id = f.id and b.status = 'confirmed')),
    'pending_pitch_requests', (
      select count(*) from public.bookings b
      join public.resources r on r.id = b.resource_id and r.type = 'pitch'
      where b.status = 'pending' and b.starts_at > now())
  ) into v_result;

  return v_result;
end;
$function$;
