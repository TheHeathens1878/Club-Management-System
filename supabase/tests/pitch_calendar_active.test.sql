-- =============================================================================
-- pitch_calendar() shows active pitches only (20260824320000)
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a8a8a8a8-4444-4111-8111-000000000001', 'pc-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a8a8a8a8-4444-4111-8111-000000000001';
update public.people set dob = '1980-01-01'
 where id = (select person_id from public.profiles where id = 'a8a8a8a8-4444-4111-8111-000000000001');

insert into public.resources (id, type, name, active) values
  ('c9c9c9c9-4444-4111-8111-000000000001', 'pitch', 'PCA – Pitch 1', true),
  ('c9c9c9c9-4444-4111-8111-000000000002', 'pitch', 'PCA – Pitch 2 (9v9 Right)', false);
insert into public.bookings (id, resource_id, starts_at, ends_at, status, kind, occasion, booker_name, booker_email) values
  ('b9b9b9b9-4444-4111-8111-000000000001', 'c9c9c9c9-4444-4111-8111-000000000001',
   '2036-09-05 09:00+01', '2036-09-05 10:00+01', 'confirmed', 'training', 'Active pitch session', 'PCA Tester', 'pca@test.invalid'),
  ('b9b9b9b9-4444-4111-8111-000000000002', 'c9c9c9c9-4444-4111-8111-000000000002',
   '2036-09-05 09:00+01', '2036-09-05 10:00+01', 'confirmed', 'training', 'Disused pitch session', 'PCA Tester', 'pca@test.invalid');

-- As the admin (has the club role, so the calendar admits them).
set local request.jwt.claims to '{"sub":"a8a8a8a8-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*) from public.pitch_calendar('2036-09-05 00:00+01', '2036-09-06 00:00+01')
    where resource_id = 'c9c9c9c9-4444-4111-8111-000000000001'),
  1::bigint, 'a booking on an active pitch is returned');
select is(
  (select count(*) from public.pitch_calendar('2036-09-05 00:00+01', '2036-09-06 00:00+01')
    where resource_id = 'c9c9c9c9-4444-4111-8111-000000000002'),
  0::bigint, 'a booking on a deactivated pitch is not (Adam 2026-08-25: disused pitches must not show)');

reset role;
set local request.jwt.claims to '{}';

-- Reactivating the pitch brings its bookings straight back — the filter is
-- the resource flag, not anything stored on the booking.
update public.resources set active = true where id = 'c9c9c9c9-4444-4111-8111-000000000002';
set local request.jwt.claims to '{"sub":"a8a8a8a8-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.pitch_calendar('2036-09-05 00:00+01', '2036-09-06 00:00+01')
    where resource_id = 'c9c9c9c9-4444-4111-8111-000000000002'),
  1::bigint, 'reactivating the pitch restores its bookings');
select is(
  (select recurrence_group_id from public.pitch_calendar('2036-09-05 00:00+01', '2036-09-06 00:00+01')
    where booking_id = 'b9b9b9b9-4444-4111-8111-000000000001'),
  null, 'the 20260824300000 recurrence column survives the redefinition');
reset role;
set local request.jwt.claims to '{}';

select * from finish();

rollback;
