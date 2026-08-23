-- =============================================================================
-- P1.6 cutover — 20260824100000_legacy_room_tables_to_views
-- =============================================================================
--   A  the four legacy tables are renamed *_legacy and closed to anon/authenticated
--   B  the old names are views over the unified tables, readable, not writable
--   C  a row synced from *_legacy reads back identically through the view
--      (Europe/London round-trip, overnight, block kind, amount_pence stand-in)
--   D  migrate/reconcile still work against the *_legacy tables; audit row present
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(34);

-- ---------------------------------------------------------------------------
-- A. renamed tables
-- ---------------------------------------------------------------------------
select has_table('public', 'room_bookings_legacy',    'room_bookings_legacy exists');
select has_table('public', 'booking_payments_legacy', 'booking_payments_legacy exists');
select has_table('public', 'booking_emails_legacy',   'booking_emails_legacy exists');
select has_table('public', 'function_rooms_legacy',   'function_rooms_legacy exists');

select ok(not has_table_privilege('anon', 'public.room_bookings_legacy', 'SELECT'),          'anon cannot read room_bookings_legacy');
select ok(not has_table_privilege('authenticated', 'public.room_bookings_legacy', 'SELECT'), 'authenticated cannot read room_bookings_legacy');
select ok(not has_table_privilege('authenticated', 'public.room_bookings_legacy', 'INSERT'), 'authenticated cannot write room_bookings_legacy');
select ok(not has_table_privilege('authenticated', 'public.function_rooms_legacy', 'SELECT'), 'authenticated cannot read function_rooms_legacy');
select ok(has_table_privilege('service_role', 'public.room_bookings_legacy', 'SELECT'),      'service_role keeps SELECT on room_bookings_legacy');

-- ---------------------------------------------------------------------------
-- B. views under the old names
-- ---------------------------------------------------------------------------
select has_view('public', 'room_bookings',    'room_bookings is a view');
select has_view('public', 'booking_payments', 'booking_payments is a view');
select has_view('public', 'booking_emails',   'booking_emails is a view');
select has_view('public', 'function_rooms',   'function_rooms is a view');

select is((select reloptions::text from pg_class where oid = 'public.room_bookings'::regclass),
  '{security_invoker=true}', 'room_bookings view is security_invoker');

select ok(has_table_privilege('anon', 'public.function_rooms', 'SELECT'),  'anon can read the function_rooms view');
select ok(has_table_privilege('authenticated', 'public.room_bookings', 'SELECT'), 'authenticated can read the room_bookings view');

-- Column set of the room_bookings view equals the legacy table's (order-insensitive).
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'room_bookings'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'room_bookings_legacy'),
  'room_bookings view exposes exactly the legacy columns');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'booking_payments'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'booking_payments_legacy'),
  'booking_payments view exposes exactly the legacy columns');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'booking_emails'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'booking_emails_legacy'),
  'booking_emails view exposes exactly the legacy columns');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'function_rooms'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'function_rooms_legacy'),
  'function_rooms view exposes exactly the legacy columns');

-- ---------------------------------------------------------------------------
-- C. round trip: seed *_legacy, sync, read through the views
-- ---------------------------------------------------------------------------
insert into public.function_rooms_legacy (id, name, capacity, resources, price_pence_per_hour)
values ('f7f7f7f7-1111-4111-8111-000000000001', 'View Lounge', 40, '{bar,stage}', 2500);

insert into public.room_bookings_legacy
  (id, room_id, date, start_time, end_time, booker_name, booker_email, status, payment_status,
   booking_type, total_pence, amount_pence)
values
  ('a7a7a7a7-1111-4111-8111-000000000001', 'f7f7f7f7-1111-4111-8111-000000000001',
   '2026-07-04', '19:00', '01:00', 'Vic Viewer', 'vic@test.invalid', 'confirmed', 'paid', 'hire', 15000, 15000),
  ('a7a7a7a7-1111-4111-8111-000000000002', 'f7f7f7f7-1111-4111-8111-000000000001',
   '2026-07-05', '09:00', '12:00', 'Club', 'club@test.invalid', 'confirmed', 'unpaid', 'block', null, null);

insert into public.booking_payments_legacy (id, booking_id, amount_pence, method, reference)
values ('c7c7c7c7-1111-4111-8111-000000000001', 'a7a7a7a7-1111-4111-8111-000000000001', 15000, 'card', 'REF-1');

insert into public.booking_emails_legacy (id, booking_id, kind, to_email, subject, body)
values ('e7e7e7e7-1111-4111-8111-000000000001', 'a7a7a7a7-1111-4111-8111-000000000001', 'confirmation', 'vic@test.invalid', 'Confirmed', 'See you then');

select lives_ok($$select public.migrate_room_bookings()$$, 'sync from *_legacy runs');
select is((select count(*) from public.reconcile_room_bookings() where not ok), 0::bigint,
  'reconcile against *_legacy is all ok');

select is(
  (select (room_id::text, date::text, start_time::text, end_time::text, status, payment_status, booking_type, amount_pence, total_pence)
     from public.room_bookings where id = 'a7a7a7a7-1111-4111-8111-000000000001'),
  ('f7f7f7f7-1111-4111-8111-000000000001'::text, '2026-07-04'::text, '19:00:00'::text, '01:00:00'::text, 'confirmed'::text, 'paid'::text, 'hire'::text, 15000, 15000),
  'overnight hire reads back through the view with Europe/London date/times');

select is(
  (select (booking_type, start_time::text, end_time::text) from public.room_bookings where id = 'a7a7a7a7-1111-4111-8111-000000000002'),
  ('block'::text, '09:00:00'::text, '12:00:00'::text),
  'block booking reads back as booking_type block');

select is((select (name, capacity, resources::text, price_pence_per_hour) from public.function_rooms
             where id = 'f7f7f7f7-1111-4111-8111-000000000001'),
  ('View Lounge'::text, 40, '{bar,stage}'::text, 2500), 'function_rooms view maps amenities back to resources');

select is((select (booking_id::text, amount_pence, method, reference) from public.booking_payments
             where id = 'c7c7c7c7-1111-4111-8111-000000000001'),
  ('a7a7a7a7-1111-4111-8111-000000000001'::text, 15000, 'card'::text, 'REF-1'::text), 'booking_payments view row');

select is((select (booking_id::text, kind, to_email, subject) from public.booking_emails
             where id = 'e7e7e7e7-1111-4111-8111-000000000001'),
  ('a7a7a7a7-1111-4111-8111-000000000001'::text, 'confirmation'::text, 'vic@test.invalid'::text, 'Confirmed'::text), 'booking_emails view row');

-- Native unified rows (no legacy id) are invisible through the views.
insert into public.bookings (resource_id, kind, status, starts_at, ends_at, booker_name, booker_email)
select r.id, 'hire', 'pending', '2026-08-01T18:00Z', '2026-08-01T20:00Z', 'Nat Native', 'nat@test.invalid'
from public.resources r where r.legacy_function_room_id = 'f7f7f7f7-1111-4111-8111-000000000001';
select is((select count(*) from public.room_bookings where booker_email = 'nat@test.invalid'), 0::bigint,
  'native bookings are not exposed through the legacy view');

-- ---------------------------------------------------------------------------
-- D. views are not writable; legacy writes by app roles fail
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.room_bookings (room_id, date, start_time, end_time, booker_name, booker_email)
    values ('f7f7f7f7-1111-4111-8111-000000000001', '2026-09-01', '10:00', '12:00', 'X', 'x@test.invalid')$$,
  '55000', null, 'insert into the room_bookings view is refused');
select throws_ok(
  $$update public.room_bookings set notes = 'x' where id = 'a7a7a7a7-1111-4111-8111-000000000001'$$,
  '55000', null, 'update through the room_bookings view is refused');
select throws_ok(
  $$delete from public.function_rooms where id = 'f7f7f7f7-1111-4111-8111-000000000001'$$,
  '42501', null, 'delete through the function_rooms view is refused (no DELETE grant)');
select throws_ok(
  $$insert into public.room_bookings_legacy (room_id, date, start_time, end_time, booker_name, booker_email)
    values ('f7f7f7f7-1111-4111-8111-000000000001', '2026-09-01', '10:00', '12:00', 'X', 'x@test.invalid')$$,
  '42501', null, 'authenticated cannot write room_bookings_legacy');
select throws_ok($$select count(*) from public.room_bookings_legacy$$, '42501', null,
  'authenticated cannot read room_bookings_legacy');
reset role;

select ok(exists (select 1 from public.audit_log
                   where action = 'migration.cutover'
                     and detail->>'migration' = '20260824100000_legacy_room_tables_to_views'),
  'cutover migration wrote its audit row');

select * from finish();
rollback;
