-- =============================================================================
-- club_overview() â€” the admin dashboard's numbers in one call
-- =============================================================================
-- The design's Overview screen (spec Â§2.2): four stat cards and the "Needs
-- you" list. One SECURITY DEFINER read, club_admin/committee-gated, so the
-- page is one round trip; the weekend fixture list and the next social come
-- from matchday_fixtures() and social_events(), which already exist.
--
-- Money comes from the subscription ledger exactly as /subs reads it:
-- collected = payments net of refunds on current-season subscriptions;
-- arrears = the same view's outstanding, counting only live subscriptions.
-- "Over 60 days" uses days_since_start â€” the club's own measure of how long a
-- debt has been open.
--
-- Renumbered 430000 -> 450000: the original number was burned when the first PR lost this file in a shared-tree race. PR METADATA (PLAN.md Â§11): migrations y; RLS n (no tables; the function
-- gates itself); data touched: none; rollback: drop function.
-- =============================================================================

create or replace function public.club_overview()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
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
      where f.is_home and f.status = 'scheduled'
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
$$;

revoke all privileges on function public.club_overview() from public, anon;
grant execute on function public.club_overview() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function public.club_overview();
