-- =============================================================================
-- A tick made at sign-up survives the trip through the inbox (20260902110000)
-- =============================================================================
--   A  THE BUG: signing up with both ticks opens both requests, pending
--   B  the coach request carries the team the form named
--   C  a team the club does not have is dropped, not fought over; the request
--      still opens
--   D  no ticks, no requests
--   E  a referee too young does NOT cost them their account — the request is
--      refused, the sign-up succeeds, and the refusal is in the audit log
--   F  a hat already held is not asked for again
--   G  the ticks follow the person the account came to REST on, not a new one:
--      an email the club already holds links, and the request lands there
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5f5f5f5f-6666-4111-8111-000000000001', 'RT 2048/49', '2048-08-01', '2049-05-31', true);
insert into public.teams (id, name, age_group, active)
  values ('7f7f7f7f-6666-4111-8111-000000000001', 'RT Under 12s', 'U12', true);


-- =============================================================================
-- A / B. both ticks, and the team
-- =============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000001', 'rt-both@test.invalid',
   '{"first_name":"Cora","last_name":"Coach","full_name":"Cora Coach","dob":"1985-05-05",
     "wants_coach": true, "wants_referee": true,
     "coach_team_id": "7f7f7f7f-6666-4111-8111-000000000001"}'::jsonb);

select set_config('rt.both', (select person_id::text from public.profiles where id = '6f6f6f6f-6666-4111-8111-000000000001'), true);

select is((select count(*) from public.account_requests where person_id = current_setting('rt.both')::uuid),
  2::bigint, 'both ticks opened a request — this is what production dropped');
select is((select status::text from public.account_requests
            where person_id = current_setting('rt.both')::uuid and requested_role = 'coach'),
  'pending', 'the coach request is pending, not granted');
select is((select team_id from public.account_requests
            where person_id = current_setting('rt.both')::uuid and requested_role = 'coach'),
  '7f7f7f7f-6666-4111-8111-000000000001'::uuid, 'and carries the team the form named');
select is((select team_id from public.account_requests
            where person_id = current_setting('rt.both')::uuid and requested_role = 'referee'),
  null, 'the referee request carries no team, because refereeing is not a squad''s');
select is((select count(*) from public.person_roles where person_id = current_setting('rt.both')::uuid
            and role in ('coach','referee') and revoked_at is null),
  0::bigint, 'and nothing has been granted by asking');


-- =============================================================================
-- C. a team the club does not have
-- =============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000002', 'rt-badteam@test.invalid',
   '{"first_name":"Bo","last_name":"Badteam","full_name":"Bo Badteam","dob":"1986-06-06",
     "wants_coach": true, "coach_team_id": "00000000-0000-0000-0000-0000000000ff"}'::jsonb);
select set_config('rt.badteam', (select person_id::text from public.profiles where id = '6f6f6f6f-6666-4111-8111-000000000002'), true);
select is((select count(*) from public.account_requests where person_id = current_setting('rt.badteam')::uuid),
  1::bigint, 'an unknown team does not lose the request');
select is((select team_id from public.account_requests where person_id = current_setting('rt.badteam')::uuid),
  null, 'it is simply dropped, and the club places them');


-- =============================================================================
-- D. no ticks
-- =============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000003', 'rt-none@test.invalid',
   '{"first_name":"Ned","last_name":"Nothing","full_name":"Ned Nothing","dob":"1987-07-07"}'::jsonb);
select is((select count(*) from public.account_requests ar
            join public.profiles pr on pr.person_id = ar.person_id
           where pr.id = '6f6f6f6f-6666-4111-8111-000000000003'),
  0::bigint, 'somebody who ticked nothing asks for nothing');


-- =============================================================================
-- E. too young to referee, and it must not cost them the account
-- =============================================================================
-- Thirteen: old enough for an account of their own under SG-10 only with a
-- guardian's consent, so this is a child the club already knows, being given
-- app access, who ticks referee out of optimism.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000010', 'rt-parent@test.invalid',
   '{"full_name":"Pia Parent","dob":"1980-01-01"}'::jsonb);
select set_config('rt.parent', (select person_id::text from public.profiles where id = '6f6f6f6f-6666-4111-8111-000000000010'), true);

insert into public.people (id, first_name, last_name, email, dob) values
  ('af6f6f6f-6666-4111-8111-000000000004', 'Tam', 'Tooyoung', 'rt-young@test.invalid',
   (current_date - interval '13 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('rt.parent')::uuid, 'af6f6f6f-6666-4111-8111-000000000004', 'parent');
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('af6f6f6f-6666-4111-8111-000000000004', current_setting('rt.parent')::uuid, 'app_account', 'v1');

select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('6f6f6f6f-6666-4111-8111-000000000004', 'rt-young@test.invalid',
     jsonb_build_object('full_name','Tam Tooyoung',
                        'dob', (current_date - interval '13 years')::date::text,
                        'wants_referee', true))
$$, 'a thirteen-year-old ticking referee still gets their account');

select is((select count(*) from public.account_requests
            where person_id = 'af6f6f6f-6666-4111-8111-000000000004'),
  0::bigint, 'no referee request is opened for them');
select is((select count(*) from public.audit_log
            where action = 'account_request.signup_refused'
              and entity_id = 'af6f6f6f-6666-4111-8111-000000000004'),
  1::bigint, 'and the refusal is findable in the audit log, not silent');


-- =============================================================================
-- F. a hat already held
-- =============================================================================
insert into public.people (id, first_name, last_name, email, dob)
  values ('af6f6f6f-6666-4111-8111-000000000005', 'Hal', 'Hasit', 'rt-hasit@test.invalid', '1979-09-09');
insert into public.person_roles (person_id, role) values ('af6f6f6f-6666-4111-8111-000000000005', 'coach');
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000005', 'rt-hasit@test.invalid',
   '{"full_name":"Hal Hasit","dob":"1979-09-09","wants_coach": true}'::jsonb);
select is((select count(*) from public.account_requests
            where person_id = 'af6f6f6f-6666-4111-8111-000000000005'),
  0::bigint, 'a coach who already holds the hat is not put in the queue again');


-- =============================================================================
-- G. the request follows the person the account came to rest on
-- =============================================================================
-- The email links to a record the club already holds (20260902100000), and the
-- tick must land on THAT person, not on a second one.
insert into public.people (id, first_name, last_name, email, dob)
  values ('af6f6f6f-6666-4111-8111-000000000006', 'Kit', 'Known', 'rt-known@test.invalid', '1983-03-03');
insert into auth.users (id, email, raw_user_meta_data) values
  ('6f6f6f6f-6666-4111-8111-000000000006', 'rt-known@test.invalid',
   '{"full_name":"Kit Known","dob":"1983-03-03","wants_referee": true}'::jsonb);

select is((select person_id from public.profiles where id = '6f6f6f6f-6666-4111-8111-000000000006'),
  'af6f6f6f-6666-4111-8111-000000000006'::uuid, 'the account joined the record the club held');
select is((select count(*) from public.account_requests
            where person_id = 'af6f6f6f-6666-4111-8111-000000000006' and requested_role = 'referee'),
  1::bigint, 'and the referee request landed on that same person');
select is((select count(*) from public.people where lower(email) = 'rt-known@test.invalid'),
  1::bigint, 'still one person at that address');

select is((select count(*) from public.account_requests where status <> 'pending'),
  0::bigint, 'nothing anywhere in this file was decided by asking');

select * from finish();
rollback;
