-- =============================================================================
-- Family linking — my_family_tree() (20260825420000)
-- =============================================================================
-- Adam, 2026-08-26: "Family linking should show you the family group you are
-- connected to in a hierarchical family tree. If an ex-spouse is also
-- registered as a guardian for the children, they shouldn't see any other
-- connected adults or children who aren't their own."
--
-- THE SCENARIO, WHICH IS THE POINT OF THIS FILE
--   Ada and Ben are separated. Both are live guardians of Xan and Yves. Ada
--   has a new partner, Pat — a connected adult Ada added, with no login of
--   their own — and Pat has a child, Zed, whom Ada has no guardianship over
--   and Ben has never heard of.
--
--     Ada's tree:  Ada → Xan → Ben          Ben's tree:  Ben → Xan → Ada
--                      → Yves → Ben                          → Yves → Ada
--                      → Pat  (connected adult)
--
--   Ben must see Xan, Yves and Ada, and must see NEITHER Pat NOR Zed. Ada must
--   not see Zed either: the screen draws the links the club holds, and Ada
--   holds no guardianship over Pat's child.
--
-- The rule is enforced by the SHAPE of my_family_tree(), not by a filter: a
-- co-guardian is a leaf and nothing recurses out of them, so the only ways
-- into a tree are a live guardianship the caller holds and the caller's own
-- household.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(25);

-- Three logins. Ada and Ben are the separated parents; Sol is a stranger who
-- must see an empty tree.
insert into auth.users (id, email, raw_user_meta_data) values
  ('fa11fa11-aaaa-4111-8111-000000000001', 'fl-ada@test.invalid',
   '{"full_name": "Ada Quinn", "dob": "1985-04-04"}'::jsonb),
  ('fa11fa11-bbbb-4111-8111-000000000002', 'fl-ben@test.invalid',
   '{"full_name": "Ben Quinn", "dob": "1984-03-03"}'::jsonb),
  ('fa11fa11-cccc-4111-8111-000000000003', 'fl-sol@test.invalid',
   '{"full_name": "Sol Alone", "dob": "1990-01-01"}'::jsonb);

select set_config('fl.ada', (select person_id::text from public.profiles
                              where id = 'fa11fa11-aaaa-4111-8111-000000000001'), true);
select set_config('fl.ben', (select person_id::text from public.profiles
                              where id = 'fa11fa11-bbbb-4111-8111-000000000002'), true);

-- ---------------------------------------------------------------------------
-- Ada builds her side of the family: two children, and a new partner with no
-- login of their own.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fl.xan', public.add_child('Xan', 'Quinn', (current_date - interval '10 years')::date)::text, true);
select set_config('fl.yves', public.add_child('Yves', 'Quinn', (current_date - interval '8 years')::date)::text, true);
select set_config('fl.pat', public.add_household_adult('Pat', 'Reed', '1986-06-06', 'fl-pat@test.invalid')::text, true);
reset role;

-- The club records Ben as the children's other guardian, and Pat as Zed's.
-- Both are administrative writes: `guardianships` is committee-write only
-- (SG-4), so a parent cannot do this and the test does not pretend they can.
insert into public.people (id, first_name, last_name, dob)
values ('fa11fa11-dddd-4111-8111-000000000004', 'Zed', 'Reed', (current_date - interval '7 years')::date);

insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('fl.ben')::uuid, current_setting('fl.xan')::uuid,  'parent'),
  (current_setting('fl.ben')::uuid, current_setting('fl.yves')::uuid, 'parent'),
  (current_setting('fl.pat')::uuid, 'fa11fa11-dddd-4111-8111-000000000004', 'parent');

-- ---------------------------------------------------------------------------
-- Capture each tree AS ITS OWNER. The claims are set explicitly every time:
-- `reset role` leaves the previous `set local request.jwt.claims` in place,
-- and a tree captured under someone else's claims would prove nothing.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_ada', public.my_family_tree()::text, true);
reset role;

set local request.jwt.claims to '{"sub":"fa11fa11-bbbb-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_ben', public.my_family_tree()::text, true);
reset role;

set local request.jwt.claims to '{"sub":"fa11fa11-cccc-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_sol', public.my_family_tree()::text, true);
reset role;

-- The assertions run as the session role against the captured text, so RLS
-- cannot answer for them either way.

-- --- Ada's tree ------------------------------------------------------------
select is(
  (current_setting('fl.tree_ada')::jsonb #>> '{self,first_name}'),
  'Ada',
  'Ada is the root of her own tree');

select is(
  (select array_agg(child ->> 'first_name' order by child ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ada')::jsonb -> 'children') child),
  array['Xan', 'Yves'],
  'Ada sees the two children she is a live guardian of');

select is(
  (select count(*)
     from jsonb_array_elements(current_setting('fl.tree_ada')::jsonb -> 'children') child
    where exists (select 1 from jsonb_array_elements(child -> 'guardians') g
                   where g ->> 'first_name' = 'Ben')),
  2::bigint,
  'both children show Ben as their other guardian — a co-parent is part of the child''s picture');

select is(
  (select count(*)
     from jsonb_array_elements(current_setting('fl.tree_ada')::jsonb -> 'children') child,
          jsonb_array_elements(child -> 'guardians') g
    where g ->> 'first_name' = 'Ada'),
  0::bigint,
  'and the caller is never listed as their own child''s other guardian');

select is(
  (select array_agg(adult ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ada')::jsonb -> 'adults') adult),
  array['Pat'],
  'Ada''s connected adults are her own household — Pat');

select ok(
  current_setting('fl.tree_ada') not like '%Zed%',
  'Ada does not see Pat''s child: Ada holds no guardianship over Zed, and the screen draws links, not guesses');

select ok(
  current_setting('fl.tree_ada') !~ '[12][0-9]{3}-[01][0-9]-[0-3][0-9]',
  'no date of birth anywhere in Ada''s tree');

select ok(
  current_setting('fl.tree_ada') not like '%"dob"%',
  'and no dob key either — the children carry an age-group hint instead');

select ok(
  (select child ->> 'age_group' ~ '^U(0[5-9]|1[0-8])$'
     from jsonb_array_elements(current_setting('fl.tree_ada')::jsonb -> 'children') child
    where child ->> 'first_name' = 'Xan'),
  'the child carries an age-group hint in the club''s U05..U18 range, computed in the database so the dob never leaves it');

-- --- Ben's tree: the ex-spouse rule ----------------------------------------
select is(
  (current_setting('fl.tree_ben')::jsonb #>> '{self,first_name}'),
  'Ben',
  'Ben is the root of his own tree');

select is(
  (select array_agg(child ->> 'first_name' order by child ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ben')::jsonb -> 'children') child),
  array['Xan', 'Yves'],
  'Ben sees the same two children — they are his as much as hers');

select is(
  (select count(*)
     from jsonb_array_elements(current_setting('fl.tree_ben')::jsonb -> 'children') child
    where exists (select 1 from jsonb_array_elements(child -> 'guardians') g
                   where g ->> 'first_name' = 'Ada')),
  2::bigint,
  'and sees Ada through them — both parents need to know who the club will ring');

select is(
  jsonb_array_length(current_setting('fl.tree_ben')::jsonb -> 'adults'),
  0,
  'Ben has no connected adults of his own, and does not inherit Ada''s');

select ok(
  current_setting('fl.tree_ben') not like '%Pat%',
  'THE RULE: Ben does not see Ada''s new partner');

select ok(
  current_setting('fl.tree_ben') not like '%Reed%',
  'not even by surname');

select ok(
  current_setting('fl.tree_ben') not like '%Zed%',
  'THE RULE: nor the new partner''s child, who is no child of Ben''s');

select ok(
  current_setting('fl.tree_ben') !~ '[12][0-9]{3}-[01][0-9]-[0-3][0-9]',
  'no date of birth anywhere in Ben''s tree');

-- --- A stranger ------------------------------------------------------------
select is(
  jsonb_array_length(current_setting('fl.tree_sol')::jsonb -> 'children')
  + jsonb_array_length(current_setting('fl.tree_sol')::jsonb -> 'adults'),
  0,
  'someone with no children and no household gets an empty tree, not somebody else''s');

select is(
  (current_setting('fl.tree_sol')::jsonb #>> '{self,first_name}'),
  'Sol',
  'and still sees themselves at the root, so the page has something to say');

-- ---------------------------------------------------------------------------
-- An ended guardianship drops out of BOTH trees.
--
-- The club records that Ben's guardianship of Xan has ended. SG-4 keeps the
-- row and lapses its effects; `my_family_tree()` reads live links on both
-- sides, so Xan leaves Ben's tree entirely and Ben leaves Xan's branch of
-- Ada's.
-- ---------------------------------------------------------------------------
update public.guardianships
   set ended_at = now()
 where guardian_person_id = current_setting('fl.ben')::uuid
   and child_person_id = current_setting('fl.xan')::uuid;

set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_ada2', public.my_family_tree()::text, true);
reset role;

set local request.jwt.claims to '{"sub":"fa11fa11-bbbb-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_ben2', public.my_family_tree()::text, true);
reset role;

select is(
  (select array_agg(child ->> 'first_name' order by child ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ada2')::jsonb -> 'children') child),
  array['Xan', 'Yves'],
  'Ada keeps both children — her own links are untouched');

select is(
  (select array_agg(g ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ada2')::jsonb -> 'children') child,
          jsonb_array_elements(child -> 'guardians') g),
  array['Ben'],
  'but Ben now appears under Yves only — the ended link left Xan''s branch');

select is(
  (select array_agg(child ->> 'first_name')
     from jsonb_array_elements(current_setting('fl.tree_ben2')::jsonb -> 'children') child),
  array['Yves'],
  'and Xan has left Ben''s tree altogether');

-- ---------------------------------------------------------------------------
-- The co-guardian read lapses at 18, exactly as `people_guardian_read` does.
--
-- SG-4: the link survives the birthday and its effects lapse in the reading
-- policies. `my_children()` keeps listing a young person whose link is live,
-- so Wyn stays on the screen — but the co-guardian's NAME is a disclosure this
-- function is the only source of, so it lapses on the same day everything else
-- the link buys does.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fl.wyn', public.add_child('Wyn', 'Quinn', (current_date - interval '17 years')::date)::text, true);
reset role;

insert into public.guardianships (guardian_person_id, child_person_id, relationship)
values (current_setting('fl.ben')::uuid, current_setting('fl.wyn')::uuid, 'parent');

set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select array_agg(g ->> 'first_name')
     from jsonb_array_elements(public.my_family_tree() -> 'children') child,
          jsonb_array_elements(child -> 'guardians') g
    where child ->> 'first_name' = 'Wyn'),
  array['Ben'],
  'while Wyn is 17 the other guardian is named');
reset role;

-- Wyn turns 19. The dob guard permits a correction that makes someone older;
-- only the direction that creates an ineligible account holder is refused.
update public.people
   set dob = (current_date - interval '19 years')::date
 where id = current_setting('fl.wyn')::uuid;

set local request.jwt.claims to '{"sub":"fa11fa11-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fl.tree_ada3', public.my_family_tree()::text, true);
reset role;

select is(
  (select count(*)
     from jsonb_array_elements(current_setting('fl.tree_ada3')::jsonb -> 'children') child
    where child ->> 'first_name' = 'Wyn'),
  1::bigint,
  'the grown-up child stays on the screen — SG-4 keeps the link');

select is(
  (select jsonb_array_length(child -> 'guardians')
     from jsonb_array_elements(current_setting('fl.tree_ada3')::jsonb -> 'children') child
    where child ->> 'first_name' = 'Wyn'),
  0,
  'but the other guardian''s name lapses at 18, as people_guardian_read does');

select * from finish();
rollback;
