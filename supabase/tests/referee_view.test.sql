-- =============================================================================
-- The referee hat and the Referees group's nudge (20260825310000)
-- =============================================================================
--   A  my_capabilities() reports the referee hat, and drops it when revoked
--   B  a post in the Referees group notifies every other live member
--   C  the sender is not notified, and a post elsewhere notifies nobody
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1f1f1f1-3333-4111-8111-000000000001', 'rv-ref@test.invalid',   '{"full_name": "Rita Ref", "dob": "1985-01-01"}'::jsonb),
  ('f1f1f1f1-3333-4111-8111-000000000002', 'rv-ref2@test.invalid',  '{"full_name": "Ronan Ref", "dob": "1986-02-02"}'::jsonb),
  ('f1f1f1f1-3333-4111-8111-000000000003', 'rv-coach@test.invalid', '{"full_name": "Cal Coach", "dob": "1984-03-03"}'::jsonb);
select set_config('rv.ref',   (select person_id::text from public.profiles where id = 'f1f1f1f1-3333-4111-8111-000000000001'), true);
select set_config('rv.ref2',  (select person_id::text from public.profiles where id = 'f1f1f1f1-3333-4111-8111-000000000002'), true);
select set_config('rv.coach', (select person_id::text from public.profiles where id = 'f1f1f1f1-3333-4111-8111-000000000003'), true);

-- The referee hat puts them in the seeded group (referee_role_sync_group()).
insert into public.person_roles (person_id, role, granted_by) values
  (current_setting('rv.ref')::uuid,  'referee', 'f1f1f1f1-3333-4111-8111-000000000001'),
  (current_setting('rv.ref2')::uuid, 'referee', 'f1f1f1f1-3333-4111-8111-000000000002');
-- The coach posts games there without holding the hat.
insert into public.conversation_participants (conversation_id, person_id, basis)
  values (public.referees_group_id(), current_setting('rv.coach')::uuid, 'member');


-- A. the hat, as my_capabilities() reports it --------------------------------------
set local request.jwt.claims to '{"sub":"f1f1f1f1-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.my_capabilities() ->> 'has_referee_role')::boolean, true,
  'a referee''s capabilities carry the hat');
reset role;

set local request.jwt.claims to '{"sub":"f1f1f1f1-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((public.my_capabilities() ->> 'has_referee_role')::boolean, false,
  'a coach''s do not');
reset role;


-- B / C. the nudge -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"f1f1f1f1-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
insert into public.messages (conversation_id, sender_person_id, body)
  values (public.referees_group_id(), current_setting('rv.coach')::uuid,
          E'Referee needed — U9 v Sale Sharks\n50 mins · 7v7');
reset role;

select is(
  (select count(*) from public.outbound_messages o
    where o.person_id = current_setting('rv.ref')::uuid
      and o.subject = 'Posted in the Referees group'), 1::bigint,
  'a referee is told when a game is posted');
select is(
  (select count(*) from public.outbound_messages o
    where o.person_id = current_setting('rv.ref2')::uuid
      and o.subject = 'Posted in the Referees group'), 1::bigint,
  'so is every other referee in the group');
select is(
  (select count(*) from public.outbound_messages o
    where o.person_id = current_setting('rv.coach')::uuid
      and o.subject = 'Posted in the Referees group'), 0::bigint,
  'the person who posted it is not told about their own post');
select is(
  (select o.body from public.outbound_messages o
    where o.person_id = current_setting('rv.ref')::uuid
      and o.subject = 'Posted in the Referees group'),
  'Referee needed — U9 v Sale Sharks',
  'the bell carries the card''s headline, first line only');

-- A conversation that is not the referees group is left alone.
insert into public.conversations (id, type, created_by_person_id)
  values ('c0ffee00-3333-4111-8111-000000000001', 'group', current_setting('rv.coach')::uuid);
update public.conversations set title = 'Something else'
 where id = 'c0ffee00-3333-4111-8111-000000000001';
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0ffee00-3333-4111-8111-000000000001', current_setting('rv.coach')::uuid, 'creator'),
  ('c0ffee00-3333-4111-8111-000000000001', current_setting('rv.ref')::uuid, 'member');
insert into public.messages (conversation_id, sender_person_id, body)
  values ('c0ffee00-3333-4111-8111-000000000001', current_setting('rv.coach')::uuid, 'Evening all');

select is(
  (select count(*) from public.outbound_messages o
    where o.person_id = current_setting('rv.ref')::uuid
      and o.subject like '%Referees group%'), 1::bigint,
  'a post in another group does not ring the referees'' bell');

-- Revoking the hat takes the capability with it.
update public.person_roles set revoked_at = now()
 where person_id = current_setting('rv.ref')::uuid and role = 'referee';
set local request.jwt.claims to '{"sub":"f1f1f1f1-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.my_capabilities() ->> 'has_referee_role')::boolean, false,
  'revoking the hat drops the capability');
reset role;

select * from finish();
rollback;
