-- =============================================================================
-- P1.5 — public.resources, public.bookings, public.payments
-- =============================================================================
-- PLAN.md task P1.5 ("`resources` (type: `function_room`, `pitch`, extensible)
-- and unified `bookings` + generalised `booking_payments`"; acceptance: "New
-- booking API path works for a test pitch resource; conflict-check function
-- has tests"). Linear TH1-14.
--
-- PURPOSE
--   One bookable-thing table and one bookings table for the whole club, so
--   that a pitch hire, a function-room hire and (from P2.5) a fixture's pitch
--   allocation all run through the same conflict check. Nothing legacy is
--   touched: `function_rooms`, `room_bookings`, `booking_payments` and
--   `booking_emails` are exactly as the baseline left them, and the live
--   function-room app keeps writing to them until P1.6 moves the data and the
--   app together.
--
-- SHAPE
--   * `resources` — `type` is an enum (`function_room`, `pitch`) so that a
--     third kind (an astro, a meeting room) is one `alter type … add value`.
--     The pricing/extras columns the function-room app renders are carried
--     as plain nullable columns rather than being folded into jsonb: P1.6 has
--     to move a live app onto this table and typed columns are what keep that
--     move reviewable. A pitch leaves them NULL. The legacy `resources text[]`
--     column (a list of amenities) is renamed `amenities` here to avoid the
--     obvious collision with the table name.
--   * `bookings` — a half-open period `[starts_at, ends_at)` in timestamptz
--     (the legacy `date + start_time + end_time` with its "end earlier than
--     start means tomorrow" convention is converted by P1.6, not reproduced),
--     plus `pre_buffer_minutes` / `post_buffer_minutes` for P2.5. The window
--     that actually blocks the resource is `[blocked_from, blocked_until)`,
--     maintained by a BEFORE trigger from the four inputs: `timestamptz ±
--     interval` is only STABLE, so it can be neither a generated column nor an
--     index expression. `status` and `payment_status` are enums holding
--     exactly the values prod's `room_bookings` uses today.
--   * `payments` — the generalised `booking_payments`. It is named `payments`
--     because the legacy table keeps its name until P1.6 renames it, and
--     because P4.1's ledger is this table with `booking_id` made nullable
--     alongside a subscription reference, not a second table.
--
-- CONFLICT CHECK
--   `bookings_no_overlap` is the baseline GiST exclusion constraint carried
--   over (`resource_id WITH =`, blocked range `WITH &&`, only for `pending`
--   and `confirmed` rows — an enquiry, a quote or a cancellation holds nothing).
--   `public.booking_conflicts(...)` returns the rows a proposed slot would
--   collide with and `public.booking_has_conflict(...)` is its boolean; both
--   apply the same status filter and the same half-open semantics, so a
--   touching edge (one ends 14:00, the next starts 14:00) is not a conflict in
--   either the function or the constraint. The constraint is the invariant;
--   the function is the courtesy that lets an API answer "that slot is taken"
--   before trying the insert.
--
-- RLS (per TH1-14: "mirroring today's function-room rules … via has_role()")
--   resources: anon/authenticated read active rows; club_admin everything.
--   bookings:  staff + club_admin read/insert/update; club_admin delete;
--              a booker reads their own (booker_person_id = current_person_id()).
--   payments:  staff + club_admin read/insert/update; club_admin delete.
--   The legacy policies use `is_staff()`, which is true for bar staff via
--   `profiles.role`; P1.4 mapped every such profile to `app_role.staff`, so
--   `has_any_role(array['staff','club_admin'])` is the same set of people
--   expressed in the new model. SAFEGUARDING §1.3 gives `staff` "no inherent
--   access to member or child data": a booking is a hire record, not a member
--   record, and a hirer is "deliberately isolated", so this is within §1.3.
--   No anon write anywhere: the public hire form goes through the server
--   (service_role), exactly as it does today.
--
-- WHAT IS DELIBERATELY NOT DONE
--   * No data is copied. P1.6 owns the move and its reconciliation.
--   * No `booking_emails` equivalent. P1.6 adds `booking_comms` with the data.
--   * No SG-2 guard: bookings are not in SG-2's list, and the legacy app hard
--     deletes cancelled enquiries. Payments likewise keep a club_admin delete
--     (legacy staff could delete); tightening that is a P4.1 question.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (new tables only, no existing
-- policy touched); data touched: none; rollback: §9 of this file.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.resource_type as enum ('function_room', 'pitch');

comment on type public.resource_type is
  'What kind of thing a public.resources row is. Extend with alter type … add value.';

-- The five values prod's room_bookings.status holds (2026-08-23 census:
-- cancelled 11, confirmed 19, quoted 8, pending 1, enquiry 1).
create type public.booking_status as enum
  ('enquiry', 'quoted', 'pending', 'confirmed', 'cancelled');

-- The three values prod's room_bookings.payment_status holds.
create type public.payment_status as enum ('unpaid', 'deposit_paid', 'paid');

-- room_bookings.booking_type: 'hire' (the default) on every prod row today, and
-- 'block' is what the staff "block booking" action writes (a club-use slot,
-- no hirer, no money). 'fixture' is P2.5's pitch allocation; 'maintenance'
-- takes a resource out of use.
create type public.booking_kind as enum ('hire', 'block', 'fixture', 'maintenance');


-- =============================================================================
-- 2. resources
-- =============================================================================

create table public.resources (
  id                    uuid primary key default gen_random_uuid(),
  type                  public.resource_type not null,
  name                  text not null,
  description           text,
  information           text,
  capacity              integer check (capacity is null or capacity > 0),
  active                boolean not null default true,
  sort_order            integer not null default 0,
  amenities             text[] not null default '{}'::text[],
  -- Pricing as the function-room app models it. All nullable; a pitch leaves
  -- them NULL and P3 decides its own pricing shape when the Neon data arrives.
  price_pence_per_hour  integer check (price_pence_per_hour is null or price_pence_per_hour >= 0),
  price_pence_half_day  integer check (price_pence_half_day is null or price_pence_half_day >= 0),
  price_pence_full_day  integer check (price_pence_full_day is null or price_pence_full_day >= 0),
  price_pence_fixed     integer check (price_pence_fixed is null or price_pence_fixed >= 0),
  standard_price_pence  integer check (standard_price_pence is null or standard_price_pence >= 0),
  standard_hours        numeric check (standard_hours is null or standard_hours > 0),
  extra_hour_pence      integer check (extra_hour_pence is null or extra_hour_pence >= 0),
  price_note            text,
  extras_config         jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(extras_config) = 'array'),
  -- Default buffers applied to new bookings on this resource when the caller
  -- does not say otherwise (P2.5 pitch allocation: changeover time).
  default_pre_buffer_minutes   integer not null default 0 check (default_pre_buffer_minutes  >= 0),
  default_post_buffer_minutes  integer not null default 0 check (default_post_buffer_minutes >= 0),
  -- Set by P1.6 on the row copied from function_rooms; NULL for everything else.
  legacy_function_room_id      uuid unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint resources_name_not_blank check (btrim(name) <> '')
);

create index resources_type_active_idx on public.resources (type, active, sort_order);

create trigger trg_resources_updated
  before update on public.resources
  for each row execute function public.set_updated_at();

comment on table public.resources is
  'Every bookable thing the club owns: function rooms and pitches today, extensible by resource_type. Replaces function_rooms (P1.6).';
comment on column public.resources.amenities is
  'Free-text amenity list. Was function_rooms.resources; renamed to avoid colliding with the table name.';
comment on column public.resources.legacy_function_room_id is
  'function_rooms.id this row was copied from by P1.6; NULL for rows created natively.';


-- =============================================================================
-- 3. bookings
-- =============================================================================

create table public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  resource_id           uuid not null references public.resources (id) on delete restrict,
  kind                  public.booking_kind not null default 'hire',
  status                public.booking_status not null default 'pending',
  -- The booked period, half-open. Always stored in UTC; Europe/London is a
  -- presentation concern.
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  pre_buffer_minutes    integer not null default 0 check (pre_buffer_minutes  >= 0),
  post_buffer_minutes   integer not null default 0 check (post_buffer_minutes >= 0),
  -- Maintained by bookings_compute_blocked(); never written by clients.
  blocked_from          timestamptz not null,
  blocked_until         timestamptz not null,
  -- Who booked. A person when known (every profile has one since P1.2); the
  -- contact snapshot is what the hire form collects and what the emails go
  -- to, and it survives the person row being pseudonymised (SG-8) because a
  -- hire contract is a separate legal basis.
  booker_person_id      uuid references public.people (id) on delete set null,
  booker_profile_id     uuid references public.profiles (id) on delete set null,
  booker_name           text not null,
  booker_first_name     text,
  booker_last_name      text,
  booker_email          text not null,
  booker_phone          text,
  occasion              text,
  estimated_guests      integer check (estimated_guests is null or estimated_guests >= 0),
  notes                 text,
  internal_notes        text,
  confirmation_note     text,
  -- Money. total_pence is what the hirer owes overall; the breakdown columns
  -- are how the function-room app arrives at it.
  total_pence           integer check (total_pence is null or total_pence >= 0),
  base_hire_pence       integer not null default 0 check (base_hire_pence >= 0),
  extras_total_pence    integer not null default 0 check (extras_total_pence >= 0),
  member_discount_pence integer not null default 0 check (member_discount_pence >= 0),
  selected_extras       jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(selected_extras) = 'array'),
  deposit_pence         integer check (deposit_pence is null or deposit_pence >= 0),
  deposit_due_date      date,
  balance_due_date      date,
  security_deposit_pence          integer not null default 0 check (security_deposit_pence >= 0),
  security_deposit_returned_at    timestamptz,
  security_deposit_returned_method text,
  security_deposit_returned_note  text,
  payment_status        public.payment_status not null default 'unpaid',
  payment_received_at   timestamptz,
  payment_received_by   text,
  payment_method        text,
  payment_reference     text,
  stripe_checkout_id    text,
  stripe_ref            text,
  deposit_terms_accepted_at timestamptz,
  -- Membership claims made on the hire form (a member discount). Free text
  -- supplied by the hirer, not a link into the member model.
  is_member             boolean not null default false,
  membership_type       text,
  member_number         text,
  team_name             text,
  child_name            text,
  child_team            text,
  -- Outbound-comms bookkeeping the reminder cron keys off.
  deposit_reminder_sent_at        timestamptz,
  balance_reminder_sent_at        timestamptz,
  cancellation_warning_sent_at    timestamptz,
  security_deposit_nudge_sent_at  timestamptz,
  quote_followup_sent_at          timestamptz,
  thank_you_sent_at               timestamptz,
  calendar_event_id     text,
  recurrence_group_id   uuid,
  anonymised_at         timestamptz,
  -- Set by P1.6 on copied rows; NULL for native rows.
  legacy_room_booking_id uuid unique,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint bookings_period_valid      check (ends_at > starts_at),
  constraint bookings_blocked_valid     check (blocked_from <= starts_at and blocked_until >= ends_at),
  constraint bookings_booker_name_not_blank  check (btrim(booker_name) <> ''),
  constraint bookings_booker_email_not_blank check (btrim(booker_email) <> '')
);

create index bookings_resource_period_idx on public.bookings (resource_id, starts_at);
create index bookings_starts_at_idx       on public.bookings (starts_at);
create index bookings_status_idx          on public.bookings (status);
create index bookings_booker_person_idx   on public.bookings (booker_person_id) where booker_person_id is not null;
create index bookings_booker_profile_idx  on public.bookings (booker_profile_id) where booker_profile_id is not null;
create index bookings_recurrence_idx      on public.bookings (recurrence_group_id) where recurrence_group_id is not null;

comment on table public.bookings is
  'Unified bookings for every resource (rooms, pitches). Period is half-open [starts_at, ends_at); [blocked_from, blocked_until) adds the buffers and is what the exclusion constraint tests.';
comment on column public.bookings.blocked_from is
  'starts_at - pre_buffer_minutes. Trigger-maintained; clients must not set it.';
comment on column public.bookings.blocked_until is
  'ends_at + post_buffer_minutes. Trigger-maintained; clients must not set it.';


-- -----------------------------------------------------------------------------
-- 3a. blocked window trigger
-- -----------------------------------------------------------------------------
-- Generated columns and index expressions both need IMMUTABLE, and
-- `timestamptz - interval` is STABLE (a day-or-longer interval depends on the
-- session time zone). Minutes never cross a DST boundary differently in any
-- zone, but Postgres does not know that, so the arithmetic lives in a trigger
-- and the constraint indexes two plain columns.

create or replace function public.bookings_compute_blocked()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.blocked_from  := new.starts_at - make_interval(mins => new.pre_buffer_minutes);
  new.blocked_until := new.ends_at   + make_interval(mins => new.post_buffer_minutes);
  return new;
end;
$$;

create trigger trg_bookings_compute_blocked
  before insert or update of starts_at, ends_at, pre_buffer_minutes, post_buffer_minutes,
                             blocked_from, blocked_until
  on public.bookings
  for each row execute function public.bookings_compute_blocked();

create trigger trg_bookings_updated
  before update on public.bookings
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3b. the exclusion constraint — the invariant
-- -----------------------------------------------------------------------------
-- Carried over from room_bookings_no_overlap. Half-open ranges, so a booking
-- ending at 14:00 and one starting at 14:00 on the same resource do not
-- conflict. btree_gist is already installed in `public` by the baseline.

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(blocked_from, blocked_until, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));


-- =============================================================================
-- 4. CONFLICT-CHECK FUNCTIONS
-- =============================================================================
-- Same status filter and same half-open semantics as the constraint, so the
-- two cannot disagree about an edge. `p_exclude_booking_id` lets an edit of an
-- existing booking ignore itself. SECURITY INVOKER: the caller sees the
-- conflicts RLS lets them see; the constraint is what protects the resource.

create or replace function public.booking_conflicts(
  p_resource_id          uuid,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz,
  p_pre_buffer_minutes   integer default 0,
  p_post_buffer_minutes  integer default 0,
  p_exclude_booking_id   uuid    default null
)
  returns setof public.bookings
  language sql
  stable
  set search_path = public
as $$
  select b.*
  from public.bookings b
  where b.resource_id = p_resource_id
    and b.status in ('pending', 'confirmed')
    and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
    and tstzrange(b.blocked_from, b.blocked_until, '[)')
        && tstzrange(
             p_starts_at - make_interval(mins => coalesce(p_pre_buffer_minutes, 0)),
             p_ends_at   + make_interval(mins => coalesce(p_post_buffer_minutes, 0)),
             '[)'
           )
  order by b.starts_at;
$$;

create or replace function public.booking_has_conflict(
  p_resource_id          uuid,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz,
  p_pre_buffer_minutes   integer default 0,
  p_post_buffer_minutes  integer default 0,
  p_exclude_booking_id   uuid    default null
)
  returns boolean
  language sql
  stable
  set search_path = public
as $$
  select exists (
    select 1 from public.booking_conflicts(
      p_resource_id, p_starts_at, p_ends_at,
      p_pre_buffer_minutes, p_post_buffer_minutes, p_exclude_booking_id
    )
  );
$$;

comment on function public.booking_conflicts(uuid, timestamptz, timestamptz, integer, integer, uuid) is
  'Live (pending/confirmed) bookings whose buffered window overlaps the proposed buffered slot on the resource. Same rule as the bookings_no_overlap constraint.';
comment on function public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid) is
  'exists(booking_conflicts(...)).';


-- =============================================================================
-- 5. payments
-- =============================================================================

create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid not null references public.bookings (id) on delete cascade,
  amount_pence            integer not null check (amount_pence > 0),
  paid_at                 timestamptz not null default now(),
  method                  text,
  reference               text,
  source                  text not null default 'manual',
  sumup_checkout_id       text,
  sumup_txn_code          text,
  stripe_payment_intent_id text,
  authorised_by_profile   uuid references public.profiles (id) on delete set null,
  authorised_by_name      text,
  authorised_by_email     text,
  note                    text,
  -- Set by P1.6 on copied rows; NULL for native rows.
  legacy_booking_payment_id uuid unique,
  created_at              timestamptz not null default now()
);

create index payments_booking_idx on public.payments (booking_id);

comment on table public.payments is
  'Money received against a booking. Generalised booking_payments; P4.1 extends it to subscriptions.';


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================

alter table public.resources enable row level security;
alter table public.bookings  enable row level security;
alter table public.payments  enable row level security;

-- Every policy except resources_public_read is scoped TO authenticated. This is
-- load-bearing for anon: policies on a table are OR-ed, and the role helpers
-- (is_club_admin(), has_any_role()) have EXECUTE revoked from anon by name
-- (the P1.1 lesson), so an unscoped admin policy would make every anon read of
-- an inactive resource fail with "permission denied for function" instead of
-- returning no row. service_role bypasses RLS regardless.

-- resources ------------------------------------------------------------------
-- Legacy: rooms_public_read (active = true, incl. anon) + rooms_committee (all).
create policy "resources_public_read" on public.resources
  for select
  using (active = true);

create policy "resources_admin_read" on public.resources
  for select
  to authenticated
  using (public.is_club_admin());

create policy "resources_admin_insert" on public.resources
  for insert
  to authenticated
  with check (public.is_club_admin());

create policy "resources_admin_update" on public.resources
  for update
  to authenticated
  using (public.is_club_admin())
  with check (public.is_club_admin());

create policy "resources_admin_delete" on public.resources
  for delete
  to authenticated
  using (public.is_club_admin());

-- bookings -------------------------------------------------------------------
-- Legacy: bookings_staff_read/insert/update (is_staff) + bookings_committee_write (all).
create policy "bookings_staff_read" on public.bookings
  for select
  to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "bookings_staff_insert" on public.bookings
  for insert
  to authenticated
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "bookings_staff_update" on public.bookings
  for update
  to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "bookings_admin_delete" on public.bookings
  for delete
  to authenticated
  using (public.is_club_admin());

-- A hirer with a login sees their own bookings (the legacy portal reads
-- room_bookings via service_role; this lets it stop).
create policy "bookings_booker_read" on public.bookings
  for select
  to authenticated
  using (
    booker_person_id is not null
    and booker_person_id = public.current_person_id()
  );

-- payments -------------------------------------------------------------------
-- Legacy: booking_payments_staff_all (is_staff, for all).
create policy "payments_staff_read" on public.payments
  for select
  to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "payments_staff_insert" on public.payments
  for insert
  to authenticated
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "payments_staff_update" on public.payments
  for update
  to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "payments_admin_delete" on public.payments
  for delete
  to authenticated
  using (public.is_club_admin());

-- A hirer sees the payments on their own bookings.
create policy "payments_booker_read" on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and b.booker_person_id is not null
        and b.booker_person_id = public.current_person_id()
    )
  );


-- =============================================================================
-- 7. GRANTS
-- =============================================================================
-- Explicit, as the baseline made its own. anon gets SELECT on resources only
-- (the public hire pages list rooms) and nothing on bookings or payments: the
-- hire form is a server action running as service_role today and stays so.

revoke all privileges on public.resources from anon, authenticated, service_role;
revoke all privileges on public.bookings  from anon, authenticated, service_role;
revoke all privileges on public.payments  from anon, authenticated, service_role;

grant select                          on public.resources to anon;
grant select, insert, update, delete  on public.resources to authenticated, service_role;
grant select, insert, update, delete  on public.bookings  to authenticated, service_role;
grant select, insert, update, delete  on public.payments  to authenticated, service_role;

-- Conflict helpers: anon may ask "is this slot free?" — the public hire form
-- shows availability before anyone logs in, and the answer is a boolean that
-- reveals nothing RLS would hide (the function is SECURITY INVOKER, so anon
-- sees no rows; it needs the boolean form via a SECURITY DEFINER wrapper if
-- that is ever wanted — deliberately not provided here).
revoke all privileges on function public.booking_conflicts(uuid, timestamptz, timestamptz, integer, integer, uuid)    from public, anon;
revoke all privileges on function public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid) from public, anon;
grant execute on function public.booking_conflicts(uuid, timestamptz, timestamptz, integer, integer, uuid)    to authenticated, service_role;
grant execute on function public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid) to authenticated, service_role;

-- Trigger function: nobody calls it.
revoke all privileges on function public.bookings_compute_blocked() from public, anon, authenticated, service_role;


-- =============================================================================
-- 8. RELOAD POSTGREST
-- =============================================================================
notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- Nothing is backfilled, so the rollback is purely structural. As postgres:
--
--   drop table public.payments;
--   drop table public.bookings;           -- takes bookings_no_overlap with it
--   drop table public.resources;
--   drop function public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid);
--   drop function public.booking_conflicts(uuid, timestamptz, timestamptz, integer, integer, uuid);
--   drop function public.bookings_compute_blocked();
--   drop type public.booking_kind;
--   drop type public.payment_status;
--   drop type public.booking_status;
--   drop type public.resource_type;
--
-- Must run before P1.6 (which references all three tables by FK and by the
-- legacy_* columns); after P1.6 the rollback is P1.6's.
