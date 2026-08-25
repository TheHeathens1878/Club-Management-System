-- =============================================================================
-- Match stats and the coach's scoreline
-- =============================================================================
-- Adam, 2026-08-25 (evening): "The event (match) page should have tabs showing
-- details, line-up, match-stats (simple... captain, goals, assists, player of
-- the match etc) and scoreline. Full-Time will only import scorelines for U12
-- and above so where it comes through as X-X, the coach's score will over-ride
-- it."
--
-- THE SCORE RULE (one rule, two places it is written down)
--   `fixtures.home_score` / `away_score` belong to the FA Full-Time importer
--   (20260823150000). Full-Time only publishes results for U12 and above, so
--   for a U9 or U11 side those columns stay NULL forever, and for older sides
--   they stay NULL until the league's secretary types the result in.
--   `coach_home_score` / `coach_away_score` are the club's own record, typed on
--   the Scoreline tab by the team's staff.
--
--   The EFFECTIVE scoreline is the coach's pair when it is set, otherwise
--   Full-Time's, otherwise there is no score yet. The coach always wins — Adam
--   asked for the override, and the coach was at the game. The web app states
--   the same rule once, in `apps/web/src/lib/scoreline.ts`, and every screen
--   reads it from there.
--
--   Nothing here overwrites Full-Time's columns and nothing there overwrites
--   the coach's: `import_fixtures()` names the columns it updates
--   (kickoff_at, opponent, is_home, competition, status, home_score,
--   away_score, venue_text, imported_at, last_seen_at) and the two new columns
--   are not among them, so a re-import leaves the coach's score alone. The
--   pgTAP test pins that.
--
-- WHO MAY WRITE THE COACH'S SCORE
--   `fixtures_guard()` gates values, not columns, and `fixtures_staff_update`
--   (20260823140000) already allows club_admin and the team's staff to UPDATE
--   any column of their own team's fixture. The two new columns therefore need
--   no policy change — they inherit exactly the audience Adam described. There
--   is no allow-list in the guard to extend; the test proves a coach can write
--   them and a stranger cannot.
--
-- SHAPE
--   * `fixture_player_stats` — one row per (fixture, player) that has anything
--     worth recording: goals, assists, and the two "there can be only one"
--     flags, captain and player of the match. Deliberately thin. Adam asked for
--     "simple"; minutes played, cards and ratings are not in the ask and would
--     each be a column nobody fills in. A player with a blank line is simply
--     not stored — the RPC drops all-zero rows — so the table holds facts, not
--     an empty grid per fixture.
--   * The two partial unique indexes are the "only one" rule. A UI radio group
--     says the same thing, but the UI is not the enforcement.
--
-- SAFEGUARDING
--   A stats row carries NO SG-6 weight, exactly like `selections` and
--   `fixture_lineup_slots`. It is not a team membership and confers no access
--   to a child. The guard below runs the same rule `fixture_lineup_slots_guard()`
--   runs: the person must hold a LIVE PLAYER membership on the fixture's team
--   for the fixture's season, so a coach cannot credit a goal to a child who is
--   not registered to that team.
--
-- RLS
--   Read: the same audience `fixture_lineups_read` has — any live member of the
--   fixture's team, their guardians, and club_admin / safeguarding_lead — so a
--   parent can see that their child scored. Write: the team's staff and
--   club_admin only, the same predicate `fixture_lineups_staff_write` uses. No
--   anon anywhere.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table, two new
-- columns on an existing one); data touched: none (additive only); rollback:
-- §7.
-- =============================================================================


-- =============================================================================
-- 1. THE COACH'S SCORELINE
-- =============================================================================

alter table public.fixtures
  add column coach_home_score integer,
  add column coach_away_score integer;

alter table public.fixtures
  add constraint fixtures_coach_home_score_positive
    check (coach_home_score is null or coach_home_score >= 0),
  add constraint fixtures_coach_away_score_positive
    check (coach_away_score is null or coach_away_score >= 0),
  add constraint fixtures_coach_scores_together
    check ((coach_home_score is null) = (coach_away_score is null));

comment on column public.fixtures.coach_home_score is
  'The home goals as the coach recorded them. Full-Time only publishes results for U12 and above; where its own home_score is null (or wrong), this is what everyone sees. The coach''s pair always overrides the imported pair — see apps/web/src/lib/scoreline.ts.';
comment on column public.fixtures.coach_away_score is
  'The away goals as the coach recorded them. Set and cleared together with coach_home_score. Never written by the Full-Time importer: import_fixtures() names the columns it updates and these are not among them.';


-- =============================================================================
-- 2. TABLE
-- =============================================================================

create table public.fixture_player_stats (
  id               uuid primary key default gen_random_uuid(),
  fixture_id       uuid not null references public.fixtures (id) on delete cascade,
  -- `restrict`, not `cascade`: a person who played in a match is part of that
  -- match's record. Deleting them is a decision someone has to make explicitly,
  -- the way `fixtures.team_id` and `fixtures.season_id` already behave.
  person_id        uuid not null references public.people (id) on delete restrict,
  goals            smallint not null default 0,
  assists          smallint not null default 0,
  captain          boolean not null default false,
  player_of_match  boolean not null default false,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fixture_id, person_id),
  constraint fixture_player_stats_goals_positive   check (goals >= 0),
  constraint fixture_player_stats_assists_positive check (assists >= 0)
);

-- One captain and one player of the match per fixture. Partial unique indexes,
-- so any number of rows may carry `false`.
create unique index fixture_player_stats_captain_idx
  on public.fixture_player_stats (fixture_id) where captain;
create unique index fixture_player_stats_potm_idx
  on public.fixture_player_stats (fixture_id) where player_of_match;
create index fixture_player_stats_person_idx on public.fixture_player_stats (person_id);

create trigger trg_fixture_player_stats_updated
  before update on public.fixture_player_stats
  for each row execute function public.set_updated_at();

comment on table public.fixture_player_stats is
  'Simple per-player match stats: goals, assists, captain, player of the match. A stats row is NOT a team membership and carries no SG-6 weight; the guard requires a live player membership on the fixture''s team for its season.';


-- =============================================================================
-- 3. GUARD
-- =============================================================================

-- The same rule `fixture_lineup_slots_guard()` enforces, reached directly
-- (stats row → fixture) rather than through a lineup.
create or replace function public.fixture_player_stats_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if not exists (
    select 1 from public.fixtures f
    join public.team_memberships m on m.team_id = f.team_id and m.season_id = f.season_id
    where f.id = new.fixture_id and m.person_id = new.person_id
      and m.left_at is null and m.role = 'player')
  then
    raise exception 'fixture_player_stats: the person must be a live player on the fixture''s team for its season'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_fixture_player_stats_guard
  before insert or update on public.fixture_player_stats
  for each row execute function public.fixture_player_stats_guard();


-- =============================================================================
-- 4. THE WHOLE-FIXTURE WRITE
-- =============================================================================

-- The Match stats form shows the squad and saves it whole, exactly as the
-- lineup board does. Sending N upserts plus the deletions for the players whose
-- line was cleared would race with itself and would let the "one captain" index
-- fire on an intermediate state (moving the armband from A to B briefly has
-- two captains). One call, one transaction, one truth.
--
-- SECURITY DEFINER, so it runs as the owner and RLS does not apply: the 42501
-- check below is the whole gate and has to be here, not in the app. The guard
-- trigger still runs, so a person who is not a live player on the team is
-- refused even through this door.
--
-- p_stats is an array of {person_id, goals, assists, captain, player_of_match}.
-- A line with nothing on it (no goals, no assists, no armband, no award) is not
-- stored — the fixture's stats are the facts about it, not a grid of zeroes.
create or replace function public.set_fixture_stats(p_fixture_id uuid, p_stats jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_team     uuid;
  v_captains integer := 0;
  v_potm     integer := 0;
  v_seen     uuid[] := '{}';
  r          jsonb;
  v_person   uuid;
  v_goals    integer;
  v_assists  integer;
  v_captain  boolean;
  v_award    boolean;
begin
  select team_id into v_team from public.fixtures where id = p_fixture_id;
  if v_team is null then
    raise exception 'set_fixture_stats: unknown fixture %', p_fixture_id using errcode = 'P0001';
  end if;

  if not (public.is_club_admin() or public.is_team_staff(v_team)) then
    raise exception 'set_fixture_stats: only the team''s staff or a club administrator may record match stats'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_stats, 'null'::jsonb)) <> 'array' then
    raise exception 'set_fixture_stats: stats must be a JSON array' using errcode = '22023';
  end if;

  -- Pass one: read and check everything before a single row is touched, so a
  -- rejected save leaves the fixture's stats exactly as they were.
  for r in select * from jsonb_array_elements(p_stats) loop
    v_person  := nullif(btrim(coalesce(r->>'person_id', '')), '')::uuid;
    if v_person is null then
      raise exception 'set_fixture_stats: every line needs a person_id' using errcode = '22023';
    end if;
    if v_person = any (v_seen) then
      raise exception 'set_fixture_stats: the same player appears twice' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_person;

    v_goals   := coalesce((r->>'goals')::integer, 0);
    v_assists := coalesce((r->>'assists')::integer, 0);
    if v_goals < 0 or v_assists < 0 then
      raise exception 'set_fixture_stats: goals and assists cannot be negative' using errcode = 'P0001';
    end if;
    if v_goals > 99 or v_assists > 99 then
      raise exception 'set_fixture_stats: goals and assists are recorded up to 99' using errcode = 'P0001';
    end if;

    v_captain := coalesce((r->>'captain')::boolean, false);
    v_award   := coalesce((r->>'player_of_match')::boolean, false);
    if v_captain then v_captains := v_captains + 1; end if;
    if v_award   then v_potm     := v_potm + 1;     end if;
  end loop;

  if v_captains > 1 then
    raise exception 'set_fixture_stats: a match has one captain, not %', v_captains using errcode = 'P0001';
  end if;
  if v_potm > 1 then
    raise exception 'set_fixture_stats: a match has one player of the match, not %', v_potm using errcode = 'P0001';
  end if;

  -- Pass two: replace the fixture's stats with exactly what was sent.
  delete from public.fixture_player_stats where fixture_id = p_fixture_id;

  insert into public.fixture_player_stats (fixture_id, person_id, goals, assists, captain, player_of_match)
  select p_fixture_id,
         (s->>'person_id')::uuid,
         coalesce((s->>'goals')::integer, 0),
         coalesce((s->>'assists')::integer, 0),
         coalesce((s->>'captain')::boolean, false),
         coalesce((s->>'player_of_match')::boolean, false)
    from jsonb_array_elements(p_stats) s
   where coalesce((s->>'goals')::integer, 0) > 0
      or coalesce((s->>'assists')::integer, 0) > 0
      or coalesce((s->>'captain')::boolean, false)
      or coalesce((s->>'player_of_match')::boolean, false);
end;
$$;

comment on function public.set_fixture_stats(uuid, jsonb) is
  'Replaces one fixture''s player stats in a single call. Team staff and club_admin only (42501). Blank lines are dropped; one captain and one player of the match are checked before anything is written.';


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

alter table public.fixture_player_stats enable row level security;

create policy "fixture_player_stats_read" on public.fixture_player_stats for select to authenticated
  using (public.is_team_member(public.fixture_team_id(fixture_id))
         or public.is_team_guardian(public.fixture_team_id(fixture_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "fixture_player_stats_staff_write" on public.fixture_player_stats for all to authenticated
  using (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)))
  with check (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)));


-- =============================================================================
-- 6. GRANTS
-- =============================================================================

revoke all privileges on public.fixture_player_stats from anon, authenticated, service_role;
grant select, insert, update, delete on public.fixture_player_stats to authenticated, service_role;

revoke all privileges on function public.set_fixture_stats(uuid, jsonb) from public, anon;
grant execute on function public.set_fixture_stats(uuid, jsonb) to authenticated, service_role;
revoke all privileges on function public.fixture_player_stats_guard() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 7. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function public.set_fixture_stats(uuid, jsonb);
-- drop table public.fixture_player_stats;
-- drop function public.fixture_player_stats_guard();
-- alter table public.fixtures
--   drop constraint fixtures_coach_scores_together,
--   drop constraint fixtures_coach_away_score_positive,
--   drop constraint fixtures_coach_home_score_positive,
--   drop column coach_away_score,
--   drop column coach_home_score;
