-- =============================================================================
-- A fixture Full-Time has withdrawn frees its pitch (Adam, 2026-09-06)
-- =============================================================================
-- "If a fixture is removed from Full Time, it should be removed from the
--  booking calendar also."
--
-- Since 20260826110000 the importer has treated a pitch booking as a reason
-- to KEEP a withdrawn fixture: it was flagged, the administrator was told,
-- and the booking sat on the calendar until somebody opened the fixture and
-- deleted it by hand. That is the wrong way round. A pitch held for a match
-- the league no longer lists is a pitch nobody else can book, and the
-- Saturday it blocks is the one the club has least of.
--
-- So the pitch is now the FIRST thing to go, not the reason to stay:
--
--   * A withdrawn fixture's booking is cancelled the way `unallocate_fixture`
--     cancels one — status 'cancelled', the link cut both ways, the fixture's
--     `fixtures_sync_booking` trigger told to stand aside — so the calendar
--     is clear on the run that finds it, not the run after.
--   * With the pitch gone, only a team sheet or player stats keep the fixture
--     back, exactly as before: those are the club's own work and are never
--     deleted by an import. The flag, the one-time message and the brake are
--     unchanged; the message now says the pitch has been freed.
--   * A withdrawn fixture with nothing else built on it is deleted, as it
--     always was — and now that includes one that had only a pitch.
--
-- The rest of `import_fixtures()` is 20260826110000's body verbatim. Only the
-- reconciliation loop changes.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table or policy change;
-- the function keeps its gate); data touched: none on push — it changes what
-- the next import does with a fixture Full-Time no longer publishes;
-- rollback: restore import_fixtures from 20260826110000.
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
  v_freed integer := 0;
  -- the telling
  v_fresh text[] := '{}';
  v_team_name text;
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
      -- Seen again, so it is published again: the flag goes.
      update public.fixtures
         set kickoff_at = v_kick, opponent = r->>'opponent', is_home = coalesce((r->>'isHome')::boolean, true),
             competition = r->>'competition', status = v_status, home_score = v_home, away_score = v_away,
             venue_text = r->>'venue', imported_at = now(), last_seen_at = now(),
             no_longer_published_at = null
       where id = v_existing.id;
      v_upd := v_upd + 1;
    else
      update public.fixtures
         set last_seen_at = now(), no_longer_published_at = null
       where id = v_existing.id;
      v_same := v_same + 1;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- Reconciliation
  -- -------------------------------------------------------------------------
  if array_length(v_refs, 1) is not null then

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
    v_limit := greatest(2, (array_length(v_refs, 1) / 2));

    if v_candidates > v_limit then
      -- The brake. Nothing is removed, nothing is flagged, nobody is told:
      -- this run has just said it does not believe the payload, and a false
      -- alarm cannot be unsent.
      v_warnings := v_warnings || to_jsonb(format(
        'Full-Time did not publish %s fixtures this team already has between %s and %s. That is more than half of the %s it did publish, so none were removed — this looks like a short fetch rather than a change to the fixture list. Check the feed, then run the import again.',
        v_candidates, v_from::date, v_to::date, array_length(v_refs, 1)));
      v_kept := v_candidates;
    else
      for v_row in
        select f.id, f.opponent, f.is_home, f.kickoff_at, f.competition,
               f.external_ref, f.venue_text, f.season_id, f.no_longer_published_at,
               f.booking_id,
               exists (select 1 from public.fixture_lineups l where l.fixture_id = f.id) as has_lineup,
               exists (select 1 from public.fixture_player_stats s where s.fixture_id = f.id) as has_stats
          from public.fixtures f where f.id = any (v_ids)
      loop
        -- THE PITCH GOES FIRST (Adam, 2026-09-06). A match the league no
        -- longer lists must not hold a pitch, whatever else is built on it.
        -- Same steps as unallocate_fixture(): the link cut both ways, the
        -- booking cancelled, the fixture's own booking trigger stood down.
        if v_row.booking_id is not null then
          update public.fixtures
             set booking_id = null, venue_resource_id = null, allocation_conflict = false
           where id = v_row.id;
          perform set_config('app.fixture_booking_managed', 'true', true);
          update public.bookings
             set status = 'cancelled', fixture_id = null
           where id = v_row.booking_id and status <> 'cancelled';
          perform set_config('app.fixture_booking_managed', '', true);
          v_freed := v_freed + 1;
        end if;

        if v_row.has_lineup or v_row.has_stats then
          v_kept := v_kept + 1;

          -- Flag it, and remember it for the notification ONLY if this run is
          -- the one that found it. Everything after the first run is silent.
          if v_row.no_longer_published_at is null then
            update public.fixtures set no_longer_published_at = now() where id = v_row.id;
            v_fresh := v_fresh || format('%s on %s (%s%s)',
              v_row.opponent,
              to_char(v_row.kickoff_at at time zone 'Europe/London', 'FMDay FMDD Mon, HH24:MI'),
              case when v_row.has_lineup then 'a team sheet has been picked'
                   else 'player stats have been recorded' end,
              case when v_row.booking_id is not null then '; its pitch booking has been cancelled' else '' end);
          end if;

          v_warnings := v_warnings || to_jsonb(format(
            '%s on %s is no longer in Full-Time, but it has %s, so it has been left alone%s. Delete it from the fixture''s own page if it should go.',
            v_row.opponent, to_char(v_row.kickoff_at at time zone 'Europe/London', 'FMDay FMDD Mon, HH24:MI'),
            case when v_row.has_lineup then 'a team sheet' else 'player stats' end,
            case when v_row.booking_id is not null then ' — its pitch booking has been cancelled' else '' end));
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
                    'booking_cancelled', v_row.booking_id,
                    'window_from', v_from,
                    'window_to', v_to,
                    'trigger', p_trigger));
          delete from public.fixtures where id = v_row.id;
          v_retired := v_retired + 1;
        end if;
      end loop;

      if v_freed > 0 then
        v_warnings := v_warnings || to_jsonb(format(
          '%s pitch booking%s cancelled for fixtures Full-Time no longer publishes.',
          v_freed, case when v_freed = 1 then ' was' else 's were' end));
      end if;
    end if;
  end if;

  insert into public.fixture_import_runs (team_id, trigger, status, source_url, fetched_at, inserted, updated, unchanged, retired, kept_back, warnings, run_by)
  values (p_team_id, p_trigger, 'ok', p_source_url, now(), v_ins, v_upd, v_same, v_retired, v_kept, v_warnings, auth.uid())
  returning id into v_run;

  update public.team_fulltime_links
     set last_import_at = now(), last_import_status = 'ok', last_import_count = v_ins + v_upd + v_same, last_error = null
   where team_id = p_team_id;

  -- -------------------------------------------------------------------------
  -- Telling somebody. One message per run, naming every fixture it found.
  -- -------------------------------------------------------------------------
  if array_length(v_fresh, 1) is not null then
    select name into v_team_name from public.teams where id = p_team_id;
    perform public.notify_club_admins(
      format('%s: %s no longer in Full-Time',
             coalesce(v_team_name, 'A team'),
             case when array_length(v_fresh, 1) = 1 then '1 fixture is'
                  else array_length(v_fresh, 1)::text || ' fixtures are' end),
      format(
        E'The fixture list Full-Time publishes for %s no longer includes %s. It has not been removed, because the club''s own work is built on it — any pitch it held has been freed:\n\n%s\n\nEither the league has withdrawn the game, or it has been re-issued under a new id and the replacement has already imported. Open the fixture to delete it, or leave it if the club is still playing it.',
        coalesce(v_team_name, 'this team'),
        case when array_length(v_fresh, 1) = 1 then 'a fixture' else 'these fixtures' end,
        array_to_string(v_fresh, E'\n')),
      format('/teams/%s', p_team_id));
  end if;

  return query select v_run, v_ins, v_upd, v_same;
end;
$fn$;

comment on function public.import_fixtures(uuid, uuid, jsonb, text, text, jsonb) is
  'Upsert a team''s Full-Time fixtures by external_ref, and retire the ones Full-Time no longer publishes inside the window the payload covers. A retired fixture''s pitch booking is cancelled on the run that finds it; the fixture itself is deleted when nothing else is built on it, and flagged with no_longer_published_at (every club administrator told once) when a team sheet or player stats hang off it. Retiring more than half of what was imported is treated as a short fetch: nothing removed, nothing flagged, nobody told.';
