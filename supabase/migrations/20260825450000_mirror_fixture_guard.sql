-- =============================================================================
-- The other side of a match is the club's to set, and both sides move together
-- =============================================================================
-- A review of 20260825410000 (mirrored fixtures for an internal match) found a
-- hole and three ways the pair can drift apart. All four are fixed here.
--
-- THE HOLE
--   `fixtures.mirror_fixture_id` arrived as an ordinary column. `authenticated`
--   holds table-wide UPDATE on `public.fixtures`, and `fixtures_staff_update`
--   is ROW-scoped (`is_club_admin() or is_team_staff(team_id)`) — it says which
--   ROWS a coach may write, not which COLUMNS. So a coach could point their own
--   fixture's mirror at a fixture belonging to a team they do not staff:
--
--     update fixtures set mirror_fixture_id = '<another team's game>' where id = '<mine>';
--     update fixtures set status = 'cancelled'                         where id = '<mine>';
--
--   and the second statement reached `fixtures_cancel_mirror()`, which is
--   SECURITY DEFINER and therefore bypasses RLS — cancelling another team's
--   game. Nothing in the app offers that, and no fixture on production is
--   mirrored yet, but the door was open from the moment the column shipped.
--
--   The fix: `fixtures_guard()` refuses a change to `mirror_fixture_id` from any
--   signed-in caller who is not a club administrator. That is the smallest rule
--   that closes it — the pairing is only ever written by
--   `create_internal_match_fixtures()`, which is club_admin-only, and an
--   administrator may already cancel any fixture directly, so nothing is
--   granted that was not already held.
--
-- THE DRIFT
--   `trg_fixtures_cancel_mirror` fired `after update of status` and acted only
--   on `cancelled`, so:
--     · POSTPONED or ABANDONED released the pitch (`fixtures_sync_booking()`)
--       and left the away team's page showing a scheduled game on a pitch the
--       club no longer holds;
--     · un-cancelling brought the home fixture back and left the mirror
--       cancelled for ever;
--     · moving the kickoff, the length or the pitch — including any
--       `allocate_fixture()` — changed one side only, permanently, because
--       those columns were copied once at creation and never again.
--   The trigger now mirrors the whole status and those three details, each
--   guarded by `is distinct from` so the mirror's own write finds nothing to do
--   and the recursion stops exactly as it did before.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered — a column-level refusal inside an existing trigger); data touched:
-- none; rollback: §4 below, and note that 20260825410000's own rollback was
-- incomplete — it dropped `mirror_fixture_id` without restoring the
-- `fixtures_guard()` body that references it, which would have left every
-- write to `fixtures` raising 42703. The rollback here restores both.
-- =============================================================================


-- =============================================================================
-- 1. THE COLUMN IS THE CLUB'S TO SET
-- =============================================================================

create or replace function public.fixtures_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.venue_resource_id is not null
     and exists (select 1 from public.resources r where r.id = new.venue_resource_id and r.type = 'function_room') then
    raise exception 'fixtures: venue_resource_id must be a pitch, not a function room' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.source = 'fulltime' and old.source = 'fulltime'
     and new.external_ref is distinct from old.external_ref then
    raise exception 'fixtures: external_ref of an imported fixture is immutable' using errcode = 'P0001';
  end if;
  if new.mirror_fixture_id = new.id then
    raise exception 'fixtures: a fixture cannot be the other side of itself' using errcode = 'P0001';
  end if;

  -- The pairing is the club's to set. A coach may write their own team's
  -- fixtures (fixtures_staff_update is row-scoped), and this column decides
  -- which OTHER row a SECURITY DEFINER trigger will reach — so a coach writing
  -- it is a coach reaching outside their own team. Club administrators keep it,
  -- because create_internal_match_fixtures() is theirs and because they may
  -- already cancel any fixture directly: no new power, just the one door.
  --
  -- auth.uid() is null for the migration, the cron and service_role, so those
  -- paths are unaffected; it is the caller's even inside this SECURITY DEFINER
  -- guard, which is exactly what distinguishes a person from a job here.
  if auth.uid() is not null
     and not public.is_club_admin()
     and new.mirror_fixture_id is distinct from
         (case when tg_op = 'UPDATE' then old.mirror_fixture_id else null end)
  then
    raise exception
      'fixtures: the other side of a match is set when a club administrator confirms the booking, not by hand [20260825450000]'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.fixtures_guard() is
  'Fixture invariants: a venue is a pitch, an imported external_ref is immutable, a fixture is not its own mirror, and mirror_fixture_id is written only by a club administrator (in practice only by create_internal_match_fixtures()).';


-- =============================================================================
-- 2. BOTH SIDES MOVE TOGETHER
-- =============================================================================

create or replace function public.fixtures_cancel_mirror()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.mirror_fixture_id is null then return null; end if;

  -- The WHOLE status, not just cancellation: postponed, abandoned and played
  -- are the same game on both pages, and un-cancelling one has to bring the
  -- other back. `is distinct from` in the WHERE is what stops the recursion —
  -- the mirror's own firing finds nothing left to change.
  if new.status is distinct from old.status then
    update public.fixtures
       set status = new.status
     where id = new.mirror_fixture_id
       and status is distinct from new.status;
  end if;

  -- And the details a reschedule moves. Copied once at creation before this;
  -- an administrator moving the kickoff, or allocate_fixture() moving the
  -- pitch, left the away team looking at the old time and the old pitch.
  if new.kickoff_at is distinct from old.kickoff_at
     or new.duration_minutes is distinct from old.duration_minutes
     or new.venue_resource_id is distinct from old.venue_resource_id
  then
    update public.fixtures
       set kickoff_at = new.kickoff_at,
           duration_minutes = new.duration_minutes,
           venue_resource_id = new.venue_resource_id
     where id = new.mirror_fixture_id
       and (kickoff_at is distinct from new.kickoff_at
            or duration_minutes is distinct from new.duration_minutes
            or venue_resource_id is distinct from new.venue_resource_id);
  end if;

  return null;
end;
$$;

revoke all privileges on function public.fixtures_cancel_mirror() from public, anon, authenticated, service_role;

comment on function public.fixtures_cancel_mirror() is
  'An internal match is one game on two teams pages: status, kickoff, length and pitch move on both rows together. Nothing is deleted.';

drop trigger if exists trg_fixtures_cancel_mirror on public.fixtures;
create trigger trg_fixtures_cancel_mirror
  after update of status, kickoff_at, duration_minutes, venue_resource_id on public.fixtures
  for each row execute function public.fixtures_cancel_mirror();

notify pgrst, 'reload schema';


-- =============================================================================
-- 3. ROLLBACK (documented, not executed)
-- =============================================================================
--   restore public.fixtures_guard() and public.fixtures_cancel_mirror() from
--   20260825410000_internal_match_fixtures.sql;
--   drop trigger trg_fixtures_cancel_mirror on public.fixtures;
--   create trigger trg_fixtures_cancel_mirror after update of status on public.fixtures
--     for each row execute function public.fixtures_cancel_mirror();
-- And if the mirror column itself is ever dropped, restore fixtures_guard()
-- from 20260823140000_fixtures.sql FIRST — the bodies above reference
-- mirror_fixture_id, and plpgsql binds late, so dropping the column under them
-- makes every write to `fixtures` raise 42703.
