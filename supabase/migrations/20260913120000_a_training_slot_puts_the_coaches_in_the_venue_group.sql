-- =============================================================================
-- A training slot puts the coaches in the venue group (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13: "When a coach's team is added to a training venue, they
-- should automatically be added to the venue chat group."
--
-- A venue's coaches group fills itself from the teams that play there
-- (20260901190000): the home pitch, a fixture on one of its pitches, an
-- event on one — three foreign keys, this season. A training venue has no
-- pitch rows to hang any of that on; what it has, since 20260913110000, is
-- `training_slots.venue_id`. So the derivation gains a fourth source:
--
--   (d) a training allocation in a slot at the venue, in a block that has
--       not ended — the plan itself, not the sessions it becomes, so a coach
--       is in the room the moment the team is placed, before the calendar
--       is updated, and stays while the block runs.
--
-- Triggers on `training_allocations` (placed, moved, taken out) and on
-- `training_slots` (moved to another venue, removed) reconcile the groups
-- the same way the team sheet and the fixtures do: the whole group, idempotent.
-- Everything else — adults only, retired venues frozen, leaving is left_at,
-- a refused join audited — is the sync's, unchanged.
--
-- Rollback: re-create venues_for_team from 20260901190000; drop the two
-- trigger functions and their four triggers.
-- =============================================================================


-- 1. The fourth source ----------------------------------------------------------

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
    union all
    -- (d) a place in a training slot at the venue, in a block still to run
    select ts.venue_id
      from public.training_allocations a
      join public.training_slots ts on ts.id = a.slot_id
      join public.training_blocks b on b.id = ts.block_id
     where a.team_id = p_team_id
       and b.ends_on >= current_date
  ) x
  where x.venue_id is not null;
$$;

comment on function public.venues_for_team(uuid) is
  'The venues a team plays or trains at: its home pitch, any pitch it has a fixture or event on this season, and any training venue it holds a slot at in a block still to run. Free-text venue_text is never parsed.';


-- 2. A team placed, moved or taken out -------------------------------------------

create or replace function public.training_allocations_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_venue uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_venue_coaches_groups_for_team(new.team_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    -- The venue the team LEFT is no longer among its venues, so reconcile it
    -- by name. On a slot's cascade delete the slot row is already gone; the
    -- slot's own trigger covers that venue.
    select ts.venue_id into v_venue from public.training_slots ts where ts.id = old.slot_id;
    perform public.sync_venue_coaches_group(v_venue);
    if tg_op = 'UPDATE' and old.team_id is distinct from new.team_id then
      perform public.sync_venue_coaches_groups_for_team(old.team_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all privileges on function public.training_allocations_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_training_allocations_sync_venue_groups on public.training_allocations;
create trigger trg_training_allocations_sync_venue_groups
  after insert or update of slot_id, team_id or delete on public.training_allocations
  for each row execute function public.training_allocations_sync_venue_groups();


-- 3. A slot moved to another venue, or removed -----------------------------------

create or replace function public.training_slots_sync_venue_groups()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    perform public.sync_venue_coaches_group(new.venue_id);
  end if;
  perform public.sync_venue_coaches_group(old.venue_id);
  return null;
end;
$$;
revoke all privileges on function public.training_slots_sync_venue_groups()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_training_slots_sync_venue_groups_upd on public.training_slots;
create trigger trg_training_slots_sync_venue_groups_upd
  after update of venue_id on public.training_slots
  for each row when (new.venue_id is distinct from old.venue_id)
  execute function public.training_slots_sync_venue_groups();

drop trigger if exists trg_training_slots_sync_venue_groups_del on public.training_slots;
create trigger trg_training_slots_sync_venue_groups_del
  after delete on public.training_slots
  for each row when (old.venue_id is not null)
  execute function public.training_slots_sync_venue_groups();


-- 4. Today's plan, reconciled once ---------------------------------------------------
select public.sync_all_venue_coaches_groups();


-- 5. Audit the schema change itself ---------------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'conversations',
        jsonb_build_object('migration', '20260913120000_a_training_slot_puts_the_coaches_in_the_venue_group',
                           'changes', array['venues_for_team gains training allocations in blocks still to run',
                                            'training_allocations and training_slots reconcile venue coaches groups']));

notify pgrst, 'reload schema';
