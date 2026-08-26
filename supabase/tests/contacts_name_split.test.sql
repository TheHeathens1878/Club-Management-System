-- =============================================================================
-- For all contacts, first name and last name are separate (20260825491000)
-- =============================================================================
--   A  the split: on the LAST space, and NEVER a guessed surname
--   B  booking_contacts — the display name is generated and unchanged, both
--      parts are required on a new row, and `name` cannot be written
--   C  waiting_list_entries — the same, through submit_waiting_list_entry()
--   D  emergency_contacts — the same, through set_emergency_contacts()
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);


-- A. the split ----------------------------------------------------------------
select is(public.contact_name_first('Jane Smith') || '|' || public.contact_name_last('Jane Smith'),
  'Jane|Smith', 'an ordinary two-part name splits on the space');
select is(public.contact_name_first('Mary Jane Watson') || '|' || public.contact_name_last('Mary Jane Watson'),
  'Mary Jane|Watson', 'the split is on the LAST space, so a middle name stays with the first');
select is(public.contact_name_first('Cher') || '|' || public.contact_name_last('Cher'),
  'Cher|', 'a name with no space keeps the whole string and leaves the last name BLANK, never guessed');
-- The backfill's guarantee: recomposing gives the display value back.
select is(
  (select bool_and(btrim(public.contact_name_first(n) || ' ' || public.contact_name_last(n)) = btrim(regexp_replace(n, '\s+', ' ', 'g')))
     from unnest(array['Jane Smith', 'Mary Jane Watson', 'Cher', 'Jo Smith-Jones',
                       '  Karen   Hayes ', 'Club', '(unknown)']) as n),
  true, 'splitting and recomposing reproduces the display name, whitespace collapsed');


-- B. booking_contacts -----------------------------------------------------------
insert into public.booking_contacts (first_name, last_name, email)
  values ('  Karen ', ' Hayes ', 'cns-karen@test.invalid');
select is((select name from public.booking_contacts where email = 'cns-karen@test.invalid'),
  'Karen Hayes', 'the display name is generated from the two parts');

select throws_like(
  $q$ insert into public.booking_contacts (first_name, email) values ('Mono', 'cns-mono@test.invalid') $q$,
  '%needs a first name and a last name%',
  'a new hire contact must carry both parts');

select throws_ok(
  $q$ insert into public.booking_contacts (first_name, last_name, name, email)
      values ('Gen', 'Erated', 'Something Else', 'cns-gen@test.invalid') $q$,
  '428C9', null, 'the display column cannot be written directly');


-- C. waiting_list_entries -------------------------------------------------------
insert into public.waiting_list_age_groups (age_group, is_open) values ('U07', true)
  on conflict (age_group) do update set is_open = true;

-- The legacy Neon importer still posts the one-string name; the trigger splits
-- it into the two parts rather than refusing it.
insert into public.waiting_list_entries (player_name, dob, age_group, parent_name, parent_email, parent_phone)
  values ('Legacy Kid', '2019-01-01', 'U07', 'Pat Parent', 'cns-legacy@test.invalid', '07700 900001');
select is((select player_first_name || '|' || player_last_name || '|' || parent_first_name
             from public.waiting_list_entries where parent_email = 'cns-legacy@test.invalid'),
  'Legacy|Kid|Pat',
  'a one-string waiting-list entry is split into the parts on the way in');

select lives_ok(
  $q$ select public.submit_waiting_list_entry('New', 'Kid', '2019-02-02', 'U07', 'Year 1', 'MALE',
        null, null, null, 'New', 'Parent', 'New@Parent.test', '07700 900002', false, null, true) $q$,
  'the public form submits a player and a parent, each in two boxes');
select is((select player_name || '/' || parent_name from public.waiting_list_entries
            where parent_email = 'new@parent.test'),
  'New Kid/New Parent', 'and both display names are generated from the parts');

select throws_like(
  $q$ select public.submit_waiting_list_entry('New', '  ', '2019-03-03', 'U07', 'Year 1', 'MALE',
        null, null, null, 'New', 'Parent', 'cns-blank@parent.test', '07700 900003', false, null, true) $q$,
  '%first name and last name are both required%',
  'a blank last name is refused rather than stored');


-- D. emergency_contacts ---------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0c0c0c0-4444-4111-8111-000000000001', 'cns-solo@test.invalid',
   '{"full_name": "Sam Solo", "dob": "1990-05-05"}'::jsonb);
select set_config('cns.solo', (select person_id::text from public.profiles where id = 'c0c0c0c0-4444-4111-8111-000000000001'), true);

set local request.jwt.claims to '{"sub":"c0c0c0c0-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($q$
  select public.set_emergency_contacts(current_setting('cns.solo')::uuid,
    '[{"first_name": " Partner ", "last_name": " Pat ", "phone": "07700 900777", "relationship": "Partner"}]'::jsonb)
$q$, 'an emergency contact is posted as two name boxes');
select is((select first_name || '|' || last_name || '|' || name from public.emergency_contacts
            where person_id = current_setting('cns.solo')::uuid),
  'Partner|Pat|Partner Pat', 'both parts are stored, trimmed, and the display name is generated');
select throws_like($q$
  select public.set_emergency_contacts(current_setting('cns.solo')::uuid,
    '[{"first_name": "Mono", "last_name": "", "phone": "07700 900778"}]'::jsonb)
$q$, '%needs a first name, a last name and a phone number%',
  'a blank last name is refused');
-- A legacy {name} object is still split rather than rejected outright.
select lives_ok($q$
  select public.set_emergency_contacts(current_setting('cns.solo')::uuid,
    '[{"name": "Legacy Larry", "phone": "07700 900779"}]'::jsonb)
$q$, 'a legacy one-string contact is split on the last space');
-- Asking what the TABLE holds, so out of the caller's role first.
reset role;
select is((select first_name || '|' || last_name from public.emergency_contacts
            where person_id = current_setting('cns.solo')::uuid),
  'Legacy|Larry', 'and lands in the two columns');

select * from finish();
rollback;
