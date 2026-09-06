-- =============================================================================
-- Winter training allocation (Adam, 2026-09-06)
-- =============================================================================
-- "I am about to start winter training allocation. We have a limited amount
--  of spaces at different training venues (2G or 3G pitches) and I need the
--  ability for these spaces to be allocated to teams (which auto-creates an
--  event for that team en masse for the winter). I will need the ability to
--  block dates out (e.g. Xmas and half-term) and if I re-run the process, it
--  will auto amend / delete / add the existing events. We don't always have a
--  full pitch so need to be able to easily subdivide into 2 or 3 or 4 or 5 or
--  even 6. Coaches should be able to cancel them if they aren't training."
--
-- THE SHAPE — a plan, and the calendar reconciled to it
--   * `training_blocks`      — "Winter 2026/27": first day, last day, the
--                              title every session carries.
--   * `training_blackouts`   — dates off inside a block: Christmas, half-term.
--   * `training_slots`       — a space at a venue, weekly: "Sale Grammar 3G,
--                              Monday 18:00–19:00, in thirds". `parts` is how
--                              many ways the pitch is divided (1–6).
--   * `training_allocations` — a team in a slot, holding `shares` of its
--                              parts. A guard keeps the sum within the slot.
--
--   `training_block_plan(block)` is the pure function from the plan to the
--   sessions it implies: one row per allocation per matching weekday between
--   the block's dates, minus the dates off. `sync_training_block(block,
--   dry_run)` reconciles `events` to that plan — adds what is missing,
--   amends what moved, removes what no longer belongs — and reports the
--   counts, so the administrator sees "8 to add, 2 to change, 3 to remove"
--   before pressing the button and "done" after. Re-running is the whole
--   design: the plan is edited freely and the calendar is brought back into
--   step, however many times.
--
-- WHAT THE SYNC WILL NOT TOUCH
--   * The past. A session that has happened is a record of what happened —
--     it is neither moved nor removed, and a plan row in the past is never
--     created after the fact.
--   * A coach's cancellation. A session the coach called off stays cancelled
--     across re-runs; a moved slot still moves it (so the record reads right
--     if they reinstate it), but it is never quietly put back on.
--
-- EVENTS, NOT BOOKINGS
--   These venues are hired 3G pitches the club does not own, so there is no
--   `resources` row to reserve and `bookings_no_overlap` has nothing to say.
--   The sessions are plain `practice` events with `venue_text` — they land on
--   every family's Calendar, take accept/decline, and notify through the
--   existing statement-level trigger (a whole winter is ONE insert, so each
--   household gets one "N new events" message, not sixty).
--
-- THE HOUSEHOLDS ARE TOLD
--   A moved session is "the details have changed" exactly as 20260824350000
--   defines it — the flag, the sentence, one batched message per team, the
--   answers left standing. A coach cancelling a session is new: nothing told
--   the families before, so `cancel_training_session()` does, with the
--   coach's reason. Reinstating uses the details-changed path.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (four new tables — anyone
-- signed in reads, a club administrator writes; the RPCs gate themselves);
-- data touched: none — nothing exists until an administrator plans a block;
-- rollback: §9.
-- =============================================================================


-- =============================================================================
-- 1. training_blocks
-- =============================================================================

create table public.training_blocks (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  season_id       uuid references public.seasons (id) on delete set null,
  starts_on       date not null,
  ends_on         date not null,
  -- What every session is called on the calendar. One title per block keeps
  -- "Winter training" from being typed forty times with three spellings.
  session_title   text not null default 'Winter training',
  notes           text,
  last_synced_at  timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint training_blocks_name_not_blank  check (btrim(name) <> ''),
  constraint training_blocks_title_not_blank check (btrim(session_title) <> ''),
  constraint training_blocks_dates_ordered   check (ends_on >= starts_on),
  constraint training_blocks_within_a_year   check (ends_on - starts_on <= 366)
);

create index training_blocks_dates_idx on public.training_blocks (starts_on, ends_on);

create trigger trg_training_blocks_updated
  before update on public.training_blocks
  for each row execute function public.set_updated_at();

comment on table public.training_blocks is
  'A run of weekly training — "Winter 2026/27" — with its dates off, its venue slots and the teams in them. sync_training_block() turns it into events.';
comment on column public.training_blocks.last_synced_at is
  'When the calendar was last brought into step with the plan. Null until the first run.';


-- =============================================================================
-- 2. training_blackouts — dates off
-- =============================================================================

create table public.training_blackouts (
  id          uuid primary key default gen_random_uuid(),
  block_id    uuid not null references public.training_blocks (id) on delete cascade,
  label       text not null,
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now(),
  constraint training_blackouts_label_not_blank check (btrim(label) <> ''),
  constraint training_blackouts_dates_ordered   check (ends_on >= starts_on)
);

create index training_blackouts_block_idx on public.training_blackouts (block_id, starts_on);

comment on table public.training_blackouts is
  'Dates inside a block with no training: Christmas, half-term, a tournament weekend. Inclusive on both ends.';


-- =============================================================================
-- 3. training_slots — a space at a venue, weekly
-- =============================================================================

create table public.training_slots (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null references public.training_blocks (id) on delete cascade,
  venue_name     text not null,
  venue_address  text check (venue_address is null or char_length(venue_address) between 1 and 300),
  -- 0 = Sunday … 6 = Saturday, as extract(dow) counts, so the plan can join
  -- on it without a lookup.
  weekday        smallint not null check (weekday between 0 and 6),
  start_time     time not null,
  end_time       time not null,
  -- How many ways the pitch is divided for this hour: 1 is the whole pitch,
  -- 3 is thirds, 6 is sixths. Allocations take `shares` of these.
  parts          smallint not null default 1 check (parts between 1 and 6),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint training_slots_venue_not_blank check (btrim(venue_name) <> ''),
  constraint training_slots_times_ordered   check (end_time > start_time)
);

create index training_slots_block_idx on public.training_slots (block_id, venue_name, weekday, start_time);

create trigger trg_training_slots_updated
  before update on public.training_slots
  for each row execute function public.set_updated_at();

comment on table public.training_slots is
  'One weekly space at a venue — "Sale Grammar 3G, Monday 18:00–19:00" — divided into `parts` (1–6) that allocations share out.';
comment on column public.training_slots.weekday is
  '0 = Sunday … 6 = Saturday, as extract(dow) counts.';


-- =============================================================================
-- 4. training_allocations — a team in a slot
-- =============================================================================

create table public.training_allocations (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references public.training_slots (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  -- How many of the slot's parts this team has. One team, one slot, one row.
  shares      smallint not null default 1 check (shares between 1 and 6),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (slot_id, team_id)
);

create index training_allocations_team_idx on public.training_allocations (team_id);

create trigger trg_training_allocations_updated
  before update on public.training_allocations
  for each row execute function public.set_updated_at();

comment on table public.training_allocations is
  'A team''s place in a slot, holding `shares` of the slot''s parts. The guard keeps a slot from being over-allocated.';

-- The slot cannot be handed out more than once over. Checked on the
-- allocation (insert / update of shares) and on the slot (shrinking parts).
create or replace function public.training_allocations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_parts integer;
  v_used  integer;
begin
  select s.parts into v_parts from public.training_slots s where s.id = new.slot_id;
  if v_parts is null then
    raise exception 'training_allocations: no such slot' using errcode = 'P0001';
  end if;
  if new.shares > v_parts then
    raise exception 'That slot is divided into % — a team cannot hold % of it.',
      public.training_parts_label(v_parts), new.shares using errcode = 'P0001';
  end if;
  select coalesce(sum(a.shares), 0) into v_used
    from public.training_allocations a
   where a.slot_id = new.slot_id and a.id <> new.id;
  if v_used + new.shares > v_parts then
    raise exception 'That slot is full: % of % % already allocated, and this team would take %.',
      v_used, v_parts, case when v_parts = 1 then 'part is' else 'parts are' end, new.shares
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all privileges on function public.training_allocations_guard() from public, anon, authenticated, service_role;

create trigger trg_training_allocations_guard
  before insert or update of slot_id, shares on public.training_allocations
  for each row execute function public.training_allocations_guard();

create or replace function public.training_slots_parts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_used integer;
begin
  select coalesce(sum(a.shares), 0) into v_used
    from public.training_allocations a where a.slot_id = new.id;
  if v_used > new.parts then
    raise exception 'The teams in this slot already hold % parts between them — take a team out before dividing it into %.',
      v_used, public.training_parts_label(new.parts) using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all privileges on function public.training_slots_parts_guard() from public, anon, authenticated, service_role;

create trigger trg_training_slots_parts_guard
  before update of parts on public.training_slots
  for each row execute function public.training_slots_parts_guard();


-- =============================================================================
-- 5. WORDS — "thirds", "two thirds of the pitch"
-- =============================================================================

-- "the whole pitch" / "halves" / "thirds" … for a slot's `parts`.
create or replace function public.training_parts_label(p_parts integer)
  returns text
  language sql
  immutable
as $$
  select case p_parts
    when 1 then 'the whole pitch'
    when 2 then 'halves'
    when 3 then 'thirds'
    when 4 then 'quarters'
    when 5 then 'fifths'
    when 6 then 'sixths'
    else p_parts || ' parts'
  end;
$$;

-- "The whole pitch" / "Half of the pitch" / "A third of the pitch" / "Two
-- thirds of the pitch" for an allocation's `shares` of a slot's `parts` —
-- what the session's note says.
create or replace function public.training_share_label(p_shares integer, p_parts integer)
  returns text
  language sql
  immutable
as $$
  select case
    when p_parts <= 1 or p_shares >= p_parts then 'The whole pitch'
    when p_parts = 2 then 'Half of the pitch'
    else
      case p_shares
        when 1 then 'A'
        when 2 then 'Two'
        when 3 then 'Three'
        when 4 then 'Four'
        when 5 then 'Five'
        else p_shares::text
      end
      || ' '
      || case p_parts
           when 3 then 'third'
           when 4 then 'quarter'
           when 5 then 'fifth'
           when 6 then 'sixth'
           else 'part'
         end
      || case when p_shares = 1 then '' else 's' end
      || ' of the pitch'
  end;
$$;


-- =============================================================================
-- 6. THE LINK — events know the plan row they came from
-- =============================================================================

alter table public.events
  add column if not exists training_block_id      uuid references public.training_blocks (id) on delete set null,
  add column if not exists training_allocation_id uuid references public.training_allocations (id) on delete set null,
  add column if not exists training_on            date;

-- One session per allocation per day is what makes the sync idempotent.
create unique index if not exists events_training_allocation_day_idx
  on public.events (training_allocation_id, training_on)
  where training_allocation_id is not null;

create index if not exists events_training_block_idx
  on public.events (training_block_id)
  where training_block_id is not null;

comment on column public.events.training_block_id is
  'The training block whose sync wrote this session. Survives the allocation being removed, so the sync can find and remove the orphaned sessions.';
comment on column public.events.training_allocation_id is
  'The (slot, team) row this session came from. Set null when the allocation is removed; the next sync then removes the future sessions.';
comment on column public.events.training_on is
  'The local calendar day of the session, so (allocation, day) is unique regardless of the clock change.';

-- Deleting a whole block takes its future sessions with it — nothing else
-- would be able to find them once the block row is gone. The past stays.
create or replace function public.training_blocks_before_delete()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  delete from public.events e
   where e.training_block_id = old.id and e.starts_at > now();
  return old;
end;
$$;
revoke all privileges on function public.training_blocks_before_delete() from public, anon, authenticated, service_role;

create trigger trg_training_blocks_before_delete
  before delete on public.training_blocks
  for each row execute function public.training_blocks_before_delete();


-- =============================================================================
-- 7. THE PLAN, AND THE SYNC
-- =============================================================================

-- Who may plan: the same people who manage the pitches.
create or replace function public.can_plan_training()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.is_club_admin() or public.is_committee();
$$;
revoke all privileges on function public.can_plan_training() from public, anon;
grant execute on function public.can_plan_training() to authenticated, service_role;

/**
 * The sessions a block implies: one per allocation per matching weekday from
 * the first day to the last, minus the dates off. Times are London wall
 * clock, so an 18:00 slot stays 18:00 across the clock change.
 */
create or replace function public.training_block_plan(p_block_id uuid)
  returns table (
    allocation_id uuid,
    slot_id       uuid,
    team_id       uuid,
    training_on   date,
    starts_at     timestamptz,
    ends_at       timestamptz,
    title         text,
    venue_text    text,
    notes         text
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select a.id,
         s.id,
         a.team_id,
         d::date,
         (d::date + s.start_time) at time zone 'Europe/London',
         (d::date + s.end_time)   at time zone 'Europe/London',
         b.session_title,
         s.venue_name,
         public.training_share_label(a.shares, s.parts) || ' · ' || b.name
  from public.training_blocks b
  join public.training_slots s       on s.block_id = b.id
  join public.training_allocations a on a.slot_id = s.id
  cross join generate_series(b.starts_on::timestamp, b.ends_on::timestamp, interval '1 day') d
  where b.id = p_block_id
    and extract(dow from d)::integer = s.weekday
    and not exists (
      select 1 from public.training_blackouts x
       where x.block_id = b.id and d::date between x.starts_on and x.ends_on)
  order by d, s.venue_name, s.start_time, a.team_id;
$$;
revoke all privileges on function public.training_block_plan(uuid) from public, anon;
grant execute on function public.training_block_plan(uuid) to authenticated, service_role;

/**
 * Bring the calendar into step with the plan. Dry-run reports what WOULD
 * happen; otherwise it happens, and the same counts come back.
 *
 *   added      future plan rows with no session yet → inserted (one statement,
 *              so the households get one summary each)
 *   updated    future sessions whose time, title, venue or note differ →
 *              amended; a moved time or venue is "the details have changed"
 *   removed    future sessions of this block the plan no longer contains →
 *              deleted, answers and all (Adam: "auto amend / delete / add")
 *   unchanged  future sessions already matching the plan
 *   cancelled  of those, the ones a coach has called off — kept as they are
 */
create or replace function public.sync_training_block(p_block_id uuid, p_dry_run boolean default false)
  returns table (added integer, updated integer, removed integer, unchanged integer, cancelled integer)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_added     integer;
  v_updated   integer;
  v_removed   integer;
  v_unchanged integer;
  v_cancelled integer;
  v_team      record;
begin
  if not public.can_plan_training() then
    raise exception 'Only a club administrator can plan training.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.training_blocks b where b.id = p_block_id) then
    raise exception 'No such training block.' using errcode = 'P0001';
  end if;

  -- What would go.
  select count(*) into v_removed
    from public.events e
   where e.training_block_id = p_block_id
     and e.starts_at > now()
     and not exists (
       select 1 from public.training_block_plan(p_block_id) p
        where p.allocation_id = e.training_allocation_id and p.training_on = e.training_on);

  -- What would arrive.
  select count(*) into v_added
    from public.training_block_plan(p_block_id) p
   where p.starts_at > now()
     and not exists (
       select 1 from public.events e
        where e.training_allocation_id = p.allocation_id and e.training_on = p.training_on);

  -- What would move, and what already fits.
  select count(*) filter (where e.starts_at <> p.starts_at
                             or e.ends_at is distinct from p.ends_at
                             or e.title <> p.title
                             or e.venue_text is distinct from p.venue_text
                             or e.notes is distinct from p.notes),
         count(*) filter (where not (e.starts_at <> p.starts_at
                             or e.ends_at is distinct from p.ends_at
                             or e.title <> p.title
                             or e.venue_text is distinct from p.venue_text
                             or e.notes is distinct from p.notes)),
         count(*) filter (where e.status = 'cancelled')
    into v_updated, v_unchanged, v_cancelled
    from public.events e
    join public.training_block_plan(p_block_id) p
      on p.allocation_id = e.training_allocation_id and p.training_on = e.training_on
   where e.starts_at > now();

  if not p_dry_run then
    delete from public.events e
     where e.training_block_id = p_block_id
       and e.starts_at > now()
       and not exists (
         select 1 from public.training_block_plan(p_block_id) p
          where p.allocation_id = e.training_allocation_id and p.training_on = e.training_on);

    update public.events e
       set starts_at  = p.starts_at,
           ends_at    = p.ends_at,
           title      = p.title,
           venue_text = p.venue_text,
           notes      = p.notes,
           details_changed_at = case
             when e.starts_at <> p.starts_at or e.venue_text is distinct from p.venue_text then now()
             else e.details_changed_at end,
           change_note = case
             when e.starts_at <> p.starts_at or e.venue_text is distinct from p.venue_text
               then public.event_change_note(e.starts_at, p.starts_at, e.venue_text, p.venue_text)
             else e.change_note end
      from public.training_block_plan(p_block_id) p
     where p.allocation_id = e.training_allocation_id and p.training_on = e.training_on
       and e.starts_at > now()
       and (e.starts_at <> p.starts_at
            or e.ends_at is distinct from p.ends_at
            or e.title <> p.title
            or e.venue_text is distinct from p.venue_text
            or e.notes is distinct from p.notes);

    -- The sessions just flagged carry this transaction's now(); tell each
    -- team's households once, the way a moved fixture does.
    for v_team in
      select e.team_id, array_agg(e.id) as ids
        from public.events e
       where e.training_block_id = p_block_id
         and e.details_changed_at = now()
         and e.status = 'scheduled'
         and e.starts_at > now()
       group by e.team_id
    loop
      perform public.notify_events_changed(v_team.team_id, v_team.ids);
    end loop;

    insert into public.events
      (team_id, type, title, status, starts_at, ends_at, venue_text, notes,
       training_block_id, training_allocation_id, training_on, created_by)
    select p.team_id, 'practice'::public.event_type, p.title, 'scheduled'::public.event_status,
           p.starts_at, p.ends_at, p.venue_text, p.notes,
           p_block_id, p.allocation_id, p.training_on, auth.uid()
      from public.training_block_plan(p_block_id) p
     where p.starts_at > now()
       and not exists (
         select 1 from public.events e
          where e.training_allocation_id = p.allocation_id and e.training_on = p.training_on);

    update public.training_blocks set last_synced_at = now() where id = p_block_id;
  end if;

  return query select v_added, v_updated, v_removed, v_unchanged, v_cancelled;
end;
$$;
revoke all privileges on function public.sync_training_block(uuid, boolean) from public, anon;
grant execute on function public.sync_training_block(uuid, boolean) to authenticated, service_role;


-- =============================================================================
-- 8. THE COACH'S TAP — "not training this week", and back on
-- =============================================================================

/**
 * Cancel a session and tell the households why. `cancel_team_event` does the
 * cancelling (and its guard: the team's staff or an administrator; never a
 * fixture) — this adds the sentence nobody was sending. The reason is kept
 * on the event as its change note.
 */
create or replace function public.cancel_training_session(p_event_id uuid, p_reason text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event  record;
  v_team   text;
  v_actor  uuid := public.current_person_id();
  v_person uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'No such session.' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin() or public.is_team_staff(v_event.team_id)) then
    raise exception 'Only the team''s staff or a club administrator can cancel a session.' using errcode = 'P0001';
  end if;
  if v_event.status = 'cancelled' then
    raise exception 'That session is already cancelled.' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'That session has already started — it cannot be cancelled now.' using errcode = 'P0001';
  end if;

  perform public.cancel_team_event(p_event_id);

  update public.events
     set change_note = case when v_reason is not null then 'Cancelled — ' || v_reason else 'Cancelled.' end
   where id = p_event_id;

  select t.name into v_team from public.teams t where t.id = v_event.team_id;
  for v_person in
    select distinct coalesce(g.guardian_person_id, m.person_id)
      from public.team_memberships m
      left join public.guardianships g
        on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
     where m.team_id = v_event.team_id and m.left_at is null
  loop
    if v_person is distinct from v_actor then
      perform public.notify(
        v_person,
        'Training cancelled: ' || coalesce(v_team, 'your team'),
        coalesce(v_team || ' — ', '') || v_event.title || ' on '
          || to_char(v_event.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
          || ' is cancelled.' || coalesce(' ' || v_reason, ''),
        '/events/' || p_event_id, 'events', p_event_id::text);
    end if;
  end loop;
end;
$$;
revoke all privileges on function public.cancel_training_session(uuid, text) from public, anon;
grant execute on function public.cancel_training_session(uuid, text) to authenticated, service_role;

/**
 * Put a cancelled session back on. Same guard as cancelling; the households
 * hear through the details-changed path, answers standing.
 */
create or replace function public.reinstate_training_session(p_event_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_event record;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'No such session.' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin() or public.is_team_staff(v_event.team_id)) then
    raise exception 'Only the team''s staff or a club administrator can reinstate a session.' using errcode = 'P0001';
  end if;
  if v_event.fixture_id is not null then
    raise exception 'This event mirrors a fixture — reinstate the fixture instead.' using errcode = 'P0001';
  end if;
  if v_event.status <> 'cancelled' then
    raise exception 'That session is not cancelled.' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'That session has already passed.' using errcode = 'P0001';
  end if;

  update public.events
     set status = 'scheduled',
         details_changed_at = now(),
         change_note = 'Training is back on.'
   where id = p_event_id;

  perform public.notify_events_changed(v_event.team_id, array[p_event_id]);
end;
$$;
revoke all privileges on function public.reinstate_training_session(uuid) from public, anon;
grant execute on function public.reinstate_training_session(uuid) to authenticated, service_role;


-- =============================================================================
-- 9. event_detail — the session knows its block, and the venue its address
-- =============================================================================

create or replace function public.event_detail(p_event_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'team_id', e.team_id,
    'team_name', t.name,
    'type', e.type,
    'title', e.title,
    'status', e.status,
    'fixture_id', e.fixture_id,
    'booking_id', e.booking_id,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'meet_minutes_before', e.meet_minutes_before,
    'meet_at', case when e.meet_minutes_before is not null
                    then e.starts_at - make_interval(mins => e.meet_minutes_before) end,
    'venue', coalesce(r.name, e.venue_text),
    'venue_address', coalesce(r.address, ts.venue_address),
    'venue_is_home', e.venue_resource_id is not null,
    'notes', e.notes,
    'created_at', e.created_at,
    'details_changed_at', e.details_changed_at,
    'change_note', e.change_note,
    'created_by_name', case
      when f.source = 'fulltime' then 'FA Full-Time import'
      else coalesce((select pp.first_name || ' ' || pp.last_name
                     from public.profiles pr join public.people pp on pp.id = pr.person_id
                     where pr.id = e.created_by), 'the club')
    end,
    'booking_status', coalesce(
      (select b.status::text from public.bookings b where b.id = e.booking_id),
      (select b.status::text from public.bookings b
        where b.fixture_id = e.fixture_id and e.fixture_id is not null
          and b.status <> 'cancelled' order by b.status limit 1),
      (select b.status::text from public.bookings b
        where e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
          and b.status = 'confirmed'
          and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
          and b.ends_at > e.starts_at
          and (b.team_id = e.team_id
               or exists (select 1 from public.booking_teams bt
                          where bt.booking_id = b.id and bt.team_id = e.team_id))
        limit 1)),
    'booked', coalesce(
      (select b.status = 'confirmed' from public.bookings b where b.id = e.booking_id),
      exists (select 1 from public.bookings b
               where e.fixture_id is not null and b.fixture_id = e.fixture_id and b.status = 'confirmed'),
      false)
      or exists (select 1 from public.bookings b
                  where e.booking_id is null and e.fixture_id is null
                    and e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
                    and b.status = 'confirmed'
                    and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
                    and b.ends_at > e.starts_at
                    and (b.team_id = e.team_id
                         or exists (select 1 from public.booking_teams bt
                                    where bt.booking_id = b.id and bt.team_id = e.team_id))),
    'series', case when s.id is not null then jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'weekday', trim(to_char(s.first_starts_at at time zone 'Europe/London', 'Day')),
      'time', to_char(s.first_starts_at at time zone 'Europe/London', 'HH24:MI'),
      'repeat_until', s.repeat_until,
      'occurrences', (select count(*) from public.events se where se.series_id = s.id)
    ) end,
    'training', case when e.training_block_id is not null then jsonb_build_object(
      'block_id', e.training_block_id,
      'block_name', tb.name,
      'share', case when ta.id is not null then public.training_share_label(ta.shares, ts.parts) end
    ) end)
  from public.events e
  join public.teams t on t.id = e.team_id
  left join public.resources r on r.id = e.venue_resource_id
  left join public.fixtures f on f.id = e.fixture_id
  left join public.event_series s on s.id = e.series_id
  left join public.training_blocks tb on tb.id = e.training_block_id
  left join public.training_allocations ta on ta.id = e.training_allocation_id
  left join public.training_slots ts on ts.id = ta.slot_id
  where e.id = p_event_id;
$$;


-- =============================================================================
-- 10. RLS + GRANTS
-- =============================================================================

alter table public.training_blocks      enable row level security;
alter table public.training_blackouts   enable row level security;
alter table public.training_slots       enable row level security;
alter table public.training_allocations enable row level security;

-- Anyone signed in may read the plan (the same stance as events: a venue, a
-- time and a team name are what the sessions themselves say). Writing is the
-- planners' alone.
create policy "training_blocks_read" on public.training_blocks
  for select to authenticated using (true);
create policy "training_blocks_admin_write" on public.training_blocks
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());

create policy "training_blackouts_read" on public.training_blackouts
  for select to authenticated using (true);
create policy "training_blackouts_admin_write" on public.training_blackouts
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());

create policy "training_slots_read" on public.training_slots
  for select to authenticated using (true);
create policy "training_slots_admin_write" on public.training_slots
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());

create policy "training_allocations_read" on public.training_allocations
  for select to authenticated using (true);
create policy "training_allocations_admin_write" on public.training_allocations
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());

revoke all privileges on public.training_blocks, public.training_blackouts,
  public.training_slots, public.training_allocations from anon, authenticated, service_role;
grant select, insert, update, delete on public.training_blocks, public.training_blackouts,
  public.training_slots, public.training_allocations to authenticated, service_role;

revoke all privileges on function public.training_parts_label(integer)          from public, anon;
revoke all privileges on function public.training_share_label(integer, integer) from public, anon;
grant execute on function public.training_parts_label(integer)          to authenticated, service_role;
grant execute on function public.training_share_label(integer, integer) to authenticated, service_role;


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop function public.reinstate_training_session(uuid);
-- drop function public.cancel_training_session(uuid, text);
-- drop function public.sync_training_block(uuid, boolean);
-- drop function public.training_block_plan(uuid);
-- drop function public.can_plan_training();
-- restore event_detail from 20260824500000_event_pitch_and_replies.sql;
-- alter table public.events drop column training_on, drop column training_allocation_id, drop column training_block_id;
-- drop table public.training_allocations, public.training_slots, public.training_blackouts, public.training_blocks;
-- drop function public.training_share_label(integer, integer), public.training_parts_label(integer),
--   public.training_slots_parts_guard(), public.training_allocations_guard(),
--   public.training_blocks_before_delete();
