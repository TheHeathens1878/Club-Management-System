-- =============================================================================
-- SG-1 protects the children the club knows about (20260902120000)
-- =============================================================================
--   A  THE DEADLOCK: two people with no date of birth share a room, and either
--      one of them can be given their real date of birth — in either order
--   B  THE VETS ROOM: a room holding one person with no date of birth admits a
--      second adult
--   C  a KNOWN child alone with an adult is still refused — SG-1 is narrowed,
--      not removed
--   D  and is still allowed when the adult is that child's own guardian
--   E  SG-1.2 still refuses a date of birth that would create a known 1:1
--   F  is_minor() is untouched: an unknown date of birth is still a minor
--      everywhere else in the database
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0da0000-7777-4111-8111-000000000001', 'km-adult@test.invalid',
   '{"full_name": "Ada Adult", "dob": "1980-01-01"}'::jsonb),
  ('c0da0000-7777-4111-8111-000000000002', 'km-parent@test.invalid',
   '{"full_name": "Gwen Guardian", "dob": "1985-03-03"}'::jsonb);
select set_config('km.adult',  (select person_id::text from public.profiles where id = 'c0da0000-7777-4111-8111-000000000001'), true);
select set_config('km.parent', (select person_id::text from public.profiles where id = 'c0da0000-7777-4111-8111-000000000002'), true);

-- Four coaches the club has never recorded a date of birth for — the state 33
-- of this club's 45 coaches were in when this rule was written — and one child
-- whose age it does know.
insert into public.people (id, first_name, last_name) values
  ('c0da0000-7777-4111-8111-0000000000c1', 'Matt', 'Nodob'),
  ('c0da0000-7777-4111-8111-0000000000c2', 'Rob',  'Nodob'),
  ('c0da0000-7777-4111-8111-0000000000c3', 'Ken',  'Nodob'),
  ('c0da0000-7777-4111-8111-0000000000c4', 'Dave', 'Nodob');
insert into public.people (id, first_name, last_name, dob) values
  ('c0da0000-7777-4111-8111-0000000000d1', 'Noah', 'Known', (current_date - interval '10 years')::date),
  ('c0da0000-7777-4111-8111-0000000000d2', 'Nell', 'Known', (current_date - interval '10 years')::date);


-- =============================================================================
-- A. THE DEADLOCK
-- =============================================================================
-- Two coaches, no dates of birth, one room. Under the old reading this was a
-- room of two children — allowed — and giving EITHER of them their real date of
-- birth turned it into an adult and a child and was refused, in either order.
-- The club could never record the fact that would have satisfied the rule.

insert into public.conversations (id, type, created_by_person_id)
  values ('c0117777-7777-4111-8111-000000000001', 'group', current_setting('km.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0117777-7777-4111-8111-000000000001', 'c0da0000-7777-4111-8111-0000000000c1', 'member');
select lives_ok($$
  insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0117777-7777-4111-8111-000000000001', 'c0da0000-7777-4111-8111-0000000000c2', 'member')
$$, 'two people with no date of birth may share a room');

select lives_ok($$
  update public.people set dob = '1989-09-19'
   where id = 'c0da0000-7777-4111-8111-0000000000c1'
$$, 'and the first of them can be given their real date of birth — the write production refused');

select lives_ok($$
  update public.people set dob = '1978-04-02'
   where id = 'c0da0000-7777-4111-8111-0000000000c2'
$$, 'and so can the second');

select ok(public.conversation_is_compliant('c0117777-7777-4111-8111-000000000001'),
  'leaving a room of two adults, which is what it always was');


-- =============================================================================
-- B. THE VETS ROOM
-- =============================================================================
-- One coach with no date of birth, and a grown man being registered for the
-- over-45s. Refusing that was the first thing Adam hit.

insert into public.conversations (id, type, created_by_person_id)
  values ('c0117777-7777-4111-8111-000000000002', 'group', current_setting('km.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0117777-7777-4111-8111-000000000002', 'c0da0000-7777-4111-8111-0000000000c3', 'staff');
select lives_ok($$
  insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0117777-7777-4111-8111-000000000002', current_setting('km.adult')::uuid, 'member')
$$, 'an adult joins a room whose only other member has no date of birth');


-- =============================================================================
-- C / D. WHAT IS STILL REFUSED
-- =============================================================================
-- The narrowing gives up the shield over a child the club has no age for. It
-- gives up nothing at all over a child it does.

insert into public.conversations (id, type, created_by_person_id)
  values ('c0117777-7777-4111-8111-000000000003', 'dm', current_setting('km.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0117777-7777-4111-8111-000000000003', current_setting('km.adult')::uuid, 'creator');
select throws_ok($$
  insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0117777-7777-4111-8111-000000000003', 'c0da0000-7777-4111-8111-0000000000d1', 'member')
$$, 'P0001', null,
  'a ten-year-old the club has a date of birth for is still refused a 1:1 with an adult');

insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('km.parent')::uuid, 'c0da0000-7777-4111-8111-0000000000d2', 'parent');
insert into public.conversations (id, type, created_by_person_id)
  values ('c0117777-7777-4111-8111-000000000004', 'dm', current_setting('km.parent')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0117777-7777-4111-8111-000000000004', current_setting('km.parent')::uuid, 'creator');
select lives_ok($$
  insert into public.conversation_participants (conversation_id, person_id, basis)
  values ('c0117777-7777-4111-8111-000000000004', 'c0da0000-7777-4111-8111-0000000000d2', 'member')
$$, 'their own guardian still may (SG-1.4)');

-- SG-1.8 since 20260902160000: ending the guardianship that excuses that room
-- is RECORDED rather than refused — the placement has ended whether or not the
-- database says so — and SG-1.7 shuts the room instead.
select lives_ok($$
  update public.guardianships set ended_at = now()
   where child_person_id = 'c0da0000-7777-4111-8111-0000000000d2'
$$, 'the guardianship can be ended, because ending it is recording a fact');
select ok(
  not public.conversation_is_compliant('c0117777-7777-4111-8111-000000000004'),
  'the room it was holding up is now non-compliant, and says so');
select throws_ok($$
  insert into public.messages (conversation_id, sender_person_id, body)
  values ('c0117777-7777-4111-8111-000000000004', current_setting('km.parent')::uuid, 'hello')
$$, 'P0001', null,
  'so nothing can be said in it (SG-1.7) — which is the rule that matters');
select is((select count(*) from public.audit_log
            where action = 'safeguarding.sg1_exposed_by_guardianship'
              and entity_id = 'c0da0000-7777-4111-8111-0000000000d2'),
  1::bigint, 'and a safeguarding lead can find it in the audit log');

-- "Does this room hold a child" answers the same way, or the admitting trigger
-- and the test it calls would disagree about the same room.
select ok(public.conversation_has_minor('c0117777-7777-4111-8111-000000000004'),
  'a room holding a child the club has an age for holds a minor');
select ok(not public.conversation_has_minor('c0117777-7777-4111-8111-000000000001'),
  'a room of two coaches does not, now that their dates of birth are on record');


-- =============================================================================
-- E. SG-1.2 STILL BINDS
-- =============================================================================
-- A date of birth that would put a KNOWN child alone with an adult is still
-- refused. This is the same guard that blocked the coach — it has not been
-- switched off, it has been told what a child is.

insert into public.conversations (id, type, created_by_person_id)
  values ('c0117777-7777-4111-8111-000000000005', 'group', current_setting('km.adult')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0117777-7777-4111-8111-000000000005', current_setting('km.adult')::uuid, 'member'),
  ('c0117777-7777-4111-8111-000000000005', 'c0da0000-7777-4111-8111-0000000000c4', 'member');
select lives_ok($$
  update public.people set dob = (current_date - interval '9 years')::date
   where id = 'c0da0000-7777-4111-8111-0000000000c4'
$$, 'a date of birth that makes somebody a child alone with an adult is RECORDED (SG-1.2, 20260902160000)');
select ok(
  not public.conversation_is_compliant('c0117777-7777-4111-8111-000000000005'),
  'the room it exposed is non-compliant');
select throws_ok($$
  insert into public.messages (conversation_id, sender_person_id, body)
  values ('c0117777-7777-4111-8111-000000000005', current_setting('km.adult')::uuid, 'hello')
$$, 'P0001', null,
  'and is shut to messages until it is put right (SG-1.7)');
select is((select count(*) from public.audit_log
            where action = 'safeguarding.sg1_exposed_by_dob'
              and entity_id = 'c0da0000-7777-4111-8111-0000000000c4'),
  1::bigint, 'with the room named in the audit log');
select lives_ok($$
  update public.people set dob = '1990-06-06'
   where id = 'c0da0000-7777-4111-8111-0000000000c4'
$$, 'the same person may be recorded as an adult');
select ok(
  public.conversation_is_compliant('c0117777-7777-4111-8111-000000000005'),
  'which puts the room right again');


-- =============================================================================
-- F. NOTHING ELSE MOVED
-- =============================================================================
-- SG-0 is intact. is_minor() is what every other rule in this database asks,
-- and it still says "unknown, so protect".

insert into public.people (id, first_name, last_name)
  values ('c0da0000-7777-4111-8111-0000000000c9', 'Una', 'Unknown');
select ok(public.is_minor('c0da0000-7777-4111-8111-0000000000c9'),
  'a person with no date of birth is still a minor to is_minor() — SG-0 is untouched');
select ok(not public.is_known_minor('c0da0000-7777-4111-8111-0000000000c9'),
  'and is not a known minor, which is the only reading SG-1 uses');
select ok(public.is_known_minor('c0da0000-7777-4111-8111-0000000000d1'),
  'a child whose date of birth the club holds is a known minor');

select * from finish();
rollback;
