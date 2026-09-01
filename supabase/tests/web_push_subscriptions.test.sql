-- =============================================================================
-- Web push subscriptions in push_tokens (20260901100000)
-- =============================================================================
-- What this suite covers:
--   A  shape: the jsonb column exists on the device register
--   B  the CHECK that keeps the two kinds of token apart — a 'web' row must
--      carry a subscription whose endpoint IS the token and whose keys are
--      present, and a native row must carry none
--   C  RLS: the browser writes its own row and nobody else's. The migration
--      adds NO policy, so this section is the proof that the existing
--      `push_tokens_self_all` really does cover the new column
--   D  the dispatcher's side: service_role reads the subscription and prunes a
--      dead endpoint by token, which is how a 404/410 is handled
--
-- Assertion count, kept in step: A 2, B 5, C 5, D 2  =  14.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures. Two logins; each fires on_auth_user_created, which creates a
-- profile and a person. Both get a dob so they are adults; the child record is
-- made by hand under the owner's guardianship.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('ab0901ab-0901-4111-8111-000000000001', 'wp-owner@test.invalid',    '{"full_name": "Wanda Owner", "dob": "1985-04-04"}'::jsonb),
  ('ab0901ab-0901-4111-8111-000000000002', 'wp-stranger@test.invalid', '{"full_name": "Stan Stranger", "dob": "1986-05-05"}'::jsonb);
select set_config('wp.owner',    (select person_id::text from public.profiles where id = 'ab0901ab-0901-4111-8111-000000000001'), true);
select set_config('wp.stranger', (select person_id::text from public.profiles where id = 'ab0901ab-0901-4111-8111-000000000002'), true);

insert into public.people (id, first_name, last_name, dob)
  values ('cd0901cd-0901-4111-8111-00000000000a', 'Kid', 'Owner', (current_date - interval '9 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('wp.owner')::uuid, 'cd0901cd-0901-4111-8111-00000000000a', 'parent');

-- A subscription the way a browser hands it over: endpoint plus the two keys
-- RFC 8291 encrypts with. The endpoint doubles as the primary key.
select set_config('wp.endpoint', 'https://fcm.googleapis.com/fcm/send/wp-owner-endpoint', true);
select set_config('wp.sub', json_build_object(
  'endpoint', current_setting('wp.endpoint'),
  'expirationTime', null,
  'keys', json_build_object(
    'p256dh', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'auth', 'BTBZMqHH6r4Tts7J_aSIgg'))::text, true);


-- ---------------------------------------------------------------------------
-- A. Shape                                                            (2)
-- ---------------------------------------------------------------------------
select has_column('public', 'push_tokens', 'web_subscription',
  'push_tokens.web_subscription — the browser''s PushSubscription');
select col_type_is('public', 'push_tokens', 'web_subscription', 'jsonb',
  'stored as jsonb, so the keys can be read without parsing in the edge function');


-- ---------------------------------------------------------------------------
-- B. The constraint that keeps native and web tokens apart            (5)
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ insert into public.push_tokens (token, person_id, platform, web_subscription, device_name)
            values (%L, %L, 'web', %L::jsonb, 'iPhone · Home Screen') $$,
         current_setting('wp.endpoint'), current_setting('wp.owner'), current_setting('wp.sub')),
  'a well-formed web subscription is accepted');

select throws_ok(
  format($$ insert into public.push_tokens (token, person_id, platform)
            values (%L, %L, 'web') $$,
         'https://fcm.googleapis.com/fcm/send/no-keys', current_setting('wp.owner')),
  '23514',
  null,
  'a web row with no subscription is refused — there would be nothing to encrypt to');

select throws_ok(
  format($$ insert into public.push_tokens (token, person_id, platform, web_subscription)
            values (%L, %L, 'web', %L::jsonb) $$,
         'https://fcm.googleapis.com/fcm/send/some-other-address', current_setting('wp.owner'),
         current_setting('wp.sub')),
  '23514',
  null,
  'the token must BE the endpoint, or pruning a dead endpoint would delete the wrong row');

select throws_ok(
  format($$ insert into public.push_tokens (token, person_id, platform, web_subscription)
            values (%L, %L, 'web', %L::jsonb) $$,
         'https://fcm.googleapis.com/fcm/send/keyless', current_setting('wp.owner'),
         json_build_object('endpoint', 'https://fcm.googleapis.com/fcm/send/keyless',
                           'keys', json_build_object('p256dh', 'x', 'auth', ''))::text),
  '23514',
  null,
  'an empty auth secret is refused: RFC 8291 has nothing to derive a key from');

select throws_ok(
  format($$ insert into public.push_tokens (token, person_id, platform, web_subscription)
            values ('ExponentPushToken[wp-native]', %L, 'ios', %L::jsonb) $$,
         current_setting('wp.owner'), current_setting('wp.sub')),
  '23514',
  null,
  'a native token carrying a web subscription is refused — the dispatcher picks its sender by platform');


-- ---------------------------------------------------------------------------
-- C. RLS, unchanged and still sufficient                              (5)
-- ---------------------------------------------------------------------------
-- The migration adds no policy. These five assertions are why it does not
-- need to: `push_tokens_self_all` is row-scoped, so it governs the new column
-- exactly as it governs `token`.

set local request.jwt.claims to '{"sub":"ab0901ab-0901-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select web_subscription #>> '{keys,auth}' from public.push_tokens
            where token = current_setting('wp.endpoint')),
  'BTBZMqHH6r4Tts7J_aSIgg', 'the member reads back their own browser''s keys');

-- The parent registers the family iPad for their child, the same gate
-- comms_preferences uses.
select lives_ok(
  format($$ insert into public.push_tokens (token, person_id, platform, web_subscription)
            values (%L, %L, 'web', %L::jsonb) $$,
         'https://fcm.googleapis.com/fcm/send/wp-child-endpoint',
         'cd0901cd-0901-4111-8111-00000000000a',
         json_build_object('endpoint', 'https://fcm.googleapis.com/fcm/send/wp-child-endpoint',
                           'keys', json_build_object('p256dh', 'BCVx', 'auth', 'BTBZ'))::text),
  'a guardian registers a device for their minor child');

reset role;
set local request.jwt.claims to '{}';

set local request.jwt.claims to '{"sub":"ab0901ab-0901-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.push_tokens where token = current_setting('wp.endpoint')),
  0::bigint, 'somebody else cannot see the subscription, so cannot see whose handset it is');

select lives_ok(
  format($$ delete from public.push_tokens where token = %L $$, current_setting('wp.endpoint')),
  'their delete runs without error…');

reset role;
set local request.jwt.claims to '{}';

select is((select count(*) from public.push_tokens where token = current_setting('wp.endpoint')),
  1::bigint, '…and removes nothing: RLS matched no row');


-- ---------------------------------------------------------------------------
-- D. The dispatcher's side                                            (2)
-- ---------------------------------------------------------------------------
set local role service_role;

select is((select web_subscription ->> 'endpoint' from public.push_tokens
            where person_id = current_setting('wp.owner')::uuid and platform = 'web'),
  current_setting('wp.endpoint'),
  'comms-dispatch reads the subscription it has to encrypt to');

-- A 404 or 410 from the push service means the subscription is gone. The
-- dispatcher prunes it by token, exactly as it does an Expo DeviceNotRegistered.
delete from public.push_tokens where token = current_setting('wp.endpoint');
reset role;

select is((select count(*) from public.push_tokens where token = current_setting('wp.endpoint')),
  0::bigint, 'a dead endpoint is pruned by token, so the next run does not waste a send on it');


select * from finish();
rollback;
