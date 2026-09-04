-- =============================================================================
-- A guest in the coaches' room keeps their seat (20260904140000)
-- =============================================================================
--   The venue sync owns the seats it put out (basis 'staff') and no others: a
--   hand-added member survives every sync, while a coach who stops coaching
--   here is still walked out.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('abababab-6666-4111-8111-000000000001', 'gg-coach@test.invalid', '{"full_name": "Cal Coach", "dob": "1984-01-01"}'::jsonb),
  ('abababab-6666-4111-8111-000000000002', 'gg-guest@test.invalid', '{"full_name": "Gus Guest", "dob": "1979-02-02"}'::jsonb);
select set_config('gg.coach', (select person_id::text from public.profiles where id = 'abababab-6666-4111-8111-000000000001'), true);
select set_config('gg.guest', (select person_id::text from public.profiles where id = 'abababab-6666-4111-8111-000000000002'), true);

update public.seasons set is_current = false where is_current;
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5f5f5f5f-6666-4111-8111-000000000001', 'Guests 2043/44', '2043-08-01', '2044-05-31', true);

insert into public.venues (id, name, sort_order)
  values ('4f4f4f4f-6666-4111-8111-000000000001', 'Guest Ground', 1);
select set_config('gg.group', (select public.venue_coaches_group_id('4f4f4f4f-6666-4111-8111-000000000001')::text), true);
insert into public.resources (id, type, name, venue_id)
  values ('7f7f7f7f-6666-4111-8111-000000000001', 'pitch', 'Guest Ground ' || chr(8211) || ' Pitch 1', '4f4f4f4f-6666-4111-8111-000000000001');
insert into public.teams (id, name, home_resource_id)
  values ('7b7b7b7b-6666-4111-8111-000000000001', 'GG Reds', '7f7f7f7f-6666-4111-8111-000000000001');
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('22222222-6666-4111-8111-000000000001', current_setting('gg.coach')::uuid,
   '7b7b7b7b-6666-4111-8111-000000000001', '5f5f5f5f-6666-4111-8111-000000000001', 'coach');

select is((select basis::text from public.conversation_participants
           where conversation_id = current_setting('gg.group')::uuid
             and person_id = current_setting('gg.coach')::uuid and left_at is null),
  'staff', 'the coach is seated by the sync, as staff');

-- An administrator adds a guest by hand, the way Group settings does.
insert into public.conversation_participants (conversation_id, person_id, basis)
  values (current_setting('gg.group')::uuid, current_setting('gg.guest')::uuid, 'member');

-- Any passing sync — a Full-Time import, a home-pitch change — must not
-- walk the guest out (Adam, 2026-09-04: "keeps ejecting me … despite me
-- adding me twice").
select public.sync_venue_coaches_group('4f4f4f4f-6666-4111-8111-000000000001');
select is((select count(*) from public.conversation_participants
           where conversation_id = current_setting('gg.group')::uuid
             and person_id = current_setting('gg.guest')::uuid and left_at is null),
  1::bigint, 'a hand-added member keeps their seat through a sync');
select is((select count(*) from public.conversation_participants
           where conversation_id = current_setting('gg.group')::uuid
             and person_id = current_setting('gg.coach')::uuid and left_at is null),
  1::bigint, 'and the coach still has theirs');

-- The sync still takes back its own chairs: the coach stops coaching here.
update public.team_memberships set left_at = now()
 where id = '22222222-6666-4111-8111-000000000001';
select public.sync_venue_coaches_group('4f4f4f4f-6666-4111-8111-000000000001');
select is((select count(*) from public.conversation_participants
           where conversation_id = current_setting('gg.group')::uuid
             and person_id = current_setting('gg.coach')::uuid and left_at is null),
  0::bigint, 'a coach who stops coaching here is still walked out');
select is((select count(*) from public.conversation_participants
           where conversation_id = current_setting('gg.group')::uuid
             and person_id = current_setting('gg.guest')::uuid and left_at is null),
  1::bigint, 'the guest outlasts that sweep too');

select * from finish();
rollback;
