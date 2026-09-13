-- =============================================================================
-- The club's share of a training venue (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13: "For training venues, I need to be able to set what
-- fraction of the pitch we have at training venue level (plus notes). When I
-- drag a team on, I need to be able to say what fraction(s) they have."
--
-- A hired 3G is rarely all ours: the club has half of Loreto on a Tuesday,
-- and that half is what the teams share. Two facts, at two levels:
--
--   · The VENUE says how its pitch is divided (`training_parts`, 1–6) and how
--     many of those parts the club has (`training_shares`), plus notes for
--     whoever plans there. A new slot at the venue starts from these.
--   · The SLOT says how many of its parts are ours (`club_parts`, null = all
--     of them). The guard hands out shares against THAT, not against the
--     whole pitch — a slot in quarters of which we have two is full at two.
--
-- The plan and the calendar sync are untouched: a session's note still says
-- "A quarter of the pitch", which is what the team actually has.
--
-- Rollback: alter table venues drop column training_parts, training_shares,
-- training_notes; alter table training_slots drop column club_parts (its
-- constraint goes with it); re-create training_allocations_guard,
-- training_slots_parts_guard and clone_training_slot from 20260906100000 /
-- 20260913110000.
-- =============================================================================


-- 1. The venue's share ------------------------------------------------------------

alter table public.venues
  add column if not exists training_parts  smallint not null default 1
    check (training_parts between 1 and 6),
  add column if not exists training_shares smallint not null default 1
    check (training_shares between 1 and 6),
  add column if not exists training_notes  text;

alter table public.venues
  drop constraint if exists venues_training_shares_within_parts,
  add constraint venues_training_shares_within_parts check (training_shares <= training_parts);

comment on column public.venues.training_parts is
  'How the pitch is divided when the club trains here: 1 = the whole pitch, 2 = halves … 6 = sixths. A new slot here starts from it.';
comment on column public.venues.training_shares is
  'How many of training_parts the club has — "we have half of Loreto" is 1 of 2. A new slot here starts from it.';
comment on column public.venues.training_notes is
  'For whoever plans training here: which half is ours, where the cones live, who to ring.';


-- 2. The slot's share -------------------------------------------------------------

alter table public.training_slots
  add column if not exists club_parts smallint;

alter table public.training_slots
  drop constraint if exists training_slots_club_parts_within_parts,
  add constraint training_slots_club_parts_within_parts
    check (club_parts is null or (club_parts between 1 and parts));

comment on column public.training_slots.club_parts is
  'How many of `parts` are the club''s to hand out; null = all of them. The allocation guard counts shares against this.';


-- 3. The guards count against what is ours -----------------------------------------

create or replace function public.training_allocations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_parts integer;
  v_ours  integer;
  v_used  integer;
begin
  select s.parts, coalesce(s.club_parts, s.parts) into v_parts, v_ours
    from public.training_slots s where s.id = new.slot_id;
  if v_parts is null then
    raise exception 'training_allocations: no such slot' using errcode = 'P0001';
  end if;
  if new.shares > v_ours then
    raise exception 'The club has % of that slot — a team cannot hold % of it.',
      case when v_ours = v_parts then public.training_parts_label(v_parts)
           else v_ours || ' of ' || v_parts || ' ' || case when v_parts = 1 then 'part' else 'parts' end end,
      new.shares using errcode = 'P0001';
  end if;
  select coalesce(sum(a.shares), 0) into v_used
    from public.training_allocations a
   where a.slot_id = new.slot_id and a.id <> new.id;
  if v_used + new.shares > v_ours then
    raise exception 'That slot is full — the teams in it already hold % of the % % the club has, and this team would take %.',
      v_used, v_ours, case when v_ours = 1 then 'part' else 'parts' end, new.shares
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all privileges on function public.training_allocations_guard() from public, anon, authenticated, service_role;

create or replace function public.training_slots_parts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_used integer;
  v_ours integer := coalesce(new.club_parts, new.parts);
begin
  select coalesce(sum(a.shares), 0) into v_used
    from public.training_allocations a where a.slot_id = new.id;
  if v_used > v_ours then
    raise exception 'The teams in this slot already hold % parts between them — take a team out before the club''s share drops to %.',
      v_used, v_ours using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all privileges on function public.training_slots_parts_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_training_slots_parts_guard on public.training_slots;
create trigger trg_training_slots_parts_guard
  before update of parts, club_parts on public.training_slots
  for each row execute function public.training_slots_parts_guard();


-- 4. A clone carries the club's share ------------------------------------------------

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

  insert into public.training_slots
    (block_id, venue_id, venue_name, venue_address, weekday, start_time, end_time, parts, club_parts, notes)
  values
    (s.block_id, s.venue_id, s.venue_name, s.venue_address, p_weekday, p_start_time, p_end_time, s.parts, s.club_parts, s.notes)
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


-- 5. Audit the schema change itself ---------------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'training_slots',
        jsonb_build_object('migration', '20260913130000_the_clubs_share_of_a_training_venue',
                           'changes', array['venues gain training_parts / training_shares / training_notes',
                                            'training_slots gain club_parts; the guards count shares against it',
                                            'clone_training_slot copies club_parts']));




-- =============================================================================
-- 6. A block's venues (Adam, 2026-09-13: "for each training block, I need to
--    be able to select which venues apply to that training block")
-- =============================================================================
-- The day planner draws a column per venue. Until now a venue only existed on
-- the planner once a slot named it; now the block says which venues it plans
-- at, and the planner shows every one of them for the chosen day — an empty
-- column is an invitation to add a slot. A slot at a venue the block has not
-- listed lists it (trigger), so nothing a slot says can be missing here.

create table if not exists public.training_block_venues (
  block_id   uuid not null references public.training_blocks (id) on delete cascade,
  venue_id   uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (block_id, venue_id)
);
create index if not exists training_block_venues_venue_idx on public.training_block_venues (venue_id);

comment on table public.training_block_venues is
  'The venues a training block plans at. A slot at a venue adds it here; taking one off is refused while a slot in the block is at it.';

alter table public.training_block_venues enable row level security;
drop policy if exists "training_block_venues_read" on public.training_block_venues;
create policy "training_block_venues_read" on public.training_block_venues
  for select to authenticated using (true);
drop policy if exists "training_block_venues_admin_write" on public.training_block_venues;
create policy "training_block_venues_admin_write" on public.training_block_venues
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());
revoke all privileges on public.training_block_venues from anon, authenticated, service_role;
grant select, insert, update, delete on public.training_block_venues to authenticated, service_role;

-- A venue picked for a block is a training venue.
create or replace function public.training_block_venues_mark_training()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.venues set for_training = true where id = new.venue_id and not for_training;
  return new;
end;
$$;
revoke all privileges on function public.training_block_venues_mark_training() from public, anon, authenticated, service_role;
drop trigger if exists trg_training_block_venues_mark_training on public.training_block_venues;
create trigger trg_training_block_venues_mark_training
  after insert on public.training_block_venues
  for each row execute function public.training_block_venues_mark_training();

-- A slot at a venue puts the venue on its block.
create or replace function public.training_slots_list_venue_on_block()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.venue_id is not null then
    insert into public.training_block_venues (block_id, venue_id)
    values (new.block_id, new.venue_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all privileges on function public.training_slots_list_venue_on_block() from public, anon, authenticated, service_role;
drop trigger if exists trg_training_slots_list_venue_on_block on public.training_slots;
create trigger trg_training_slots_list_venue_on_block
  after insert or update of venue_id, block_id on public.training_slots
  for each row execute function public.training_slots_list_venue_on_block();

-- A venue with slots in the block cannot be taken off the block.
create or replace function public.training_block_venues_guard_delete()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_slots integer;
begin
  select count(*) into v_slots
    from public.training_slots s
   where s.block_id = old.block_id and s.venue_id = old.venue_id;
  if v_slots > 0 then
    raise exception 'This block has % % at that venue — remove or move them before taking the venue off the block.',
      v_slots, case when v_slots = 1 then 'slot' else 'slots' end using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all privileges on function public.training_block_venues_guard_delete() from public, anon, authenticated, service_role;
drop trigger if exists trg_training_block_venues_guard_delete on public.training_block_venues;
create trigger trg_training_block_venues_guard_delete
  before delete on public.training_block_venues
  for each row execute function public.training_block_venues_guard_delete();

-- Backfill: every venue a slot already names is on its block.
insert into public.training_block_venues (block_id, venue_id)
select distinct s.block_id, s.venue_id
  from public.training_slots s
 where s.venue_id is not null
on conflict do nothing;


-- =============================================================================
-- 7. A venue's bookings, season by season (Adam, 2026-09-13: "note booking
--    dates for each season against each training venue")
-- =============================================================================
-- What the club has actually booked at a hired venue: "Loreto, 2026/27, 6 Oct
-- to 23 Mar, Tuesdays 7–8, ref LHS-0412, paid to Christmas". A record of the
-- hire, not the plan — the block's slots say what happens in it. Several rows
-- per venue per season are fine (a booking to Christmas and another after).

create table if not exists public.venue_bookings (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  season_id   uuid references public.seasons (id) on delete set null,
  starts_on   date not null,
  ends_on     date not null,
  -- "Tuesdays 19:00–20:00", "Tue + Thu evenings" — free text; it is a note.
  when_text   text,
  reference   text,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint venue_bookings_dates_ordered check (ends_on >= starts_on),
  constraint venue_bookings_within_two_years check (ends_on - starts_on <= 731)
);
create index if not exists venue_bookings_venue_idx  on public.venue_bookings (venue_id, starts_on);
create index if not exists venue_bookings_season_idx on public.venue_bookings (season_id);

comment on table public.venue_bookings is
  'The dates the club has booked a training venue for, season by season — the hire itself, not the plan.';

drop trigger if exists trg_venue_bookings_updated on public.venue_bookings;
create trigger trg_venue_bookings_updated
  before update on public.venue_bookings
  for each row execute function public.set_updated_at();

alter table public.venue_bookings enable row level security;
drop policy if exists "venue_bookings_read" on public.venue_bookings;
create policy "venue_bookings_read" on public.venue_bookings
  for select to authenticated using (true);
drop policy if exists "venue_bookings_admin_write" on public.venue_bookings;
create policy "venue_bookings_admin_write" on public.venue_bookings
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());
revoke all privileges on public.venue_bookings from anon, authenticated, service_role;
grant select, insert, update, delete on public.venue_bookings to authenticated, service_role;

-- A booking makes the venue a training venue.
create or replace function public.venue_bookings_mark_training()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.venues set for_training = true where id = new.venue_id and not for_training;
  return new;
end;
$$;
revoke all privileges on function public.venue_bookings_mark_training() from public, anon, authenticated, service_role;
drop trigger if exists trg_venue_bookings_mark_training on public.venue_bookings;
create trigger trg_venue_bookings_mark_training
  after insert on public.venue_bookings
  for each row execute function public.venue_bookings_mark_training();

notify pgrst, 'reload schema';
