-- =============================================================================
-- Full-Time widget link + pg_net fetch (20260824130000, 20260824180000)
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(22);

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
