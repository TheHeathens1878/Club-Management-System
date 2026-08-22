-- =============================================================================
-- P1.5 — public.resources, public.bookings, public.payments
-- =============================================================================
-- What this suite covers, and where:
--   A  schema shape — enums, tables, RLS enabled, exclusion constraint, triggers
--   B  privileges — anon reads resources only; nothing else for anon
--   C  the conflict check, against a test PITCH resource (the acceptance
--      criterion): overlap, touching edges, overnight, cancelled ignored,
--      buffers, exclude-self, and the function agreeing with the constraint
--   D  blocked_from / blocked_until are trigger-maintained and unspoofable
--   E  RLS — staff read/insert/update, club_admin delete, booker self-read,
--      member sees nothing, anon sees nothing; payments follow bookings
--
-- Impersonation follows roles.test.sql:
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     set local role authenticated;
--
-- Every count assertion is data-independent (captured into transaction-local
-- settings by the owner), so the suite passes on a prod-shaped preview branch.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(85);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b5b5b5b5-1111-4111-8111-000000000001', 'bk-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('b5b5b5b5-1111-4111-8111-000000000002', 'bk-staff@test.invalid',  '{"full_name": "Stu Staff"}'::jsonb),
  ('b5b5b5b5-1111-4111-8111-000000000003', 'bk-member@test.invalid', '{"full_name": "Mo Member"}'::jsonb),
  ('b5b5b5b5-1111-4111-8111-000000000004', 'bk-booker@test.invalid', '{"full_name": "Bea Booker"}'::jsonb);

-- The P1.4 sync trigger grants club_admin / staff from profiles.role.
update public.profiles set role = 'committee' where id = 'b5b5b5b5-1111-4111-8111-000000000001';
update public.profiles set role = 'bar'       where id = 'b5b5b5b5-1111-4111-8111-000000000002';

select set_config('test.booker_person',
  (select person_id::text from public.profiles where id = 'b5b5b5b5-1111-4111-8111-000000000004'), true);
select set_config('test.member_person',
  (select person_id::text from public.profiles where id = 'b5b5b5b5-1111-4111-8111-000000000003'), true);

insert into public.resources (id, type, name, default_pre_buffer_minutes, default_post_buffer_minutes) values
  ('c5c5c5c5-1111-4111-8111-000000000001', 'pitch',         'Test Pitch 1', 0, 0),
  ('c5c5c5c5-1111-4111-8111-000000000002', 'pitch',         'Test Pitch 2', 0, 0),
  ('c5c5c5c5-1111-4111-8111-000000000003', 'function_room', 'Test Room',    0, 0);
update public.resources set active = false where id = 'c5c5c5c5-1111-4111-8111-000000000003';

select set_config('test.resources_active',
  (select count(*)::text from public.resources where active), true);
select set_config('test.resources_all',
  (select count(*)::text from public.resources), true);

-- ---------------------------------------------------------------------------
-- A. Schema shape
-- ---------------------------------------------------------------------------
select has_table('public', 'resources', 'resources exists');
select has_table('public', 'bookings',  'bookings exists');
select has_table('public', 'payments',  'payments exists');

select has_enum('public', 'resource_type',  'resource_type enum');
select has_enum('public', 'booking_status', 'booking_status enum');
select has_enum('public', 'payment_status', 'payment_status enum');
select has_enum('public', 'booking_kind',   'booking_kind enum');

select enum_has_labels('public', 'resource_type', array['function_room', 'pitch'],
  'resource_type labels');
select enum_has_labels('public', 'booking_status',
  array['enquiry', 'quoted', 'pending', 'confirmed', 'cancelled'], 'booking_status labels');
select enum_has_labels('public', 'payment_status', array['unpaid', 'deposit_paid', 'paid'],
  'payment_status labels');
select enum_has_labels('public', 'booking_kind', array['hire', 'block', 'fixture', 'maintenance'],
  'booking_kind labels');

select ok((select relrowsecurity from pg_class where oid = 'public.resources'::regclass), 'RLS on resources');
select ok((select relrowsecurity from pg_class where oid = 'public.bookings'::regclass),  'RLS on bookings');
select ok((select relrowsecurity from pg_class where oid = 'public.payments'::regclass),  'RLS on payments');

select ok(
  exists (select 1 from pg_constraint where conname = 'bookings_no_overlap' and contype = 'x'),
  'bookings_no_overlap is an exclusion constraint');

select trigger_is('public', 'bookings', 'trg_bookings_compute_blocked', 'public', 'bookings_compute_blocked',
  'blocked window trigger present');
select trigger_is('public', 'bookings', 'trg_bookings_updated', 'public', 'set_updated_at',
  'bookings updated_at trigger');
select trigger_is('public', 'resources', 'trg_resources_updated', 'public', 'set_updated_at',
  'resources updated_at trigger');

select has_function('public', 'booking_conflicts',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone', 'integer', 'integer', 'uuid'],
  'booking_conflicts()');
select has_function('public', 'booking_has_conflict',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone', 'integer', 'integer', 'uuid'],
  'booking_has_conflict()');

select policies_are('public', 'resources',
  array['resources_public_read', 'resources_admin_read', 'resources_admin_insert',
        'resources_admin_update', 'resources_admin_delete'],
  'resources policy list');
select policies_are('public', 'bookings',
  array['bookings_staff_read', 'bookings_staff_insert', 'bookings_staff_update',
        'bookings_admin_delete', 'bookings_booker_read'],
  'bookings policy list');
select policies_are('public', 'payments',
  array['payments_staff_read', 'payments_staff_insert', 'payments_staff_update',
        'payments_admin_delete', 'payments_booker_read'],
  'payments policy list');

-- ---------------------------------------------------------------------------
-- B. Privileges
-- ---------------------------------------------------------------------------
select ok(has_table_privilege('anon', 'public.resources', 'SELECT'),      'anon may SELECT resources');
select ok(not has_table_privilege('anon', 'public.resources', 'INSERT'),  'anon may not INSERT resources');
select ok(not has_table_privilege('anon', 'public.bookings', 'SELECT'),   'anon may not SELECT bookings');
select ok(not has_table_privilege('anon', 'public.payments', 'SELECT'),   'anon may not SELECT payments');
select ok(not has_function_privilege('anon', 'public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid)', 'EXECUTE'),
  'anon cannot execute booking_has_conflict');
select ok(has_function_privilege('authenticated', 'public.booking_has_conflict(uuid, timestamptz, timestamptz, integer, integer, uuid)', 'EXECUTE'),
  'authenticated can execute booking_has_conflict');

-- ---------------------------------------------------------------------------
-- C. The conflict check on a test pitch (as the owner: the constraint is
--    the invariant and must hold regardless of who writes)
-- ---------------------------------------------------------------------------
-- Base booking: 2030-06-01 10:00–12:00 UTC on Pitch 1.
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, booker_name, booker_email)
values ('d5d5d5d5-1111-4111-8111-000000000001', 'c5c5c5c5-1111-4111-8111-000000000001', 'hire', 'confirmed',
        '2030-06-01 10:00+00', '2030-06-01 12:00+00', 'Base Hirer', 'base@test.invalid');

-- 1 overlap
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'pending',
            '2030-06-01 11:00+00', '2030-06-01 13:00+00', 'X', 'x@test.invalid')$$,
  '23P01', null, 'overlapping pending booking on the same pitch is refused');

-- 2 containment
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-01 10:30+00', '2030-06-01 11:00+00', 'X', 'x@test.invalid')$$,
  '23P01', null, 'booking inside an existing one is refused');

-- 3 touching edge after: allowed (half-open)
select lives_ok(
  $$insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('d5d5d5d5-1111-4111-8111-000000000002', 'c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-01 12:00+00', '2030-06-01 13:00+00', 'Edge After', 'e@test.invalid')$$,
  'booking starting exactly when the previous ends is allowed');

-- 4 touching edge before: allowed
select lives_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-01 09:00+00', '2030-06-01 10:00+00', 'Edge Before', 'e@test.invalid')$$,
  'booking ending exactly when the next starts is allowed');

-- 5 same slot on a different pitch: allowed
select lives_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000002', 'confirmed',
            '2030-06-01 10:00+00', '2030-06-01 12:00+00', 'Other Pitch', 'o@test.invalid')$$,
  'same slot on another resource is allowed');

-- 6 cancelled / enquiry / quoted hold nothing
select lives_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'cancelled',
            '2030-06-01 10:00+00', '2030-06-01 12:00+00', 'Cancelled', 'c@test.invalid')$$,
  'cancelled booking may overlap a live one');
select lives_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'enquiry',
            '2030-06-01 10:00+00', '2030-06-01 12:00+00', 'Enquiry', 'q@test.invalid')$$,
  'enquiry may overlap a live one');
select lives_ok(
  $$insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('d5d5d5d5-1111-4111-8111-000000000003', 'c5c5c5c5-1111-4111-8111-000000000001', 'quoted',
            '2030-06-01 10:00+00', '2030-06-01 12:00+00', 'Quoted', 'q@test.invalid')$$,
  'quote may overlap a live one');

-- 7 ...but promoting that quote to confirmed brings it into the constraint
select throws_ok(
  $$update public.bookings set status = 'confirmed' where id = 'd5d5d5d5-1111-4111-8111-000000000003'$$,
  '23P01', null, 'confirming a quote that overlaps a live booking is refused');

-- 8 overnight: 22:00 → 02:00 next day
insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_name, booker_email)
values ('d5d5d5d5-1111-4111-8111-000000000004', 'c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
        '2030-06-01 22:00+00', '2030-06-02 02:00+00', 'Overnight', 'n@test.invalid');
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-02 01:00+00', '2030-06-02 03:00+00', 'X', 'x@test.invalid')$$,
  '23P01', null, 'booking in the small hours collides with an overnight booking');
select lives_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-02 02:00+00', '2030-06-02 03:00+00', 'After Overnight', 'x@test.invalid')$$,
  'booking starting when the overnight one ends is allowed');

-- 9 ends_at must be after starts_at
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000002', 'confirmed',
            '2030-06-03 12:00+00', '2030-06-03 12:00+00', 'Zero', 'z@test.invalid')$$,
  '23514', null, 'zero-length booking is refused');

-- 10 buffers: 13:00–14:00 with a 90-minute pre-buffer reaches back to 11:30,
--    into the 10:00–12:00 base booking
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, pre_buffer_minutes, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000001', 'confirmed',
            '2030-06-01 13:00+00', '2030-06-01 14:00+00', 90, 'Buffered', 'b@test.invalid')$$,
  '23P01', null, 'pre-buffer collides with the booking before it');
-- and a post-buffer on the base booking would likewise block 12:00 onwards
select throws_ok(
  $$update public.bookings set post_buffer_minutes = 15 where id = 'd5d5d5d5-1111-4111-8111-000000000001'$$,
  '23P01', null, 'adding a post-buffer that reaches into the next booking is refused');

-- 11 the function agrees with the constraint
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-01 11:00+00', '2030-06-01 13:00+00'),
  true, 'booking_has_conflict: overlap → true');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-01 13:00+00', '2030-06-01 14:00+00'),
  false, 'booking_has_conflict: free slot → false');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-01 13:00+00', '2030-06-01 14:00+00', 90, 0),
  true, 'booking_has_conflict: pre-buffer → true');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-02 01:00+00', '2030-06-02 03:00+00'),
  true, 'booking_has_conflict: overnight → true');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-02 03:00+00', '2030-06-02 04:00+00'),
  false, 'booking_has_conflict: slot after the overnight chain → false');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-01 10:00+00', '2030-06-01 12:00+00',
                              0, 0, 'd5d5d5d5-1111-4111-8111-000000000001'),
  false, 'booking_has_conflict: excluding itself → false');
select is(
  public.booking_has_conflict('c5c5c5c5-1111-4111-8111-000000000001', '2030-06-01 10:00+00', '2030-06-01 12:00+00',
                              0, 0, null),
  true, 'booking_has_conflict: same slot without exclusion → true');
select is(
  (select count(*) from public.booking_conflicts('c5c5c5c5-1111-4111-8111-000000000001',
                                                 '2030-06-01 09:30+00', '2030-06-01 12:30+00')),
  3::bigint, 'booking_conflicts lists every live booking touched (before, base, after)');
select is(
  (select array_agg(id order by starts_at) from public.booking_conflicts('c5c5c5c5-1111-4111-8111-000000000001',
                                                 '2030-06-01 11:00+00', '2030-06-01 12:30+00')),
  array['d5d5d5d5-1111-4111-8111-000000000001', 'd5d5d5d5-1111-4111-8111-000000000002']::uuid[],
  'booking_conflicts returns the colliding rows in time order and ignores cancelled/enquiry/quoted');

-- ---------------------------------------------------------------------------
-- D. The blocked window is trigger-maintained
-- ---------------------------------------------------------------------------
select is(
  (select blocked_from from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000001'),
  '2030-06-01 10:00+00'::timestamptz, 'blocked_from = starts_at with no buffer');

insert into public.bookings (id, resource_id, status, starts_at, ends_at, pre_buffer_minutes, post_buffer_minutes,
                             blocked_from, blocked_until, booker_name, booker_email)
values ('d5d5d5d5-1111-4111-8111-000000000005', 'c5c5c5c5-1111-4111-8111-000000000002', 'confirmed',
        '2030-06-05 10:00+00', '2030-06-05 12:00+00', 30, 45,
        '2000-01-01 00:00+00', '2000-01-01 00:00+00', 'Spoof', 's@test.invalid');
select is(
  (select blocked_from from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000005'),
  '2030-06-05 09:30+00'::timestamptz, 'a supplied blocked_from is overwritten from the buffer');
select is(
  (select blocked_until from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000005'),
  '2030-06-05 12:45+00'::timestamptz, 'a supplied blocked_until is overwritten from the buffer');

update public.bookings set blocked_from = '2000-01-01 00:00+00'
 where id = 'd5d5d5d5-1111-4111-8111-000000000005';
select is(
  (select blocked_from from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000005'),
  '2030-06-05 09:30+00'::timestamptz, 'updating blocked_from directly is recomputed away');

update public.bookings set starts_at = '2030-06-05 11:00+00'
 where id = 'd5d5d5d5-1111-4111-8111-000000000005';
select is(
  (select blocked_from from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000005'),
  '2030-06-05 10:30+00'::timestamptz, 'moving starts_at moves blocked_from');

-- ---------------------------------------------------------------------------
-- E. RLS
-- ---------------------------------------------------------------------------
-- A booking owned by the booker persona, on Pitch 2, plus a payment on it.
insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_person_id, booker_name, booker_email)
values ('d5d5d5d5-1111-4111-8111-000000000006', 'c5c5c5c5-1111-4111-8111-000000000002', 'confirmed',
        '2030-06-06 10:00+00', '2030-06-06 12:00+00',
        current_setting('test.booker_person')::uuid, 'Bea Booker', 'bk-booker@test.invalid');
insert into public.payments (id, booking_id, amount_pence, method, source)
values ('e5e5e5e5-1111-4111-8111-000000000001', 'd5d5d5d5-1111-4111-8111-000000000006', 5000, 'cash', 'manual');

select set_config('test.bookings_all', (select count(*)::text from public.bookings), true);
select set_config('test.payments_all', (select count(*)::text from public.payments), true);

-- anon: active resources only, nothing else
set local role anon;
select is((select count(*) from public.resources),
  current_setting('test.resources_active')::bigint, 'anon sees active resources only');
select throws_ok($$select count(*) from public.bookings$$, '42501', null, 'anon cannot read bookings');
select throws_ok($$select count(*) from public.payments$$, '42501', null, 'anon cannot read payments');
select throws_ok(
  $$insert into public.resources (type, name) values ('pitch', 'Anon Pitch')$$,
  '42501', null, 'anon cannot insert a resource');
reset role;

-- member (no staff/admin role): no bookings, active resources only
set local request.jwt.claims to '{"sub":"b5b5b5b5-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.bookings), 0::bigint, 'member sees no bookings');
select is((select count(*) from public.payments), 0::bigint, 'member sees no payments');
select is((select count(*) from public.resources),
  current_setting('test.resources_active')::bigint, 'member sees active resources only');
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000002', 'pending',
            '2030-07-01 10:00+00', '2030-07-01 12:00+00', 'M', 'm@test.invalid')$$,
  '42501', null, 'member cannot insert a booking');
update public.resources set name = 'Hacked' where id = 'c5c5c5c5-1111-4111-8111-000000000001';
reset role;
select is((select name from public.resources where id = 'c5c5c5c5-1111-4111-8111-000000000001'),
  'Test Pitch 1', 'member cannot update a resource (0 rows affected)');

-- booker: own booking and its payment, nothing else
set local request.jwt.claims to '{"sub":"b5b5b5b5-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(id) from public.bookings),
  array['d5d5d5d5-1111-4111-8111-000000000006']::uuid[], 'booker sees exactly their own booking');
select is((select array_agg(id) from public.payments),
  array['e5e5e5e5-1111-4111-8111-000000000001']::uuid[], 'booker sees the payment on their own booking');
-- an UPDATE by the booker affects no rows (no update policy for bookers)
update public.bookings set notes = 'mine' where id = 'd5d5d5d5-1111-4111-8111-000000000006';
reset role;
select is((select notes from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000006'),
  null, 'booker cannot update their own booking (0 rows affected)');

-- staff: read all, insert, update; cannot delete
set local request.jwt.claims to '{"sub":"b5b5b5b5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.bookings),
  current_setting('test.bookings_all')::bigint, 'staff sees every booking');
select is((select count(*) from public.payments),
  current_setting('test.payments_all')::bigint, 'staff sees every payment');
select is((select count(*) from public.resources),
  current_setting('test.resources_active')::bigint, 'staff sees active resources only (not an admin)');
select lives_ok(
  $$insert into public.bookings (id, resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('d5d5d5d5-1111-4111-8111-000000000007', 'c5c5c5c5-1111-4111-8111-000000000002', 'pending',
            '2030-07-01 10:00+00', '2030-07-01 12:00+00', 'Staff Made', 's@test.invalid')$$,
  'staff can insert a booking');
select throws_ok(
  $$insert into public.bookings (resource_id, status, starts_at, ends_at, booker_name, booker_email)
    values ('c5c5c5c5-1111-4111-8111-000000000002', 'pending',
            '2030-07-01 11:00+00', '2030-07-01 13:00+00', 'Staff Clash', 's@test.invalid')$$,
  '23P01', null, 'the constraint binds staff too');
select lives_ok(
  $$update public.bookings set internal_notes = 'seen' where id = 'd5d5d5d5-1111-4111-8111-000000000007'$$,
  'staff can update a booking');
select lives_ok(
  $$insert into public.payments (booking_id, amount_pence, method, source)
    values ('d5d5d5d5-1111-4111-8111-000000000007', 1000, 'card', 'manual')$$,
  'staff can record a payment');
delete from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000007';
select throws_ok(
  $$insert into public.resources (type, name) values ('pitch', 'Staff Pitch')$$,
  '42501', null, 'staff cannot create a resource');
reset role;
select ok(exists (select 1 from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000007'),
  'staff delete affected no rows');

-- club_admin: everything, including delete and inactive resources
set local request.jwt.claims to '{"sub":"b5b5b5b5-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.resources),
  current_setting('test.resources_all')::bigint, 'club_admin sees inactive resources too');
select lives_ok(
  $$insert into public.resources (type, name) values ('pitch', 'Admin Pitch')$$,
  'club_admin can create a resource');
select lives_ok(
  $$delete from public.payments where booking_id = 'd5d5d5d5-1111-4111-8111-000000000007'$$,
  'club_admin can delete a payment');
select lives_ok(
  $$delete from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000007'$$,
  'club_admin can delete a booking');
reset role;
select ok(not exists (select 1 from public.bookings where id = 'd5d5d5d5-1111-4111-8111-000000000007'),
  'club_admin delete removed the row');

-- resource FK is restrict: a resource with bookings cannot be deleted
select throws_ok(
  $$delete from public.resources where id = 'c5c5c5c5-1111-4111-8111-000000000001'$$,
  '23503', null, 'a resource with bookings cannot be deleted');

-- payments cascade with their booking
select is((select count(*) from public.payments where booking_id = 'd5d5d5d5-1111-4111-8111-000000000007'),
  0::bigint, 'payments are gone with their booking');

select * from finish();

rollback;
