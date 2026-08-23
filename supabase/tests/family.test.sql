-- =============================================================================
-- Gap 9 — family self-service (20260824180000)
-- =============================================================================
begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1f1f1f1-1111-4111-8111-000000000001', 'fm-parent@test.invalid', '{"full_name": "Pa Rent", "dob": "1980-05-05"}'::jsonb),
  ('f1f1f1f1-1111-4111-8111-000000000002', 'fm-nodob@test.invalid',  '{"full_name": "No Dob"}'::jsonb);
select set_config('fm.parent', (select person_id::text from public.profiles where id = 'f1f1f1f1-1111-4111-8111-000000000001'), true);

set local request.jwt.claims to '{"sub":"f1f1f1f1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fm.child', public.add_child('Kid', 'Rent', (current_date - interval '8 years')::date, 'Kiddo')::text, true);
select is((select count(*) from public.my_children()), 1::bigint, 'parent adds a child and sees them');
select is((select (first_name, preferred_name, is_minor, relationship) from public.my_children()),
  ('Kid'::text, 'Kiddo'::text, true, 'parent'::text), 'child row carries the expected fields');
select is((select count(*) from public.people where id = current_setting('fm.child')::uuid), 1::bigint,
  'parent can read the child record (people_guardian_read)');
select throws_like($$ select public.add_child('Big', 'Rent', '1990-01-01') $$, '%SG-4%', 'an adult cannot be added as a child');
select throws_ok($$ select public.add_child('Future', 'Rent', (current_date + 1)::date) $$, 'P0001', null, 'future dob refused');
reset role;

set local request.jwt.claims to '{"sub":"f1f1f1f1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.add_child('Kid', 'Two', (current_date - interval '6 years')::date) $$, '%SG-4%',
  'a guardian with no known date of birth is refused');
select is((select count(*) from public.my_children()), 0::bigint, 'no children for the other login');
reset role;

select is((select count(*) from public.audit_log where action = 'family.child_added' and entity_id = current_setting('fm.child')), 1::bigint,
  'child_added is audited');
select is((select count(*) from public.people where first_name = 'Kid' and last_name = 'Two'), 0::bigint,
  'the refused add left no orphan person row');

select * from finish();
rollback;
