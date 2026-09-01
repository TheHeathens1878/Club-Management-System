-- =============================================================================
-- Venue addresses (20260824460000)
-- =============================================================================
--   A  column exists and takes a postal address
--   B  the length check refuses the empty string and the essay
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(4);

insert into public.resources (id, type, name) values
  ('b3b3b3b3-1111-4111-8111-000000000001', 'pitch', 'VA Park – Pitch 1');

-- A. column
select has_column('public', 'resources', 'address', 'resources.address');

update public.resources
   set address = 'Crossford Bridge, Meadows Road, Sale M33 2PE'
 where id = 'b3b3b3b3-1111-4111-8111-000000000001';
select is(
  (select address from public.resources where id = 'b3b3b3b3-1111-4111-8111-000000000001'),
  'Crossford Bridge, Meadows Road, Sale M33 2PE',
  'address holds a postal address');

-- B. length checks
select throws_ok($$
  update public.resources set address = '' where id = 'b3b3b3b3-1111-4111-8111-000000000001'
$$, '23514', null, 'the empty string is refused — blank means null');
select throws_ok($$
  update public.resources set address = repeat('x', 301) where id = 'b3b3b3b3-1111-4111-8111-000000000001'
$$, '23514', null, 'an address longer than 300 characters is refused');

select * from finish();
rollback;
