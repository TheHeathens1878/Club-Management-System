-- =============================================================================
-- Match lineups — formation + who stands where
-- =============================================================================
-- Adam, 2026-08-25 (with Spond screenshots): "Within a match event, I want the
-- ability to select a formation and assign players to it. The formations
-- available will depend on the playing format." Follow-up: "the avatar or the
-- player's initials should appear on the line-up section."
--
-- SHAPE
--   * `fixture_lineups` — ONE lineup per fixture (fixture_id is unique). The
--     formation is free text ('4-4-2', '3-2-3', …) because the catalogue of
--     shapes lives in the web app (`apps/web/src/lib/formations.ts`), keyed by
--     the team's playing format, which is itself derived from `teams.age_group`
--     via the FA table — never stored. Putting the catalogue in the database
--     would mean a migration every time the FA moves a shape around.
--     `name`/`description` are nullable and unused by the first screen; they
--     are here so "Plan B", "second half" lineups can arrive later without a
--     table rewrite.
--   * `fixture_lineup_slots` — one row per occupied slot. The slot key ('GK',
--     'CB1', 'LM', …) is the formation's own key, so changing formation keeps
--     whoever stands on a key that still exists and unplaces the rest. Two
--     unique keys do the work the UI would otherwise have to police:
--     (lineup_id, slot) — one player per position — and (lineup_id, person_id)
--     — nobody plays two positions at once.
--
-- SAFEGUARDING
--   A lineup carries NO SG-6 weight — exactly like `selections`. It is not a
--   team membership and confers no access to a child. The guard below is the
--   same one `selections_guard()` runs: the person placed must hold a LIVE
--   PLAYER membership on the fixture's team for the fixture's season, so a
--   coach cannot draw a child onto a pitch they are not registered to.
--
-- RLS
--   Read: any live member of the fixture's team, their guardians, and
--   club_admin / safeguarding_lead — the same audience `selections` has, so a
--   parent can see where their child is playing. Write: the team's staff and
--   club_admin only. No anon.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (two new tables); data
-- touched: none; rollback: §7.
-- =============================================================================


-- =============================================================================
-- 1. TABLES
-- =============================================================================

create table public.fixture_lineups (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null unique references public.fixtures (id) on delete cascade,
  name        text,
  description text,
  formation   text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fixture_lineups_formation_not_blank check (btrim(formation) <> ''),
  constraint fixture_lineups_formation_shape     check (formation ~ '^[0-9]+(-[0-9]+){1,4}$'),
  constraint fixture_lineups_name_not_blank      check (name is null or btrim(name) <> '')
);

create trigger trg_fixture_lineups_updated
  before update on public.fixture_lineups
  for each row execute function public.set_updated_at();

comment on table public.fixture_lineups is
  'One lineup per fixture: the chosen formation. The catalogue of formations per playing format lives in the web app, not here. No safeguarding weight (see fixture_lineup_slots).';

create table public.fixture_lineup_slots (
  lineup_id   uuid not null references public.fixture_lineups (id) on delete cascade,
  slot        text not null,
  person_id   uuid not null references public.people (id) on delete cascade,
  placed_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (lineup_id, slot),
  unique (lineup_id, person_id),
  constraint fixture_lineup_slots_slot_not_blank check (btrim(slot) <> ''),
  constraint fixture_lineup_slots_slot_shape     check (slot ~ '^[A-Z]{2,4}[0-9]?$')
);

create index fixture_lineup_slots_person_idx on public.fixture_lineup_slots (person_id);

create trigger trg_fixture_lineup_slots_updated
  before update on public.fixture_lineup_slots
  for each row execute function public.set_updated_at();

comment on table public.fixture_lineup_slots is
  'Who stands on which slot key of the lineup''s formation. A placement is NOT a team membership and carries no SG-6 weight; the guard requires a live player membership on the fixture''s team, so nobody can be drawn onto a team they are not registered to.';


-- =============================================================================
-- 2. GUARD
-- =============================================================================

-- The same rule `selections_guard()` enforces, reached one hop further out
-- (slot → lineup → fixture).
create or replace function public.fixture_lineup_slots_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.placed_by := coalesce(auth.uid(), new.placed_by);
  if not exists (
    select 1 from public.fixture_lineups l
    join public.fixtures f on f.id = l.fixture_id
    join public.team_memberships m on m.team_id = f.team_id and m.season_id = f.season_id
    where l.id = new.lineup_id and m.person_id = new.person_id
      and m.left_at is null and m.role = 'player')
  then
    raise exception 'fixture_lineup_slots: the person must be a live player on the fixture''s team for its season'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_fixture_lineup_slots_guard
  before insert or update on public.fixture_lineup_slots
  for each row execute function public.fixture_lineup_slots_guard();


-- =============================================================================
-- 3. HELPER FOR RLS
-- =============================================================================

-- The team a lineup belongs to, so the slot policies can reuse the same
-- `is_team_*` helpers the fixture policies use.
create or replace function public.lineup_team_id(p_lineup_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select f.team_id
    from public.fixture_lineups l
    join public.fixtures f on f.id = l.fixture_id
   where l.id = p_lineup_id;
$$;


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

alter table public.fixture_lineups      enable row level security;
alter table public.fixture_lineup_slots enable row level security;

create policy "fixture_lineups_read" on public.fixture_lineups for select to authenticated
  using (public.is_team_member(public.fixture_team_id(fixture_id))
         or public.is_team_guardian(public.fixture_team_id(fixture_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "fixture_lineups_staff_write" on public.fixture_lineups for all to authenticated
  using (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)))
  with check (public.is_club_admin() or public.is_team_staff(public.fixture_team_id(fixture_id)));

create policy "fixture_lineup_slots_read" on public.fixture_lineup_slots for select to authenticated
  using (public.is_team_member(public.lineup_team_id(lineup_id))
         or public.is_team_guardian(public.lineup_team_id(lineup_id))
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "fixture_lineup_slots_staff_write" on public.fixture_lineup_slots for all to authenticated
  using (public.is_club_admin() or public.is_team_staff(public.lineup_team_id(lineup_id)))
  with check (public.is_club_admin() or public.is_team_staff(public.lineup_team_id(lineup_id)));


-- =============================================================================
-- 5. GRANTS
-- =============================================================================

revoke all privileges on public.fixture_lineups, public.fixture_lineup_slots
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.fixture_lineups, public.fixture_lineup_slots
  to authenticated, service_role;

revoke all privileges on function public.lineup_team_id(uuid) from public, anon;
grant execute on function public.lineup_team_id(uuid) to authenticated, service_role;
revoke all privileges on function public.fixture_lineup_slots_guard() from public, anon, authenticated, service_role;


-- =============================================================================
-- 6. SCHEMA RELOAD
-- =============================================================================

notify pgrst, 'reload schema';


-- =============================================================================
-- 7. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop table public.fixture_lineup_slots, public.fixture_lineups;
-- drop function public.fixture_lineup_slots_guard(), public.lineup_team_id(uuid);
