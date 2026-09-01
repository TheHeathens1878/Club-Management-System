-- =============================================================================
-- Registration team rules (20260825500000)
-- =============================================================================
-- What this suite covers:
--   A  shape: people.sex, and the five functions the migration adds
--   B  fa_age_band(): 31 August vs 1 September, and a season straddling the
--      new year. Fixed calendar dates, because the rule is about dates.
--   C  team_admits_sex(): a girls' team takes female players only
--   D  may_register_for_team(): own band, the band above, and the refusals
--   E  registrations_guard(): what a PARENT may write, what a CLUB ADMIN may
--      write, and the one rule that binds them both
--   F  set_person_sex() and registration_subjects(): who may, and who sees what
--
-- The teams' age groups are derived from the test child's own band rather than
-- hard-coded, so the suite says the same thing whenever CI runs it.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(44);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aabb0000-1111-4111-8111-000000000001', 'rt-admin@test.invalid',    '{"full_name": "Ada Admin"}'::jsonb),
  ('aabb0000-1111-4111-8111-000000000002', 'rt-parent@test.invalid',   '{"full_name": "Pat Parent"}'::jsonb),
  ('aabb0000-1111-4111-8111-000000000003', 'rt-stranger@test.invalid', '{"full_name": "Sam Stranger"}'::jsonb);
update public.profiles set role = 'committee' where id = 'aabb0000-1111-4111-8111-000000000001';
select set_config('rt.admin',    (select person_id::text from public.profiles where id = 'aabb0000-1111-4111-8111-000000000001'), true);
select set_config('rt.parent',   (select person_id::text from public.profiles where id = 'aabb0000-1111-4111-8111-000000000002'), true);
select set_config('rt.stranger', (select person_id::text from public.profiles where id = 'aabb0000-1111-4111-8111-000000000003'), true);
update public.people set dob = '1985-03-03'
 where id in (current_setting('rt.admin')::uuid, current_setting('rt.parent')::uuid, current_setting('rt.stranger')::uuid);

-- Four children, all the same age, so each can hold one live registration in
-- the one season without tripping `registrations_live_idx`.
select set_config('rt.dob', (current_date - interval '10 years')::date::text, true);
insert into public.people (id, first_name, last_name, dob, sex) values
  ('ccdd0000-1111-4111-8111-000000000001', 'Bram', 'Band', current_setting('rt.dob')::date, 'male'),
  ('ccdd0000-1111-4111-8111-000000000002', 'Ben',  'Band', current_setting('rt.dob')::date, 'male'),
  ('ccdd0000-1111-4111-8111-000000000003', 'Bea',  'Band', current_setting('rt.dob')::date, 'female'),
  ('ccdd0000-1111-4111-8111-000000000004', 'Bo',   'Band', current_setting('rt.dob')::date, 'male'),
  -- No date of birth at all: SG-0 says minor, and a minor the club cannot place.
  ('ccdd0000-1111-4111-8111-000000000005', 'Nod',  'Band', null, 'male');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('rt.parent')::uuid, 'ccdd0000-1111-4111-8111-000000000001', 'parent'),
  (current_setting('rt.parent')::uuid, 'ccdd0000-1111-4111-8111-000000000002', 'parent'),
  (current_setting('rt.parent')::uuid, 'ccdd0000-1111-4111-8111-000000000003', 'parent'),
  (current_setting('rt.parent')::uuid, 'ccdd0000-1111-4111-8111-000000000004', 'parent'),
  (current_setting('rt.parent')::uuid, 'ccdd0000-1111-4111-8111-000000000005', 'parent');

select set_config('rt.band', public.fa_age_band_today(current_setting('rt.dob')::date)::text, true);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('eeff0000-1111-4111-8111-000000000001', 'RT 2040/41', current_date - 30, current_date + 300, true);

insert into public.teams (id, name, age_group, gender) values
  ('bbcc0000-1111-4111-8111-000000000001', 'RT Own',       'U' || lpad(current_setting('rt.band'),                     2, '0'), 'mixed'),
  ('bbcc0000-1111-4111-8111-000000000002', 'RT Above',     'U' || lpad((current_setting('rt.band')::int + 1)::text,    2, '0'), 'boys'),
  ('bbcc0000-1111-4111-8111-000000000003', 'RT Own Girls', 'U' || lpad(current_setting('rt.band'),                     2, '0'), 'girls'),
  ('bbcc0000-1111-4111-8111-000000000004', 'RT Two Above', 'U' || lpad((current_setting('rt.band')::int + 2)::text,    2, '0'), 'mixed'),
  ('bbcc0000-1111-4111-8111-000000000005', 'RT Unlabelled', null, null);

-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'people', 'sex', 'people.sex');
select col_is_null('public', 'people', 'sex', 'people.sex is nullable — unknown is a real answer');
select has_function('public', 'fa_age_band', array['date', 'date'], 'fa_age_band(date, date)');
select has_function('public', 'team_admits_sex', array['text', 'text'], 'team_admits_sex(text, text)');
select has_function('public', 'may_register_for_team', array['uuid', 'uuid'], 'may_register_for_team(uuid, uuid)');
select has_function('public', 'set_person_sex', array['uuid', 'text'], 'set_person_sex(uuid, text)');
select has_function('public', 'registration_subjects', array['uuid[]'], 'registration_subjects(uuid[])');
select throws_ok(
  $$insert into public.people (first_name, last_name, sex) values ('No', 'Such', 'other')$$,
  '23514', null, 'people.sex admits male and female only');

-- ---------------------------------------------------------------------------
-- B. The age band, from calendar dates
-- ---------------------------------------------------------------------------
-- 1 September and 31 August are on opposite sides of the FA cohort line.
select is(public.fa_age_band('2014-09-01', '2026-08-26'), 12,
  'born 1 September 2014 is U12 in the 2026/27 season');
select is(public.fa_age_band('2014-08-31', '2026-08-26'), 13,
  'born 31 August 2014 — one day earlier — is U13');
-- The season straddles the new year, and the band does not move with it.
select is(public.fa_age_band('2014-09-01', '2026-12-31'), 12, 'still U12 on New Year''s Eve');
select is(public.fa_age_band('2014-09-01', '2027-01-01'), 12, 'still U12 on New Year''s Day');
select is(public.fa_age_band('2014-09-01', '2027-06-30'), 12, 'still U12 on the last day of the season');
select is(public.fa_age_band('2014-09-01', '2027-07-01'), 13, 'U13 on 1 July, when the season rolls over');
select is(public.fa_age_band(null::date, '2026-08-26'), null::integer, 'no date of birth, no band');

-- ---------------------------------------------------------------------------
-- C. The sex a team admits
-- ---------------------------------------------------------------------------
select ok(not public.team_admits_sex('male', 'girls'), 'a girls'' team does not admit a male player');
select ok(public.team_admits_sex('female', 'girls'), 'a girls'' team admits a female player');
select ok(public.team_admits_sex('male', 'boys'), 'a boys'' team admits a male player');
select ok(public.team_admits_sex('female', 'boys'), 'a boys'' team admits a female player too');
select ok(public.team_admits_sex(null::text, 'girls'), 'an unknown sex cannot prove a breach, so it is not one');

-- ---------------------------------------------------------------------------
-- D. Both rules, for one person and one team
-- ---------------------------------------------------------------------------
select ok(public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', 'bbcc0000-1111-4111-8111-000000000001'),
  'own age group');
select ok(public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', 'bbcc0000-1111-4111-8111-000000000002'),
  'the age group above');
select ok(not public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', 'bbcc0000-1111-4111-8111-000000000004'),
  'two age groups above is not offered');
select ok(not public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', 'bbcc0000-1111-4111-8111-000000000003'),
  'a male player and a girls'' team in his own age group');
select ok(public.may_register_for_team('ccdd0000-1111-4111-8111-000000000003', 'bbcc0000-1111-4111-8111-000000000003'),
  'a female player and the same girls'' team');
select ok(not public.may_register_for_team('ccdd0000-1111-4111-8111-000000000005', 'bbcc0000-1111-4111-8111-000000000001'),
  'an unknown date of birth is a child the club cannot place [SAFEGUARDING.md SG-0]');
select ok(public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', null::uuid),
  'a team-less registration is nobody''s age group');
select ok(public.may_register_for_team('ccdd0000-1111-4111-8111-000000000001', 'bbcc0000-1111-4111-8111-000000000005'),
  'a team whose age group the club never recorded has no band to be outside of');

-- ---------------------------------------------------------------------------
-- E. What the trigger lets through
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aabb0000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000001', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000001', '{}'::jsonb)$$,
  'a parent registers their child for their own age group');

select lives_ok(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000002', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000002', '{}'::jsonb)$$,
  'and for the age group above');

select throws_like(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000004', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000004', '{}'::jsonb)$$,
  '%own age group or the one above%',
  'but not two age groups above, and the refusal says why');

select throws_like(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000004', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000003', '{}'::jsonb)$$,
  '%girls%',
  'a male player is refused a girls'' team');

select lives_ok(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000003', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000003', '{}'::jsonb)$$,
  'a female player joins the same girls'' team');

select throws_like(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000005', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000001', '{}'::jsonb)$$,
  '%own age group or the one above%',
  'a child with no date of birth is not placed at all [SAFEGUARDING.md SG-0]');

-- The club administrator: the age band is theirs to override, the league's
-- rule is not.
reset role;
set local request.jwt.claims to '{"sub":"aabb0000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select ok(public.is_club_admin(), 'the committee login is a club_admin');

select lives_ok(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000004', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000004', '{}'::jsonb)$$,
  'a club administrator may place a child outside the two bands');

select throws_like(
  $$insert into public.registrations (person_id, season_id, team_id, form)
    values ('ccdd0000-1111-4111-8111-000000000005', 'eeff0000-1111-4111-8111-000000000001',
            'bbcc0000-1111-4111-8111-000000000003', '{}'::jsonb)$$,
  '%girls%',
  'but not a male player into a girls'' team — that rule binds everybody');

select throws_like(
  $$update public.registrations set team_id = 'bbcc0000-1111-4111-8111-000000000003'
     where person_id = 'ccdd0000-1111-4111-8111-000000000001'$$,
  '%girls%',
  'nor may they MOVE a male player onto one');

-- ---------------------------------------------------------------------------
-- F. Recording the sex, and reading the two facts back
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '{"sub":"aabb0000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.set_person_sex('ccdd0000-1111-4111-8111-000000000001', 'MALE')$$,
  'a guardian records their child''s sex, in whatever case the form posts it');
select throws_like(
  $$select public.set_person_sex('ccdd0000-1111-4111-8111-000000000001', 'unsure')$$,
  '%male or female%',
  'and only male or female');
select is((select count(*) from public.registration_subjects(
            array['ccdd0000-1111-4111-8111-000000000001',
                  'ccdd0000-1111-4111-8111-000000000003']::uuid[])),
  2::bigint, 'a guardian reads the date of birth and sex of their own children');

reset role;
set local request.jwt.claims to '{"sub":"aabb0000-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$select public.set_person_sex('ccdd0000-1111-4111-8111-000000000001', 'female')$$,
  '%able to record this%',
  'a stranger may not record it for somebody else''s child');
select is((select count(*) from public.registration_subjects(
            array['ccdd0000-1111-4111-8111-000000000001']::uuid[])),
  0::bigint, 'and sees nothing about them');

-- The table itself, asked as nobody in particular.
reset role;
set local request.jwt.claims to '{"role":"service_role"}';
select is((select sex from public.people where id = 'ccdd0000-1111-4111-8111-000000000001'),
  'male', 'the sex the guardian recorded is on the person, lower case');

select * from finish();
rollback;
