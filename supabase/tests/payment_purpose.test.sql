-- =============================================================================
-- A payment says what it was for (20260913140000)
-- =============================================================================
-- Run with: npx supabase test db

begin;

select plan(4);

insert into public.resources (id, name, type) values
  ('7e50c000-0913-4111-8111-000000000001', 'PP Room', 'function_room');
insert into public.bookings (id, resource_id, booker_name, booker_email, starts_at, ends_at, status, kind, total_pence, deposit_pence, security_deposit_pence)
values ('b00c0000-0913-4111-8111-000000000001', '7e50c000-0913-4111-8111-000000000001', 'PP Hirer', 'pp@test.invalid',
        now() + interval '40 days', now() + interval '40 days 4 hours', 'confirmed', 'hire', 35000, 10000, 20000);

select lives_ok($$
  insert into public.payments (booking_id, amount_pence, purpose) values
    ('b00c0000-0913-4111-8111-000000000001', 10000, 'deposit'),
    ('b00c0000-0913-4111-8111-000000000001', 25000, 'balance'),
    ('b00c0000-0913-4111-8111-000000000001', 20000, 'security_deposit'),
    ('b00c0000-0913-4111-8111-000000000001', 500, null)
$$, 'the three purposes, and an unlabelled row, are all accepted');

select throws_ok($$
  insert into public.payments (booking_id, amount_pence, purpose) values
    ('b00c0000-0913-4111-8111-000000000001', 100, 'tip')
$$, '23514', null, 'an unknown purpose is refused');

select is((select sum(amount_pence)::int from public.payments
            where booking_id = 'b00c0000-0913-4111-8111-000000000001' and purpose is distinct from 'security_deposit'),
  35500, 'the hire is what was paid that was not the security deposit');
select is((select sum(amount_pence)::int from public.payments
            where booking_id = 'b00c0000-0913-4111-8111-000000000001' and purpose = 'security_deposit'),
  20000, 'the security deposit is held apart');

select * from finish();
rollback;
