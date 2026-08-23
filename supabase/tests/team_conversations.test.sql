-- =============================================================================
-- P5.3 — team conversation auto-membership
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(23);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b3b3b3b3-2222-4111-8111-000000000001', 't5-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('b3b3b3b3-2222-4111-8111-000000000002', 't5-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('b3b3b3b3-2222-4111-8111-000000000003', 't5-mum@test.invalid',    '{"full_name": "Mum Second"}'::jsonb),
  ('b3b3b3b3-2222-4111-8111-000000000004', 't5-adult@test.invalid',  '{"full_name": "Al Adult"}'::jsonb);
select set_config('t5.coach',  (select person_id::text from public.profiles where id = 'b3b3b3b3-2222-4111-8111-000000000001'), true);
select set_config('t5.parent', (select person_id::text from public.profiles where id = 'b3b3b3b3-2222-4111-8111-000000000002'), true);
select set_config('t5.mum',    (select person_id::text from public.profiles where id = 'b3b3b3b3-2222-4111-8111-000000000003'), true);
select set_config('t5.adult',  (select person_id::text from public.profiles where id = 'b3b3b3b3-2222-4111-8111-000000000004'), true);
update public.people set dob = '1982-02-02' where id in (current_setting('t5.coach')::uuid, current_setting('t5.parent')::uuid, current_setting('t5.mum')::uuid, current_setting('t5.adult')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('d3d3d3d3-2222-4111-8111-000000000001', 'Kid', 'One', current_date - interval '9 years'),
  ('d3d3d3d3-2222-4111-8111-000000000002', 'Kid', 'Two', current_date - interval '10 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('t5.parent')::uuid, 'd3d3d3d3-2222-4111-8111-000000000001', 'parent'),
  (current_setting('t5.parent')::uuid, 'd3d3d3d3-2222-4111-8111-000000000002', 'parent');
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('t5.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('t5.coach')::uuid, 'safeguarding_children', current_date + 300, now());
insert into public.seasons (id, name, starts_on, ends_on) values ('5a5a5a5a-3333-4111-8111-000000000001', 'TC 2039/40', '2039-08-01', '2040-05-31');
insert into public.teams (id, name) values ('7a7a7a7a-3333-4111-8111-000000000001', 'TC U10s');

-- coach joins → team + announcement rooms exist with the coach as staff
insert into public.team_memberships (person_id, team_id, season_id, role) values (current_setting('t5.coach')::uuid, '7a7a7a7a-3333-4111-8111-000000000001', '5a5a5a5a-3333-4111-8111-000000000001', 'coach');
select set_config('t5.room', (select id::text from public.conversations where team_id = '7a7a7a7a-3333-4111-8111-000000000001' and type = 'team'), true);
select set_config('t5.ann',  (select id::text from public.conversations where team_id = '7a7a7a7a-3333-4111-8111-000000000001' and type = 'announcement'), true);
select ok(current_setting('t5.room') <> '', 'team room created on first membership');
select ok(current_setting('t5.ann') <> '', 'announcement room created too');
select is((select basis::text from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.coach')::uuid),
  'staff', 'coach is a staff participant');

-- adding a minor player adds their guardian
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('ad3ad3ad-3333-4111-8111-000000000001', 'd3d3d3d3-2222-4111-8111-000000000001', '7a7a7a7a-3333-4111-8111-000000000001', '5a5a5a5a-3333-4111-8111-000000000001', 'player');
select is((select array_agg(basis::text order by basis::text) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and left_at is null),
  array['guardian', 'member', 'staff']::text[], 'adding a player adds their guardian (coach, child, parent)');
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.ann')::uuid and left_at is null), 3::bigint, 'announcement room mirrors');
-- second child of the same parent: no duplicate guardian row
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('ad3ad3ad-3333-4111-8111-000000000002', 'd3d3d3d3-2222-4111-8111-000000000002', '7a7a7a7a-3333-4111-8111-000000000001', '5a5a5a5a-3333-4111-8111-000000000001', 'player');
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.parent')::uuid and left_at is null),
  1::bigint, 'a guardian of two players is in the room once');
-- a new guardianship for a child on the team adds the guardian
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('t5.mum')::uuid, 'd3d3d3d3-2222-4111-8111-000000000001', 'parent');
select is((select basis::text from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.mum')::uuid and left_at is null),
  'guardian', 'a new guardianship adds the guardian to the team room');
-- the room is a working conversation
select lives_ok($$insert into public.messages (conversation_id, sender_person_id, body) values (current_setting('t5.room')::uuid, current_setting('t5.coach')::uuid, 'Training Tuesday')$$,
  'coach posts to the team room');
select lives_ok($$insert into public.messages (conversation_id, sender_person_id, body) values (current_setting('t5.room')::uuid, current_setting('t5.parent')::uuid, 'Thanks')$$,
  'parent posts to the team room');
select throws_ok($$insert into public.messages (conversation_id, sender_person_id, body) values (current_setting('t5.ann')::uuid, current_setting('t5.parent')::uuid, 'reply')$$,
  'P0001', null, 'parent cannot post to announcements');

-- child 1 leaves: still in history; parent stays (child 2 remains); mum leaves (her only child left)
update public.team_memberships set left_at = now() where id = 'ad3ad3ad-3333-4111-8111-000000000001';
select is((select left_at is not null from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = 'd3d3d3d3-2222-4111-8111-000000000001'),
  true, 'leaving team marks participant left');
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = 'd3d3d3d3-2222-4111-8111-000000000001'),
  1::bigint, 'history retained (row not deleted)');
select is((select left_at is null from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.parent')::uuid),
  true, 'guardian of a remaining child stays');
select is((select left_at is not null from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.mum')::uuid),
  true, 'guardian with no remaining child leaves');
-- rejoin: new live row
update public.team_memberships set left_at = null where id = 'ad3ad3ad-3333-4111-8111-000000000001';
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = 'd3d3d3d3-2222-4111-8111-000000000001' and left_at is null),
  1::bigint, 'rejoining re-adds the child');
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.mum')::uuid and left_at is null),
  1::bigint, 'and the returning child''s other guardian');

-- child 2 leaves, then child 1 leaves: the parent must NOT be dropped while child 1 is there, and IS dropped after
update public.team_memberships set left_at = now() where id = 'ad3ad3ad-3333-4111-8111-000000000002';
select is((select left_at is null from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.parent')::uuid),
  true, 'parent stays while one child remains');
update public.team_memberships set left_at = now() where id = 'ad3ad3ad-3333-4111-8111-000000000001';
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and left_at is null), 1::bigint,
  'only the coach remains after both children leave');

-- ending a guardianship while the child is on the team: SG-1.8 allows it (room has ≥3), guardian dropped
update public.team_memberships set left_at = null where id = 'ad3ad3ad-3333-4111-8111-000000000001';
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and left_at is null), 4::bigint, 'coach + child + two guardians');
select lives_ok($$update public.guardianships set ended_at = now() where guardian_person_id = current_setting('t5.mum')::uuid and child_person_id = 'd3d3d3d3-2222-4111-8111-000000000001'$$,
  'ending one of two guardianships is allowed (the room stays compliant)');
select is((select count(*) from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.mum')::uuid and left_at is null),
  0::bigint, 'the ended guardian is removed from the room');
-- an adult player joins: no guardians involved
insert into public.team_memberships (person_id, team_id, season_id, role) values (current_setting('t5.adult')::uuid, '7a7a7a7a-3333-4111-8111-000000000001', '5a5a5a5a-3333-4111-8111-000000000001', 'player');
select is((select basis::text from public.conversation_participants where conversation_id = current_setting('t5.room')::uuid and person_id = current_setting('t5.adult')::uuid and left_at is null),
  'member', 'adult player is a member participant');
select ok(not has_function_privilege('authenticated', 'public.team_conversation_add(uuid, uuid, uuid, public.team_role)', 'EXECUTE'), 'sync functions are not callable by authenticated');

select * from finish();

rollback;
