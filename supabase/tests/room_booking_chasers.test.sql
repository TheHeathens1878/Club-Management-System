-- =============================================================================
-- Two chasers for a room that was asked about and never taken (20260911100000)
-- =============================================================================
--   A  the three columns exist, nullable, and the discount refuses a negative
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(5);

select has_column('public', 'bookings', 'chaser_sent_at', 'chaser_sent_at exists');
select has_column('public', 'bookings', 'final_chaser_sent_at', 'final_chaser_sent_at exists');
select has_column('public', 'bookings', 'final_chaser_discount_pence', 'final_chaser_discount_pence exists');
select col_is_null('public', 'bookings', 'final_chaser_discount_pence', 'the discount is nullable');

insert into public.resources (id, type, name, active)
  values ('c4a5e2c4-0911-4111-8111-000000000001', 'function_room', 'Chaser Room', true);

select throws_ok(
  $$ insert into public.bookings (resource_id, starts_at, ends_at, blocked_from, blocked_until,
       booker_name, booker_email, status, kind, final_chaser_discount_pence)
     values ('c4a5e2c4-0911-4111-8111-000000000001',
       '2045-07-16 18:00+00', '2045-07-16 23:00+00', '2045-07-16 18:00+00', '2045-07-16 23:00+00',
       'Chase Me', 'chase@test.invalid', 'quoted', 'hire', -1) $$,
  '23514',
  null,
  'a negative discount is refused');

select * from finish();
rollback;
