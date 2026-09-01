-- =============================================================================
-- A referee is fourteen (20260901160000)
-- =============================================================================
--   A  the role is refused below 14, whichever path reaches it
--   B  the boundary is the birthday itself, not the year
--   C  an unknown date of birth is refused, as SG-0 refuses it everywhere
--   D  asking is refused too, with the date they can ask on
--   E  granted at 14, the Referees group picks them up
--   F  the sign-up no longer opens a referee request
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into public.people (id, first_name, last_name, dob) values
  ('4f4f4f4f-4444-4111-8111-000000000001', 'Fay',  'Fourteen', (current_date - interval '14 years')::date),
  ('4f4f4f4f-4444-4111-8111-000000000002', 'Theo', 'Thirteen', (current_date - interval '14 years' + interval '1 day')::date),
  ('4f4f4f4f-4444-4111-8111-000000000003', 'Ness', 'Nodob',    null);

-- A / B / C. the role -----------------------------------------------------------
select throws_like($$
  insert into public.person_roles (person_id, role)
  values ('4f4f4f4f-4444-4111-8111-000000000002', 'referee')
$$, '%registers referees from age%', 'a day short of 14 is refused the referee role');

select lives_ok($$
  insert into public.person_roles (person_id, role)
  values ('4f4f4f4f-4444-4111-8111-000000000001', 'referee')
$$, 'and exactly 14 today is allowed — the boundary is the birthday');

select throws_like($$
  insert into public.person_roles (person_id, role)
  values ('4f4f4f4f-4444-4111-8111-000000000003', 'referee')
$$, '%date of birth is needed%', 'an unknown date of birth is refused, as SG-0 refuses it everywhere else');

-- Another role on the same too-young person is untouched by the rule.
select lives_ok($$
  insert into public.person_roles (person_id, role)
  values ('4f4f4f4f-4444-4111-8111-000000000002', 'member')
$$, 'and the rule is about refereeing, not about roles');

-- D. asking ----------------------------------------------------------------------
select throws_like($$
  insert into public.account_requests (person_id, requested_role)
  values ('4f4f4f4f-4444-4111-8111-000000000002', 'referee')
$$, '%you can ask from%', 'asking too young is refused, and told when they may ask');

-- E. the group -------------------------------------------------------------------
select is(
  (select count(*)::int
     from public.conversation_participants cp
    where cp.conversation_id = public.referees_group_id()
      and cp.person_id = '4f4f4f4f-4444-4111-8111-000000000001'
      and cp.left_at is null),
  1,
  'granting the role puts them in the Referees group');

-- F. the side door ----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('4f4f4f4f-4444-4111-8111-00000000000a', 'ref-door@test.invalid',
   '{"first_name": "Sid", "last_name": "Door", "dob": "1990-01-01", "requested_role": "referee"}'::jsonb);

select is(
  (select count(*)::int from public.account_requests ar
     join public.profiles pr on pr.person_id = ar.person_id
    where pr.id = '4f4f4f4f-4444-4111-8111-00000000000a'),
  0,
  'a sign-up asking to referee in its metadata no longer opens a request');

select * from finish();
rollback;
