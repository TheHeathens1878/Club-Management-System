-- =============================================================================
-- Membership kind is counted in PLAYERS, not in people (Adam, 2026-08-26)
-- =============================================================================
-- "The system should work out whether it is an individual or family membership
--  based on the number of players (2+ is family). Each person in that family
--  membership (and individual) should be tagged (which should be visible on
--  tables and member record). Admins should be able to easily click and see
--  who else is in the family setup."
--
-- THE BUG BEING NAMED
--   `create_membership()` (20260824280000) settled the kind with
--       case when array_length(ids, 1) > 1 then 'family' else 'individual' end
--   — the number of PEOPLE on the submission. A parent who registers one child
--   is two people and one player, and the club charges that as an INDIVIDUAL
--   membership. The parent is on the record because somebody has to be the
--   lead contact, not because they are playing.
--
-- WHAT COUNTS AS A PLAYER, AND WHY
--   A person on a membership counts as a player FOR THAT MEMBERSHIP'S SEASON
--   when either is true:
--
--     * a live `team_memberships` row — `role = 'player'`, `left_at is null`,
--       `season_id` = the membership's season. This is the club's own record
--       of who is actually playing, and P2.1 keeps it true.
--
--     * a `registrations` row for that season with `status in ('pending',
--       'approved')`. `registrations` is defined by 20260823130000 as "a
--       person's request to play for the club in a season", and those two
--       statuses are exactly the pair the schema itself already calls live —
--       `registrations_live_idx` is unique on (person_id, season_id) WHERE
--       status in ('pending', 'approved'). `rejected` and `withdrawn` are
--       final states (`registrations_guard()` refuses to move a row out of
--       either), so a person in one of them is not asking to play any more.
--
--   PENDING COUNTS ON PURPOSE. The family that submits the join wizard for two
--   children is a family membership from the moment they ask, not from the
--   moment an administrator gets round to approving it — otherwise every new
--   family is filed as an individual for as long as the queue is long, and the
--   fee band is wrong for exactly the households that just paid.
--
--   2 or more players => 'family'. 0 or 1 => 'individual'. A membership with
--   nobody playing is an individual, not an error: the lead contact may be
--   registering ahead of the season opening.
--
--   NOT `people.is_player` (20260825480000), deliberately, though the two
--   definitions agree on what a player looks like. That column is a person's
--   own statement about themselves and is what SCREENS ask; its own header
--   says it "decides which questions a screen asks — never who may read or do
--   anything". What the club charges a household is not a self-service tick,
--   and it is per SEASON, which a boolean on `people` cannot be.
--
-- ONE PLACE, AND IT STAYS TRUE
--   `public.membership_kind_for(membership_id)` is the only place the rule is
--   written. `create_membership()` asks it instead of counting people, and
--   three statement-level triggers keep it honest afterwards, because the
--   second child is very often registered weeks after the first:
--
--     membership_people   -- somebody is added to or removed from a membership
--     registrations       -- a registration is submitted, approved, rejected,
--                            withdrawn or deleted, for the membership's season
--     team_memberships    -- a player joins a squad or leaves it, same season
--
--   STATEMENT level with transition tables (the `pitch_request_notify()`
--   pattern from 20260825170000): the join wizard writes several
--   `membership_people` rows in one INSERT and an end-of-season sweep closes
--   hundreds of `team_memberships` rows in one UPDATE, and each should cost
--   one re-derivation per affected membership, not one per row. Postgres will
--   not attach transition tables to a multi-event trigger, so each table gets
--   an insert / update / delete trigger over one shared function.
--
--   NO RECURSION IS POSSIBLE. Every path writes to `public.memberships`, and
--   `public.memberships` carries no trigger of its own — the three above sit on
--   the three tables the rule READS. `refresh_membership_kind()` additionally
--   writes only where the derived kind actually differs, so a re-derivation
--   that changes nothing writes nothing.
--
-- THE TAG, WHERE A SCREEN CAN READ IT
--   `public.person_memberships` — a security_invoker view, one row per person
--   per membership, carrying the kind, the membership id, the season and
--   whether that person is the lead contact. security_invoker means it widens
--   NOTHING: the rows a caller gets back are exactly the rows
--   `membership_people_read` and `memberships_self_read` already give them
--   (the lead contact, club_admin, safeguarding_lead). `/people` and
--   `/people/[id]` are committee/admin screens reading their own client, so
--   the badge appears for the people who could already read the membership.
--
-- BACKFILL (this migration touches DATA)
--   Every existing `memberships` row is re-derived from the same helper. On a
--   fresh database that is zero rows; on production it corrects every
--   membership whose people count and player count disagree — in practice the
--   parent-plus-one-child submissions filed as 'family'. The count is raised
--   as a NOTICE so the migration log says how many moved.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no new policy, no policy
-- changed, one security_invoker view that inherits the existing ones); data
-- touched: YES — `memberships.kind` is re-derived for every existing row;
-- rollback: §8 at the foot of this file.
-- =============================================================================


-- =============================================================================
-- 1. THE RULE, IN ONE PLACE
-- =============================================================================

-- SECURITY DEFINER and granted to nobody: this is the database's own arithmetic,
-- called from SECURITY DEFINER triggers that must see every registration and
-- squad row regardless of who is at the keyboard. Screens do not call it — they
-- read `memberships.kind` (or `person_memberships`) under their own RLS.
create or replace function public.membership_kind_for(p_membership_id uuid)
  returns public.membership_kind
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when not exists (select 1 from public.memberships m where m.id = p_membership_id)
      then null
    when (
      select count(*)
        from public.membership_people mp
        join public.memberships m on m.id = mp.membership_id
       where mp.membership_id = p_membership_id
         and (
           exists (select 1 from public.team_memberships tm
                    where tm.person_id = mp.person_id
                      and tm.season_id = m.season_id
                      and tm.role = 'player'
                      and tm.left_at is null)
           or exists (select 1 from public.registrations r
                       where r.person_id = mp.person_id
                         and r.season_id = m.season_id
                         and r.status in ('pending', 'approved'))
         )
    ) > 1 then 'family'
    else 'individual'
  end::public.membership_kind;
$$;
revoke all privileges on function public.membership_kind_for(uuid) from public, anon, authenticated, service_role;

comment on function public.membership_kind_for(uuid) is
  'The membership kind derived from PLAYERS in the membership''s season — a live team_memberships player row, or a pending/approved registration. Two or more players is a family. Null for a membership that does not exist.';


create or replace function public.refresh_membership_kind(p_membership_ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_n integer;
begin
  if p_membership_ids is null or array_length(p_membership_ids, 1) is null then
    return 0;
  end if;
  update public.memberships m
     set kind = public.membership_kind_for(m.id)
   where m.id = any (p_membership_ids)
     and m.kind is distinct from public.membership_kind_for(m.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all privileges on function public.refresh_membership_kind(uuid[]) from public, anon, authenticated, service_role;

comment on function public.refresh_membership_kind(uuid[]) is
  'Re-derives memberships.kind for the given memberships, writing only where the answer changed. Returns the number of rows moved.';


-- =============================================================================
-- 2. KEEPING IT TRUE — THREE TABLES, ONE FUNCTION EACH
-- =============================================================================

create or replace function public.membership_people_kind_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_membership_kind(
      array(select distinct n.membership_id from new_rows n));
  elsif tg_op = 'DELETE' then
    perform public.refresh_membership_kind(
      array(select distinct o.membership_id from old_rows o));
  else
    perform public.refresh_membership_kind(array(
      select distinct both_ways.id from (
        select n.membership_id as id from new_rows n
        union
        select o.membership_id from old_rows o) both_ways));
  end if;
  return null;
end $$;
revoke all privileges on function public.membership_people_kind_sync() from public, anon, authenticated, service_role;

drop trigger if exists trg_membership_people_kind_insert on public.membership_people;
create trigger trg_membership_people_kind_insert
  after insert on public.membership_people
  referencing new table as new_rows
  for each statement execute function public.membership_people_kind_sync();

drop trigger if exists trg_membership_people_kind_update on public.membership_people;
create trigger trg_membership_people_kind_update
  after update on public.membership_people
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.membership_people_kind_sync();

drop trigger if exists trg_membership_people_kind_delete on public.membership_people;
create trigger trg_membership_people_kind_delete
  after delete on public.membership_people
  referencing old table as old_rows
  for each statement execute function public.membership_people_kind_sync();


-- A registration only ever moves a membership whose SEASON it matches. Someone
-- registering for 2035/36 does not change what they were charged in 2034/35.
create or replace function public.registrations_kind_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_membership_kind(array(
      select distinct mp.membership_id
        from old_rows r
        join public.membership_people mp on mp.person_id = r.person_id
        join public.memberships m on m.id = mp.membership_id and m.season_id = r.season_id));
  else
    -- `registrations_guard()` makes person_id and season_id immutable, so on an
    -- UPDATE the new row names the same membership the old one did.
    perform public.refresh_membership_kind(array(
      select distinct mp.membership_id
        from new_rows r
        join public.membership_people mp on mp.person_id = r.person_id
        join public.memberships m on m.id = mp.membership_id and m.season_id = r.season_id));
  end if;
  return null;
end $$;
revoke all privileges on function public.registrations_kind_sync() from public, anon, authenticated, service_role;

drop trigger if exists trg_registrations_kind_insert on public.registrations;
create trigger trg_registrations_kind_insert
  after insert on public.registrations
  referencing new table as new_rows
  for each statement execute function public.registrations_kind_sync();

drop trigger if exists trg_registrations_kind_update on public.registrations;
create trigger trg_registrations_kind_update
  after update on public.registrations
  referencing new table as new_rows
  for each statement execute function public.registrations_kind_sync();

drop trigger if exists trg_registrations_kind_delete on public.registrations;
create trigger trg_registrations_kind_delete
  after delete on public.registrations
  referencing old table as old_rows
  for each statement execute function public.registrations_kind_sync();


-- Squad rows carry no immutability guard, so an UPDATE is read from BOTH sides:
-- moving a player between seasons has to settle two memberships, not one.
create or replace function public.team_memberships_kind_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_membership_kind(array(
      select distinct mp.membership_id
        from new_rows tm
        join public.membership_people mp on mp.person_id = tm.person_id
        join public.memberships m on m.id = mp.membership_id and m.season_id = tm.season_id));
  elsif tg_op = 'DELETE' then
    perform public.refresh_membership_kind(array(
      select distinct mp.membership_id
        from old_rows tm
        join public.membership_people mp on mp.person_id = tm.person_id
        join public.memberships m on m.id = mp.membership_id and m.season_id = tm.season_id));
  else
    perform public.refresh_membership_kind(array(
      select distinct mp.membership_id
        from (select person_id, season_id from new_rows
              union
              select person_id, season_id from old_rows) tm
        join public.membership_people mp on mp.person_id = tm.person_id
        join public.memberships m on m.id = mp.membership_id and m.season_id = tm.season_id));
  end if;
  return null;
end $$;
revoke all privileges on function public.team_memberships_kind_sync() from public, anon, authenticated, service_role;

drop trigger if exists trg_team_memberships_kind_insert on public.team_memberships;
create trigger trg_team_memberships_kind_insert
  after insert on public.team_memberships
  referencing new table as new_rows
  for each statement execute function public.team_memberships_kind_sync();

drop trigger if exists trg_team_memberships_kind_update on public.team_memberships;
create trigger trg_team_memberships_kind_update
  after update on public.team_memberships
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.team_memberships_kind_sync();

drop trigger if exists trg_team_memberships_kind_delete on public.team_memberships;
create trigger trg_team_memberships_kind_delete
  after delete on public.team_memberships
  referencing old table as old_rows
  for each statement execute function public.team_memberships_kind_sync();


-- =============================================================================
-- 3. create_membership(): ask the helper instead of counting heads
-- =============================================================================
-- Unchanged: the household check, the six-person cap, the idempotent
-- re-submission, the audit row. Changed: the kind is derived AFTER the people
-- are attached, because that is the only moment the answer can be right.

create or replace function public.create_membership(p_person_ids uuid[])
  returns table (membership_id uuid, kind public.membership_kind)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me     uuid := public.current_person_id();
  v_season uuid;
  v_kind   public.membership_kind;
  v_id     uuid;
  v_pid    uuid;
  v_ids    uuid[];
begin
  if v_me is null then
    raise exception 'create_membership: no person is linked to this login' using errcode = '42501';
  end if;
  select id into v_season from public.seasons where is_current limit 1;
  if v_season is null then
    raise exception 'create_membership: no current season is set' using errcode = 'P0001';
  end if;

  -- The registrant is always included; duplicates collapse; cap at six.
  v_ids := (select array_agg(distinct pid) from unnest(p_person_ids || v_me) as pid);
  if array_length(v_ids, 1) > 6 then
    raise exception 'create_membership: a family membership covers at most six people' using errcode = 'P0001';
  end if;

  -- Every listed person must be the caller, their guarded child, or a
  -- household member this login created (no login of their own).
  foreach v_pid in array v_ids loop
    if v_pid = v_me then continue; end if;
    if exists (select 1 from public.guardianships g
               where g.child_person_id = v_pid and g.guardian_person_id = v_me and g.ended_at is null) then
      continue;
    end if;
    if exists (select 1 from public.people p
               where p.id = v_pid and p.created_by = auth.uid() and p.deleted_at is null
                 and not exists (select 1 from public.profiles pr where pr.person_id = p.id)) then
      continue;
    end if;
    raise exception 'create_membership: % is not in your household', v_pid using errcode = 'P0001';
  end loop;

  -- 'individual' is a placeholder, not a decision: the row has to exist before
  -- membership_people can point at it, and the kind is settled below.
  insert into public.memberships (season_id, primary_person_id, kind, created_by)
  values (v_season, v_me, 'individual', auth.uid())
  on conflict (season_id, primary_person_id)
    do update set kind = memberships.kind
  returning id into v_id;

  delete from public.membership_people where membership_people.membership_id = v_id;
  insert into public.membership_people (membership_id, person_id)
  select v_id, pid from unnest(v_ids) as pid;

  -- Players, not people (see this file's header). The membership_people
  -- triggers above have already had a go at this; settling it here as well is
  -- what makes the RETURNED value trustworthy rather than a hopeful re-read.
  update public.memberships m
     set kind = public.membership_kind_for(m.id)
   where m.id = v_id
  returning m.kind into v_kind;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'membership.submitted', 'memberships', v_id::text,
          jsonb_build_object('kind', v_kind, 'people', v_ids, 'season_id', v_season));

  return query select v_id, v_kind;
end $$;
revoke all privileges on function public.create_membership(uuid[]) from public, anon;
grant execute on function public.create_membership(uuid[]) to authenticated;


-- =============================================================================
-- 4. THE TAG A SCREEN READS
-- =============================================================================

create or replace view public.person_memberships
  with (security_invoker = true) as
  select mp.person_id,
         m.id                                   as membership_id,
         m.kind,
         m.season_id,
         s.name                                 as season_name,
         s.is_current                           as season_is_current,
         m.primary_person_id,
         (mp.person_id = m.primary_person_id)   as is_primary,
         m.created_at
    from public.membership_people mp
    join public.memberships m on m.id = mp.membership_id
    left join public.seasons s on s.id = m.season_id;

comment on view public.person_memberships is
  'One row per person per membership: the kind (individual/family), the membership, the season, and whether this person is the lead contact. security_invoker — rows follow membership_people_read, so it widens nothing.';

revoke all privileges on public.person_memberships from anon, authenticated, service_role;
grant select on public.person_memberships to authenticated, service_role;


-- =============================================================================
-- 5. BACKFILL — every existing membership, re-derived
-- =============================================================================

do $backfill$
declare
  v_total   integer;
  v_changed integer;
begin
  select count(*) into v_total from public.memberships;
  select public.refresh_membership_kind(array(select id from public.memberships))
    into v_changed;
  raise notice 'membership kind backfill: % of % membership rows re-derived from player counts',
    coalesce(v_changed, 0), v_total;
end $backfill$;


-- =============================================================================
-- 6. AUDIT THE SCHEMA CHANGE ITSELF
-- =============================================================================

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'memberships',
        jsonb_build_object('migration', '20260825520000_membership_kind_by_players',
                           'changes', array[
                             'membership_kind_for() derives the kind from players, not people',
                             'refresh_membership_kind() re-derives on membership_people, registrations and team_memberships',
                             'create_membership() asks the helper',
                             'person_memberships view exposes the tag per person',
                             'backfill: memberships.kind re-derived for every existing row']));


-- =============================================================================
-- 7. PostgREST
-- =============================================================================

notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK
-- =============================================================================
--   drop trigger trg_membership_people_kind_insert on public.membership_people;
--   drop trigger trg_membership_people_kind_update on public.membership_people;
--   drop trigger trg_membership_people_kind_delete on public.membership_people;
--   drop trigger trg_registrations_kind_insert     on public.registrations;
--   drop trigger trg_registrations_kind_update     on public.registrations;
--   drop trigger trg_registrations_kind_delete     on public.registrations;
--   drop trigger trg_team_memberships_kind_insert  on public.team_memberships;
--   drop trigger trg_team_memberships_kind_update  on public.team_memberships;
--   drop trigger trg_team_memberships_kind_delete  on public.team_memberships;
--   drop view public.person_memberships;
--   drop function public.membership_people_kind_sync(), public.registrations_kind_sync(),
--                 public.team_memberships_kind_sync(), public.refresh_membership_kind(uuid[]),
--                 public.membership_kind_for(uuid);
--   restore create_membership() from 20260824280000 (the people-count rule).
--   The backfilled `kind` values are NOT restored by any of the above: they are
--   derived data, and re-deriving them under the old rule means
--     update public.memberships m set kind = case when
--       (select count(*) from public.membership_people mp where mp.membership_id = m.id) > 1
--       then 'family' else 'individual' end::public.membership_kind;
-- =============================================================================
