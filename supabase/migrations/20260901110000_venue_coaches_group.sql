-- =============================================================================
-- A coaches' group per venue, kept in step with who actually coaches there
-- =============================================================================
-- Adam, 2026-09-01: "Each venue (e.g. AoM Sports Club) should have a group for
-- coaches and all coaches whose teams play at that venue are auto-added."
--
-- This is 20260823220000 (team rooms) one level up. The shape is deliberately
-- the same, because that shape has been right for a fortnight:
--   * one conversation per thing, created ON DEMAND rather than in a fixture;
--   * membership DERIVED from facts elsewhere, never typed in;
--   * leaving marks `left_at` — the row stays, because SG-2 says history stays;
--   * a backfill at the end so the club does not have to wait for a change.
--
--
-- 1. WHICH TEAMS PLAY AT A VENUE — and how sure we are
-- ---------------------------------------------------------------------------
-- This is the whole question, so it is worth being precise about what the
-- database actually knows. There are three ways a team is tied to a ground and
-- exactly one of them is guesswork:
--
--   (a) `teams.home_resource_id` — the team's home pitch, set by an admin on
--       the team's match-day settings (20260824200000). On production today 37
--       of 82 teams have one. This is a foreign key an administrator chose. It
--       is the primary rule and it is not a heuristic.
--
--   (b) `fixtures.venue_resource_id` — set by `allocate_fixture()` when a home
--       fixture is put on a pitch (20260823160000). Also a foreign key, also
--       chosen. A team allocated to a pitch at this ground in the CURRENT
--       season plays here whether or not it is their home pitch.
--
--   (c) `events.venue_resource_id` — the same for training and everything else
--       on the team calendar (20260824290000). A team that trains here every
--       Tuesday plays here in every sense a coach cares about.
--
--   And the one we do NOT use: `fixtures.venue_text` / `events.venue_text`.
--   That is free text off FA Full-Time — "Platt Lane Sports Complex", "The
--   Manchester Respect League" — an away ground or a central venue somebody
--   else runs. It is not matched to anything, it is frequently a league name
--   rather than a ground, and `teams.central_venue_name` exists precisely
--   BECAUSE those places are not ours. Nothing here parses it. If the club
--   ever wants central venues modelled, that is a venues row an admin creates
--   and a pitch they attach, not a string match.
--
--   So: derivation is (a) ∪ (b) ∪ (c), over ACTIVE teams, all three of them
--   foreign keys. (b) and (c) are bounded to the current season — a fixture
--   played here in 2024 does not make you a coach here now — and that bound is
--   the one time-dependent part of the rule, which is why §6 schedules a
--   nightly reconcile alongside the immediate triggers.
--
--
-- 2. WHO IS A COACH
-- ---------------------------------------------------------------------------
-- `team_memberships.role in ('coach', 'assistant_coach', 'manager')` with
-- `left_at is null` — the same definition `belongs_in_referees_group()` uses
-- (20260825320000), so the club has one answer to "is this person a coach",
-- not two. The club-wide `person_roles.coach` hat is deliberately NOT enough
-- on its own here: this group is about a GROUND, and the hat says nothing
-- about where you coach.
--
--
-- 3. ADULTS ONLY — and why that is a real constraint, not a comment
-- ---------------------------------------------------------------------------
-- SG-1 forbids a conversation of exactly one adult and one minor with no
-- guardian. A coaches' group will usually have twenty people in it and never
-- come near that. It could, though: a ground with one team, whose one coach
-- and one assistant are the only members, and one of them a minor.
--
-- And "a coach can be a minor" is NOT hypothetical in this data:
--
--   * SG-0 says an unknown date of birth IS a minor, fail-closed. Of the 53
--     people the club currently records as coach, assistant coach or manager,
--     35 have no date of birth on file — 20260825340000 deliberately attached
--     them to their teams without one so the club could see its own coaching
--     staff, and asks for the date at their next sign-in instead.
--   * A young referee holds the same `referee` hat as an adult one
--     (20260825030000 says so in as many words), and youth coaches exist.
--
-- So the rule this migration enforces is STRICTER than SG-1: a venue coaches'
-- group admits nobody for whom `is_minor()` is true. Not "no lone minor" —
-- no minor. A room with no minors in it cannot be one adult and one minor with
-- no guardian, whoever leaves it, so SG-1 is satisfied structurally rather
-- than narrowly, and the trigger below refuses the row rather than trusting
-- the sync function to have filtered it: SAFEGUARDING.md §1.2 — a rule
-- enforced only by the code that usually calls it is not enforced.
--
-- The cost is visible and self-healing: a coach with no date of birth is not
-- in the group, `venue_coaching_staff()` reports them as waiting and says why,
-- the venue page names them, and the moment they sign in and give the date
-- (`needs_dob_completion()` stops them until they do) the trigger in §5 puts
-- them in. Nothing is silent.
--
--
-- 4. WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
--   * No message is written, ever. This migration moves membership only.
--   * No participant row is deleted; leaving is `left_at`.
--   * A retired venue's group is frozen, not closed: nobody is added, nobody
--     is marked left, the history stays readable. Closing a conversation is a
--     safeguarding act (SG-3) and belongs to a person, not to a trigger.
--   * Nothing touches the Referees group, team rooms, or any existing policy.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one column on
-- public.conversations, one new participant guard; no policy widened —
-- `conversations_one_attachment` is re-stated to cover the new column);
-- data touched: creates one `group` conversation per active venue and inserts
-- conversation_participants rows for the coaches already there; rollback: §8.
-- =============================================================================


-- =============================================================================
-- 1. conversations.venue_id
-- =============================================================================
-- 20260824250000 gave a group `resource_id` ("groups attached to venues
-- initially") and `scope_label` for anything else, with a check that a group
-- carries at most ONE structured attachment. A venue is the third kind, and
-- the check is re-stated rather than replaced piecemeal so the rule stays
-- readable in one place.
--
-- `on delete restrict` — not `set null`. A venue cannot be deleted at all
-- (20260901100000 §1), and if that ever changes, the database should refuse
-- rather than quietly cut a room full of messages loose from the thing it is
-- about.

alter table public.conversations
  add column if not exists venue_id uuid references public.venues (id) on delete restrict;

alter table public.conversations
  drop constraint if exists conversations_one_attachment;

alter table public.conversations
  add constraint conversations_one_attachment check (
    (case when team_id     is not null then 1 else 0 end)
  + (case when resource_id is not null then 1 else 0 end)
  + (case when venue_id    is not null then 1 else 0 end) <= 1
  );

-- One live coaches' group per venue. A closed one may sit beside it in
-- history, which is why the index is partial on closed_at.
create unique index if not exists conversations_venue_live_idx
  on public.conversations (venue_id) where venue_id is not null and closed_at is null;

create index if not exists conversations_venue_idx
  on public.conversations (venue_id) where venue_id is not null;

comment on column public.conversations.venue_id is
  'The venue whose coaches this group is. Membership is derived and trigger-maintained (20260901110000); a venue group is adults only.';


-- =============================================================================
-- 2. THE INVARIANT: a venue group admits no minor
-- =============================================================================
-- BEFORE, so the row never exists. Fires alongside the SG-1 pair from
-- 20260823210000 rather than instead of them: `trg_conversation_participants_
-- sg1_guard` (closed-conversation check) sorts before this one by name, and
-- the AFTER constraint trigger still evaluates SG-1 over the result. This is
-- the additional, stricter rule — see the header, §3.

create or replace function public.venue_group_adults_only()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_venue uuid;
begin
  -- Only an ACTIVE membership is constrained. Marking somebody left, or
  -- keeping a historic row, says nothing about who may read the room.
  if new.left_at is not null then
    return new;
  end if;

  select c.venue_id into v_venue from public.conversations c where c.id = new.conversation_id;
  if v_venue is null then
    return new;
  end if;

  -- SG-0: an unknown date of birth is a minor. That is the fail-closed default
  -- and it is not softened here.
  if public.is_minor(new.person_id) then
    raise exception
      'conversation_participants: a venue coaches group is adults only, and % is a minor or has no date of birth on file [SAFEGUARDING.md SG-0, SG-1]',
      new.person_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.venue_group_adults_only() is
  'A conversation attached to a venue admits no minor (and no unknown date of birth). Stricter than SG-1 on purpose: a room with no minors cannot become one adult and one minor.';

revoke all privileges on function public.venue_group_adults_only()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_conversation_participants_venue_adults_only on public.conversation_participants;
create trigger trg_conversation_participants_venue_adults_only
  before insert or update of left_at on public.conversation_participants
  for each row execute function public.venue_group_adults_only();


-- =============================================================================
-- 3. THE GROUP ITSELF
-- =============================================================================

create or replace function public.venue_coaches_group_id(p_venue_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select c.id
    from public.conversations c
   where c.venue_id = p_venue_id and c.type = 'group' and c.closed_at is null
   order by c.created_at
   limit 1;
$$;

comment on function public.venue_coaches_group_id(uuid) is
  'The venue''s live coaches group, or null. Read-only — ensure_venue_coaches_group() is what creates one.';


create or replace function public.ensure_venue_coaches_group(p_venue_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
begin
  if p_venue_id is null then
    return null;
  end if;

  v_id := public.venue_coaches_group_id(p_venue_id);
  if v_id is not null then
    return v_id;
  end if;

  select name into v_name from public.venues where id = p_venue_id;
  if v_name is null then
    return null;
  end if;

  insert into public.conversations (type, title, venue_id)
  values ('group', v_name || ' coaches', p_venue_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.ensure_venue_coaches_group(uuid) is
  'The venue''s coaches group, created on demand — the same on-demand rule ensure_team_conversation() follows for team rooms.';


-- The group is named after the venue, so a rename follows it. Renaming a
-- conversation is otherwise club_admin/lead-only (20260825320000); this runs
-- as the definer, and the venue rename it follows is already club_admin-only.
create or replace function public.venues_rename_coaches_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_group uuid := public.venue_coaches_group_id(new.id);
begin
  if v_group is not null then
    update public.conversations
       set title = new.name || ' coaches'
     where id = v_group and title = old.name || ' coaches';
  end if;
  return null;
end;
$$;

revoke all privileges on function public.venues_rename_coaches_group()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_venues_rename_coaches_group on public.venues;
create trigger trg_venues_rename_coaches_group
  after update of name on public.venues
  for each row when (new.name is distinct from old.name)
  execute function public.venues_rename_coaches_group();


-- =============================================================================
-- 4. THE DERIVATION
-- =============================================================================

-- Every venue a team plays at. See the header, §1: three foreign keys, no
-- string matching, the last two bounded to the current season.
create or replace function public.venues_for_team(p_team_id uuid)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select distinct x.venue_id from (
    -- (a) the home pitch an admin set
    select r.venue_id
      from public.teams t
      join public.resources r on r.id = t.home_resource_id
     where t.id = p_team_id
    union all
    -- (b) a fixture allocated to one of our pitches this season
    select r.venue_id
      from public.fixtures f
      join public.resources r on r.id = f.venue_resource_id
      join public.seasons s on s.is_current
     where f.team_id = p_team_id
       and f.kickoff_at >= s.starts_on::timestamptz
       and f.kickoff_at <  (s.ends_on + 1)::timestamptz
    union all
    -- (c) training or anything else on the team calendar, same season
    select r.venue_id
      from public.events e
      join public.resources r on r.id = e.venue_resource_id
      join public.seasons s on s.is_current
     where e.team_id = p_team_id
       and e.starts_at >= s.starts_on::timestamptz
       and e.starts_at <  (s.ends_on + 1)::timestamptz
  ) x
  where x.venue_id is not null;
$$;

comment on function public.venues_for_team(uuid) is
  'The venues a team plays at: its home pitch, plus any pitch it has a fixture or event on this season. Free-text venue_text is never parsed.';


-- The venue's coaching staff, INCLUDING the ones who cannot be admitted, and
-- whether they are in the room. This is the one read the venue page needs and
-- the one the sync filters — so what an administrator is shown and what the
-- database does can never drift apart.
create or replace function public.venue_coaching_staff(p_venue_id uuid)
  returns table (person_id uuid, adult boolean, in_group boolean)
  language sql
  stable
  security definer
  set search_path = public
as $$
  with staff as (
    select distinct m.person_id
      from public.team_memberships m
      join public.teams t on t.id = m.team_id and t.active
     where m.left_at is null
       and m.role in ('coach', 'assistant_coach', 'manager')
       and exists (
         select 1 from public.venues_for_team(m.team_id) v(venue_id)
          where v.venue_id = p_venue_id)
  )
  select s.person_id,
         not public.is_minor(s.person_id) as adult,
         exists (
           select 1 from public.conversation_participants p
            where p.conversation_id = public.venue_coaches_group_id(p_venue_id)
              and p.person_id = s.person_id
              and p.left_at is null) as in_group
    from staff s;
$$;

comment on function public.venue_coaching_staff(uuid) is
  'Every coach, assistant coach and manager of an active team that plays at this venue, with whether they may be admitted (adult = date of birth on file and 18+) and whether they are in the group.';


create or replace function public.venue_coach_person_ids(p_venue_id uuid)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.person_id from public.venue_coaching_staff(p_venue_id) s where s.adult;
$$;

comment on function public.venue_coach_person_ids(uuid) is
  'The subset of venue_coaching_staff() a venue coaches group may hold: adults with a date of birth on file.';


-- =============================================================================
-- 5. THE SYNC
-- =============================================================================
-- Reconcile the WHOLE group rather than applying a delta. There are five
-- venues and about fifty coaches, so the cost is nothing, and an idempotent
-- reconcile is the only version that a nightly job, a backfill and eight
-- triggers can all safely call.

create or replace function public.sync_venue_coaches_group(p_venue_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_group  uuid;
  v_person uuid;
begin
  if p_venue_id is null then
    return;
  end if;

  -- A retired venue's group is frozen: nobody joins, nobody is walked out,
  -- the history stays exactly as it was. See the header, §4.
  if not exists (select 1 from public.venues where id = p_venue_id and active) then
    return;
  end if;

  v_group := public.ensure_venue_coaches_group(p_venue_id);
  if v_group is null then
    return;
  end if;

  -- OUT: anyone in the room who no longer coaches a team here. `not exists`
  -- rather than `not in`, because `not in` against a set that could contain a
  -- null is a trap this repo has already fallen into once (DECISIONS.md, the
  -- SG-1 NULL-comparison defects).
  update public.conversation_participants p
     set left_at = now()
   where p.conversation_id = v_group
     and p.left_at is null
     and not exists (
       select 1 from public.venue_coach_person_ids(p_venue_id) c(person_id)
        where c.person_id = p.person_id);

  -- IN: one at a time, and tolerant. A messaging rule refusing a join must
  -- never fail the thing that triggered this — a Full-Time import, a team
  -- sheet, an admin setting a home pitch. That is how
  -- `sync_referees_group_member()` was written (20260825320000) and the reason
  -- has not changed. It is audited, so a refusal is findable.
  for v_person in
    select c.person_id from public.venue_coach_person_ids(p_venue_id) c(person_id)
    except
    select p.person_id from public.conversation_participants p
     where p.conversation_id = v_group and p.left_at is null
  loop
    begin
      insert into public.conversation_participants (conversation_id, person_id, basis)
      values (v_group, v_person, 'staff');
    exception when others then
      perform public.write_audit(
        'venue_coaches_group.join_refused', 'conversations', v_group::text,
        jsonb_build_object('venue_id', p_venue_id, 'person_id', v_person, 'error', sqlerrm));
    end;
  end loop;
end;
$$;

comment on function public.sync_venue_coaches_group(uuid) is
  'Reconcile one venue coaches group against who coaches there now. Idempotent; leaving is left_at, never a delete (SAFEGUARDING.md SG-2).';


create or replace function public.sync_venue_coaches_group_of_resource(p_resource_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_venue uuid;
begin
  if p_resource_id is null then
    return;
  end if;
  select venue_id into v_venue from public.resources where id = p_resource_id;
  perform public.sync_venue_coaches_group(v_venue);
end;
$$;


create or replace function public.sync_venue_coaches_groups_for_team(p_team_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v uuid;
begin
  if p_team_id is null then
    return;
  end if;
  for v in select * from public.venues_for_team(p_team_id) loop
    perform public.sync_venue_coaches_group(v);
  end loop;
end;
$$;


-- The reconcile the nightly job runs. It is also the answer to the one part of
-- the rule that moves on its own: "this season" stops being true at a season
-- boundary without anybody touching a row.
create or replace function public.sync_all_venue_coaches_groups()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v uuid;
begin
  for v in select id from public.venues where active order by sort_order, name loop
    perform public.sync_venue_coaches_group(v);
  end loop;
end;
$$;

comment on function public.sync_all_venue_coaches_groups() is
  'Reconcile every active venue coaches group. Scheduled nightly (20260901110000 §6) because the current-season bound moves without any row changing.';


-- ---------------------------------------------------------------------------
-- 5a. The triggers — one per fact the derivation reads
-- ---------------------------------------------------------------------------

-- A new venue gets its group immediately, so an admin who creates one can open
-- it in the same visit.
create or replace function public.venues_sync_coaches_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_group(new.id);
  return null;
end;
$$;

revoke all privileges on function public.venues_sync_coaches_group()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_venues_sync_coaches_group on public.venues;
create trigger trg_venues_sync_coaches_group
  after insert or update of active on public.venues
  for each row execute function public.venues_sync_coaches_group();


-- The team sheet: a coach arriving, leaving, or changing role or team.
create or replace function public.team_memberships_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_groups_for_team(new.team_id);
  if tg_op = 'UPDATE' and old.team_id is distinct from new.team_id then
    perform public.sync_venue_coaches_groups_for_team(old.team_id);
  end if;
  return null;
end;
$$;

revoke all privileges on function public.team_memberships_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_team_memberships_sync_venue_groups on public.team_memberships;
create trigger trg_team_memberships_sync_venue_groups
  after insert or update of left_at, role, team_id on public.team_memberships
  for each row execute function public.team_memberships_sync_venue_groups();


-- A team arriving with a home pitch, that pitch moving from one ground to
-- another, or the team being archived. INSERT is included so that a team
-- created at its ground is on that ground's list before anybody is added to
-- its sheet — it costs one reconcile of a group that is usually unchanged.
create or replace function public.teams_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_group_of_resource(new.home_resource_id);
  if tg_op = 'UPDATE' then
    if old.home_resource_id is distinct from new.home_resource_id then
      perform public.sync_venue_coaches_group_of_resource(old.home_resource_id);
    end if;
    if old.active and not new.active then
      perform public.sync_venue_coaches_groups_for_team(new.id);
    end if;
  end if;
  return null;
end;
$$;

revoke all privileges on function public.teams_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_teams_sync_venue_groups on public.teams;
create trigger trg_teams_sync_venue_groups
  after insert or update of home_resource_id, active on public.teams
  for each row execute function public.teams_sync_venue_groups();


-- A fixture allocated to (or moved off) one of our pitches. The WHEN clauses
-- keep the nightly Full-Time import out of this entirely: an imported fixture
-- arrives with no pitch, so nothing fires.
create or replace function public.fixtures_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_group_of_resource(new.venue_resource_id);
  if tg_op = 'UPDATE' then
    perform public.sync_venue_coaches_group_of_resource(old.venue_resource_id);
  end if;
  return null;
end;
$$;

revoke all privileges on function public.fixtures_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_fixtures_sync_venue_groups_ins on public.fixtures;
create trigger trg_fixtures_sync_venue_groups_ins
  after insert on public.fixtures
  for each row when (new.venue_resource_id is not null)
  execute function public.fixtures_sync_venue_groups();

drop trigger if exists trg_fixtures_sync_venue_groups_upd on public.fixtures;
create trigger trg_fixtures_sync_venue_groups_upd
  after update of venue_resource_id, team_id on public.fixtures
  for each row when (new.venue_resource_id is distinct from old.venue_resource_id
                     or new.team_id is distinct from old.team_id)
  execute function public.fixtures_sync_venue_groups();


-- Training and everything else on the team calendar, same rule.
create or replace function public.events_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_group_of_resource(new.venue_resource_id);
  if tg_op = 'UPDATE' then
    perform public.sync_venue_coaches_group_of_resource(old.venue_resource_id);
  end if;
  return null;
end;
$$;

revoke all privileges on function public.events_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_events_sync_venue_groups_ins on public.events;
create trigger trg_events_sync_venue_groups_ins
  after insert on public.events
  for each row when (new.venue_resource_id is not null)
  execute function public.events_sync_venue_groups();

drop trigger if exists trg_events_sync_venue_groups_upd on public.events;
create trigger trg_events_sync_venue_groups_upd
  after update of venue_resource_id, team_id on public.events
  for each row when (new.venue_resource_id is distinct from old.venue_resource_id
                     or new.team_id is distinct from old.team_id)
  execute function public.events_sync_venue_groups();


-- A pitch being moved from one venue to another (or placed for the first
-- time). Both grounds are reconciled.
create or replace function public.resources_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_venue_coaches_group(new.venue_id);
  perform public.sync_venue_coaches_group(old.venue_id);
  return null;
end;
$$;

revoke all privileges on function public.resources_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_resources_sync_venue_groups on public.resources;
create trigger trg_resources_sync_venue_groups
  after update of venue_id on public.resources
  for each row when (new.venue_id is distinct from old.venue_id)
  execute function public.resources_sync_venue_groups();


-- The date of birth arriving — the one that matters most on day one, because
-- 35 of the club's 53 coaches have none (see the header, §3). Giving it at
-- first sign-in puts them in every venue group they belong to; a date that
-- turns out to make somebody a minor walks them back out of all of them.
create or replace function public.people_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v uuid;
begin
  for v in
    select vt.venue_id
      from public.team_memberships m
      cross join lateral public.venues_for_team(m.team_id) vt(venue_id)
     where m.person_id = new.id
       and m.left_at is null
       and m.role in ('coach', 'assistant_coach', 'manager')
    union
    select c.venue_id
      from public.conversation_participants p
      join public.conversations c on c.id = p.conversation_id
     where p.person_id = new.id and p.left_at is null and c.venue_id is not null
  loop
    perform public.sync_venue_coaches_group(v);
  end loop;
  return null;
end;
$$;

revoke all privileges on function public.people_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_people_sync_venue_groups on public.people;
create trigger trg_people_sync_venue_groups
  after update of dob on public.people
  for each row when (new.dob is distinct from old.dob)
  execute function public.people_sync_venue_groups();


-- =============================================================================
-- 6. THE NIGHTLY RECONCILE
-- =============================================================================
-- 03:15 UTC, in the same style as 20260823250000's five jobs and clear of the
-- Full-Time prefetch at 03:12. It exists for the current-season bound in the
-- header §1 and as the backstop for any refusal §5 audited rather than raised.

select cron.schedule(
  'venue-coaches-groups-daily',
  '15 3 * * *',
  $cron$ select public.sync_all_venue_coaches_groups() $cron$);


-- =============================================================================
-- 7. GRANTS, AND THE BACKFILL
-- =============================================================================
-- The read helpers are for the venue page and are safe to expose: they return
-- person ids, and every NAME behind those ids still comes back through
-- `people`'s own RLS. The writers are service_role only — membership is
-- derived, so nothing signed in has any business calling them by hand.

revoke all privileges on function public.venue_coaches_group_id(uuid)   from public, anon;
revoke all privileges on function public.venues_for_team(uuid)          from public, anon;
revoke all privileges on function public.venue_coaching_staff(uuid)     from public, anon;
revoke all privileges on function public.venue_coach_person_ids(uuid)   from public, anon;
grant execute on function public.venue_coaches_group_id(uuid), public.venues_for_team(uuid),
  public.venue_coaching_staff(uuid), public.venue_coach_person_ids(uuid)
  to authenticated, service_role;

revoke all privileges on function public.ensure_venue_coaches_group(uuid)            from public, anon, authenticated;
revoke all privileges on function public.sync_venue_coaches_group(uuid)              from public, anon, authenticated;
revoke all privileges on function public.sync_venue_coaches_group_of_resource(uuid)  from public, anon, authenticated;
revoke all privileges on function public.sync_venue_coaches_groups_for_team(uuid)    from public, anon, authenticated;
revoke all privileges on function public.sync_all_venue_coaches_groups()             from public, anon, authenticated;
grant execute on function public.ensure_venue_coaches_group(uuid), public.sync_venue_coaches_group(uuid),
  public.sync_venue_coaches_group_of_resource(uuid), public.sync_venue_coaches_groups_for_team(uuid),
  public.sync_all_venue_coaches_groups()
  to service_role;

-- Backfill: the club should not have to wait for a team sheet to change.
select public.sync_all_venue_coaches_groups();

notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK (documented, not executed)
-- =============================================================================
--   select cron.unschedule('venue-coaches-groups-daily');
--   drop trigger trg_people_sync_venue_groups on public.people;
--   drop trigger trg_resources_sync_venue_groups on public.resources;
--   drop trigger trg_events_sync_venue_groups_upd on public.events;
--   drop trigger trg_events_sync_venue_groups_ins on public.events;
--   drop trigger trg_fixtures_sync_venue_groups_upd on public.fixtures;
--   drop trigger trg_fixtures_sync_venue_groups_ins on public.fixtures;
--   drop trigger trg_teams_sync_venue_groups on public.teams;
--   drop trigger trg_team_memberships_sync_venue_groups on public.team_memberships;
--   drop trigger trg_venues_sync_coaches_group on public.venues;
--   drop trigger trg_venues_rename_coaches_group on public.venues;
--   drop trigger trg_conversation_participants_venue_adults_only on public.conversation_participants;
--   drop the eleven functions this file creates;
--   drop index conversations_venue_live_idx; drop index conversations_venue_idx;
--   alter table public.conversations drop constraint conversations_one_attachment;
--   alter table public.conversations add constraint conversations_one_attachment
--     check (team_id is null or resource_id is null);   -- 20260824250000's form
--   alter table public.conversations drop column venue_id;
--
-- The groups themselves and every participant row STAY. They are conversations
-- like any other, and SG-2 does not make an exception for a rollback.
