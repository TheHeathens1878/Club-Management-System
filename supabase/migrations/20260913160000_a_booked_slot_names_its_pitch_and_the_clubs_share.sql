-- =============================================================================
-- A booked slot names its pitch and the club's share (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13: "some days we might only have half a pitch (or a quarter)
-- or a full pitch. We need to be able to note this in venue settings. Some
-- venues have two pitches also" — Partington Sports Village: Pitch 1 Monday
-- 6–7 half a pitch, Pitch 1 Monday 7–8 the full pitch, Pitch 2 both hours in
-- full. And: "pitches should have a tick box to note training or matches (or
-- both) and should be allocatable to venues".
--
-- A pitch is a `resources` row and has been allocatable to a venue since
-- 20260901180000 (`resources.venue_id`). Now it says what it is FOR:
-- `for_matches` / `for_training` — the club's own pitches both, a hired 3G
-- at Partington training only — so the booking form offers a pitch for what
-- it is used for. Both default true: nothing the club already books changes.
--
-- A booked slot (20260913150000) then points at the pitch (`pitch_id`) and
-- says how much of it is ours (`parts` / `shares`, in the terms a training
-- slot uses). A training slot in a block points at its pitch too, so two
-- slots at the same venue at the same hour on different pitches are two
-- columns in the day planner, not one box drawn over another. A clone keeps
-- it. The venue's own training_parts / training_shares (20260913130000)
-- remain the default for a venue whose share does not change slot by slot.
--
-- Rollback: alter table resources drop column for_matches, for_training;
-- alter table venue_booking_slots drop column pitch_id, parts, shares;
-- alter table training_slots drop column pitch_id; re-create
-- clone_training_slot from 20260913130000.
-- =============================================================================


-- 1. What a pitch is for -------------------------------------------------------------

alter table public.resources
  add column if not exists for_matches  boolean not null default true,
  add column if not exists for_training boolean not null default true;

comment on column public.resources.for_matches is
  'A pitch the club plays matches on. The fixture desk and a match booking offer only these.';
comment on column public.resources.for_training is
  'A pitch the club trains on. A training booking and a training block offer only these.';


-- 2. A booked slot's pitch and share --------------------------------------------------

alter table public.venue_booking_slots
  add column if not exists pitch_id uuid references public.resources (id) on delete set null,
  add column if not exists parts  smallint not null default 1 check (parts between 1 and 6),
  add column if not exists shares smallint not null default 1 check (shares between 1 and 6);

alter table public.venue_booking_slots
  drop constraint if exists venue_booking_slots_shares_within_parts,
  add constraint venue_booking_slots_shares_within_parts check (shares <= parts);

create index if not exists venue_booking_slots_pitch_idx on public.venue_booking_slots (pitch_id) where pitch_id is not null;

comment on column public.venue_booking_slots.pitch_id is
  'Which of the venue''s pitches (a resources row on that venue); null = the venue''s only one.';
comment on column public.venue_booking_slots.parts is
  'How the pitch is divided for this slot: 1 = whole, 2 = halves … 6 = sixths.';
comment on column public.venue_booking_slots.shares is
  'How many of `parts` the club has booked for this slot.';


-- 3. A training slot's pitch ------------------------------------------------------------

alter table public.training_slots
  add column if not exists pitch_id uuid references public.resources (id) on delete set null;

create index if not exists training_slots_pitch_idx on public.training_slots (pitch_id) where pitch_id is not null;

comment on column public.training_slots.pitch_id is
  'Which of the venue''s pitches the slot is on — the same resources row a booked slot names; null = the only one.';

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
    (block_id, venue_id, venue_name, venue_address, pitch_id, weekday, start_time, end_time, parts, club_parts, notes)
  values
    (s.block_id, s.venue_id, s.venue_name, s.venue_address, s.pitch_id, p_weekday, p_start_time, p_end_time, s.parts, s.club_parts, s.notes)
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


-- 4. Audit --------------------------------------------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'venue_booking_slots',
        jsonb_build_object('migration', '20260913160000_a_booked_slot_names_its_pitch_and_the_clubs_share',
                           'changes', array['resources gain for_matches / for_training',
                                            'venue_booking_slots gain pitch_id, parts, shares',
                                            'training_slots gain pitch_id; clone_training_slot copies it']));

notify pgrst, 'reload schema';
