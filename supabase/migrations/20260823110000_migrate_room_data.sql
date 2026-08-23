-- =============================================================================
-- P1.6 — function-room data → unified tables; booking_comms; audit_log guard
-- =============================================================================
-- PLAN.md task P1.6 ("Migrate function_rooms/room_bookings/booking_payments/
-- booking_emails data into the unified structure; keep legacy tables as
-- read-only views or renamed _legacy"; acceptance: "Row counts reconcile; web
-- app reads/writes unified tables; audit_log records migration"). Linear TH1-15.
--
-- PURPOSE
--   Copy every legacy function-room row into P1.5's `resources` / `bookings` /
--   `payments` and the new `booking_comms`, through ONE idempotent function
--   that can be re-run at cutover. The live site still deploys from the old
--   repo and writes to the legacy tables (P0.4's Vercel repoint is deferred),
--   so this migration copies and reconciles but does NOT rename or replace the
--   legacy tables. That is the cutover step, which runs when the Vercel repoint
--   happens: re-run `migrate_room_bookings()` under a write freeze, assert
--   `reconcile_room_bookings()`, then apply the rename-to-`_legacy` + views
--   migration kept in docs/runbooks/P1.6-cutover.md. Until then the unified
--   copy can drift behind legacy; nothing reads the unified copy in production
--   until apps/web is the deployed site.
--
-- WHAT THIS FILE DOES, IN ORDER
--   1. SG-2 on `public.audit_log` (SAFEGUARDING §4 "Audit (Phase 1 review)"):
--      `deny_hard_delete()` + `deny_truncate()`, DELETE/TRUNCATE revoked from
--      anon/authenticated/service_role. The table is already append-only in
--      practice; this makes it so at every layer including service_role.
--   2. `public.write_audit(action, entity, entity_id, detail)` — the single
--      helper §4 asks for, so `actor_id`/`actor_email` are populated the same
--      way everywhere. SECURITY DEFINER; EXECUTE for authenticated +
--      service_role; anon revoked by name.
--   3. `public.booking_comms` — the generalised `booking_emails` (channel
--      column for P4.4's SMS/push; `to_address` not `to_email`).
--   4. `public.migrate_room_bookings()` — upsert by `legacy_*_id`, delete
--      unified rows whose legacy row has since been hard-deleted, one summary
--      `migration.backfill` audit row per run.
--   5. `public.reconcile_room_bookings()` — row counts, payment sum, status
--      census, linkage, and a time-conversion spot check, as (check, legacy,
--      unified, ok) rows.
--   6. Runs 4 and raises if any row of 5 is not ok, so a failed reconciliation
--      rolls the whole migration back.
--
-- TIME CONVERSION
--   Legacy `date + start_time + end_time` are wall-clock Europe/London. A
--   booking whose `end_time < start_time` ends the next day (the baseline
--   constraint's own rule). `(date + time) at time zone 'Europe/London'` gives
--   the timestamptz. The mapping is monotonic, so every pair of rows that
--   satisfied `room_bookings_no_overlap` satisfies `bookings_no_overlap` —
--   except across the autumn DST fall-back hour, which no prod row straddles
--   (the reconciliation's overlap check would catch one).
--
-- PEOPLE
--   `booker_person_id` is `profiles.person_id` for the 30 rows that carry a
--   `booker_profile_id` (P1.2 gave every profile a person). No `people` row is
--   created for the 10 hirers without a login: a hire contact snapshot is not a
--   member record, and P1.2's rule against matching on email applies with
--   equal force here.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (`booking_comms` new; the
-- `audit_log` policy set unchanged — grants narrowed only); data touched:
-- resources +1, bookings +40, payments +9, booking_comms +32, audit_log +1
-- (prod census 2026-08-23); rollback: §8 of this file.
-- =============================================================================


-- =============================================================================
-- 1. SG-2 ON audit_log
-- =============================================================================

create trigger trg_audit_log_deny_hard_delete
  before delete on public.audit_log
  for each row execute function public.deny_hard_delete();

create trigger trg_audit_log_deny_truncate
  before truncate on public.audit_log
  for each statement execute function public.deny_truncate();

revoke delete, truncate on public.audit_log from anon, authenticated, service_role;


-- =============================================================================
-- 2. write_audit()
-- =============================================================================
-- The actor is whoever is calling, resolved server-side, so a caller cannot
-- attribute a row to someone else. `actor_email` comes from auth.users, which
-- only a definer can read. service_role (no auth.uid()) writes NULL actor —
-- the same as the imported app's writeAudit() with a null actorId.

create or replace function public.write_audit(
  p_action     text,
  p_entity     text,
  p_entity_id  text default null,
  p_detail     jsonb default null
)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    bigint;
begin
  if p_action is null or btrim(p_action) = '' then
    raise exception 'write_audit: action is required' using errcode = '22023';
  end if;
  if p_entity is null or btrim(p_entity) = '' then
    raise exception 'write_audit: entity is required' using errcode = '22023';
  end if;
  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  end if;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (v_uid, v_email, p_action, p_entity, p_entity_id, p_detail)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all privileges on function public.write_audit(text, text, text, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, text, jsonb) to authenticated, service_role;

comment on function public.write_audit(text, text, text, jsonb) is
  'Append one audit_log row attributed to the calling user (SAFEGUARDING §4). Returns the new id.';


-- =============================================================================
-- 3. booking_comms
-- =============================================================================

create table public.booking_comms (
  id                        uuid primary key default gen_random_uuid(),
  booking_id                uuid not null references public.bookings (id) on delete cascade,
  kind                      text not null default 'manual',
  channel                   text not null default 'email'
                            check (channel in ('email', 'sms', 'push', 'in_app')),
  to_address                text not null,
  cc                        text,
  subject                   text not null,
  body                      text,
  sent_by                   uuid references auth.users (id) on delete set null,
  sent_by_name              text,
  sent_at                   timestamptz not null default now(),
  legacy_booking_email_id   uuid unique
);

create index booking_comms_booking_idx on public.booking_comms (booking_id, sent_at desc);

comment on table public.booking_comms is
  'Every outbound message about a booking. Generalised booking_emails; P4.4 routes all channels through it.';

alter table public.booking_comms enable row level security;

-- Legacy: booking_emails_staff_read / booking_emails_staff_insert (is_staff).
create policy "booking_comms_staff_read" on public.booking_comms
  for select
  to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "booking_comms_staff_insert" on public.booking_comms
  for insert
  to authenticated
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

create policy "booking_comms_booker_read" on public.booking_comms
  for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_comms.booking_id
        and b.booker_person_id is not null
        and b.booker_person_id = public.current_person_id()
    )
  );

revoke all privileges on public.booking_comms from anon, authenticated, service_role;
grant select, insert on public.booking_comms to authenticated;
grant select, insert, update, delete on public.booking_comms to service_role;


-- =============================================================================
-- 4. migrate_room_bookings()
-- =============================================================================
-- Idempotent: every target row is keyed on its legacy id; a re-run updates
-- what changed in legacy and removes what legacy has hard-deleted. Only rows
-- that carry a legacy id are ever touched — native unified rows are invisible
-- to this function. SECURITY DEFINER because the cutover re-run is made
-- through service_role/CLI and the function must see every legacy row.

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
  from public.room_bookings
  where status not in ('enquiry', 'quoted', 'pending', 'confirmed', 'cancelled');
  if v_bad is not null then
    raise exception 'migrate_room_bookings: unmapped room_bookings.status value(s): %', v_bad
      using errcode = 'P0001';
  end if;
  select string_agg(distinct payment_status, ', ') into v_bad
  from public.room_bookings
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
  from public.function_rooms fr
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
  from public.room_bookings rb
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
    and not exists (select 1 from public.room_bookings rb where rb.id = b.legacy_room_booking_id);
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
  from public.booking_payments bp
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
    and not exists (select 1 from public.booking_payments bp where bp.id = p.legacy_booking_payment_id);

  -- booking_comms ← booking_emails
  insert into public.booking_comms as c (
    booking_id, kind, channel, to_address, cc, subject, body, sent_by, sent_by_name, sent_at,
    legacy_booking_email_id
  )
  select
    b.id, be.kind, 'email', be.to_email, be.cc, be.subject, be.body, be.sent_by, be.sent_by_name, be.sent_at,
    be.id
  from public.booking_emails be
  join public.bookings b on b.legacy_room_booking_id = be.booking_id
  on conflict (legacy_booking_email_id) do update set
    booking_id = excluded.booking_id, kind = excluded.kind, to_address = excluded.to_address,
    cc = excluded.cc, subject = excluded.subject, body = excluded.body,
    sent_by = excluded.sent_by, sent_by_name = excluded.sent_by_name, sent_at = excluded.sent_at;
  get diagnostics v_comms = row_count;

  delete from public.booking_comms c
  where c.legacy_booking_email_id is not null
    and not exists (select 1 from public.booking_emails be where be.id = c.legacy_booking_email_id);

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

revoke all privileges on function public.migrate_room_bookings() from public, anon, authenticated;
grant execute on function public.migrate_room_bookings() to service_role;

comment on function public.migrate_room_bookings() is
  'Idempotent legacy→unified sync for the function-room data (P1.6). Re-run at cutover under a write freeze. service_role only.';


-- =============================================================================
-- 5. reconcile_room_bookings()
-- =============================================================================

create or replace function public.reconcile_room_bookings()
  returns table ("check" text, legacy bigint, unified bigint, ok boolean)
  language sql
  stable
  security definer
  set search_path = public
as $$
  with checks as (
    select 'function_rooms → resources' as c,
           (select count(*) from public.function_rooms) as l,
           (select count(*) from public.resources where legacy_function_room_id is not null) as u
    union all
    select 'room_bookings → bookings',
           (select count(*) from public.room_bookings),
           (select count(*) from public.bookings where legacy_room_booking_id is not null)
    union all
    select 'booking_payments → payments',
           (select count(*) from public.booking_payments),
           (select count(*) from public.payments where legacy_booking_payment_id is not null)
    union all
    select 'booking_emails → booking_comms',
           (select count(*) from public.booking_emails),
           (select count(*) from public.booking_comms where legacy_booking_email_id is not null)
    union all
    select 'sum(payments.amount_pence)',
           (select coalesce(sum(amount_pence), 0) from public.booking_payments),
           (select coalesce(sum(amount_pence), 0) from public.payments where legacy_booking_payment_id is not null)
    union all
    select 'sum(bookings.total_pence)',
           (select coalesce(sum(total_pence), 0) from public.room_bookings),
           (select coalesce(sum(total_pence), 0) from public.bookings where legacy_room_booking_id is not null)
    union all
    select 'bookings status=' || s,
           (select count(*) from public.room_bookings where status = s),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and status::text = s)
    from unnest(array['enquiry', 'quoted', 'pending', 'confirmed', 'cancelled']) s
    union all
    select 'bookings payment_status=' || s,
           (select count(*) from public.room_bookings where payment_status = s),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and payment_status::text = s)
    from unnest(array['unpaid', 'deposit_paid', 'paid']) s
    union all
    select 'bookings kind=block',
           (select count(*) from public.room_bookings where booking_type = 'block'),
           (select count(*) from public.bookings where legacy_room_booking_id is not null and kind = 'block')
    union all
    select 'payments linked to the same booking',
           (select count(*) from public.booking_payments),
           (select count(*) from public.payments p
              join public.bookings b on b.id = p.booking_id
              join public.booking_payments bp on bp.id = p.legacy_booking_payment_id
             where bp.booking_id = b.legacy_room_booking_id)
    union all
    select 'comms linked to the same booking',
           (select count(*) from public.booking_emails),
           (select count(*) from public.booking_comms c
              join public.bookings b on b.id = c.booking_id
              join public.booking_emails be on be.id = c.legacy_booking_email_id
             where be.booking_id = b.legacy_room_booking_id)
    union all
    select 'bookings with booker_profile_id carry that profile''s person',
           (select count(*) from public.room_bookings where booker_profile_id is not null),
           (select count(*) from public.bookings b
              join public.profiles p on p.id = b.booker_profile_id
             where b.legacy_room_booking_id is not null and b.booker_person_id = p.person_id)
    union all
    select 'local date/time round-trips (Europe/London)',
           (select count(*) from public.room_bookings),
           (select count(*) from public.bookings b
              join public.room_bookings rb on rb.id = b.legacy_room_booking_id
             where (b.starts_at at time zone 'Europe/London')::date = rb.date
               and (b.starts_at at time zone 'Europe/London')::time = rb.start_time
               and (b.ends_at   at time zone 'Europe/London')::time = rb.end_time
               and (b.ends_at   at time zone 'Europe/London')::date
                   = rb.date + case when rb.end_time < rb.start_time then 1 else 0 end)
    union all
    select 'overnight bookings',
           (select count(*) from public.room_bookings where end_time < start_time),
           (select count(*) from public.bookings b
              join public.room_bookings rb on rb.id = b.legacy_room_booking_id
             where (b.ends_at at time zone 'Europe/London')::date > (b.starts_at at time zone 'Europe/London')::date)
  )
  select c, l, u, l = u from checks;
$$;

revoke all privileges on function public.reconcile_room_bookings() from public, anon, authenticated;
grant execute on function public.reconcile_room_bookings() to service_role;

comment on function public.reconcile_room_bookings() is
  'Legacy-vs-unified reconciliation for P1.6: one row per check, ok = counts agree. service_role only.';


-- =============================================================================
-- 6. RUN IT, AND REFUSE TO COMMIT A FAILED RECONCILIATION
-- =============================================================================

do $$
declare
  r record;
  v_failed text;
begin
  perform public.migrate_room_bookings();

  select string_agg(format('%s (legacy %s, unified %s)', "check", legacy, unified), '; ')
    into v_failed
  from public.reconcile_room_bookings()
  where not ok;

  if v_failed is not null then
    raise exception 'P1.6 reconciliation failed: %', v_failed using errcode = 'P0001';
  end if;
end
$$;


-- =============================================================================
-- 7. RELOAD POSTGREST
-- =============================================================================
notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK (documented, not executed)
-- =============================================================================
-- As postgres, one transaction:
--   delete from public.booking_comms where legacy_booking_email_id is not null;
--   delete from public.payments      where legacy_booking_payment_id is not null;
--   delete from public.bookings      where legacy_room_booking_id is not null;
--   delete from public.resources     where legacy_function_room_id is not null;
--   drop table public.booking_comms;
--   drop function public.reconcile_room_bookings();
--   drop function public.migrate_room_bookings();
--   drop function public.write_audit(text, text, text, jsonb);
--   drop trigger trg_audit_log_deny_truncate on public.audit_log;
--   drop trigger trg_audit_log_deny_hard_delete on public.audit_log;
--   grant delete, truncate on public.audit_log to service_role;  -- only if really wanted
-- The migration.backfill audit row stays (append-only). The legacy tables were
-- never modified, so nothing needs restoring.
