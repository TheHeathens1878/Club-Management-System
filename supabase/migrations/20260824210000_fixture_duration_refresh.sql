-- =============================================================================
-- Fixture durations follow the team's match settings (follow-up to 20260824200000)
-- =============================================================================
-- The INSERT trigger gives new fixtures the team's match duration, but a whole
-- season was imported before any team had settings — and a later change of
-- settings should reach fixtures that still carry the old default. When a
-- team's match columns change, re-default every fixture of that team that:
--   * kicks off in the future,
--   * has no pitch booking yet (allocation fixes the slot), and
--   * still carries the previous default (the old computed duration, or 90) —
--     i.e. was never set by hand.
-- Fixtures an admin sized explicitly are never touched.
--
-- Rollback: drop trigger trg_teams_match_duration_refresh on public.teams;
-- drop function public.teams_match_duration_refresh().
-- =============================================================================

create or replace function public.teams_match_duration_refresh()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_old integer;
  v_new integer;
begin
  v_old := case when old.half_length_minutes is null then null
                else old.match_halves * old.half_length_minutes + old.half_time_minutes end;
  v_new := case when new.half_length_minutes is null then null
                else new.match_halves * new.half_length_minutes + new.half_time_minutes end;
  if v_new is not distinct from v_old then
    return new;
  end if;

  update public.fixtures f
     set duration_minutes = least(greatest(coalesce(v_new, 90), 10), 600)
   where f.team_id = new.id
     and f.kickoff_at > now()
     and f.booking_id is null
     and f.duration_minutes = coalesce(v_old, 90);
  return new;
end $$;
revoke all privileges on function public.teams_match_duration_refresh() from public, anon, authenticated, service_role;

drop trigger if exists trg_teams_match_duration_refresh on public.teams;
create trigger trg_teams_match_duration_refresh
  after update of match_halves, half_length_minutes, half_time_minutes on public.teams
  for each row execute function public.teams_match_duration_refresh();
