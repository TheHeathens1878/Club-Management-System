-- =============================================================================
-- Asking for a hat on somebody else's behalf (20260901200000)
-- =============================================================================
--   A  a parent ticks "referee" beside their 14-year-old: a pending request,
--      and no role granted
--   B  the same tick twice returns the same request — the form may be
--      submitted again without a constraint violation
--   C  a twelve-year-old is refused, and the refusal names the date
--   D  a login-less connected adult can be asked for; a stranger cannot
--   E  a coach with no team is allowed, and approving grants the hat alone —
--      no team membership is invented
--   F  the household can READ what it asked for; an outsider cannot
--   G  a role already held asks for nothing
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(19);

-- -----------------------------------------------------------------------------
-- People. The parent and the outsider hold logins; the child and the connected
-- adult do not, which is the whole reason this function exists.
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('7e7e7e7e-2222-4111-8111-000000000001', 'jr-parent@test.invalid',
     '{"full_name": "Pia Parent", "dob": "1982-04-04"}'::jsonb),
  ('7e7e7e7e-2222-4111-8111-000000000002', 'jr-outsider@test.invalid',
     '{"full_name": "Otto Outside", "dob": "1981-05-05"}'::jsonb),
  ('7e7e7e7e-2222-4111-8111-000000000003', 'jr-admin@test.invalid',
     '{"full_name": "Ada Admin", "dob": "1975-06-06"}'::jsonb);

select set_config('jr.parent',   (select person_id::text from public.profiles where id = '7e7e7e7e-2222-4111-8111-000000000001'), true);
select set_config('jr.outsider', (select person_id::text from public.profiles where id = '7e7e7e7e-2222-4111-8111-000000000002'), true);
select set_config('jr.admin',    (select person_id::text from public.profiles where id = '7e7e7e7e-2222-4111-8111-000000000003'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('jr.admin')::uuid, 'club_admin', '7e7e7e7e-2222-4111-8111-000000000003');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5a5a5a5a-2222-4111-8111-000000000001', 'JR 2044/45', '2044-08-01', '2045-05-31', true);

insert into public.teams (id, name, age_group, active)
  values ('7a7a7a7a-2222-4111-8111-000000000001', 'JR Colts', 'U14', true);

-- The parent's own household, created the way the joining wizard creates it.
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('jr.teen',
  (select public.add_child('Tess', 'Teen', (current_date - interval '14 years 2 months')::date))::text, true);
select set_config('jr.tween',
  (select public.add_child('Toby', 'Tween', (current_date - interval '12 years')::date))::text, true);
select set_config('jr.adult',
  (select public.add_household_adult(
      p_first_name => 'Alex', p_last_name => 'Lodger', p_dob => '1990-07-07',
      p_confirm_new => true))::text, true);
reset role;


-- =============================================================================
-- A. the tick beside a 14-year-old
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select set_config('jr.req',
  (select public.request_role_for(current_setting('jr.teen')::uuid, 'referee'))::text, true);

select isnt(nullif(current_setting('jr.req'), ''), null,
  'a parent may ask for the referee hat on behalf of their 14-year-old');
reset role;

select is((select status::text from public.account_requests where id = current_setting('jr.req')::uuid),
  'pending', 'the request lands pending — nobody is granted anything by asking');
select is((select requested_role from public.account_requests where id = current_setting('jr.req')::uuid),
  'referee', 'and it is a referee request');
select is((select count(*) from public.person_roles
            where person_id = current_setting('jr.teen')::uuid and revoked_at is null),
  0::bigint, 'the child holds no role yet');


-- =============================================================================
-- B. twice is once
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.request_role_for(current_setting('jr.teen')::uuid, 'referee'),
  current_setting('jr.req')::uuid,
  'submitting the form again returns the open request rather than failing on the unique index');
reset role;


-- =============================================================================
-- C. twelve is too young, and the refusal says when
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$select public.request_role_for(current_setting('jr.tween')::uuid, 'referee')$$,
  '%registers referees from age 14%',
  'a twelve-year-old is refused, in the database''s own words');
reset role;

select is((select count(*) from public.account_requests where person_id = current_setting('jr.tween')::uuid),
  0::bigint, 'and no row is written');


-- =============================================================================
-- D. the connected adult yes, a stranger no
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select isnt(public.request_role_for(current_setting('jr.adult')::uuid, 'referee'), null,
  'a login-less connected adult can be asked for');
select throws_ok(
  $$select public.request_role_for(current_setting('jr.outsider')::uuid, 'referee')$$,
  '42501',
  null,
  'somebody else''s account is not yours to speak for');
reset role;


-- =============================================================================
-- E. a coach with no team
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('jr.coachreq',
  (select public.request_role_for(current_setting('jr.parent')::uuid, 'coach'))::text, true);
select isnt(nullif(current_setting('jr.coachreq'), ''), null,
  '"I coach" may be said before anybody has been placed on a squad');
reset role;

set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select outcome from public.approve_account_request(current_setting('jr.coachreq')::uuid)),
  'approved', 'an administrator approves it');
reset role;

select is((select count(*) from public.person_roles
            where person_id = current_setting('jr.parent')::uuid and role = 'coach' and revoked_at is null),
  1::bigint, 'the club-wide coach hat is granted');
select is((select count(*) from public.team_memberships where person_id = current_setting('jr.parent')::uuid),
  0::bigint, 'and no team membership is invented');


-- =============================================================================
-- F. reading back what you asked for
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.account_requests where person_id = current_setting('jr.teen')::uuid),
  1::bigint, 'the parent can see the request they made for their child');
reset role;

set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.account_requests where person_id = current_setting('jr.teen')::uuid),
  0::bigint, 'and somebody outside the household sees nothing');
select throws_ok(
  $$select public.request_role_for(current_setting('jr.teen')::uuid, 'coach')$$,
  '42501',
  null,
  'nor can they ask on that child''s behalf');
reset role;


-- =============================================================================
-- G. a hat already worn
-- =============================================================================
set local request.jwt.claims to '{"sub":"7e7e7e7e-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.request_role_for(current_setting('jr.parent')::uuid, 'coach'), null,
  'a role already held is a fact, not a request');
reset role;


-- =============================================================================
-- And the constraint still holds where a squad IS named
-- =============================================================================
select throws_ok(
  $$insert into public.account_requests (person_id, requested_role)
    values (current_setting('jr.parent')::uuid, 'manager')$$,
  '23514',
  null,
  'a manager request still has to name the team it is about');

select is((select count(*) from public.account_requests
            where person_id = current_setting('jr.parent')::uuid
              and requested_role = 'coach' and team_id is null),
  1::bigint, 'exactly one team-less coach request was ever written');

select * from finish();
rollback;
