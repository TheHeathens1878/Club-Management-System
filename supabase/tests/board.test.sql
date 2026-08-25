-- =============================================================================
-- The board (20260824400000)
-- =============================================================================
--   A  who may post: admin anywhere; staff club-wide and to their own teams;
--      a parent not at all; staff cannot target someone else's team
--   B  the club lobby: club posts for everyone; targeted posts only for their
--      audience; age groups expand to teams at posting time
--   C  the push: a pushed club post sits on every team board wearing the
--      club chip; an unpushed one does not; a targeted post sits on its boards
--   D  one thread: replies from the team board land on the main post
--   E  reads: "N of M" audience arithmetic; receipts idempotent and self-only
--   F  notifications: targeted posts tell the audience (guardian for a minor,
--      author excluded); club-wide posts do not fan out
--   G  pin and delete: author or admin; a deleted post vanishes from feeds
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(28);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0b0b0b0-8888-4111-8111-000000000001', 'bd-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('b0b0b0b0-8888-4111-8111-000000000002', 'bd-coach@test.invalid',  '{"full_name": "Cai Coach", "dob": "1983-02-02"}'::jsonb),
  ('b0b0b0b0-8888-4111-8111-000000000003', 'bd-parent@test.invalid', '{"full_name": "Pia Parent", "dob": "1987-03-03"}'::jsonb),
  ('b0b0b0b0-8888-4111-8111-000000000004', 'bd-out@test.invalid',    '{"full_name": "Ote Out", "dob": "1991-04-04"}'::jsonb);
select set_config('bd.admin',  (select person_id::text from public.profiles where id = 'b0b0b0b0-8888-4111-8111-000000000001'), true);
select set_config('bd.coach',  (select person_id::text from public.profiles where id = 'b0b0b0b0-8888-4111-8111-000000000002'), true);
select set_config('bd.parent', (select person_id::text from public.profiles where id = 'b0b0b0b0-8888-4111-8111-000000000003'), true);
select set_config('bd.out',    (select person_id::text from public.profiles where id = 'b0b0b0b0-8888-4111-8111-000000000004'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('bd.admin')::uuid, 'club_admin', 'b0b0b0b0-8888-4111-8111-000000000001');

insert into public.people (id, first_name, last_name, dob)
  values ('b0b0b0b0-8888-4111-8111-00000000000a', 'Min', 'Or', (current_date - interval '10 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('bd.parent')::uuid, 'b0b0b0b0-8888-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d5d5d5d-8888-4111-8111-000000000001', 'BD 2044/45', '2044-08-01', '2045-05-31', true);
insert into public.teams (id, name, age_group) values
  ('9a9a9a9a-8888-4111-8111-000000000001', 'BD Reds', 'U12'),
  ('9a9a9a9a-8888-4111-8111-000000000002', 'BD Blues', 'U12'),
  ('9a9a9a9a-8888-4111-8111-000000000003', 'BD Vets', 'Open');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('bd.coach')::uuid, '9a9a9a9a-8888-4111-8111-000000000001', '5d5d5d5d-8888-4111-8111-000000000001', 'coach'),
  ('b0b0b0b0-8888-4111-8111-00000000000a', '9a9a9a9a-8888-4111-8111-000000000001', '5d5d5d5d-8888-4111-8111-000000000001', 'player');

-- A. who may post -------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.create_board_post('Hello', 'From a parent') $$,
  '%administrators and team staff%', 'a parent cannot post to the board');
reset role;

set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('bd.clubpost', public.create_board_post('Pitch closed next week', 'The 3G is being resurfaced.')::text, true);
select isnt(current_setting('bd.clubpost'), '', 'a coach posts club-wide');
select throws_like($$
  select public.create_board_post('Sneaky', 'x', array['9a9a9a9a-8888-4111-8111-000000000003']::uuid[])
$$, '%teams you are staff of%', 'a coach cannot target a team they do not staff');
select set_config('bd.teampost', public.create_board_post('Meet 08:45 Saturday', 'Full kit, water bottle.',
  array['9a9a9a9a-8888-4111-8111-000000000001']::uuid[])::text, true);
select isnt(current_setting('bd.teampost'), '', 'a coach posts to their own team');
reset role;

set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('bd.pushed', public.create_board_post('Autumn subs are open', 'Due 1 September.',
  null, null, true, true)::text, true);
select is((select push_to_boards from public.board_posts where id = current_setting('bd.pushed')::uuid), true,
  'an admin pushes a club post onto every board');
select set_config('bd.agepost', public.create_board_post('U12 festival', 'Sunday, all U12 squads.',
  null, array['U12'])::text, true);
select is((select count(*) from public.board_post_teams where post_id = current_setting('bd.agepost')::uuid),
  2::bigint, 'an age group expands to every team in it at posting time');
reset role;

-- B. the lobby ------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.club_lobby_posts()), 2::bigint,
  'an outsider''s lobby holds the two club posts and no targeted ones');
reset role;
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.club_lobby_posts()), 4::bigint,
  'the guardian of a squad player sees the team and age-group posts too');
select is((select pinned from public.club_lobby_posts() limit 1), true, 'pinned posts lead the lobby');
reset role;

-- C. the boards -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')), 3::bigint,
  'the team board holds its targeted posts plus the pushed club post');
select is((select audience from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where title = 'Autumn subs are open'), 'club',
  'the pushed post wears the club-wide chip');
select is((select count(*) from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where title = 'Pitch closed next week'), 0::bigint,
  'an unpushed club post stays off the boards');
reset role;
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select * from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001') $$,
  '%members, their guardians and staff%', 'an outsider cannot read a team board');
reset role;

-- D. one thread -------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.reply_board_post(current_setting('bd.teampost')::uuid, 'We can help with the barrier.') $$,
  'a guardian met the post on the team board and replies');
reset role;
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.board_post_thread(current_setting('bd.teampost')::uuid)), 1::bigint,
  'the reply sits on the main post — one thread wherever it was met');
reset role;
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.reply_board_post(current_setting('bd.teampost')::uuid, 'me too') $$,
  '%not for a team or age group you belong to%', 'an outsider cannot reply to a targeted post');
reset role;

-- E. reads ---------------------------------------------------------------------------
select is(public.board_post_audience_count(current_setting('bd.teampost')::uuid), 2,
  'the audience is the coach and the minor''s guardian — the child does not count twice');
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.mark_board_posts_read(array[current_setting('bd.teampost')::uuid, current_setting('bd.teampost')::uuid]) $$,
  'receipts are idempotent');
select is((select read_count from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where post_id = current_setting('bd.teampost')::uuid), 1,
  'the read count moves');
select is((select read_of from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where post_id = current_setting('bd.teampost')::uuid), 2,
  '"1 of 2 read" — the denominator is the audience');
select is((select my_read from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where post_id = current_setting('bd.teampost')::uuid), true, 'and the reader knows they have read it');
reset role;

-- F. notifications ---------------------------------------------------------------------
select is((select count(*) from public.outbound_messages
            where channel = 'in_app' and entity = 'board_posts'
              and entity_id = current_setting('bd.teampost')
              and person_id = current_setting('bd.parent')::uuid), 1::bigint,
  'a targeted post notifies the minor''s guardian in-app');
select is((select count(*) from public.outbound_messages
            where channel = 'in_app' and entity = 'board_posts'
              and entity_id = current_setting('bd.clubpost')), 0::bigint,
  'a club-wide post does not fan out — the lobby is its surface');

-- G. pin and delete ----------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.set_board_post_pinned(current_setting('bd.teampost')::uuid, true) $$,
  '%author or a club administrator%', 'a reader cannot pin someone else''s post');
select throws_like($$ select public.delete_board_post(current_setting('bd.teampost')::uuid) $$,
  '%author or a club administrator%', 'nor remove it');
reset role;
set local request.jwt.claims to '{"sub":"b0b0b0b0-8888-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.delete_board_post(current_setting('bd.teampost')::uuid) $$,
  'the author removes their own post');
select is((select count(*) from public.team_board_posts('9a9a9a9a-8888-4111-8111-000000000001')
            where post_id = current_setting('bd.teampost')::uuid), 0::bigint,
  'a removed post leaves the feeds');
reset role;
select isnt((select deleted_at from public.board_posts where id = current_setting('bd.teampost')::uuid), null,
  'but the row remains — soft delete, nothing destroyed');

select * from finish();
rollback;
