-- =============================================================================
-- One band below, until sixteen (20260901210000)
-- =============================================================================
--   A  the setting reader takes a stored value again (the '^d+$' bug), and a
--      value that is not a number never reaches the row
--   B  a U15-band referee: their own band, and a ceiling one below it
--   C  an adult referee: no ceiling
--   D  a referee with no date of birth: no games at all (SG-0)
--   E  claiming — the young referee takes a game below their band, is refused
--      one at it, and is refused an adult side; the adult referee takes that
--      one
--   F  a card whose age group the club never recorded is left alone
--   G  the group list answers a participant and nobody else
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(21);

-- =============================================================================
-- A. the setting reader
-- =============================================================================
-- 20260901160000 shipped '^d+$', which no number matches, so every stored
-- value was ignored in favour of the documented default. Prove a stored value
-- is read again.
update public.site_settings set value = '17' where key = 'safeguarding.referee_open_age';
select is(public.safeguarding_setting_int('safeguarding.referee_open_age'), 17,
  'a stored value is read, not silently replaced by the default');

-- And a value that is not a number never gets stored in the first place:
-- `site_settings_safeguarding_guard()` refuses it, so the fallback inside the
-- reader is belt-and-braces rather than the only thing standing there.
select throws_like($$
  update public.site_settings set value = 'sixteen' where key = 'safeguarding.referee_open_age'
$$, '%must be a plain integer%', 'a safeguarding age that is not a number is refused at the row');
update public.site_settings set value = '16' where key = 'safeguarding.referee_open_age';


-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------
-- The young referee's date of birth is expressed against the FA cohort cut-off
-- (1 September) so their band is 15 whenever this test is run: born 1 October,
-- fifteen cohorts back.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6b6b6b6b-3333-4111-8111-000000000001', 'rb-admin@test.invalid',
     '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('6b6b6b6b-3333-4111-8111-000000000002', 'rb-grownup@test.invalid',
     '{"full_name": "Gus Grownup", "dob": "1990-01-01"}'::jsonb),
  ('6b6b6b6b-3333-4111-8111-000000000003', 'rb-coach@test.invalid',
     '{"full_name": "Cy Coach", "dob": "1988-02-02"}'::jsonb),
  ('6b6b6b6b-3333-4111-8111-000000000004', 'rb-parent@test.invalid',
     '{"full_name": "Pia Parent", "dob": "1984-04-04"}'::jsonb);

select set_config('rb.admin',   (select person_id::text from public.profiles where id = '6b6b6b6b-3333-4111-8111-000000000001'), true);
select set_config('rb.grownup', (select person_id::text from public.profiles where id = '6b6b6b6b-3333-4111-8111-000000000002'), true);
select set_config('rb.coach',   (select person_id::text from public.profiles where id = '6b6b6b6b-3333-4111-8111-000000000003'), true);
select set_config('rb.parent',  (select person_id::text from public.profiles where id = '6b6b6b6b-3333-4111-8111-000000000004'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rb.admin')::uuid, 'club_admin', '6b6b6b6b-3333-4111-8111-000000000001');

insert into public.people (id, first_name, last_name, dob) values
  ('b6b6b6b6-3333-4111-8111-000000000001', 'Yara', 'Young',
     make_date(extract(year from (now() at time zone 'Europe/London'))::int
               - case when extract(month from (now() at time zone 'Europe/London'))::int >= 7 then 15 else 16 end,
               10, 1)),
  ('b6b6b6b6-3333-4111-8111-000000000002', 'Ned', 'Nodob', null);
select set_config('rb.young', 'b6b6b6b6-3333-4111-8111-000000000001', true);
select set_config('rb.nodob', 'b6b6b6b6-3333-4111-8111-000000000002', true);

-- Yara is fifteen, so her account exists on her guardian's consent — SG-10's
-- rule, and the reason a young referee can sign in at all.
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('rb.parent')::uuid, current_setting('rb.young')::uuid, 'parent');
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values (current_setting('rb.young')::uuid, current_setting('rb.parent')::uuid, 'app_account', 'v1');
insert into auth.users (id, email, raw_user_meta_data) values
  ('6b6b6b6b-3333-4111-8111-000000000005', 'rb-young@test.invalid',
     jsonb_build_object('full_name', 'Yara Young', 'person_id', current_setting('rb.young')));

-- The hats. Ned's is granted the way production's was: before the age guard
-- could speak. The trigger is disabled for that one statement rather than
-- pretending such a row cannot exist, because on production one does.
insert into public.person_roles (person_id, role) values
  (current_setting('rb.young')::uuid,   'referee'),
  (current_setting('rb.grownup')::uuid, 'referee');

alter table public.person_roles disable trigger trg_person_roles_referee_age;
insert into public.person_roles (person_id, role) values (current_setting('rb.nodob')::uuid, 'referee');
alter table public.person_roles enable trigger trg_person_roles_referee_age;


-- =============================================================================
-- B / C / D. the bands themselves
-- =============================================================================
select is((select own_band from public.referee_bands(array[current_setting('rb.young')::uuid])),
  15, 'the young referee is in the U15 band');
select is((select unlimited from public.referee_bands(array[current_setting('rb.young')::uuid])),
  false, 'and is under the open age');
select is((select max_band from public.referee_bands(array[current_setting('rb.young')::uuid])),
  14, 'so takes U14 and below — one band below their own');

select is((select unlimited from public.referee_bands(array[current_setting('rb.grownup')::uuid])),
  true, 'an adult referee is past the open age');
select is((select max_band from public.referee_bands(array[current_setting('rb.grownup')::uuid])),
  null, 'and has no ceiling');

select is((select dob_known from public.referee_bands(array[current_setting('rb.nodob')::uuid])),
  false, 'a referee with no date of birth is known not to be known');
select is(public.referee_may_take_band(current_setting('rb.nodob')::uuid, 8), false,
  'and takes nothing at all, however young the game (SG-0)');

select is(public.referee_may_take_band(current_setting('rb.young')::uuid, 14), true,
  'the young referee may take a U14 game');
select is(public.referee_may_take_band(current_setting('rb.young')::uuid, 15), false,
  'but not one at their own band');
select is(public.referee_may_take_band(current_setting('rb.young')::uuid, null), false,
  'and not an adult side');
select is(public.referee_may_take_band(current_setting('rb.grownup')::uuid, null), true,
  'which the adult referee may');
select is(public.referee_may_take_band(current_setting('rb.coach')::uuid, 8), false,
  'somebody without the hat may take nothing, whatever their age');


-- =============================================================================
-- E / F. claiming a game
-- =============================================================================
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5b5b5b5b-3333-4111-8111-000000000001', 'RB 2046/47', '2046-08-01', '2047-05-31', true);
insert into public.teams (id, name, age_group, active) values
  ('7b7b7b7b-3333-4111-8111-000000000001', 'RB Under 12s',  'U12',      true),
  ('7b7b7b7b-3333-4111-8111-000000000002', 'RB Under 15s',  'U15',      true),
  ('7b7b7b7b-3333-4111-8111-000000000003', 'RB Firsts',     'Open Age', true),
  ('7b7b7b7b-3333-4111-8111-000000000004', 'RB Unlabelled', null,       true);

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('f1f1f1f1-3333-4111-8111-000000000001', '7b7b7b7b-3333-4111-8111-000000000001',
     '5b5b5b5b-3333-4111-8111-000000000001', 'Rivals', true, '2046-10-01 10:00+00'),
  ('f1f1f1f1-3333-4111-8111-000000000002', '7b7b7b7b-3333-4111-8111-000000000002',
     '5b5b5b5b-3333-4111-8111-000000000001', 'Rivals', true, '2046-10-01 12:00+00'),
  ('f1f1f1f1-3333-4111-8111-000000000003', '7b7b7b7b-3333-4111-8111-000000000003',
     '5b5b5b5b-3333-4111-8111-000000000001', 'Rivals', true, '2046-10-01 14:00+00'),
  ('f1f1f1f1-3333-4111-8111-000000000004', '7b7b7b7b-3333-4111-8111-000000000004',
     '5b5b5b5b-3333-4111-8111-000000000001', 'Rivals', true, '2046-10-01 16:00+00');

select set_config('rb.group', (select public.referees_group_id())::text, true);
insert into public.conversation_participants (conversation_id, person_id, basis)
  values (current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid, 'staff')
  on conflict do nothing;

insert into public.messages (id, conversation_id, sender_person_id, body) values
  ('11111111-3333-4111-8111-000000000001', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid, 'U12 game'),
  ('11111111-3333-4111-8111-000000000002', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid, 'U15 game'),
  ('11111111-3333-4111-8111-000000000003', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid, 'Open age game'),
  ('11111111-3333-4111-8111-000000000004', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid, 'Unlabelled game');

insert into public.referee_match_posts (message_id, conversation_id, posted_by_person_id, fixture_id, fixture_text) values
  ('11111111-3333-4111-8111-000000000001', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid,
     'f1f1f1f1-3333-4111-8111-000000000001', 'RB Under 12s v Rivals'),
  ('11111111-3333-4111-8111-000000000002', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid,
     'f1f1f1f1-3333-4111-8111-000000000002', 'RB Under 15s v Rivals'),
  ('11111111-3333-4111-8111-000000000003', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid,
     'f1f1f1f1-3333-4111-8111-000000000003', 'RB Firsts v Rivals'),
  ('11111111-3333-4111-8111-000000000004', current_setting('rb.group')::uuid, current_setting('rb.admin')::uuid,
     'f1f1f1f1-3333-4111-8111-000000000004', 'RB Unlabelled v Rivals');

-- Yara claims, through the guard, as herself.
set local request.jwt.claims to '{"sub":"6b6b6b6b-3333-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  update public.referee_match_posts
     set claimed_by_person_id = current_setting('rb.young')::uuid, claimed_at = now()
   where message_id = '11111111-3333-4111-8111-000000000001'
$$, 'a U15-band referee takes the U12 game');

select throws_like($$
  update public.referee_match_posts
     set claimed_by_person_id = current_setting('rb.young')::uuid, claimed_at = now()
   where message_id = '11111111-3333-4111-8111-000000000002'
$$, '%one age group below their own%', 'and is refused the U15 game, with the rule named');

select throws_like($$
  update public.referee_match_posts
     set claimed_by_person_id = current_setting('rb.young')::uuid, claimed_at = now()
   where message_id = '11111111-3333-4111-8111-000000000003'
$$, '%Open Age%', 'and the open-age side, which the refusal names');

select lives_ok($$
  update public.referee_match_posts
     set claimed_by_person_id = current_setting('rb.young')::uuid, claimed_at = now()
   where message_id = '11111111-3333-4111-8111-000000000004'
$$, 'a game whose age group the club never recorded is not something the database judges');
reset role;

set local request.jwt.claims to '{"sub":"6b6b6b6b-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.referee_match_posts
     set claimed_by_person_id = current_setting('rb.grownup')::uuid, claimed_at = now()
   where message_id = '11111111-3333-4111-8111-000000000003'
$$, 'the adult referee takes the open-age game');
reset role;


-- =============================================================================
-- G. who may read the list
-- =============================================================================
set local request.jwt.claims to '{"sub":"6b6b6b6b-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select ok((select count(*) from public.referees_group_bands()) >= 2,
  'a club administrator sees the group''s bands');
reset role;

set local request.jwt.claims to '{"sub":"6b6b6b6b-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.referees_group_bands()), 0::bigint,
  'somebody outside the group sees nothing');
reset role;

select * from finish();
rollback;
