-- =============================================================================
-- An age group can name a range, or name no youth band at all (20260825530000)
-- =============================================================================
-- Production holds nine teams whose age group is not shaped like "U12":
-- 'U05<en dash>U08' (U05 Wildcats), 'Open Age' (six sides) and 'Vets' (two).
-- Before this migration the first was offered to nobody and all nine were
-- open to anybody. What this suite covers:
--
--   A  shape: the two new functions
--   B  age_group_band_range(): one band, a range, every dash, and the labels
--      that name no band at all
--   C  age_group_is_adult(): recognised positively; silence is not a statement
--   D  may_register_for_team(): a child inside a range, a child outside it, a
--      child kept out of an adult side, an adult kept out of a range
--   E  registrations_guard(): the two cases end to end, as a parent
--
-- The teams' age groups are derived from the test child's own band, so the
-- suite says the same thing whenever CI runs it.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(28);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9b0b0-5151-4111-8111-000000000001', 'agr-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb);
select set_config('agr.parent', (select person_id::text from public.profiles where id = 'a9a9b0b0-5151-4111-8111-000000000001'), true);
update public.people set dob = '1985-03-03', sex = 'male' where id = current_setting('agr.parent')::uuid;

select set_config('agr.dob', (current_date - interval '10 years')::date::text, true);
select set_config('agr.band', public.fa_age_band_today(current_setting('agr.dob')::date)::text, true);

-- Three children of the same age: one live registration each, in one season.
insert into public.people (id, first_name, last_name, dob, sex) values
  ('c9c9b0b0-5151-4111-8111-000000000001', 'Rae', 'Range', current_setting('agr.dob')::date, 'female'),
  ('c9c9b0b0-5151-4111-8111-000000000002', 'Rex', 'Range', current_setting('agr.dob')::date, 'male'),
  ('c9c9b0b0-5151-4111-8111-000000000003', 'Ros', 'Range', current_setting('agr.dob')::date, 'female');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('agr.parent')::uuid, 'c9c9b0b0-5151-4111-8111-000000000001', 'parent'),
  (current_setting('agr.parent')::uuid, 'c9c9b0b0-5151-4111-8111-000000000002', 'parent'),
  (current_setting('agr.parent')::uuid, 'c9c9b0b0-5151-4111-8111-000000000003', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('e9e9b0b0-5151-4111-8111-000000000001', 'AGR 2040/41', current_date - 30, current_date + 300, true);

-- The range spelling on production is an EN DASH, so that is what is tested.
insert into public.teams (id, name, age_group, gender) values
  ('b9b9b0b0-5151-4111-8111-000000000001', 'AGR Covering',
     'U' || lpad((current_setting('agr.band')::int - 1)::text, 2, '0') || chr(8211)
         || 'U' || lpad((current_setting('agr.band')::int + 1)::text, 2, '0'), 'mixed'),
  ('b9b9b0b0-5151-4111-8111-000000000002', 'AGR Beyond',
     'U' || lpad((current_setting('agr.band')::int + 3)::text, 2, '0') || chr(8211)
         || 'U' || lpad((current_setting('agr.band')::int + 5)::text, 2, '0'), 'mixed'),
  ('b9b9b0b0-5151-4111-8111-000000000003', 'AGR Open Age',  'Open Age', 'mixed'),
  ('b9b9b0b0-5151-4111-8111-000000000004', 'AGR Vets',      'Vets',     'mixed'),
  ('b9b9b0b0-5151-4111-8111-000000000005', 'AGR Unlabelled', null,      null);


-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------
select has_function('public', 'age_group_band_range', array['text'], 'age_group_band_range(text)');
select has_function('public', 'age_group_is_adult',   array['text'], 'age_group_is_adult(text)');


-- ---------------------------------------------------------------------------
-- B. What an age group names
-- ---------------------------------------------------------------------------
select is(public.age_group_band_range('U12'), int4range(12, 12, '[]'),
  'a single band is a range of one');
select is(public.age_group_band_range('u8'), int4range(8, 8, '[]'),
  'and it does not matter how it is padded or cased');
select is(public.age_group_band_range('U05' || chr(8211) || 'U08'), int4range(5, 8, '[]'),
  'an EN DASH range is read — this is the spelling U05 Wildcats carries');
select is(public.age_group_band_range('U05-U08'), int4range(5, 8, '[]'),
  'so is a plain hyphen');
select is(public.age_group_band_range('U5 - U8'), int4range(5, 8, '[]'),
  'so is one with spaces round the dash');
select is(public.age_group_band_range('U05-8'), int4range(5, 8, '[]'),
  'and the second half need not repeat the U');
select is(public.age_group_band_range('U08-U05'), int4range(5, 8, '[]'),
  'a range written backwards is put the right way round');
select is(public.age_group_band_range('Open Age'), null,
  'an adult side names no youth band');
select is(public.age_group_band_range(''), null, 'neither does a blank');
select is(public.age_group_band_range(null), null, 'nor an absent one');


-- ---------------------------------------------------------------------------
-- C. An age group that says it is an adult side
-- ---------------------------------------------------------------------------
select ok(public.age_group_is_adult('Open Age'), '"Open Age" is an adult side');
select ok(public.age_group_is_adult('Vets'), 'so is "Vets"');
select ok(public.age_group_is_adult('O45'), 'so is "O45"');
select ok(not public.age_group_is_adult('U12'), 'a U-band is not');
select ok(not public.age_group_is_adult(''),
  'and a blank is NOT an adult side — the club has said nothing, which is not the same thing');
select ok(not public.age_group_is_adult('Openers'),
  'a longer word that merely contains one is not caught');


-- ---------------------------------------------------------------------------
-- D. The rule over a range
-- ---------------------------------------------------------------------------
select ok(public.may_register_for_team('c9c9b0b0-5151-4111-8111-000000000001',
                                       'b9b9b0b0-5151-4111-8111-000000000001'),
  'a child whose band the range covers may be registered — this is the case that was broken');
select ok(not public.may_register_for_team('c9c9b0b0-5151-4111-8111-000000000001',
                                           'b9b9b0b0-5151-4111-8111-000000000002'),
  'a range three bands above them may not');
select ok(not public.may_register_for_team('c9c9b0b0-5151-4111-8111-000000000001',
                                           'b9b9b0b0-5151-4111-8111-000000000003'),
  'a child is not registered into an Open Age side');
select ok(not public.may_register_for_team('c9c9b0b0-5151-4111-8111-000000000001',
                                           'b9b9b0b0-5151-4111-8111-000000000004'),
  'nor into the Vets');
select ok(public.may_register_for_team(current_setting('agr.parent')::uuid,
                                       'b9b9b0b0-5151-4111-8111-000000000003'),
  'an adult may be registered for the Open Age side');
select ok(not public.may_register_for_team(current_setting('agr.parent')::uuid,
                                           'b9b9b0b0-5151-4111-8111-000000000001'),
  'and an adult may not be registered into a youth range');
select ok(public.may_register_for_team('c9c9b0b0-5151-4111-8111-000000000001',
                                       'b9b9b0b0-5151-4111-8111-000000000005'),
  'a team whose age group the club never recorded is not something the database can refuse');


-- ---------------------------------------------------------------------------
-- E. End to end, as the parent
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9b0b0-5151-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.registrations (person_id, team_id, season_id)
     values ('c9c9b0b0-5151-4111-8111-000000000001',
             'b9b9b0b0-5151-4111-8111-000000000001',
             'e9e9b0b0-5151-4111-8111-000000000001') $$,
  'a parent registers their child for the team whose range covers them');

select throws_like(
  $$ insert into public.registrations (person_id, team_id, season_id)
     values ('c9c9b0b0-5151-4111-8111-000000000002',
             'b9b9b0b0-5151-4111-8111-000000000003',
             'e9e9b0b0-5151-4111-8111-000000000001') $$,
  '%own age group or the one above%',
  'and is refused the Open Age side for another of their children');

select throws_like(
  $$ insert into public.registrations (person_id, team_id, season_id)
     values ('c9c9b0b0-5151-4111-8111-000000000003',
             'b9b9b0b0-5151-4111-8111-000000000002',
             'e9e9b0b0-5151-4111-8111-000000000001') $$,
  '%own age group or the one above%',
  'and is refused a range three bands above them');

reset role;

select * from finish();
rollback;
