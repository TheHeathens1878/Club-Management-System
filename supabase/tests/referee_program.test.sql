-- =============================================================================
-- The referee programme (20260825020000 + 20260825030000)
-- =============================================================================
--   A  self accounts: a 16-year-old signs up alone; a 15-year-old still cannot
--   B  SG-1.10: an adult may hold a 1:1 with a 17-year-old, not with a plain
--      15-year-old; a 14-year-old REFEREE is admitted with the lead flag set
--   C  the Referees group: seeded, joined on grant, left on revoke
--   D  referee_match_posts: posted by a participant, frozen after posting,
--      claimable once, by a referee only
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

-- --- A: self accounts --------------------------------------------------------
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('5e1f5e1f-aaaa-4111-8111-000000000001', 'rp-sixteen@test.invalid',
             jsonb_build_object('full_name', 'Selena Sixteen',
                                'dob', to_char(current_date - interval '16 years', 'YYYY-MM-DD'))) $$,
  'a 16-year-old signs up with no guardian consent (SG-1.10 self account)');
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('5e1f5e1f-aaaa-4111-8111-000000000002', 'rp-fifteen@test.invalid',
             jsonb_build_object('full_name', 'Finn Fifteen',
                                'dob', to_char(current_date - interval '15 years', 'YYYY-MM-DD'))) $$,
  'a 15-year-old without guardian consent is still refused (SG-10)');

-- The rest of the cast.
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e1f5e1f-aaaa-4111-8111-000000000003', 'rp-adult@test.invalid', '{"full_name": "Ada Adult", "dob": "1980-01-01"}'::jsonb),
  ('5e1f5e1f-aaaa-4111-8111-000000000004', 'rp-admin@test.invalid', '{"full_name": "Cleo Clubadmin", "dob": "1975-02-02"}'::jsonb);
select set_config('rp.adult', (select person_id::text from public.profiles where id = '5e1f5e1f-aaaa-4111-8111-000000000003'), true);
select set_config('rp.admin', (select person_id::text from public.profiles where id = '5e1f5e1f-aaaa-4111-8111-000000000004'), true);
select set_config('rp.teen',  (select person_id::text from public.profiles where id = '5e1f5e1f-aaaa-4111-8111-000000000001'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rp.admin')::uuid, 'club_admin', '5e1f5e1f-aaaa-4111-8111-000000000004');

insert into public.people (id, first_name, last_name, dob) values
  ('5e1f5e1f-aaaa-4111-8111-00000000000a', 'Kai', 'Fourteen', (current_date - interval '14 years')::date),
  ('5e1f5e1f-aaaa-4111-8111-00000000000b', 'Pip', 'Plainfifteen', (current_date - interval '15 years')::date);

-- --- B: SG-1.10 --------------------------------------------------------------
insert into public.conversations (id, type, created_by_person_id)
  values ('c0fee000-aaaa-4111-8111-000000000001', 'dm', current_setting('rp.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0fee000-aaaa-4111-8111-000000000001', current_setting('rp.adult')::uuid, 'creator');
select lives_ok(
  $$ insert into public.conversation_participants (conversation_id, person_id)
     values ('c0fee000-aaaa-4111-8111-000000000001', current_setting('rp.teen')::uuid) $$,
  'an adult and a 16-year-old may hold a 1:1 (SG-1.10)');

insert into public.conversations (id, type, created_by_person_id)
  values ('c0fee000-aaaa-4111-8111-000000000002', 'dm', current_setting('rp.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0fee000-aaaa-4111-8111-000000000002', current_setting('rp.adult')::uuid, 'creator');
select throws_ok(
  $$ insert into public.conversation_participants (conversation_id, person_id)
     values ('c0fee000-aaaa-4111-8111-000000000002', '5e1f5e1f-aaaa-4111-8111-00000000000b') $$,
  'P0001', null,
  'an adult and a plain 15-year-old are still refused (SG-1)');

-- The 14-year-old referee.
insert into public.person_roles (person_id, role, granted_by)
  values ('5e1f5e1f-aaaa-4111-8111-00000000000a', 'referee', '5e1f5e1f-aaaa-4111-8111-000000000004');
insert into public.conversations (id, type, created_by_person_id)
  values ('c0fee000-aaaa-4111-8111-000000000003', 'dm', current_setting('rp.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0fee000-aaaa-4111-8111-000000000003', current_setting('rp.adult')::uuid, 'creator');
select lives_ok(
  $$ insert into public.conversation_participants (conversation_id, person_id)
     values ('c0fee000-aaaa-4111-8111-000000000003', '5e1f5e1f-aaaa-4111-8111-00000000000a') $$,
  'an adult and a 14-year-old referee are admitted (SG-1.9 referee limb)');
select ok(
  (select supervised_by_lead from public.conversations
    where id = 'c0fee000-aaaa-4111-8111-000000000003'),
  'the referee 1:1 carries the lead-supervision flag');

-- --- C: the Referees group ---------------------------------------------------
select ok(public.referees_group_id() is not null, 'the Referees group is seeded');
select ok(
  exists (select 1 from public.conversation_participants
           where conversation_id = public.referees_group_id()
             and person_id = '5e1f5e1f-aaaa-4111-8111-00000000000a'
             and left_at is null),
  'granting the referee hat joined the group');

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rp.adult')::uuid, 'referee', '5e1f5e1f-aaaa-4111-8111-000000000004');
select ok(
  exists (select 1 from public.conversation_participants
           where conversation_id = public.referees_group_id()
             and person_id = current_setting('rp.adult')::uuid and left_at is null),
  'a second referee joined the group');

-- The poster: a coach in the group by hand (any participant may post a game).
insert into public.conversation_participants (conversation_id, person_id, basis)
  values (public.referees_group_id(), current_setting('rp.admin')::uuid, 'member');

-- --- D: match posts ----------------------------------------------------------
insert into public.messages (id, conversation_id, sender_person_id, body)
  values ('9e55a9e0-aaaa-4111-8111-000000000001', public.referees_group_id(),
          current_setting('rp.admin')::uuid, 'Referee needed: U9 v Sale Sharks');
insert into public.referee_match_posts
  (id, message_id, conversation_id, posted_by_person_id, fixture_text,
   duration_text, format_text, location_text, surface, kickoff_at, fee_text)
values
  ('90570000-aaaa-4111-8111-000000000001', '9e55a9e0-aaaa-4111-8111-000000000001',
   public.referees_group_id(), current_setting('rp.admin')::uuid,
   'Longford Park U9 v Sale Sharks', '50 mins', '7v7', 'Longford Park, M32 8QS',
   'Grass', now() + interval '9 days', '£20');

set local request.jwt.claims to '{"sub":"5e1f5e1f-aaaa-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ update public.referee_match_posts
        set fixture_text = 'Edited' where id = '90570000-aaaa-4111-8111-000000000001' $$,
  'P0001', null,
  'a posted card''s details are frozen');
select throws_ok(
  $$ update public.referee_match_posts
        set claimed_by_person_id = current_setting('rp.admin')::uuid, claimed_at = now()
      where id = '90570000-aaaa-4111-8111-000000000001' $$,
  'P0001', null,
  'a non-referee cannot claim a game');

set local request.jwt.claims to '{"sub":"5e1f5e1f-aaaa-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ update public.referee_match_posts
        set claimed_by_person_id = current_setting('rp.adult')::uuid, claimed_at = now()
      where id = '90570000-aaaa-4111-8111-000000000001' $$,
  'an approved referee claims the game');
select throws_ok(
  $$ update public.referee_match_posts
        set claimed_by_person_id = current_setting('rp.teen')::uuid
      where id = '90570000-aaaa-4111-8111-000000000001' $$,
  'P0001', null,
  'a claimed game cannot be re-claimed');

reset role;

-- Revoking the hat walks the referee out of the group.
update public.person_roles set revoked_at = now()
 where person_id = current_setting('rp.adult')::uuid and role = 'referee';
select ok(
  not exists (select 1 from public.conversation_participants
               where conversation_id = public.referees_group_id()
                 and person_id = current_setting('rp.adult')::uuid and left_at is null),
  'revoking the referee hat leaves the group');

-- And the settings guard knows the new key's bounds.
select throws_ok(
  $$ update public.site_settings set value = '13'
      where key = 'safeguarding.self_account_age' $$,
  'P0001', null,
  'self_account_age below the unsupervised-messaging age is refused');
select throws_ok(
  $$ update public.site_settings set value = '19'
      where key = 'safeguarding.self_account_age' $$,
  'P0001', null,
  'self_account_age above 18 is refused');

select * from finish();
rollback;
