-- =============================================================================
-- Coaches in the Referees group; a group's settings are the club's (20260825320000)
-- =============================================================================
--   A  the coach role puts somebody in the group, and revoking it takes them out
--   B  a coach recorded on a team sheet is in it too, and leaving takes them out
--   C  a referee is still in it, and a plain member is not
--   D  the creator of a group can no longer rename or close it; an admin can
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0c0c0c0-4444-4111-8111-000000000001', 'rg-coach@test.invalid',  '{"full_name": "Cal Coach", "dob": "1984-01-01"}'::jsonb),
  ('c0c0c0c0-4444-4111-8111-000000000002', 'rg-staff@test.invalid',  '{"full_name": "Sam Staff", "dob": "1983-02-02"}'::jsonb),
  ('c0c0c0c0-4444-4111-8111-000000000003', 'rg-member@test.invalid', '{"full_name": "Mo Member", "dob": "1982-03-03"}'::jsonb),
  ('c0c0c0c0-4444-4111-8111-000000000004', 'rg-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-04-04"}'::jsonb);
select set_config('rg.coach',  (select person_id::text from public.profiles where id = 'c0c0c0c0-4444-4111-8111-000000000001'), true);
select set_config('rg.staff',  (select person_id::text from public.profiles where id = 'c0c0c0c0-4444-4111-8111-000000000002'), true);
select set_config('rg.member', (select person_id::text from public.profiles where id = 'c0c0c0c0-4444-4111-8111-000000000003'), true);
select set_config('rg.admin',  (select person_id::text from public.profiles where id = 'c0c0c0c0-4444-4111-8111-000000000004'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rg.admin')::uuid, 'club_admin', 'c0c0c0c0-4444-4111-8111-000000000004');

create or replace function pg_temp.in_referees_group(p uuid) returns boolean language sql as $$
  select exists (
    select 1 from public.conversation_participants
     where conversation_id = public.referees_group_id()
       and person_id = p and left_at is null);
$$;


-- A. the coach role -----------------------------------------------------------------
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rg.coach')::uuid, 'coach', 'c0c0c0c0-4444-4111-8111-000000000004');
select ok(pg_temp.in_referees_group(current_setting('rg.coach')::uuid),
  'granting the coach role puts them in the Referees group');

update public.person_roles set revoked_at = now()
 where person_id = current_setting('rg.coach')::uuid and role = 'coach';
select ok(not pg_temp.in_referees_group(current_setting('rg.coach')::uuid),
  'revoking it takes them out again');


-- B. the team sheet -----------------------------------------------------------------
insert into public.seasons (id, name, starts_on, ends_on)
  values ('5c5c5c5c-4444-4111-8111-000000000001', 'Referees 2037/38', '2037-08-01', '2038-05-31');
insert into public.teams (id, name, age_group)
  values ('7c7c7c7c-4444-4111-8111-000000000001', 'Whistle U15s', 'U15');
insert into public.team_memberships (id, person_id, team_id, season_id, role)
  values ('7c7c7c7c-4444-4111-8111-0000000000a1', current_setting('rg.staff')::uuid,
          '7c7c7c7c-4444-4111-8111-000000000001', '5c5c5c5c-4444-4111-8111-000000000001', 'coach');
select ok(pg_temp.in_referees_group(current_setting('rg.staff')::uuid),
  'a coach on a team sheet is in the group');

update public.team_memberships set left_at = now()
 where id = '7c7c7c7c-4444-4111-8111-0000000000a1';
select ok(not pg_temp.in_referees_group(current_setting('rg.staff')::uuid),
  'leaving the team takes them out');


-- C. referees stay, members never join ----------------------------------------------
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rg.staff')::uuid, 'referee', 'c0c0c0c0-4444-4111-8111-000000000004');
select ok(pg_temp.in_referees_group(current_setting('rg.staff')::uuid),
  'the referee hat still puts somebody in the group');
select ok(not pg_temp.in_referees_group(current_setting('rg.member')::uuid),
  'an ordinary member is not in it');
select ok(public.belongs_in_referees_group(current_setting('rg.staff')::uuid),
  'belongs_in_referees_group answers for a referee');
select ok(not public.belongs_in_referees_group(current_setting('rg.member')::uuid),
  'and says no for a member');


-- D. a group's settings are the club's ------------------------------------------------
insert into public.conversations (id, type, created_by_person_id)
  values ('c0ffee11-4444-4111-8111-000000000001', 'group', current_setting('rg.member')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0ffee11-4444-4111-8111-000000000001', current_setting('rg.member')::uuid, 'creator'),
  ('c0ffee11-4444-4111-8111-000000000001', current_setting('rg.admin')::uuid, 'member');

set local request.jwt.claims to '{"sub":"c0c0c0c0-4444-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
update public.conversations set title = 'Renamed by its creator'
 where id = 'c0ffee11-4444-4111-8111-000000000001';
select is(
  (select count(*) from public.conversations
    where id = 'c0ffee11-4444-4111-8111-000000000001' and title = 'Renamed by its creator'), 0::bigint,
  'the person who created a group can no longer rename it');
reset role;

set local request.jwt.claims to '{"sub":"c0c0c0c0-4444-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
update public.conversations set title = 'Renamed by the club', closed_at = now()
 where id = 'c0ffee11-4444-4111-8111-000000000001';
select is(
  (select title from public.conversations where id = 'c0ffee11-4444-4111-8111-000000000001'),
  'Renamed by the club',
  'a club administrator renames and closes it');
reset role;

select * from finish();
rollback;
