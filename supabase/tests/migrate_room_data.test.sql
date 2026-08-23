-- =============================================================================
-- P1.6 — migrate_room_bookings(), reconcile_room_bookings(), booking_comms,
--        SG-2 on audit_log, write_audit()
-- =============================================================================
-- What this suite covers, and where:
--   A  SG-2 on audit_log — no delete, no truncate, at every layer incl. owner
--   B  write_audit() — attribution from auth.uid(), anon excluded
--   C  booking_comms shape and RLS
--   D  the sync — seeded legacy rows land in the unified tables with the
--      documented conversions (Europe/London, overnight, block kind, person
--      link), reconcile all-ok, idempotent re-run, legacy edit propagates,
--      legacy hard-delete propagates (cascade), one audit row per run,
--      unmapped status refused, native rows untouched
--   E  privileges on the two functions
--
-- Counts are data-independent: deltas are measured against values captured
-- by the owner before each step, so the suite passes on a prod-shaped branch
-- where the migration has already copied the real rows.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(62);

-- ---------------------------------------------------------------------------
-- A. SG-2 on audit_log
-- ---------------------------------------------------------------------------
select trigger_is('public', 'audit_log', 'trg_audit_log_deny_hard_delete', 'public', 'deny_hard_delete',
  'audit_log has the delete guard');
select trigger_is('public', 'audit_log', 'trg_audit_log_deny_truncate', 'public', 'deny_truncate',
  'audit_log has the truncate guard');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'DELETE'),   'service_role cannot DELETE audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE'), 'service_role cannot TRUNCATE audit_log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),  'authenticated cannot DELETE audit_log');
select ok(not has_table_privilege('anon', 'public.audit_log', 'DELETE'),           'anon cannot DELETE audit_log');

insert into public.audit_log (action, entity) values ('test.row', 'test');
select throws_ok($$delete from public.audit_log where entity = 'test'$$, 'P0001', null,
  'owner cannot hard-delete an audit row (trigger, not grant)');
select throws_ok($$truncate public.audit_log$$, 'P0001', null,
  'owner cannot truncate audit_log');
set local role service_role;
select throws_ok($$delete from public.audit_log where entity = 'test'$$, '42501', null,
  'service_role delete refused at the privilege layer');
reset role;

-- ---------------------------------------------------------------------------
-- B. write_audit()
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b6b6b6b6-1111-4111-8111-000000000001', 'm-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('b6b6b6b6-1111-4111-8111-000000000002', 'm-staff@test.invalid',  '{"full_name": "Stu Staff"}'::jsonb),
  ('b6b6b6b6-1111-4111-8111-000000000003', 'm-member@test.invalid', '{"full_name": "Mo Member"}'::jsonb),
  ('b6b6b6b6-1111-4111-8111-000000000004', 'm-booker@test.invalid', '{"full_name": "Bea Booker"}'::jsonb);
update public.profiles set role = 'committee' where id = 'b6b6b6b6-1111-4111-8111-000000000001';
update public.profiles set role = 'bar'       where id = 'b6b6b6b6-1111-4111-8111-000000000002';

select ok(not has_function_privilege('anon', 'public.write_audit(text, text, text, jsonb)', 'EXECUTE'),
  'anon cannot execute write_audit');

set local request.jwt.claims to '{"sub":"b6b6b6b6-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select set_config('test.audit_id', public.write_audit('test.action', 'test', 'e1', '{"k":1}'::jsonb)::text, true);
reset role;
select is(
  (select (actor_id::text, actor_email, action, entity, entity_id, detail::text)
     from public.audit_log where id = current_setting('test.audit_id')::bigint),
  ('b6b6b6b6-1111-4111-8111-000000000003'::text, 'm-member@test.invalid'::text, 'test.action'::text, 'test'::text, 'e1'::text, '{"k": 1}'::text),
  'write_audit attributes the row to the caller from auth.uid()');
select throws_ok($$select public.write_audit('', 'x')$$, '22023', null, 'write_audit refuses a blank action');
select throws_ok($$select public.write_audit('x', null)$$, '22023', null, 'write_audit refuses a null entity');

-- ---------------------------------------------------------------------------
-- C. booking_comms
-- ---------------------------------------------------------------------------
select has_table('public', 'booking_comms', 'booking_comms exists');
select ok((select relrowsecurity from pg_class where oid = 'public.booking_comms'::regclass), 'RLS on booking_comms');
select policies_are('public', 'booking_comms',
  array['booking_comms_staff_read', 'booking_comms_staff_insert', 'booking_comms_booker_read'],
  'booking_comms policy list');
select ok(not has_table_privilege('anon', 'public.booking_comms', 'SELECT'), 'anon cannot read booking_comms');
select ok(not has_table_privilege('authenticated', 'public.booking_comms', 'DELETE'), 'authenticated cannot delete booking_comms');

-- ---------------------------------------------------------------------------
-- D. The sync
-- ---------------------------------------------------------------------------
-- Baseline counts before seeding (prod-shaped branches already hold rows).
select set_config('test.res0',   (select count(*)::text from public.resources), true);
select set_config('test.bk0',    (select count(*)::text from public.bookings), true);
select set_config('test.pay0',   (select count(*)::text from public.payments), true);
select set_config('test.comm0',  (select count(*)::text from public.booking_comms), true);
select set_config('test.audit0', (select count(*)::text from public.audit_log
                                   where action = 'migration.backfill' and entity = 'bookings'), true);

-- A native unified row that the sync must never touch.
insert into public.resources (id, type, name) values ('c6c6c6c6-1111-4111-8111-000000000009', 'pitch', 'Native Pitch');
insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_name, booker_email)
values ('d6d6d6d6-1111-4111-8111-000000000009', 'c6c6c6c6-1111-4111-8111-000000000009', 'confirmed',
        '2031-01-01 10:00+00', '2031-01-01 12:00+00', 'Native', 'n@test.invalid');

-- Legacy fixtures: one room, three bookings (summer-time, winter-time,
-- overnight block), one payment, one email.
insert into public.function_rooms_legacy (id, name, description, capacity, resources, price_pence_per_hour, active, sort_order)
values ('f6f6f6f6-1111-4111-8111-000000000001', 'Legacy Lounge', 'The lounge', 80, array['bar','stage'], 2500, true, 5);

insert into public.room_bookings_legacy (id, room_id, date, start_time, end_time, booker_name, booker_email, booker_phone,
                                  occasion, status, payment_status, booker_profile_id, total_pence, deposit_pence,
                                  booking_type, internal_notes)
values
  -- BST: 2030-07-06 19:00–23:00 London = 18:00–22:00 UTC
  ('a6a6a6a6-1111-4111-8111-000000000001', 'f6f6f6f6-1111-4111-8111-000000000001', '2030-07-06', '19:00', '23:00',
   'Bea Booker', 'm-booker@test.invalid', '0700', 'Party', 'confirmed', 'deposit_paid',
   'b6b6b6b6-1111-4111-8111-000000000004', 20000, 5000, 'hire', null),
  -- GMT: 2030-12-06 10:00–12:00 London = 10:00–12:00 UTC
  ('a6a6a6a6-1111-4111-8111-000000000002', 'f6f6f6f6-1111-4111-8111-000000000001', '2030-12-06', '10:00', '12:00',
   'Walk In', 'walkin@test.invalid', null, 'Meeting', 'quoted', 'unpaid', null, 8000, null, 'hire', 'quote sent'),
  -- overnight block booking: 2030-12-31 22:00 → 02:00 next day
  ('a6a6a6a6-1111-4111-8111-000000000003', 'f6f6f6f6-1111-4111-8111-000000000001', '2030-12-31', '22:00', '02:00',
   'Club', '—', null, 'NYE', 'confirmed', 'unpaid', null, null, null, 'block', null);

insert into public.booking_payments_legacy (id, booking_id, amount_pence, method, source, note)
values ('e6e6e6e6-1111-4111-8111-000000000001', 'a6a6a6a6-1111-4111-8111-000000000001', 5000, 'sumup', 'sumup', 'deposit');

insert into public.booking_emails_legacy (id, booking_id, kind, to_email, subject, body, sent_by_name)
values ('e6e6e6e6-1111-4111-8111-000000000002', 'a6a6a6a6-1111-4111-8111-000000000001', 'confirmation',
        'm-booker@test.invalid', 'Confirmed', 'See you there', 'Ada Admin');

-- Run 1
select results_eq(
  $$select resources_upserted, bookings_upserted, bookings_removed, payments_upserted, comms_upserted
      from public.migrate_room_bookings()$$,
  $$select (select count(*)::int from public.function_rooms_legacy),
           (select count(*)::int from public.room_bookings_legacy),
           0,
           (select count(*)::int from public.booking_payments_legacy),
           (select count(*)::int from public.booking_emails_legacy)$$,
  'run 1 upserts every legacy row (seeded + any pre-existing), removes none');

select is((select count(*) from public.resources), current_setting('test.res0')::bigint + 2,
  'one legacy room landed beside the native pitch');
select is((select count(*) from public.bookings), current_setting('test.bk0')::bigint + 4,
  'three legacy bookings landed beside the native booking');
select is((select count(*) from public.payments), current_setting('test.pay0')::bigint + 1, 'one payment landed');
select is((select count(*) from public.booking_comms), current_setting('test.comm0')::bigint + 1, 'one comm landed');

-- Resource mapping
select is(
  (select (type::text, name, capacity, amenities, price_pence_per_hour, active, sort_order)
     from public.resources where legacy_function_room_id = 'f6f6f6f6-1111-4111-8111-000000000001'),
  ('function_room'::text, 'Legacy Lounge'::text, 80, array['bar','stage']::text[], 2500, true, 5),
  'function_rooms row mapped column for column (resources → amenities)');

-- Booking 1: BST conversion, person link, enums, money
select is(
  (select (starts_at, ends_at, kind::text, status::text, payment_status::text, booker_person_id, booker_profile_id,
           total_pence, deposit_pence, booker_phone)
     from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000001'),
  ('2030-07-06 18:00+00'::timestamptz, '2030-07-06 22:00+00'::timestamptz, 'hire'::text, 'confirmed'::text, 'deposit_paid'::text,
   (select person_id from public.profiles where id = 'b6b6b6b6-1111-4111-8111-000000000004'),
   'b6b6b6b6-1111-4111-8111-000000000004'::uuid, 20000, 5000, '0700'::text),
  'summer-time booking: Europe/London 19:00 → 18:00 UTC, booker_person_id from the profile');

-- Booking 2: GMT conversion, no person
select is(
  (select (starts_at, ends_at, status::text, booker_person_id, internal_notes)
     from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000002'),
  ('2030-12-06 10:00+00'::timestamptz, '2030-12-06 12:00+00'::timestamptz, 'quoted'::text, null::uuid, 'quote sent'::text),
  'winter-time booking: Europe/London 10:00 = 10:00 UTC, no person for a walk-in');

-- Booking 3: overnight + block kind
select is(
  (select (starts_at, ends_at, kind::text)
     from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000003'),
  ('2030-12-31 22:00+00'::timestamptz, '2031-01-01 02:00+00'::timestamptz, 'block'::text),
  'overnight block booking ends the next day and is kind=block');

-- Linkage
select is(
  (select (p.amount_pence, p.source, b.legacy_room_booking_id)
     from public.payments p join public.bookings b on b.id = p.booking_id
    where p.legacy_booking_payment_id = 'e6e6e6e6-1111-4111-8111-000000000001'),
  (5000, 'sumup'::text, 'a6a6a6a6-1111-4111-8111-000000000001'::uuid),
  'payment re-pointed at the unified booking');
select is(
  (select (c.kind, c.channel, c.to_address, c.subject, b.legacy_room_booking_id)
     from public.booking_comms c join public.bookings b on b.id = c.booking_id
    where c.legacy_booking_email_id = 'e6e6e6e6-1111-4111-8111-000000000002'),
  ('confirmation'::text, 'email'::text, 'm-booker@test.invalid'::text, 'Confirmed'::text, 'a6a6a6a6-1111-4111-8111-000000000001'::uuid),
  'email re-pointed at the unified booking as an email comm');

-- Reconciliation: every check ok
select is((select count(*) from public.reconcile_room_bookings() where not ok), 0::bigint,
  'reconcile_room_bookings(): every check ok after run 1');
select ok((select count(*) from public.reconcile_room_bookings()) >= 18,
  'reconcile_room_bookings() has the full check list');

-- Audit: exactly one summary row per run
select is(
  (select count(*) from public.audit_log where action = 'migration.backfill' and entity = 'bookings'),
  current_setting('test.audit0')::bigint + 1, 'run 1 wrote one migration.backfill audit row');
select is(
  (select detail->>'migration' from public.audit_log
    where action = 'migration.backfill' and entity = 'bookings' order by id desc limit 1),
  '20260823110000_migrate_room_data', 'the audit row names the migration');

-- Run 2: idempotent
select set_config('test.bk1', (select count(*)::text from public.bookings), true);
select set_config('test.bk1_ids', (select string_agg(id::text, ',' order by id) from public.bookings), true);
select lives_ok($$select public.migrate_room_bookings()$$, 'run 2 succeeds');
select is((select count(*) from public.bookings), current_setting('test.bk1')::bigint, 'run 2 adds no bookings');
select is((select string_agg(id::text, ',' order by id) from public.bookings), current_setting('test.bk1_ids'),
  'run 2 keeps every unified id stable (upsert, not replace)');
select is((select count(*) from public.payments), current_setting('test.pay0')::bigint + 1, 'run 2 adds no payments');
select is((select count(*) from public.booking_comms), current_setting('test.comm0')::bigint + 1, 'run 2 adds no comms');
select is((select count(*) from public.resources), current_setting('test.res0')::bigint + 2, 'run 2 adds no resources');
select is(
  (select count(*) from public.audit_log where action = 'migration.backfill' and entity = 'bookings'),
  current_setting('test.audit0')::bigint + 2, 'run 2 wrote its own audit row');

-- Legacy edit propagates
update public.room_bookings_legacy set status = 'cancelled', end_time = '22:00'
 where id = 'a6a6a6a6-1111-4111-8111-000000000001';
update public.function_rooms_legacy set name = 'Renamed Lounge' where id = 'f6f6f6f6-1111-4111-8111-000000000001';
select lives_ok($$select public.migrate_room_bookings()$$, 'run 3 succeeds');
select is(
  (select (status::text, ends_at) from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000001'),
  ('cancelled'::text, '2030-07-06 21:00+00'::timestamptz), 'a legacy status/time edit is carried into the unified row');
select is((select name from public.resources where legacy_function_room_id = 'f6f6f6f6-1111-4111-8111-000000000001'),
  'Renamed Lounge', 'a legacy room rename is carried');

-- Legacy hard-delete propagates, with cascade
delete from public.room_bookings_legacy where id = 'a6a6a6a6-1111-4111-8111-000000000001';
select results_eq(
  $$select bookings_removed from public.migrate_room_bookings()$$,
  $$values (1)$$, 'run 4 reports the removed booking');
select is((select count(*) from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000001'),
  0::bigint, 'unified copy of a hard-deleted legacy booking is gone');
select is((select count(*) from public.payments where legacy_booking_payment_id = 'e6e6e6e6-1111-4111-8111-000000000001'),
  0::bigint, 'its payment cascaded');
select is((select count(*) from public.booking_comms where legacy_booking_email_id = 'e6e6e6e6-1111-4111-8111-000000000002'),
  0::bigint, 'its comm cascaded');
select is((select count(*) from public.reconcile_room_bookings() where not ok), 0::bigint,
  'reconcile still all ok after the delete');

-- Native rows untouched throughout
select is(
  (select (name, type::text) from public.resources where id = 'c6c6c6c6-1111-4111-8111-000000000009'),
  ('Native Pitch'::text, 'pitch'::text), 'native resource untouched');
select ok(exists (select 1 from public.bookings where id = 'd6d6d6d6-1111-4111-8111-000000000009'),
  'native booking untouched');

-- Unmapped status refused, nothing written
insert into public.room_bookings_legacy (id, room_id, date, start_time, end_time, booker_name, booker_email, status)
values ('a6a6a6a6-1111-4111-8111-000000000099', 'f6f6f6f6-1111-4111-8111-000000000001', '2030-01-01', '10:00', '11:00',
        'Bad', 'bad@test.invalid', 'archived');
select throws_ok($$select public.migrate_room_bookings()$$, 'P0001', null,
  'an unmapped legacy status aborts the sync');
select is((select count(*) from public.bookings where legacy_room_booking_id = 'a6a6a6a6-1111-4111-8111-000000000099'),
  0::bigint, 'nothing was written for the bad row');
delete from public.room_bookings_legacy where id = 'a6a6a6a6-1111-4111-8111-000000000099';

-- After 20260824100000 the old names are read-only views (see legacy_views.test.sql)
select is((select relkind from pg_class where oid = 'public.room_bookings_legacy'::regclass), 'r',
  'room_bookings_legacy is a table after the cutover rename');
select is((select relkind from pg_class where oid = 'public.function_rooms_legacy'::regclass), 'r',
  'function_rooms_legacy is a table after the cutover rename');

-- ---------------------------------------------------------------------------
-- E. Privileges on the two functions
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.migrate_room_bookings()', 'EXECUTE'),
  'anon cannot execute migrate_room_bookings');
select ok(not has_function_privilege('authenticated', 'public.migrate_room_bookings()', 'EXECUTE'),
  'authenticated cannot execute migrate_room_bookings');
select ok(has_function_privilege('service_role', 'public.migrate_room_bookings()', 'EXECUTE'),
  'service_role can execute migrate_room_bookings');
select ok(not has_function_privilege('authenticated', 'public.reconcile_room_bookings()', 'EXECUTE'),
  'authenticated cannot execute reconcile_room_bookings');
select ok(has_function_privilege('service_role', 'public.reconcile_room_bookings()', 'EXECUTE'),
  'service_role can execute reconcile_room_bookings');

-- RLS on booking_comms, with a live comm
insert into public.booking_comms (booking_id, kind, to_address, subject)
values ('d6d6d6d6-1111-4111-8111-000000000009', 'manual', 'x@test.invalid', 'Hi');
select set_config('test.comms_all', (select count(*)::text from public.booking_comms), true);

set local request.jwt.claims to '{"sub":"b6b6b6b6-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.booking_comms), current_setting('test.comms_all')::bigint,
  'staff reads every comm');
select lives_ok(
  $$insert into public.booking_comms (booking_id, kind, to_address, subject)
    values ('d6d6d6d6-1111-4111-8111-000000000009', 'manual', 'y@test.invalid', 'Staff')$$,
  'staff can log a comm');
reset role;
set local request.jwt.claims to '{"sub":"b6b6b6b6-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.booking_comms), 0::bigint, 'member sees no comms');
reset role;

select * from finish();

rollback;
