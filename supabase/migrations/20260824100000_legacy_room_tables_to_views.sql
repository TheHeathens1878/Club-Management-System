-- =============================================================================
-- P1.6 cutover — legacy function-room tables → *_legacy, read-only views in
-- their place (docs/runbooks/P1.6-cutover.md step 3)
-- =============================================================================
-- Run only inside the cutover window, after the old Vercel project is paused
-- and migrate_room_bookings() + reconcile_room_bookings() have been re-run
-- clean. From here the unified tables are the only writable copy:
--   * the four legacy tables are renamed *_legacy and revoked from anon and
--     authenticated (service_role keeps SELECT for the 30-day check);
--   * views under the old names, built over the unified tables, serve any
--     straggling reader and fail any straggling writer (joins/expressions
--     make them non-updatable);
--   * migrate_room_bookings() / reconcile_room_bookings() are re-pointed at
--     the *_legacy tables so the abort path and the 30-day check stay truthful.
-- Nothing is dropped (PLAN §2.5). Decommission of *_legacy is a later task.
-- Abort: drop the four views, rename the tables back, re-create the two
-- functions from 20260823110000 — in one transaction.
-- =============================================================================

-- 1. Rename ------------------------------------------------------------------
alter table public.room_bookings    rename to room_bookings_legacy;
alter table public.booking_payments rename to booking_payments_legacy;
alter table public.booking_emails   rename to booking_emails_legacy;
alter table public.function_rooms   rename to function_rooms_legacy;

revoke all on public.room_bookings_legacy, public.booking_payments_legacy,
              public.booking_emails_legacy, public.function_rooms_legacy
  from anon, authenticated;

comment on table public.room_bookings_legacy    is 'Frozen at P1.6 cutover; superseded by public.bookings. Drop after 30 clean days (DECISIONS.md).';
comment on table public.booking_payments_legacy is 'Frozen at P1.6 cutover; superseded by public.payments. Drop after 30 clean days.';
comment on table public.booking_emails_legacy   is 'Frozen at P1.6 cutover; superseded by public.booking_comms. Drop after 30 clean days.';
comment on table public.function_rooms_legacy   is 'Frozen at P1.6 cutover; superseded by public.resources. Drop after 30 clean days.';

-- 2. Views under the old names -----------------------------------------------
-- security_invoker: the caller's RLS on the unified tables applies.
create view public.function_rooms with (security_invoker = true) as
  select legacy_function_room_id as id, name, description, capacity,
         price_pence_per_hour, price_pence_half_day, price_pence_full_day,
         active, sort_order, created_at, amenities as resources,
         price_pence_fixed, price_note, information, extras_config,
         standard_price_pence, standard_hours, extra_hour_pence
  from public.resources
  where legacy_function_room_id is not null;

create view public.room_bookings with (security_invoker = true) as
  select b.legacy_room_booking_id as id,
         r.legacy_function_room_id as room_id,
         (b.starts_at at time zone 'Europe/London')::date as date,
         (b.starts_at at time zone 'Europe/London')::time as start_time,
         (b.ends_at   at time zone 'Europe/London')::time as end_time,
         b.booker_name, b.booker_email, b.booker_phone, b.occasion, b.estimated_guests, b.notes,
         b.status::text as status,
         b.total_pence as amount_pence,   -- legacy amount_pence had no unified equivalent; total_pence stands in
         b.stripe_checkout_id, b.stripe_ref,
         b.payment_status::text as payment_status,
         b.internal_notes, b.created_at, b.updated_at,
         b.kind::text as booking_type,
         b.recurrence_group_id, b.payment_received_at, b.payment_received_by, b.payment_method, b.payment_reference,
         b.calendar_event_id, b.booker_first_name, b.booker_last_name,
         b.total_pence, b.deposit_pence, b.deposit_due_date, b.balance_due_date,
         b.booker_profile_id, b.deposit_reminder_sent_at, b.balance_reminder_sent_at,
         b.selected_extras, b.extras_total_pence, b.security_deposit_pence, b.security_deposit_returned_at,
         b.is_member, b.membership_type, b.member_number, b.team_name, b.child_name, b.child_team,
         b.base_hire_pence, b.member_discount_pence, b.cancellation_warning_sent_at,
         b.security_deposit_returned_method, b.security_deposit_returned_note, b.confirmation_note,
         b.deposit_terms_accepted_at, b.security_deposit_nudge_sent_at, b.quote_followup_sent_at,
         b.anonymised_at, b.thank_you_sent_at
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  where b.legacy_room_booking_id is not null;

create view public.booking_payments with (security_invoker = true) as
  select p.legacy_booking_payment_id as id,
         b.legacy_room_booking_id as booking_id,
         p.amount_pence, p.paid_at, p.method, p.reference, p.source,
         p.sumup_checkout_id, p.sumup_txn_code,
         p.authorised_by_profile, p.authorised_by_name, p.authorised_by_email,
         p.note, p.created_at
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  where p.legacy_booking_payment_id is not null;

create view public.booking_emails with (security_invoker = true) as
  select c.legacy_booking_email_id as id,
         b.legacy_room_booking_id as booking_id,
         c.kind, c.to_address as to_email, c.cc, c.subject, c.body,
         c.sent_by, c.sent_by_name, c.sent_at
  from public.booking_comms c
  join public.bookings b on b.id = c.booking_id
  where c.legacy_booking_email_id is not null;

grant select on public.function_rooms, public.room_bookings,
                public.booking_payments, public.booking_emails
  to anon, authenticated, service_role;

comment on view public.function_rooms   is 'Read-only compatibility view over public.resources (P1.6 cutover). Writers must use resources.';
comment on view public.room_bookings    is 'Read-only compatibility view over public.bookings (P1.6 cutover). Writers must use bookings.';
comment on view public.booking_payments is 'Read-only compatibility view over public.payments (P1.6 cutover). Writers must use payments.';
comment on view public.booking_emails   is 'Read-only compatibility view over public.booking_comms (P1.6 cutover). Writers must use booking_comms.';

-- 3. Re-point the sync + reconcile at the *_legacy tables ---------------------
-- Bodies identical to 20260823110000 except the four table names.
create or replace function public.migrate_room_bookings()
  returns table (
    resources_upserted  integer,
    bookings_upserted   integer,
    bookings_removed    integer,
    payments_upserted   integer,
    comms_upserted      integer
  )
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_resources integer := 0;
  v_bookings  integer := 0;
  v_removed   integer := 0;
  v_payments  integer := 0;
  v_comms     integer := 0;
  v_bad       text;
begin
  -- Refuse to guess at a status/payment_status value the enums do not hold.
  select string_agg(distinct status, ', ') into v_bad
  from public.room_bookings_legacy
  where status not in ('enquiry', 'quoted', 'pending', 'confirmed', 'cancelled');
  if v_bad is not null then
    raise exception 'migrate_room_bookings: unmapped room_bookings.status value(s): %', v_bad
      using errcode = 'P0001';
  end if;
  select string_agg(distinct payment_status, ', ') into v_bad
  from public.room_bookings_legacy
  where payment_status not in ('unpaid', 'deposit_paid', 'paid');
  if v_bad is not null then
    raise exception 'migrate_room_bookings: unmapped room_bookings.payment_status value(s): %', v_bad
      using errcode = 'P0001';
  end if;

  -- resources ← function_rooms
  insert into public.resources as r (
    type, name, description, information, capacity, active, sort_order, amenities,
    price_pence_per_hour, price_pence_half_day, price_pence_full_day, price_pence_fixed,
    standard_price_pence, standard_hours, extra_hour_pence, price_note, extras_config,
    legacy_function_room_id, created_at
  )
  select
    'function_room', fr.name, fr.description, fr.information, fr.capacity, fr.active, fr.sort_order, fr.resources,
    fr.price_pence_per_hour, fr.price_pence_half_day, fr.price_pence_full_day, fr.price_pence_fixed,
    fr.standard_price_pence, fr.standard_hours, fr.extra_hour_pence, fr.price_note, fr.extras_config,
    fr.id, fr.created_at
  from public.function_rooms_legacy fr
  on conflict (legacy_function_room_id) do update set
    name = excluded.name, description = excluded.description, information = excluded.information,
    capacity = excluded.capacity, active = excluded.active, sort_order = excluded.sort_order,
    amenities = excluded.amenities,
    price_pence_per_hour = excluded.price_pence_per_hour, price_pence_half_day = excluded.price_pence_half_day,
    price_pence_full_day = excluded.price_pence_full_day, price_pence_fixed = excluded.price_pence_fixed,
    standard_price_pence = excluded.standard_price_pence, standard_hours = excluded.standard_hours,
    extra_hour_pence = excluded.extra_hour_pence, price_note = excluded.price_note,
    extras_config = excluded.extras_config;
  get diagnostics v_resources = row_count;

  -- bookings ← room_bookings
  insert into public.bookings as b (
    resource_id, kind, status, starts_at, ends_at,
    booker_person_id, booker_profile_id, booker_name, booker_first_name, booker_last_name,
    booker_email, booker_phone, occasion, estimated_guests, notes, internal_notes, confirmation_note,
    total_pence, base_hire_pence, extras_total_pence, member_discount_pence, selected_extras,
    deposit_pence, deposit_due_date, balance_due_date,
    security_deposit_pence, security_deposit_returned_at, security_deposit_returned_method, security_deposit_returned_note,
    payment_status, payment_received_at, payment_received_by, payment_method, payment_reference,
    stripe_checkout_id, stripe_ref, deposit_terms_accepted_at,
    is_member, membership_type, member_number, team_name, child_name, child_team,
    deposit_reminder_sent_at, balance_reminder_sent_at, cancellation_warning_sent_at,
    security_deposit_nudge_sent_at, quote_followup_sent_at, thank_you_sent_at,
    calendar_event_id, recurrence_group_id, anonymised_at,
    legacy_room_booking_id, created_at, updated_at
  )
  select
    r.id,
    case when rb.booking_type = 'block' then 'block' else 'hire' end::public.booking_kind,
    rb.status::public.booking_status,
    (rb.date + rb.start_time) at time zone 'Europe/London',
    (rb.date + rb.end_time
       + case when rb.end_time < rb.start_time then interval '1 day' else interval '0' end)
       at time zone 'Europe/London',
    p.person_id, rb.booker_profile_id,
    -- booker_name is NOT NULL on both sides; guard the blank-name check anyway.
    case when btrim(coalesce(rb.booker_name, '')) = '' then '(unknown)' else rb.booker_name end,
    rb.booker_first_name, rb.booker_last_name,
    case when btrim(coalesce(rb.booker_email, '')) = '' then '—' else rb.booker_email end,
    rb.booker_phone, rb.occasion, rb.estimated_guests, rb.notes, rb.internal_notes, rb.confirmation_note,
    rb.total_pence, rb.base_hire_pence, rb.extras_total_pence, rb.member_discount_pence, rb.selected_extras,
    rb.deposit_pence, rb.deposit_due_date, rb.balance_due_date,
    rb.security_deposit_pence, rb.security_deposit_returned_at, rb.security_deposit_returned_method, rb.security_deposit_returned_note,
    rb.payment_status::public.payment_status, rb.payment_received_at, rb.payment_received_by, rb.payment_method, rb.payment_reference,
    rb.stripe_checkout_id, rb.stripe_ref, rb.deposit_terms_accepted_at,
    rb.is_member, rb.membership_type, rb.member_number, rb.team_name, rb.child_name, rb.child_team,
    rb.deposit_reminder_sent_at, rb.balance_reminder_sent_at, rb.cancellation_warning_sent_at,
    rb.security_deposit_nudge_sent_at, rb.quote_followup_sent_at, rb.thank_you_sent_at,
    rb.calendar_event_id, rb.recurrence_group_id, rb.anonymised_at,
    rb.id, rb.created_at, rb.updated_at
  from public.room_bookings_legacy rb
  join public.resources r on r.legacy_function_room_id = rb.room_id
  left join public.profiles p on p.id = rb.booker_profile_id
  on conflict (legacy_room_booking_id) do update set
    resource_id = excluded.resource_id, kind = excluded.kind, status = excluded.status,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    booker_person_id = excluded.booker_person_id, booker_profile_id = excluded.booker_profile_id,
    booker_name = excluded.booker_name, booker_first_name = excluded.booker_first_name,
    booker_last_name = excluded.booker_last_name, booker_email = excluded.booker_email,
    booker_phone = excluded.booker_phone, occasion = excluded.occasion,
    estimated_guests = excluded.estimated_guests, notes = excluded.notes,
    internal_notes = excluded.internal_notes, confirmation_note = excluded.confirmation_note,
    total_pence = excluded.total_pence, base_hire_pence = excluded.base_hire_pence,
    extras_total_pence = excluded.extras_total_pence, member_discount_pence = excluded.member_discount_pence,
    selected_extras = excluded.selected_extras, deposit_pence = excluded.deposit_pence,
    deposit_due_date = excluded.deposit_due_date, balance_due_date = excluded.balance_due_date,
    security_deposit_pence = excluded.security_deposit_pence,
    security_deposit_returned_at = excluded.security_deposit_returned_at,
    security_deposit_returned_method = excluded.security_deposit_returned_method,
    security_deposit_returned_note = excluded.security_deposit_returned_note,
    payment_status = excluded.payment_status, payment_received_at = excluded.payment_received_at,
    payment_received_by = excluded.payment_received_by, payment_method = excluded.payment_method,
    payment_reference = excluded.payment_reference, stripe_checkout_id = excluded.stripe_checkout_id,
    stripe_ref = excluded.stripe_ref, deposit_terms_accepted_at = excluded.deposit_terms_accepted_at,
    is_member = excluded.is_member, membership_type = excluded.membership_type,
    member_number = excluded.member_number, team_name = excluded.team_name,
    child_name = excluded.child_name, child_team = excluded.child_team,
    deposit_reminder_sent_at = excluded.deposit_reminder_sent_at,
    balance_reminder_sent_at = excluded.balance_reminder_sent_at,
    cancellation_warning_sent_at = excluded.cancellation_warning_sent_at,
    security_deposit_nudge_sent_at = excluded.security_deposit_nudge_sent_at,
    quote_followup_sent_at = excluded.quote_followup_sent_at, thank_you_sent_at = excluded.thank_you_sent_at,
    calendar_event_id = excluded.calendar_event_id, recurrence_group_id = excluded.recurrence_group_id,
    anonymised_at = excluded.anonymised_at, updated_at = excluded.updated_at;
  get diagnostics v_bookings = row_count;

  -- Legacy hard-deletes (the staff app deletes cancelled enquiries): remove the
  -- unified copy. payments/booking_comms cascade.
  delete from public.bookings b
  where b.legacy_room_booking_id is not null
    and not exists (select 1 from public.room_bookings_legacy rb where rb.id = b.legacy_room_booking_id);
  get diagnostics v_removed = row_count;

  -- payments ← booking_payments
  insert into public.payments as p (
    booking_id, amount_pence, paid_at, method, reference, source,
    sumup_checkout_id, sumup_txn_code, authorised_by_profile, authorised_by_name, authorised_by_email,
    note, legacy_booking_payment_id, created_at
  )
  select
    b.id, bp.amount_pence, bp.paid_at, bp.method, bp.reference, bp.source,
    bp.sumup_checkout_id, bp.sumup_txn_code, bp.authorised_by_profile, bp.authorised_by_name, bp.authorised_by_email,
    bp.note, bp.id, bp.created_at
  from public.booking_payments_legacy bp
  join public.bookings b on b.legacy_room_booking_id = bp.booking_id
  on conflict (legacy_booking_payment_id) do update set
    booking_id = excluded.booking_id, amount_pence = excluded.amount_pence, paid_at = excluded.paid_at,
    method = excluded.method, reference = excluded.reference, source = excluded.source,
    sumup_checkout_id = excluded.sumup_checkout_id, sumup_txn_code = excluded.sumup_txn_code,
    authorised_by_profile = excluded.authorised_by_profile, authorised_by_name = excluded.authorised_by_name,
    authorised_by_email = excluded.authorised_by_email, note = excluded.note;
  get diagnostics v_payments = row_count;

  delete from public.payments p
  where p.legacy_booking_payment_id is not null
    and not exists (select 1 from public.booking_payments_legacy bp where bp.id = p.legacy_booking_payment_id);

  -- booking_comms ← booking_emails
  insert into public.booking_comms as c (
    booking_id, kind, channel, to_address, cc, subject, body, sent_by, sent_by_name, sent_at,
    legacy_booking_email_id
  )
  select
    b.id, be.kind, 'email', be.to_email, be.cc, be.subject, be.body, be.sent_by, be.sent_by_name, be.sent_at,
    be.id
  from public.booking_emails_legacy be
  join public.bookings b on b.legacy_room_booking_id = be.booking_id
  on conflict (legacy_booking_email_id) do update set
    booking_id = excluded.booking_id, kind = excluded.kind, to_address = excluded.to_address,
    cc = excluded.cc, subject = excluded.subject, body = excluded.body,
    sent_by = excluded.sent_by, sent_by_name = excluded.sent_by_name, sent_at = excluded.sent_at;
  get diagnostics v_comms = row_count;

  delete from public.booking_comms c
  where c.legacy_booking_email_id is not null
    and not exists (select 1 from public.booking_emails_legacy be where be.id = c.legacy_booking_email_id);

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), 'migration', 'migration.backfill', 'bookings', null,
          jsonb_build_object(
            'migration', '20260823110000_migrate_room_data',
            'resources_upserted', v_resources,
            'bookings_upserted', v_bookings,
            'bookings_removed', v_removed,
            'payments_upserted', v_payments,
            'comms_upserted', v_comms));

  return query select v_resources, v_bookings, v_removed, v_payments, v_comms;
end;
$$;

comment on function public.migrate_room_bookings() is
  'Idempotent *_legacy→unified sync for the function-room data (P1.6). After cutover reads the frozen *_legacy tables. service_role only.';

create or replace function public.reconcile_room_bookings()
  returns table ("check" text, legacy bigint, unified bigint, ok boolean)
  language sql
  stable
  security definer
  set search_path = public
as $$
  with checks as (
    select 'function_rooms → resources' as c,
           (select count(*) from public.function_rooms_legacy) as l,
           (select count(*) from public.resources where legacy_function_room_id is not null) as u
    union all
    select 'room_bookings → bookings',
           (select count(*) from public.room_bookings_legacy),
           (select count(*) from public.bookings where legacy_room_booking_id is not null)
    union all
    select 'booking_payments → payments',
           (select count(*) from public.booking_payments_legacy),
           (select count(*) from public.payments where legacy_booking_payment_id is not null)
    union all
    select 'booking_emails → booking_comms',
           (select count(*) from public.booking_emails_legacy),
           (select count(*) from public.booking_comms where legacy_booking_email_id is not null)
    union all
    select 'sum(payments.amount_pence)',
           (select coalesce(sum(amount_pence), 0) from public.booking_payments_legacy),
           (select coalesce(sum(amount_pence), 0) from public.payments where legacy_booking_payment_id is not null)
    union all
    select 'sum(bookings.total_pence)',
           (select coalesce(sum(total_pence), 0) from public.room_bookings_legacy),
           (select coalesce(sum(total_pence), 0) from public.bookings where legacy_room_booking_id is not null)
    union all
    select 'bookings status=' || s,
           (select count(*) from public.room_bookings_legacy where status = s),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and status::text = s)
    from unnest(array['enquiry', 'quoted', 'pending', 'confirmed', 'cancelled']) s
    union all
    select 'bookings payment_status=' || s,
           (select count(*) from public.room_bookings_legacy where payment_status = s),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and payment_status::text = s)
    from unnest(array['unpaid', 'deposit_paid', 'paid']) s
    union all
    select 'bookings kind=block',
           (select count(*) from public.room_bookings_legacy where booking_type = 'block'),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and kind = 'block')
    union all
    select 'payments linked to the same booking',
           (select count(*) from public.booking_payments_legacy),
           (select count(*) from public.payments p
              join public.bookings b on b.id = p.booking_id
              join public.booking_payments_legacy bp on bp.id = p.legacy_booking_payment_id
             where bp.booking_id = b.legacy_room_booking_id)
    union all
    select 'comms linked to the same booking',
           (select count(*) from public.booking_emails_legacy),
           (select count(*) from public.booking_comms c
              join public.bookings b on b.id = c.booking_id
              join public.booking_emails_legacy be on be.id = c.legacy_booking_email_id
             where be.booking_id = b.legacy_room_booking_id)
    union all
    select 'bookings with booker_profile_id carry that profile''s person',
           (select count(*) from public.room_bookings_legacy where booker_profile_id is not null),
           (select count(*) from public.bookings b
              join public.profiles p on p.id = b.booker_profile_id
             where b.legacy_room_booking_id is not null and b.booker_person_id = p.person_id)
    union all
    select 'local date/time round-trips (Europe/London)',
           (select count(*) from public.room_bookings_legacy),
           (select count(*) from public.bookings b
              join public.room_bookings_legacy rb on rb.id = b.legacy_room_booking_id
             where (b.starts_at at time zone 'Europe/London')::date = rb.date
               and (b.starts_at at time zone 'Europe/London')::time = rb.start_time
               and (b.ends_at   at time zone 'Europe/London')::time = rb.end_time
               and (b.ends_at   at time zone 'Europe/London')::date
                   = rb.date + case when rb.end_time < rb.start_time then 1 else 0 end)
    union all
    select 'overnight bookings',
           (select count(*) from public.room_bookings_legacy where end_time < start_time),
           (select count(*) from public.bookings b
              join public.room_bookings_legacy rb on rb.id = b.legacy_room_booking_id
             where (b.ends_at at time zone 'Europe/London')::date > (b.starts_at at time zone 'Europe/London')::date)
  )
  select c, l, u, l = u from checks;
$$;

comment on function public.reconcile_room_bookings() is
  'Reconciles the frozen *_legacy tables against the unified copy (P1.6). Every row must be ok. service_role only.';

-- 4. Audit --------------------------------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.cutover', 'bookings',
        jsonb_build_object('migration', '20260824100000_legacy_room_tables_to_views',
                           'renamed', array['room_bookings','booking_payments','booking_emails','function_rooms']));
