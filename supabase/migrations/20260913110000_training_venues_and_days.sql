-- =============================================================================
-- Training venues, training days, and a slot that can be cloned (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13, on the winter training allocation (P7.3):
--
--   "the venues in Training Blocks should be visible in Venues (under a
--    training venues tab - so we have training / matches (some can be both))"
--   "In Teams settings, they should have a default training day field which
--    can be set in bulk on Teams table"
--   "I need the ability to clone a training slot - to a different hour / time
--    and also to another day"
--   "On the Training Blocks, I want the ability to choose the day and then
--    drag the teams on to a calendar view for our training venues on that day"
--
-- Four things, the first three here (the fourth is a screen over them):
--
--   1. A venue says what it is FOR. `venues.for_matches` (the grounds the
--      club plays at — every existing venue) and `venues.for_training` (the
--      hired 3Gs and school pitches). Some are both.
--   2. A training slot is AT a venue: `training_slots.venue_id`. The text
--      columns stay — the plan and the calendar sync read `venue_name`, and a
--      slot written before this had only text — but a trigger fills them from
--      the venue and keeps them in step when the venue is renamed. Every
--      slot's typed venue becomes a real venue here, marked for training.
--   3. `teams.default_training_day` — which evening this team trains, so the
--      planner can offer the Tuesday teams for a Tuesday.
--   4. `clone_training_slot()` — the same venue, division and (optionally)
--      the same teams, on another day or at another hour. SECURITY INVOKER,
--      so the planning policies decide who may, exactly as for a new slot.
--
-- Rollback: drop function clone_training_slot; drop trigger
-- trg_training_slots_venue_sync and trg_venues_rename_training_slots and
-- their functions; alter table training_slots drop column venue_id; alter
-- table teams drop column default_training_day; alter table venues drop
-- column for_matches, drop column for_training. Venues created by the
-- back-fill (for_training and not for_matches) may be retired or left.
-- =============================================================================


-- 1. What a venue is for ------------------------------------------------------

alter table public.venues
  add column if not exists for_matches  boolean not null default true,
  add column if not exists for_training boolean not null default false;

comment on column public.venues.for_matches is
  'The club plays matches here: the ground has pitches, or is a central venue. Every venue before 2026-09-13 is one.';
comment on column public.venues.for_training is
  'The club trains here: a hired 3G or school pitch that winter training slots are planned at. Set by hand, and set automatically the moment a training slot names the venue.';


-- 2. A slot is at a venue -----------------------------------------------------

alter table public.training_slots
  add column if not exists venue_id uuid references public.venues (id) on delete set null;

create index if not exists training_slots_venue_idx
  on public.training_slots (venue_id) where venue_id is not null;

comment on column public.training_slots.venue_id is
  'The venue this weekly space is at. venue_name / venue_address are filled from it by trigger and kept for the plan; a slot from before 2026-09-13 may carry text only.';

-- Every venue a slot has ever named becomes a real venue, used for training.
-- One row per name however it was typed (the venues table already refuses a
-- second "Sale Grammar 3G" by lower(name)); the address the first slot gave.
insert into public.venues (name, address, for_matches, for_training, active, sort_order)
select distinct on (lower(btrim(s.venue_name)))
       btrim(s.venue_name), s.venue_address, false, true, true, 100
  from public.training_slots s
 where not exists (
         select 1 from public.venues v where lower(btrim(v.name)) = lower(btrim(s.venue_name)))
 order by lower(btrim(s.venue_name)), s.created_at;

update public.venues v
   set for_training = true
 where not v.for_training
   and exists (select 1 from public.training_slots s where lower(btrim(s.venue_name)) = lower(btrim(v.name)));

update public.training_slots s
   set venue_id = v.id
  from public.venues v
 where s.venue_id is null
   and lower(btrim(v.name)) = lower(btrim(s.venue_name));

-- The venue fills the slot's text, and marks itself as a training venue.
create or replace function public.training_slots_venue_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_name    text;
  v_address text;
begin
  if new.venue_id is null then
    return new;
  end if;
  select v.name, v.address into v_name, v_address from public.venues v where v.id = new.venue_id;
  if v_name is null then
    raise exception 'training_slots: that venue does not exist' using errcode = 'P0001';
  end if;
  new.venue_name := v_name;
  -- The slot may still carry its own address (a different gate for the
  -- evening); where it does, the slot wins — the same rule pitches follow.
  if tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id then
    new.venue_address := coalesce(nullif(btrim(coalesce(new.venue_address, '')), ''), v_address);
  end if;
  update public.venues set for_training = true where id = new.venue_id and not for_training;
  return new;
end;
$$;
revoke all privileges on function public.training_slots_venue_sync() from public, anon, authenticated, service_role;

drop trigger if exists trg_training_slots_venue_sync on public.training_slots;
create trigger trg_training_slots_venue_sync
  before insert or update of venue_id, venue_name on public.training_slots
  for each row execute function public.training_slots_venue_sync();

-- Renaming the venue renames it on every slot, so the plan says the new name.
create or replace function public.venues_rename_training_slots()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.training_slots set venue_name = new.name where venue_id = new.id;
  end if;
  return new;
end;
$$;
revoke all privileges on function public.venues_rename_training_slots() from public, anon, authenticated, service_role;

drop trigger if exists trg_venues_rename_training_slots on public.venues;
create trigger trg_venues_rename_training_slots
  after update of name on public.venues
  for each row execute function public.venues_rename_training_slots();


-- 3. Which evening a team trains ---------------------------------------------

alter table public.teams
  add column if not exists default_training_day smallint
    check (default_training_day is null or default_training_day between 0 and 6);

comment on column public.teams.default_training_day is
  'The evening this team usually trains, 0 = Sunday … 6 = Saturday as extract(dow) counts. Null = not set. The training planner offers a day''s teams first.';


-- 4. Clone a slot --------------------------------------------------------------

create or replace function public.clone_training_slot(
  p_slot_id    uuid,
  p_weekday    integer,
  p_start_time time,
  p_end_time   time,
  p_copy_teams boolean default true
)
  returns uuid
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  s    public.training_slots%rowtype;
  v_id uuid;
begin
  select * into s from public.training_slots where id = p_slot_id;
  if not found then
    raise exception 'training_slots: no such slot' using errcode = 'P0001';
  end if;
  if p_weekday is null or p_weekday not between 0 and 6 then
    raise exception 'Choose the day of the week.' using errcode = 'P0001';
  end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception 'The slot must end after it starts.' using errcode = 'P0001';
  end if;
  if p_weekday = s.weekday and p_start_time = s.start_time and p_end_time = s.end_time then
    raise exception 'That is the same day and time as the slot being cloned — change one of them.' using errcode = 'P0001';
  end if;

  -- RLS on training_slots and training_allocations still runs here (SECURITY
  -- INVOKER): the planning policies are what admit the caller.
  insert into public.training_slots
    (block_id, venue_id, venue_name, venue_address, weekday, start_time, end_time, parts, notes)
  values
    (s.block_id, s.venue_id, s.venue_name, s.venue_address, p_weekday, p_start_time, p_end_time, s.parts, s.notes)
  returning id into v_id;

  if p_copy_teams then
    insert into public.training_allocations (slot_id, team_id, shares, notes)
    select v_id, a.team_id, a.shares, a.notes
      from public.training_allocations a
     where a.slot_id = p_slot_id;
  end if;

  return v_id;
end;
$$;
revoke all privileges on function public.clone_training_slot(uuid, integer, time, time, boolean) from public, anon;
grant execute on function public.clone_training_slot(uuid, integer, time, time, boolean) to authenticated, service_role;

comment on function public.clone_training_slot(uuid, integer, time, time, boolean) is
  'Copy a training slot — venue, division, notes and (by default) its teams — to another weekday and/or hour in the same block. SECURITY INVOKER: the planning policies decide who may.';


-- 5. Audit the schema change itself -------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'training_slots',
        jsonb_build_object('migration', '20260913110000_training_venues_and_days',
                           'changes', array['venues gain for_matches / for_training',
                                            'training_slots gain venue_id, back-filled from venue_name; venue text kept in step by trigger',
                                            'teams gain default_training_day',
                                            'clone_training_slot()']));

notify pgrst, 'reload schema';
