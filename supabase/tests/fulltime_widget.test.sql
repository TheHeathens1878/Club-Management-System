-- =============================================================================
-- Full-Time widget link + pg_net fetch + club widgets (20260824130000 → 220000)
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(36);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a7a7a7a7-1111-4111-8111-000000000001', 'w-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('a7a7a7a7-1111-4111-8111-000000000002', 'w-coach@test.invalid', '{"full_name": "Cy Coach"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a7a7a7a7-1111-4111-8111-000000000001';

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d5d5d5d-1111-4111-8111-000000000001', 'Wid 2036/37', '2036-08-01', '2037-05-31', true);
insert into public.teams (id, name) values
  ('7d7d7d7d-1111-4111-8111-000000000001', 'Widget U14s'),
  ('7d7d7d7d-1111-4111-8111-000000000002', 'Page U15s');

-- -----------------------------------------------------------------------------
-- A link is either a widget or a page URL
-- -----------------------------------------------------------------------------
select lives_ok(
  $$insert into public.team_fulltime_links (team_id, source_url, widget_code, ft_team_name)
    values ('7d7d7d7d-1111-4111-8111-000000000001', 'https://fulltime.thefa.com/js/cs1.html?cs=728576966', '728576966', 'Widget U14s Mavericks')$$,
  'a widget-only link needs no league or season id');
select lives_ok(
  $$insert into public.team_fulltime_links (team_id, source_url, league_id, ft_season_id)
    values ('7d7d7d7d-1111-4111-8111-000000000002', 'https://fulltime.thefa.com/fixtures.html?league=1&selectedSeason=2', '1', '2')$$,
  'a page-URL link still works');
select throws_ok(
  $$update public.team_fulltime_links set widget_code = null where team_id = '7d7d7d7d-1111-4111-8111-000000000001'$$,
  '23514', null, 'a link must have a widget code or league+season');
select throws_ok(
  $$update public.team_fulltime_links set widget_code = '12' where team_id = '7d7d7d7d-1111-4111-8111-000000000001'$$,
  '23514', null, 'a widget code is 6–12 digits');
select throws_ok(
  $$update public.team_fulltime_links set widget_code = 'abc123456' where team_id = '7d7d7d7d-1111-4111-8111-000000000001'$$,
  '23514', null, 'a widget code is digits only');

-- Switching a page link to a widget link is an UPDATE; fixtures untouched.
insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
  values ('7d7d7d7d-1111-4111-8111-000000000002', '5d5d5d5d-1111-4111-8111-000000000001', 'Old FC', true, '2036-09-06 10:00+01', 'fulltime', '30540038');
select lives_ok(
  $$update public.team_fulltime_links
      set widget_code = '111222333', source_url = 'https://fulltime.thefa.com/js/cs1.html?cs=111222333', league_id = null, ft_season_id = null
    where team_id = '7d7d7d7d-1111-4111-8111-000000000002'$$,
  're-linking a page link as a widget link');
select is((select count(*) from public.fixtures where team_id = '7d7d7d7d-1111-4111-8111-000000000002'), 1::bigint,
  'fixtures survive the re-link');

-- -----------------------------------------------------------------------------
-- Import targets carry the widget code
-- -----------------------------------------------------------------------------
select results_eq(
  $$select team_id, widget_code, ft_team_name from public.fulltime_import_targets()
    where team_id in ('7d7d7d7d-1111-4111-8111-000000000001', '7d7d7d7d-1111-4111-8111-000000000002') order by team_id$$,
  $$values ('7d7d7d7d-1111-4111-8111-000000000001'::uuid, '728576966'::text, 'Widget U14s Mavericks'::text),
           ('7d7d7d7d-1111-4111-8111-000000000002'::uuid, '111222333'::text, 'Page U15s'::text)$$,
  'targets expose widget_code and fall back to the team name');

-- -----------------------------------------------------------------------------
-- Import trigger values
-- -----------------------------------------------------------------------------
select lives_ok(
  $$select * from public.import_fixtures('7d7d7d7d-1111-4111-8111-000000000001', '5d5d5d5d-1111-4111-8111-000000000001', '[]'::jsonb, 'manual_widget',
      'https://fulltime.thefa.com/js/cs1.html?cs=728576966')$$,
  'manual_widget is an accepted trigger');
select throws_ok(
  $$select * from public.import_fixtures('7d7d7d7d-1111-4111-8111-000000000001', '5d5d5d5d-1111-4111-8111-000000000001', '[]'::jsonb, 'browser_widget')$$,
  '23514', null, 'browser_widget (never used) is not');

-- -----------------------------------------------------------------------------
-- pg_net fetch: who may call, what may be fetched, what may be read back
-- -----------------------------------------------------------------------------
select has_function('public', 'fulltime_http_get', array['text'], 'fulltime_http_get exists');
select has_function('public', 'fulltime_http_result', array['bigint'], 'fulltime_http_result exists');
select ok((select relrowsecurity from pg_class where oid = 'public.fulltime_http_requests'::regclass), 'RLS on fulltime_http_requests');
select ok(not has_function_privilege('anon', 'public.fulltime_http_get(text)', 'EXECUTE'), 'anon cannot fetch');

-- service_role (no auth.uid()) may fetch a Full-Time URL; the request is recorded.
select lives_ok(
  $$select set_config('w.req', public.fulltime_http_get('https://fulltime.thefa.com/js/cs1.html?cs=728576966')::text, true)$$,
  'service role issues a widget fetch');
select is((select url from public.fulltime_http_requests where id = current_setting('w.req')::bigint),
  'https://fulltime.thefa.com/js/cs1.html?cs=728576966', 'the request is recorded');
select throws_ok(
  $$select public.fulltime_http_get('https://example.com/anything')$$,
  '22023', null, 'only Full-Time URLs may be fetched');
select throws_ok(
  $$select public.fulltime_http_get('http://fulltime.thefa.com/js/cs1.html?cs=1')$$,
  '22023', null, 'and only over https');

-- Not done yet (the worker never runs inside this transaction) reads as done=false.
select results_eq(
  $$select done, status_code from public.fulltime_http_result(current_setting('w.req')::bigint)$$,
  $$values (false, null::integer)$$, 'a pending request reads as not done');
-- A pg_net id that did not come from fulltime_http_get is refused.
select throws_ok(
  $$select * from public.fulltime_http_result(-1)$$,
  '22023', null, 'an unknown request id cannot be read');

-- -----------------------------------------------------------------------------
-- Nightly prefetch
-- -----------------------------------------------------------------------------
select is(public.fulltime_source_url('728576966', 'https://fulltime.thefa.com/fixtures.html?league=1'),
  'https://fulltime.thefa.com/js/cs1.html?cs=728576966', 'a widget link prefetches the widget');
select is(public.fulltime_source_url(null, 'https://fulltime.thefa.com/fixtures.html?league=1'),
  'https://fulltime.thefa.com/fixtures.html?league=1', 'a page link prefetches the page');
-- Club codes come from site_settings; malformed values are ignored; a value
-- may carry several codes (the girls' league has its own club widget).
select is((select count(*) from public.fulltime_club_codes()), 0::bigint, 'no club codes configured yet');
insert into public.site_settings (key, value) values
  ('fulltime_club_fixtures_code', '885630049 442066767'),
  ('fulltime_club_results_code', 'not-a-code');
select results_eq(
  $$select kind, code from public.fulltime_club_codes() order by code$$,
  $$values ('fixtures'::text, '442066767'::text), ('fixtures'::text, '885630049'::text)$$,
  'several club codes per setting; malformed values filtered');
update public.site_settings set value = '114930447' where key = 'fulltime_club_results_code';

-- Two team links share one widget URL with the second team; prefetch queues
-- each distinct URL once: shared team URL + three club URLs = 4.
update public.team_fulltime_links
  set widget_code = '728576966', source_url = 'https://fulltime.thefa.com/js/cs1.html?cs=728576966'
  where team_id = '7d7d7d7d-1111-4111-8111-000000000002';
select is(public.fulltime_prefetch(), 4, 'prefetch queues each distinct URL once (shared link + 3 club codes)');
select results_eq(
  $$select count(*) from public.fulltime_prefetched_url('https://fulltime.thefa.com/js/cs1.html?cs=728576966')$$,
  $$values (1::bigint)$$, 'the prefetch is found by URL');
select is((select count(*) from public.fulltime_prefetches where url = 'https://fulltime.thefa.com/js/cs1.html?cs=114930447' and team_id is null), 1::bigint,
  'a club widget prefetch carries no team');
update public.fulltime_prefetches set created_at = now() - interval '2 hours';
select is((select count(*) from public.fulltime_prefetched_url('https://fulltime.thefa.com/js/cs1.html?cs=728576966')), 0::bigint,
  'a stale prefetch is not offered');
select ok(not has_function_privilege('authenticated', 'public.fulltime_prefetch()', 'EXECUTE'), 'prefetch is service_role only');
select ok(not has_function_privilege('authenticated', 'public.fulltime_club_codes()', 'EXECUTE'), 'club codes are service_role only');

-- -----------------------------------------------------------------------------
-- Import oversight: one notification per run to every live club_admin
-- -----------------------------------------------------------------------------
select is((select value from public.site_settings where key = 'fulltime_club_name'), 'Ashton On Mersey FC',
  'the club name is seeded');
insert into public.people (id, first_name, last_name, dob)
  values ('9e9e9e9e-1111-4111-8111-000000000001', 'Ada', 'Admin', '1980-01-01');
insert into public.person_roles (person_id, role)
  values ('9e9e9e9e-1111-4111-8111-000000000001', 'club_admin');
-- Seed data may hold live club admins of its own; count relative to them.
select set_config('w.admins',
  (select count(distinct person_id)::text from public.person_roles where role = 'club_admin' and revoked_at is null),
  true);
select is(public.notify_club_admins('Fixtures import: 3 new', 'U15 Falcons: 3 new', '/teams'),
  current_setting('w.admins')::integer, 'every live club_admin is notified');
select is((select count(*) from public.outbound_messages
           where person_id = '9e9e9e9e-1111-4111-8111-000000000001' and subject = 'Fixtures import: 3 new'), 1::bigint,
  'the notification landed as an in-app message');
update public.person_roles set revoked_at = now() where person_id = '9e9e9e9e-1111-4111-8111-000000000001';
select is(public.notify_club_admins('x', 'y'), current_setting('w.admins')::integer - 1,
  'revoked admins are not notified');

-- A coach can do neither.
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.fulltime_http_get('https://fulltime.thefa.com/js/cs1.html?cs=728576966')$$,
  '42501', null, 'a coach cannot fetch');
select throws_ok(
  $$select * from public.fulltime_http_result(1)$$,
  '42501', null, 'a coach cannot read results');
reset role;

select * from finish();

rollback;
