-- =============================================================================
-- Who in this room is a referee (20260902130000)
-- =============================================================================
--   A  a referee in the room is named; a coach in the same room is not
--   B  a member of the room may ask
--   C  somebody who is not in the room, and not an administrator, gets nothing
--   D  a club administrator may ask about a room they are not in
--   E  somebody who has LEFT the room is still named, because their posts stay
--   F  a revoked hat stops being named
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c4ee0000-8888-4111-8111-000000000001', 'cr-ref@test.invalid',    '{"full_name":"Rita Ref","dob":"1990-01-01"}'::jsonb),
  ('c4ee0000-8888-4111-8111-000000000002', 'cr-coach@test.invalid',  '{"full_name":"Colin Coach","dob":"1985-02-02"}'::jsonb),
  ('c4ee0000-8888-4111-8111-000000000003', 'cr-gone@test.invalid',   '{"full_name":"Gus Gone","dob":"1988-03-03"}'::jsonb),
  ('c4ee0000-8888-4111-8111-000000000004', 'cr-out@test.invalid',    '{"full_name":"Olive Outside","dob":"1979-04-04"}'::jsonb),
  ('c4ee0000-8888-4111-8111-000000000005', 'cr-admin@test.invalid',  '{"full_name":"Ada Admin","dob":"1975-05-05"}'::jsonb);

select set_config('cr.ref',   (select person_id::text from public.profiles where id = 'c4ee0000-8888-4111-8111-000000000001'), true);
select set_config('cr.coach', (select person_id::text from public.profiles where id = 'c4ee0000-8888-4111-8111-000000000002'), true);
select set_config('cr.gone',  (select person_id::text from public.profiles where id = 'c4ee0000-8888-4111-8111-000000000003'), true);
select set_config('cr.out',   (select person_id::text from public.profiles where id = 'c4ee0000-8888-4111-8111-000000000004'), true);
select set_config('cr.admin', (select person_id::text from public.profiles where id = 'c4ee0000-8888-4111-8111-000000000005'), true);

insert into public.person_roles (person_id, role) values
  (current_setting('cr.ref')::uuid,   'referee'),
  (current_setting('cr.gone')::uuid,  'referee'),
  (current_setting('cr.coach')::uuid, 'coach'),
  (current_setting('cr.admin')::uuid, 'club_admin');

-- A room of grown-ups, so SG-1 has nothing to say about any of this.
insert into public.conversations (id, type, title, created_by_person_id)
  values ('c4ee0000-8888-4111-8111-00000000000c', 'group', 'Officials',
          current_setting('cr.coach')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c4ee0000-8888-4111-8111-00000000000c', current_setting('cr.coach')::uuid, 'creator'),
  ('c4ee0000-8888-4111-8111-00000000000c', current_setting('cr.ref')::uuid,   'member'),
  ('c4ee0000-8888-4111-8111-00000000000c', current_setting('cr.gone')::uuid,  'member');


-- =============================================================================
-- A / B. a member asks
-- =============================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"c4ee0000-8888-4111-8111-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c')),
  2::bigint, 'the two referees in the room are named');
select ok(
  exists (select 1 from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c') r
           where r = current_setting('cr.ref')::uuid),
  'the referee is one of them');
select ok(
  not exists (select 1 from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c') r
               where r = current_setting('cr.coach')::uuid),
  'the coach is NOT — being in the referees group is not being a referee');
reset role;


-- =============================================================================
-- E. somebody who has left is still named
-- =============================================================================
update public.conversation_participants set left_at = now()
 where conversation_id = 'c4ee0000-8888-4111-8111-00000000000c'
   and person_id = current_setting('cr.gone')::uuid;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c4ee0000-8888-4111-8111-000000000002","role":"authenticated"}';
select ok(
  exists (select 1 from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c') r
           where r = current_setting('cr.gone')::uuid),
  'a referee who has left is still named — their posts are still in the room');
reset role;


-- =============================================================================
-- C. an outsider
-- =============================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"c4ee0000-8888-4111-8111-000000000004","role":"authenticated"}';
select is(
  (select count(*) from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c')),
  0::bigint, 'somebody outside the room is told nothing');
reset role;


-- =============================================================================
-- D. a club administrator
-- =============================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"c4ee0000-8888-4111-8111-000000000005","role":"authenticated"}';
select is(
  (select count(*) from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c')),
  2::bigint, 'a club administrator may ask about a room they are not in');
reset role;


-- =============================================================================
-- F. the hat comes off
-- =============================================================================
update public.person_roles set revoked_at = now()
 where person_id = current_setting('cr.ref')::uuid and role = 'referee';

set local role authenticated;
set local request.jwt.claims to '{"sub":"c4ee0000-8888-4111-8111-000000000002","role":"authenticated"}';
select ok(
  not exists (select 1 from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c') r
               where r = current_setting('cr.ref')::uuid),
  'a revoked hat is no longer named');
select is(
  (select count(*) from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c')),
  1::bigint, 'leaving only the one who still holds it');
reset role;


-- =============================================================================
-- and anonymously
-- =============================================================================
set local role anon;
select throws_ok($$ select * from public.conversation_referees('c4ee0000-8888-4111-8111-00000000000c') $$,
  '42501', null, 'anon may not execute it at all');
reset role;

select * from finish();
rollback;
