-- =============================================================================
-- P2.3 — fixtures, availability, selections, team_fulltime_links
-- =============================================================================
-- PLAN.md task P2.3 ("Fixtures schema in main project: fixtures (home/away,
-- opponent, competition, kickoff, status, source = fulltime/manual,
-- external_ref, venue → nullable FK to pitch resources), availability,
-- selections. Team settings store the team's FA Full-Time identifiers —
-- editable in-app by club admins … RLS: club_admin only"). Linear TH1-20.
--
-- PURPOSE
--   The club's own fixtures module. Rows arrive from the FA Full-Time importer
--   (P2.4, `source = 'fulltime'`, keyed by `external_ref`) or are typed in
--   (`source = 'manual'`). The `fixtures-system` Supabase project is unrelated
--   and is not referenced anywhere (PLAN §3 Q2).
--
-- SHAPE
--   * `team_fulltime_links` — one row per team: the Full-Time identifiers the
--     admin screen parses out of a pasted URL (`league`, `selectedSeason`,
--     `selectedDivision`, `selectedFixtureGroupKey`, optional `selectedTeam`)
--     plus the original URL, an `enabled` switch, and the last import's
--     outcome. Re-linking a team (new season, league change) is an UPDATE of
--     this row; fixtures are keyed on (team_id, external_ref) and are never
--     touched by a re-link, so nothing is orphaned. RLS: club_admin only;
--     service_role (the importer) bypasses.
--   * `fixtures` — per team per season. `kickoff_at timestamptz`; `is_home`;
--     `opponent` free text (Full-Time team names, not a FK — the opponent is
--     not a person or team the club manages); `competition`; `status`;
--     `source`; `external_ref` (Full-Time's `displayFixture.html?id=NNN`, or
--     a stable hash when absent — P2.4); `venue_resource_id` → a pitch in
--     `resources` (nullable; P2.5's allocation sets it and links a booking);
--     `venue_text` for away grounds; scores; `last_seen_at` so the importer
--     can notice a fixture Full-Time has dropped.
--   * `availability` — (fixture, person) → available / unavailable / maybe,
--     with a note. Written by the person (or an active guardian of a minor),
--     read by the team's staff.
--   * `selections` — (fixture, person) with `role` starter / sub and a shirt
--     number; written by team staff / club_admin. A selection is NOT a team
--     membership and carries no SG-6 weight; the guard requires the person
--     to hold a live membership on the fixture's team in its season, so a
--     coach cannot "select" a child onto a team they are not registered to.
--
-- RLS
--   fixtures: any authenticated person reads (a fixture list is club-public
--   information); club_admin and the team's staff insert/update; club_admin
--   deletes. availability: self + guardian-of-minor write; self, guardian,
--   team staff, admins read. selections: team staff + club_admin write; any
--   live member of the team, their guardians, staff and admins read.
--   team_fulltime_links: club_admin only. No anon anywhere.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (four new tables); data
-- touched: none; rollback: §9.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.fixture_status as enum ('scheduled', 'postponed', 'cancelled', 'played', 'abandoned');
create type public.fixture_source as enum ('fulltime', 'manual');
create type public.availability_status as enum ('available', 'unavailable', 'maybe');
create type public.selection_role as enum ('starter', 'substitute');


-- =============================================================================
-- 2. team_fulltime_links
-- =============================================================================

create table public.team_fulltime_links (
  team_id             uuid primary key references public.teams (id) on delete cascade,
  source_url          text not null,
  league_id           text not null,
  ft_season_id        text not null,
  division_id         text,
  fixture_group_key   text,
  ft_team_id          text,
  ft_team_name        text,
  enabled             boolean not null default true,
  last_import_at      timestamptz,
  last_import_status  text check (last_import_status is null or last_import_status in ('ok', 'error', 'challenge')),
  last_import_count   integer,
  last_error          text,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint team_fulltime_links_url_not_blank     check (btrim(source_url) <> ''),
  constraint team_fulltime_links_league_not_blank  check (btrim(league_id) <> ''),
  constraint team_fulltime_links_season_not_blank  check (btrim(ft_season_id) <> ''),
  constraint team_fulltime_links_url_is_fulltime   check (source_url ~* '^https?://fulltime\.thefa\.com/')
);

create trigger trg_team_fulltime_links_updated
  before update on public.team_fulltime_links
  for each row execute function public.set_updated_at();

comment on table public.team_fulltime_links is
  'FA Full-Time identifiers per team, parsed from a pasted URL by the admin screen. Re-linking updates this row; fixtures are keyed by external_ref and are never orphaned.';


-- =============================================================================
-- 3. fixtures
-- =============================================================================

create table public.fixtures (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams (id) on delete restrict,
  season_id           uuid not null references public.seasons (id) on delete restrict,
  opponent            text not null,
  is_home             boolean not null,
  competition         text,
  kickoff_at          timestamptz not null,
  status              public.fixture_status not null default 'scheduled',
  source              public.fixture_source not null default 'manual',
  external_ref        text,
  venue_resource_id   uuid references public.resources (id) on delete set null,
  venue_text          text,
  home_score          integer check (home_score is null or home_score >= 0),
  away_score          integer check (away_score is null or away_score >= 0),
  notes               text,
  imported_at         timestamptz,
  last_seen_at        timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fixtures_opponent_not_blank check (btrim(opponent) <> ''),
  constraint fixtures_external_ref_for_fulltime check (source <> 'fulltime' or external_ref is not null),
  constraint fixtures_scores_together check ((home_score is null) = (away_score is null))
);

create unique index fixtures_team_external_ref_idx on public.fixtures (team_id, external_ref) where external_ref is not null;
create index fixtures_team_kickoff_idx on public.fixtures (team_id, kickoff_at);
create index fixtures_kickoff_idx on public.fixtures (kickoff_at);
create index fixtures_venue_idx on public.fixtures (venue_resource_id) where venue_resource_id is not null;

create trigger trg_fixtures_updated
  before update on public.fixtures
  for each row execute function public.set_updated_at();

-- A venue must be a pitch (or any resource that is not a function room).
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
  return new;
end;
$$;

create trigger trg_fixtures_guard
  before insert or update on public.fixtures
  for each row execute function public.fixtures_guard();

comment on table public.fixtures is
  'Club fixtures per team per season. source=fulltime rows are owned by the P2.4 importer and keyed by external_ref; manual rows are typed in.';


-- =============================================================================
-- 4. availability
-- =============================================================================

create table public.availability (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references public.fixtures (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  status      public.availability_status not null,
  note        text,
  set_by      uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fixture_id, person_id)
);

create index availability_person_idx on public.availability (person_id);

create trigger trg_availability_updated
  before update on public.availability
  for each row execute function public.set_updated_at();

create or replace function public.availability_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.set_by := coalesce(auth.uid(), new.set_by);
  if not exists (
    select 1 from public.fixtures f
    join public.team_memberships m on m.team_id = f.team_id and m.season_id = f.season_id
    where f.id = new.fixture_id and m.person_id = new.person_id and m.left_at is null)
  then
    raise exception 'availability: the person must hold a live membership on the fixture''s team for its season'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_availability_guard
  before insert or update on public.availability
  for each row execute function public.availability_guard();


-- =============================================================================
-- 5. selections
-- =============================================================================

create table public.selections (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    uuid not null references public.fixtures (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  role          public.selection_role not null default 'starter',
  shirt_number  integer check (shirt_number is null or shirt_number between 0 and 99),
  selected_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (fixture_id, person_id)
);

create trigger trg_selections_updated
  before update on public.selections
  for each row execute function public.set_updated_at();

create or replace function public.selections_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.selected_by := coalesce(auth.uid(), new.selected_by);
  if not exists (
    select 1 from public.fixtures f
    join public.team_memberships m on m.team_id = f.team_id and m.season_id = f.season_id
    where f.id = new.fixture_id and m.person_id = new.person_id and m.left_at is null and m.role = 'player')
  then
    raise exception 'selections: the person must be a live player on the fixture''s team for its season'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_selections_guard
  before insert or update on public.selections
  for each row execute function public.selections_guard();


-- =============================================================================
-- 6. HELPERS FOR RLS
-- =============================================================================

create or replace function public.fixture_team_id(p_fixture_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select team_id from public.fixtures where id = p_fixture_id;
$$;

-- Is the caller a live member (any role) of this team?
create or replace function public.is_team_member(p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.team_id = p_team_id and m.left_at is null
      and m.person_id = public.current_person_id());
$$;

-- Is the caller an active guardian of a minor who is a live member of this team?
create or replace function public.is_team_guardian(p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships m
    join public.guardianships g on g.child_person_id = m.person_id and g.ended_at is null
    where m.team_id = p_team_id and m.left_at is null
      and g.guardian_person_id = public.current_person_id()
      and public.is_minor(m.person_id));
$$;

-- May the caller write availability/selection rows on behalf of this person?
-- (self, or active guardian of a minor)
create or replace function public.can_act_for(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p_person_id = public.current_person_id()
      or (public.is_minor(p_person_id) and public.is_active_guardian_of(p_person_id));
$$;


-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================

alter table public.team_fulltime_links enable row level security;
alter table public.fixtures             enable row level security;
alter table public.availability         enable row level security;
alter table public.selections           enable row level security;

create policy "team_fulltime_links_admin_all" on public.team_fulltime_links for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "fixtures_read" on public.fixtures for select to authenticated using (true);
create policy "fixtures_staff_insert" on public.fixtures for insert to authenticated
  with check (public.is_club_admin() or public.is_team_staff(team_id));
create policy "fixtures_staff_update" on public.fixtures for update to authenticated
  using (public.is_club_admin() or public.is_team_staff(team_id))
  with check (public.is_club_admin() or public.is_team_staff(team_id));
create policy "fixtures_admin_delete" on public.fixtures for delete to authenticated
  using (public.is_club_admin());

create policy "availability_read" on public.availability for select to authenticated
  using (public.can_act_for(person_id)
         or public.is_team_staff(public.fixture_team_id(fixture_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "availability_write_insert" on public.availability for insert to authenticated
  with check (public.can_act_for(person_id) or public.is_club_admin()
              or public.is_team_staff(public.fixture_team_id(fixture_id)));
create policy "availability_write_update" on public.availability for update to authenticated
  using (public.can_act_for(person_id) or public.is_club_admin()
         or public.is_team_staff(public.fixture_team_id(fixture_id)))
  with check (public.can_act_for(person_id) or public.is_club_admin()
              or public.is_team_staff(public.fixture_team_id(fixture_id)));
create policy "availability_write_delete" on public.availability for delete to authenticated
  using (public.can_act_for(person_id) or public.is_club_admin());

create policy "selections_read" on public.selections for select to authenticated
  using (public.is_team_member(public.fixture_team_id(fixture_id))
         or public.is_team_guardian(public.fixture_team_id(fixture_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "selections_staff_write" on public.selections for all to authenticated
  using (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)))
  with check (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)));


-- =============================================================================
-- 8. GRANTS
-- =============================================================================

revoke all privileges on public.team_fulltime_links, public.fixtures, public.availability, public.selections
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.team_fulltime_links, public.fixtures, public.availability, public.selections
  to authenticated, service_role;

revoke all privileges on function public.fixture_team_id(uuid)   from public, anon;
revoke all privileges on function public.is_team_member(uuid)    from public, anon;
revoke all privileges on function public.is_team_guardian(uuid)  from public, anon;
revoke all privileges on function public.can_act_for(uuid)       from public, anon;
grant execute on function public.fixture_team_id(uuid), public.is_team_member(uuid),
  public.is_team_guardian(uuid), public.can_act_for(uuid) to authenticated, service_role;
revoke all privileges on function public.fixtures_guard()     from public, anon, authenticated, service_role;
revoke all privileges on function public.availability_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.selections_guard()   from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop table selections, availability, fixtures, team_fulltime_links; drop the
-- seven functions; drop types selection_role, availability_status,
-- fixture_source, fixture_status.
