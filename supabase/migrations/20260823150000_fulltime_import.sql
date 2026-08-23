-- =============================================================================
-- P2.4 — FA Full-Time importer: the database half
-- =============================================================================
-- PLAN.md task P2.4 ("scheduled Edge Function fetches each mapped team's
-- fixtures from fulltime.thefa.com and upserts by external_ref … Handles
-- reschedules/postponements as updates, never duplicates; imports results
-- after matches … import failures alert admin. Manual fallback: paste a
-- Full-Time URL or CSV to import on demand"). Linear TH1-21.
--
-- DIVISION OF LABOUR
--   Fetching and parsing happen outside the database (`packages/fulltime`,
--   used by the `fulltime-import` Edge Function and by the admin screen's
--   paste/CSV fallback). Everything that decides what an import MEANS happens
--   here, in one function, so the scheduled path and the manual path cannot
--   drift:
--     `import_fixtures(team_id, season_id, fixtures jsonb, source, run_meta)`
--   upserts by (team_id, external_ref): a new ref inserts; a known ref updates
--   kickoff/opponent/competition/status/scores/venue_text (a reschedule or
--   postponement is an UPDATE of the same row — never a duplicate); every
--   ref seen gets `last_seen_at`; refs NOT in the payload are left alone
--   (Full-Time pages are filtered views; absence is not cancellation — the
--   admin screen shows "not seen since" instead). Manual rows (`source =
--   'manual'`) are never touched by an import. P2.5's `fixtures_sync_booking`
--   trigger fires on the UPDATE, so a reschedule moves the linked pitch
--   booking or flags a conflict — the importer does not know or care.
--
--   `fixture_import_runs` records every run (scheduled or manual) with the
--   outcome, counts and the error/challenge text, and mirrors the latest
--   outcome onto `team_fulltime_links.last_import_*`. A failed run writes a
--   `fixtures.import_failed` audit row, which is what "alert admin" hangs off
--   (P4.2/P4.4 route it as a notification; until then the teams screen shows
--   it).
--
-- WHO MAY CALL
--   `import_fixtures()` is SECURITY DEFINER; `service_role` (the Edge
--   Function) and `club_admin` (manual fallback) — anyone else is refused.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table); data
-- touched: none; rollback: §6.
-- =============================================================================


-- =============================================================================
-- 1. fixture_import_runs
-- =============================================================================

create table public.fixture_import_runs (
  id             bigint generated always as identity primary key,
  team_id        uuid references public.teams (id) on delete cascade,
  trigger        text not null check (trigger in ('scheduled', 'manual_url', 'manual_csv')),
  status         text not null check (status in ('ok', 'error', 'challenge', 'skipped')),
  source_url     text,
  fetched_at     timestamptz,
  inserted       integer not null default 0,
  updated        integer not null default 0,
  unchanged      integer not null default 0,
  warnings       jsonb not null default '[]'::jsonb,
  error          text,
  run_by         uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index fixture_import_runs_team_idx on public.fixture_import_runs (team_id, created_at desc);

alter table public.fixture_import_runs enable row level security;
create policy "fixture_import_runs_admin_read" on public.fixture_import_runs for select to authenticated
  using (public.is_club_admin());
revoke all privileges on public.fixture_import_runs from anon, authenticated, service_role;
grant select on public.fixture_import_runs to authenticated;
grant select, insert on public.fixture_import_runs to service_role;

comment on table public.fixture_import_runs is 'One row per Full-Time import attempt (scheduled or manual), with outcome and counts.';


-- =============================================================================
-- 2. import_fixtures()
-- =============================================================================
-- fixtures jsonb: array of objects
--   { externalRef, kickoffAt (ISO), opponent, isHome (bool), competition?,
--     status ('scheduled'|'played'|'postponed'|'cancelled'|'abandoned'),
--     homeScore?, awayScore?, venue? }
-- (the `ParsedFixture` shape from packages/fulltime after fixturesForTeam()).

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
as $$
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

  insert into public.fixture_import_runs (team_id, trigger, status, source_url, fetched_at, inserted, updated, unchanged, warnings, run_by)
  values (p_team_id, p_trigger, 'ok', p_source_url, now(), v_ins, v_upd, v_same, coalesce(p_warnings, '[]'::jsonb), auth.uid())
  returning id into v_run;

  update public.team_fulltime_links
     set last_import_at = now(), last_import_status = 'ok', last_import_count = v_ins + v_upd + v_same, last_error = null
   where team_id = p_team_id;

  return query select v_run, v_ins, v_upd, v_same;
end;
$$;

-- Record a failed or challenged fetch (no fixtures touched) and alert.
create or replace function public.record_fixture_import_failure(
  p_team_id    uuid,
  p_trigger    text,
  p_status     text,
  p_source_url text,
  p_error      text
)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_run bigint;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'record_fixture_import_failure: club_admin or service_role only' using errcode = '42501';
  end if;
  if p_status not in ('error', 'challenge', 'skipped') then
    raise exception 'record_fixture_import_failure: status must be error, challenge or skipped' using errcode = '22023';
  end if;
  insert into public.fixture_import_runs (team_id, trigger, status, source_url, fetched_at, error, run_by)
  values (p_team_id, p_trigger, p_status, p_source_url, now(), p_error, auth.uid())
  returning id into v_run;
  update public.team_fulltime_links
     set last_import_at = now(), last_import_status = p_status, last_error = p_error
   where team_id = p_team_id;
  if p_status <> 'skipped' then
    insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (auth.uid(), (select email from auth.users where id = auth.uid()),
            'fixtures.import_failed', 'team_fulltime_links', p_team_id::text,
            jsonb_build_object('status', p_status, 'trigger', p_trigger, 'error', left(p_error, 500)));
  end if;
  return v_run;
end;
$$;

-- What the scheduled importer iterates: enabled links with their team + the
-- current season.
create or replace function public.fulltime_import_targets()
  returns table (team_id uuid, team_name text, season_id uuid, source_url text, league_id text, ft_season_id text,
                 division_id text, fixture_group_key text, ft_team_id text, ft_team_name text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select l.team_id, t.name, s.id, l.source_url, l.league_id, l.ft_season_id, l.division_id, l.fixture_group_key,
         l.ft_team_id, coalesce(l.ft_team_name, t.name)
  from public.team_fulltime_links l
  join public.teams t on t.id = l.team_id
  cross join lateral (select id from public.seasons where is_current limit 1) s
  where l.enabled and t.active
  order by t.sort_order, t.name;
$$;


-- =============================================================================
-- 3. GRANTS
-- =============================================================================

revoke all privileges on function public.import_fixtures(uuid, uuid, jsonb, text, text, jsonb) from public, anon;
revoke all privileges on function public.record_fixture_import_failure(uuid, text, text, text, text) from public, anon;
revoke all privileges on function public.fulltime_import_targets() from public, anon, authenticated;
grant execute on function public.import_fixtures(uuid, uuid, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.record_fixture_import_failure(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.fulltime_import_targets() to service_role;

-- =============================================================================
-- 4. NIGHTLY SCHEDULE — pg_cron → pg_net → the fulltime-import Edge Function
-- =============================================================================
-- The call needs the project URL and the service-role key. Neither belongs in
-- a migration, so both are read from Vault at run time:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
-- Until both secrets exist the job logs a NOTICE and does nothing — it never
-- fails loudly at 03:00 for a missing secret. 03:15 UTC daily.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or v_key is null then
    raise notice 'invoke_edge_function(%): Vault secrets project_url/service_role_key not set; skipping', p_name;
    return null;
  end if;
  return net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := p_body,
    timeout_milliseconds := 120000);
end;
$$;
revoke all privileges on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;

select cron.schedule('fulltime-import-nightly', '15 3 * * *', $cron$ select public.invoke_edge_function('fulltime-import') $cron$);

notify pgrst, 'reload schema';


-- =============================================================================
-- 6. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function fulltime_import_targets, record_fixture_import_failure,
-- import_fixtures; drop table fixture_import_runs. Imported fixtures stay.
