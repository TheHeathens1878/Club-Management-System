-- =============================================================================
-- A fixture Full-Time has stopped publishing is not a fixture
-- =============================================================================
-- Adam, 2026-08-26: "The import isn't working properly. U13 Eagles, Pumas and
-- Rhinos have duplicate and clashing fixtures which aren't in the code
-- snippet" and "Sparks and Infernos have duplicates".
--
-- WHAT WAS ACTUALLY WRONG (checked against production and against the live
-- widget feed on 2026-08-26)
--
-- 20260823150000 chose, deliberately and in writing, to leave alone any ref
-- that is not in the payload: "Full-Time pages are filtered views; absence is
-- not cancellation". That is right for a page showing the next five games. It
-- is wrong for the club widget, which publishes the whole season, and it let
-- two separate accidents become permanent:
--
--   1. MIS-ATTRIBUTION, since corrected upstream. Before 20260824220000,
--      matching was suffix-only, so "Sale Communities JFC U13 Eagles" claimed
--      our U13 Eagles and "Altrincham FC Juniors U13 Flames" claimed our U13
--      Flames. 20260824220000 anchored matching on the club's own name and the
--      wrong rows stopped being refreshed — but nothing removed them, so four
--      fixtures have sat on the wrong teams' pages ever since, one of them
--      holding a pitch. These are the "Sparks and Infernos duplicates": the
--      derby appears twice because a stranger's team of the same name claimed
--      one side of it.
--
--   2. RE-ISSUED FIXTURES. The league re-published part of the U15 division
--      with NEW Full-Time ids (30626xxx replacing 30533xxx). The new ones
--      imported correctly; the old ones stayed, so U15 Pumas, Rhinos and
--      Scorpions each show two different opponents in the same slot. Verified
--      by fetching the live feed: the 30626xxx refs are in it and the refs
--      they clash with are not.
--
-- THE RULE ADDED HERE
--   After a run, a fixture belonging to this team is retired when ALL of:
--     · it came from Full-Time (`source = 'fulltime'`) — manual rows are the
--       club's own and are never touched;
--     · its ref was NOT in this payload;
--     · its kickoff falls INSIDE the window this payload covers. This is what
--       keeps 20260823150000's reasoning intact: a filtered page reconciles
--       only the period it actually reported on, and a team that vanishes from
--       the feed entirely is never reconciled at all, because the caller does
--       not call this function with an empty payload.
--     · it is still `scheduled` and has no score — history is not rewritten.
--
--   A retired fixture is DELETED when nothing has been built on it, and left
--   alone with a warning when something has: a team sheet, player stats, or a
--   pitch booking. Deleting a game somebody has picked a side for, or that is
--   holding a pitch, is the administrator's call, and they now have a Delete
--   button for it. Availability answers alone do not save a fixture — an RSVP
--   to a game that was never ours is not a record worth keeping.
--
--   THE BRAKE. If a run would retire more than half of what it imported (or
--   more than 2 when the payload is tiny), it retires NOTHING and says so in
--   the run's warnings. A feed that half-loads must not be able to empty a
--   season, and this is the difference between "the league moved four games"
--   and "the fetch came back short".
--
-- Everything retired is written to `audit_log` as `fixture.retired`, one row
-- each, carrying the whole fixture — a cron deleting rows silently is not
-- something anybody should have to reconstruct from memory.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered); data touched: none by this migration itself — the first import
-- run after it will delete the phantom rows described above (16 candidates on
-- production at the time of writing, of which 4 hold a pitch and will be left
-- for an administrator); rollback: §4.
-- =============================================================================


-- =============================================================================
-- 1. THE RUN ROW REMEMBERS WHAT IT RETIRED
-- =============================================================================

alter table public.fixture_import_runs
  add column if not exists retired integer not null default 0,
  add column if not exists kept_back integer not null default 0;

comment on column public.fixture_import_runs.retired is
  'Fixtures deleted by this run because Full-Time no longer publishes them inside the window the run covered.';
comment on column public.fixture_import_runs.kept_back is
  'Fixtures Full-Time no longer publishes that were NOT deleted, because a team sheet, player stats or a pitch booking hangs off them. A club administrator decides.';


-- =============================================================================
-- 2. import_fixtures(): 20260823150000's body, plus the reconciliation
-- =============================================================================

create or replace function public.import_fixtures(
  p_team_id    uuid,
  p_season_id  uuid,
  p_fixtures   jsonb,
  p_trigger    text default 'scheduled',
  p_source_url text default null,
  p_warnings   jsonb default '[]'::jsonb
)
  returns table (run_id bigint, inserted integer, updated integer, unchanged integer)
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_ins integer := 0;
  v_upd integer := 0;
  v_same integer := 0;
  v_run bigint;
  r jsonb;
  v_ref text;
  v_kick timestamptz;
  v_status public.fixture_status;
  v_existing public.fixtures%rowtype;
  v_home integer;
  v_away integer;
  -- reconciliation
  v_refs text[] := '{}';
  v_from timestamptz;
  v_to timestamptz;
  v_candidates integer := 0;
  v_retired integer := 0;
  v_kept integer := 0;
  v_limit integer;
  v_warnings jsonb := coalesce(p_warnings, '[]'::jsonb);
  v_row record;
  v_ids uuid[] := '{}';
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'import_fixtures: club_admin or service_role only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fixtures) <> 'array' then
    raise exception 'import_fixtures: fixtures must be a JSON array' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'import_fixtures: unknown team %', p_team_id using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.seasons where id = p_season_id) then
    raise exception 'import_fixtures: unknown season %', p_season_id using errcode = 'P0001';
  end if;

  for r in select * from jsonb_array_elements(p_fixtures) loop
    v_ref := nullif(btrim(r->>'externalRef'), '');
    if v_ref is null then
      raise exception 'import_fixtures: every fixture needs an externalRef (got %)', r using errcode = '22023';
    end if;
    v_kick := (r->>'kickoffAt')::timestamptz;
    v_status := coalesce(nullif(r->>'status', ''), 'scheduled')::public.fixture_status;
    v_home := (r->>'homeScore')::integer;
    v_away := (r->>'awayScore')::integer;
    if (v_home is null) <> (v_away is null) then
      v_home := null; v_away := null;
    end if;

    -- What this payload says it covers, gathered as we go.
    v_refs := v_refs || v_ref;
    if v_from is null or v_kick < v_from then v_from := v_kick; end if;
    if v_to is null or v_kick > v_to then v_to := v_kick; end if;

    select * into v_existing from public.fixtures
     where team_id = p_team_id and external_ref = v_ref;

    if not found then
      insert into public.fixtures (team_id, season_id, opponent, is_home, competition, kickoff_at, status, source,
                                   external_ref, venue_text, home_score, away_score, imported_at, last_seen_at)
      values (p_team_id, p_season_id, r->>'opponent', coalesce((r->>'isHome')::boolean, true), r->>'competition',
              v_kick, v_status, 'fulltime', v_ref, r->>'venue', v_home, v_away, now(), now());
      v_ins := v_ins + 1;
    elsif v_existing.source = 'manual' then
      -- A manual row that happens to carry this ref is the admin's; leave it.
      v_same := v_same + 1;
    elsif v_existing.kickoff_at is distinct from v_kick
       or v_existing.opponent is distinct from (r->>'opponent')
       or v_existing.is_home is distinct from coalesce((r->>'isHome')::boolean, true)
       or v_existing.competition is distinct from (r->>'competition')
       or v_existing.status is distinct from v_status
       or v_existing.home_score is distinct from v_home
       or v_existing.away_score is distinct from v_away
       or v_existing.venue_text is distinct from (r->>'venue')
    then
      update public.fixtures
         set kickoff_at = v_kick, opponent = r->>'opponent', is_home = coalesce((r->>'isHome')::boolean, true),
             competition = r->>'competition', status = v_status, home_score = v_home, away_score = v_away,
             venue_text = r->>'venue', imported_at = now(), last_seen_at = now()
       where id = v_existing.id;
      v_upd := v_upd + 1;
    else
      update public.fixtures set last_seen_at = now() where id = v_existing.id;
      v_same := v_same + 1;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- Reconciliation: what this payload covered but did not mention
  -- -------------------------------------------------------------------------
  -- An empty payload says nothing about anything, so it reconciles nothing.
  if array_length(v_refs, 1) is not null then

    -- Held as an array of ids rather than a temporary table: this function is
    -- called once per team and two calls can share a transaction, where a
    -- `create temporary table` left behind by a failed call would break the
    -- next one.
    select coalesce(array_agg(f.id), '{}')
      into v_ids
      from public.fixtures f
     where f.team_id = p_team_id
       and f.source = 'fulltime'
       and f.status = 'scheduled'
       and f.home_score is null
       and f.kickoff_at between v_from and v_to
       and not (f.external_ref = any (v_refs));

    v_candidates := coalesce(array_length(v_ids, 1), 0);

    -- The brake. Half of what we just imported, or two, whichever is larger.
    v_limit := greatest(2, (array_length(v_refs, 1) / 2));

    if v_candidates > v_limit then
      v_warnings := v_warnings || to_jsonb(format(
        'Full-Time did not publish %s fixtures this team already has between %s and %s. That is more than half of the %s it did publish, so none were removed — this looks like a short fetch rather than a change to the fixture list. Check the feed, then run the import again.',
        v_candidates, v_from::date, v_to::date, array_length(v_refs, 1)));
      v_kept := v_candidates;
    else
      for v_row in
        select f.id, f.opponent, f.is_home, f.kickoff_at, f.competition,
               f.external_ref, f.venue_text, f.season_id,
               (f.booking_id is not null) as has_pitch,
               exists (select 1 from public.fixture_lineups l where l.fixture_id = f.id) as has_lineup,
               exists (select 1 from public.fixture_player_stats s where s.fixture_id = f.id) as has_stats
          from public.fixtures f where f.id = any (v_ids)
      loop
        if v_row.has_lineup or v_row.has_stats or v_row.has_pitch then
          -- Something has been built on it. An administrator decides.
          v_kept := v_kept + 1;
          v_warnings := v_warnings || to_jsonb(format(
            '%s on %s is no longer in Full-Time, but it has %s, so it has been left alone. Delete it from the fixture''s own page if it should go.',
            v_row.opponent, to_char(v_row.kickoff_at at time zone 'Europe/London', 'FMDay FMDD Mon, HH24:MI'),
            case when v_row.has_pitch and (v_row.has_lineup or v_row.has_stats) then 'a pitch and a team sheet'
                 when v_row.has_pitch then 'a pitch booked'
                 when v_row.has_lineup then 'a team sheet'
                 else 'player stats' end));
        else
          insert into public.audit_log (actor_email, action, entity, entity_id, detail)
          values ('fulltime-import', 'fixture.retired', 'fixtures', v_row.id::text,
                  jsonb_build_object(
                    'reason', 'Full-Time no longer publishes this fixture inside the window this import covered',
                    'team_id', p_team_id,
                    'season_id', v_row.season_id,
                    'opponent', v_row.opponent,
                    'is_home', v_row.is_home,
                    'kickoff_at', v_row.kickoff_at,
                    'competition', v_row.competition,
                    'external_ref', v_row.external_ref,
                    'venue_text', v_row.venue_text,
                    'window_from', v_from,
                    'window_to', v_to,
                    'trigger', p_trigger));
          delete from public.fixtures where id = v_row.id;
          v_retired := v_retired + 1;
        end if;
      end loop;
    end if;
  end if;

  insert into public.fixture_import_runs (team_id, trigger, status, source_url, fetched_at, inserted, updated, unchanged, retired, kept_back, warnings, run_by)
  values (p_team_id, p_trigger, 'ok', p_source_url, now(), v_ins, v_upd, v_same, v_retired, v_kept, v_warnings, auth.uid())
  returning id into v_run;

  update public.team_fulltime_links
     set last_import_at = now(), last_import_status = 'ok', last_import_count = v_ins + v_upd + v_same, last_error = null
   where team_id = p_team_id;

  return query select v_run, v_ins, v_upd, v_same;
end;
$fn$;

comment on function public.import_fixtures(uuid, uuid, jsonb, text, text, jsonb) is
  'Upsert a team''s Full-Time fixtures by external_ref, and retire the ones Full-Time no longer publishes inside the window the payload covers. A retired fixture is deleted when nothing is built on it and left for an administrator when a team sheet, player stats or a pitch booking hangs off it. Retiring more than half of what was imported is treated as a short fetch and does nothing.';

notify pgrst, 'reload schema';


-- =============================================================================
-- 3. ROLLBACK (documented, not executed)
-- =============================================================================
--   create or replace function public.import_fixtures(...) -- the body in
--     supabase/migrations/20260823150000_fulltime_import.sql §3, verbatim
--   alter table public.fixture_import_runs drop column retired, drop column kept_back;
-- Fixtures already retired are not restored by the above; each one's audit_log
-- `fixture.retired` row carries everything needed to re-enter it by hand.
-- =============================================================================
