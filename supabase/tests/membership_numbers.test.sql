-- =============================================================================
-- Every household gets a number (20260904170000)
-- =============================================================================
--   A  numbers are sequential from 1; the lead wears letter A; the card reads
--      00001A
--   B  household letters run B, C…; a soft-removed person gets their OWN
--      letter back on re-add; nobody sits under two numbers at once
--   C  the guards: a minor cannot lead; an unknown DOB cannot lead; the
--      number and the letters are immutable; the lead cannot be removed
--   D  financial spine rows are never hard-deleted
--   E  RLS: a household member sees their own account and everyone under it;
--      a stranger sees nothing; the dedicated finance role sees all
--   F  the batch issues ALPHABETICALLY by lead whatever order it was handed,
--      and attaches the household linked-adults-then-children
--   G  the preview is finance-gated and says why a lead qualifies
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(37);

-- Three logins: Ann (an ordinary member who will lead a household), a
-- dedicated finance user (finance role, NOT club_admin), and a stranger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeaaaa-2222-4222-8222-000000000001', 'mn-ann@test.invalid',
   '{"full_name": "Ann Aardvark", "dob": "1985-03-03"}'::jsonb),
  ('eeeeaaaa-2222-4222-8222-000000000002', 'mn-fin@test.invalid',
   '{"full_name": "Tess Treasurer", "dob": "1980-04-04"}'::jsonb),
  ('eeeeaaaa-2222-4222-8222-000000000003', 'mn-str@test.invalid',
   '{"full_name": "Sam Stranger", "dob": "1990-05-05"}'::jsonb);
select set_config('mn.ann', (select person_id::text from public.profiles where id = 'eeeeaaaa-2222-4222-8222-000000000001'), true);
select set_config('mn.fin', (select person_id::text from public.profiles where id = 'eeeeaaaa-2222-4222-8222-000000000002'), true);
select set_config('mn.str', (select person_id::text from public.profiles where id = 'eeeeaaaa-2222-4222-8222-000000000003'), true);

insert into public.person_roles (person_id, role)
values (current_setting('mn.fin')::uuid, 'finance');

-- People without logins, written directly: a lead, her household, and the
-- batch/preview cast.
insert into public.people (id, first_name, last_name, dob) values
  ('ffffaaaa-2222-4222-8222-000000000001', 'Lena', 'Lead',     '1975-01-01'),
  ('ffffaaaa-2222-4222-8222-000000000002', 'Milo', 'Lead',     '1977-02-02'),
  ('ffffaaaa-2222-4222-8222-000000000003', 'Nia',  'Lead',     '1979-03-03'),
  ('ffffaaaa-2222-4222-8222-000000000004', 'Bob',  'Aardvark', (current_date - interval '10 years')::date),
  ('ffffaaaa-2222-4222-8222-000000000005', 'Cara', 'Linked',   '1986-06-06'),
  ('ffffaaaa-2222-4222-8222-000000000006', 'Zed',  'Zebra',    '1970-07-07'),
  ('ffffaaaa-2222-4222-8222-000000000007', 'Newt', 'Notyet',   '1988-08-08'),
  ('ffffaaaa-2222-4222-8222-000000000008', 'Iggy', 'Ignored',  '1989-09-09'),
  ('ffffaaaa-2222-4222-8222-000000000009', 'Mini', 'Minor',    (current_date - interval '12 years')::date),
  ('ffffaaaa-2222-4222-8222-000000000010', 'Unis', 'Undated',  null);

insert into public.guardianships (guardian_person_id, child_person_id, relationship)
values (current_setting('mn.ann')::uuid, 'ffffaaaa-2222-4222-8222-000000000004', 'parent');
insert into public.household_links (owner_user_id, person_id, match_basis)
values ('eeeeaaaa-2222-4222-8222-000000000001', 'ffffaaaa-2222-4222-8222-000000000005', 'email');

-- Membership bases for the batch: Zed and Newt hold the member role; Ann has
-- one from her login already (profiles sync). Iggy holds nothing.
insert into public.person_roles (person_id, role) values
  ('ffffaaaa-2222-4222-8222-000000000006', 'member'),
  ('ffffaaaa-2222-4222-8222-000000000007', 'member');


-- ---------------------------------------------------------------------------
-- A. Sequential numbers, letter A, the printed form.
-- ---------------------------------------------------------------------------
select set_config('mn.acc1', public.create_billing_account('ffffaaaa-2222-4222-8222-000000000001')::text, true);

select is((select member_no from public.billing_accounts where id = current_setting('mn.acc1')::uuid),
  1, 'the first account issued gets number 1');
select is((select letter from public.billing_account_people
            where account_id = current_setting('mn.acc1')::uuid
              and person_id = 'ffffaaaa-2222-4222-8222-000000000001'),
  'A', 'the lead member wears letter A');
select is(public.member_card_ref('ffffaaaa-2222-4222-8222-000000000001'),
  '00001A', 'the card reads 00001A — five digits, then the letter');

select set_config('mn.acc2', public.create_billing_account('ffffaaaa-2222-4222-8222-000000000002')::text, true);
select is((select member_no from public.billing_accounts where id = current_setting('mn.acc2')::uuid),
  2, 'the second account gets number 2 — sequential, no gaps');


-- ---------------------------------------------------------------------------
-- B. Letters B, C…; re-add restores the same letter; one number per person.
-- ---------------------------------------------------------------------------
select is(public.add_person_to_billing_account(
            current_setting('mn.acc1')::uuid, 'ffffaaaa-2222-4222-8222-000000000009'),
  'B', 'the first person added wears B');
select is(public.add_person_to_billing_account(
            current_setting('mn.acc1')::uuid, 'ffffaaaa-2222-4222-8222-000000000010'),
  'C', 'the second wears C');

select throws_like(
  $$select public.add_person_to_billing_account(
      (select id from public.billing_accounts where member_no = 2),
      'ffffaaaa-2222-4222-8222-000000000009')$$,
  '%already under a membership number%',
  'a person cannot sit under two numbers at once');

select lives_ok(
  $$select public.remove_person_from_billing_account(
      current_setting('mn.acc1')::uuid, 'ffffaaaa-2222-4222-8222-000000000009')$$,
  'removal is allowed — and is soft');
select isnt((select removed_at from public.billing_account_people
             where account_id = current_setting('mn.acc1')::uuid
               and person_id = 'ffffaaaa-2222-4222-8222-000000000009'),
  null, 'the row survives with removed_at stamped');
select is(public.member_card_ref('ffffaaaa-2222-4222-8222-000000000009'),
  null, 'a removed person has no live card');

select is(public.add_person_to_billing_account(
            current_setting('mn.acc1')::uuid, 'ffffaaaa-2222-4222-8222-000000000009'),
  'B', 're-adding gives their OWN letter back, not the next free one');


-- ---------------------------------------------------------------------------
-- C. The guards.
-- ---------------------------------------------------------------------------
select throws_like(
  $$select public.create_billing_account('ffffaaaa-2222-4222-8222-000000000009')$$,
  '%already under a membership number%',
  'a numbered person cannot also lead a new account');
select throws_like(
  $$insert into public.billing_accounts (member_no, lead_person_id)
    values (90001, 'ffffaaaa-2222-4222-8222-000000000009')$$,
  '%adult with a known date of birth%',
  'a minor cannot be the bill-payer');
select throws_like(
  $$insert into public.billing_accounts (member_no, lead_person_id)
    values (90002, 'ffffaaaa-2222-4222-8222-000000000010')$$,
  '%adult with a known date of birth%',
  'an unknown date of birth cannot lead either — nobody is presumed adult');
select throws_like(
  $$update public.billing_accounts set member_no = 500
     where id = current_setting('mn.acc1')::uuid$$,
  '%never changed%',
  'a membership number, once issued, is never changed');
select throws_like(
  $$update public.billing_account_people set letter = 'Z'
     where account_id = current_setting('mn.acc1')::uuid and letter = 'C'$$,
  '%immutable%',
  'an issued letter is never reassigned');
select throws_like(
  $$update public.billing_account_people set removed_at = now()
     where account_id = current_setting('mn.acc1')::uuid
       and person_id = 'ffffaaaa-2222-4222-8222-000000000001'$$,
  '%lead member cannot be removed%',
  'the lead cannot be removed from their own account');


-- ---------------------------------------------------------------------------
-- D. Financial spine rows are never hard-deleted.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$delete from public.billing_accounts where id = current_setting('mn.acc1')::uuid$$,
  'P0001', null,
  'billing_accounts refuses hard deletes');
select throws_ok(
  $$delete from public.billing_account_people
     where account_id = current_setting('mn.acc1')::uuid and letter = 'C'$$,
  'P0001', null,
  'billing_account_people refuses hard deletes');


-- ---------------------------------------------------------------------------
-- E. RLS. Ann leads her own household (issued below in F); first, the two
--    accounts so far belong to nobody Ann knows.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.billing_accounts), 0,
  'an outsider to every household sees no accounts at all');
reset role;

-- The batch (F) runs as the finance user — the role, not club_admin.
set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('mn.batch',
  (select jsonb_agg(jsonb_build_object('no', member_no, 'lead', lead_person_id) order by member_no)::text
     from public.issue_membership_numbers(array[
       'ffffaaaa-2222-4222-8222-000000000006',  -- Zed Zebra, handed over FIRST
       current_setting('mn.ann')::uuid          -- Ann Aardvark, handed over second
     ])), true);
reset role;


-- ---------------------------------------------------------------------------
-- F. Alphabetical whatever the order handed over; household letters attach
--    linked-adults-then-children.
-- ---------------------------------------------------------------------------
select is((select (current_setting('mn.batch')::jsonb -> 0 ->> 'lead')::uuid),
  current_setting('mn.ann')::uuid,
  'Aardvark is numbered before Zebra although Zebra was handed over first');
select is((select member_no from public.billing_accounts where lead_person_id = current_setting('mn.ann')::uuid),
  3, 'Ann Aardvark takes the next number in the series');
select is((select member_no from public.billing_accounts where lead_person_id = 'ffffaaaa-2222-4222-8222-000000000006'),
  4, 'Zed Zebra follows');
select is((select letter from public.billing_account_people
            where person_id = 'ffffaaaa-2222-4222-8222-000000000005' and removed_at is null),
  'B', 'the household-linked adult wears B — linked adults come before children');
select is((select letter from public.billing_account_people
            where person_id = 'ffffaaaa-2222-4222-8222-000000000004' and removed_at is null),
  'C', 'the guarded child wears C');
select is(public.member_card_ref('ffffaaaa-2222-4222-8222-000000000004'),
  '00003C', 'the child''s card carries the household number with their own letter');

-- Idempotent: handing the same leads over again issues nothing new.
select is((select count(*)::int from public.issue_membership_numbers(array[current_setting('mn.ann')::uuid])),
  0, 'an already-numbered lead is skipped, not renumbered');


-- ---------------------------------------------------------------------------
-- E (continued). Now Ann has a household: she sees exactly her own.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.billing_accounts), 1,
  'a lead sees their own account and nobody else''s');
select is((select count(*)::int from public.billing_account_people), 3,
  'and everyone under their number — the two-way click-through');
select is(public.member_card_ref(current_setting('mn.ann')::uuid), '00003A',
  'a member reads their own card');
select is(public.member_card_ref('ffffaaaa-2222-4222-8222-000000000001'), null,
  'but not a stranger''s — member_card_ref answers under the caller''s own RLS');
reset role;

set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.billing_accounts), 4,
  'the dedicated finance user reads every account');
reset role;

set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.create_billing_account(current_setting('mn.str')::uuid)$$,
  '42501', null,
  'an ordinary member cannot issue themselves a membership number');


-- ---------------------------------------------------------------------------
-- G. The preview: gated, and it says why a lead qualifies.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select * from public.preview_membership_numbering()$$,
  '42501', null,
  'the preview is finance-gated — it reads names club-wide');
reset role;

set local request.jwt.claims to '{"sub":"eeeeaaaa-2222-4222-8222-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select basis from public.preview_membership_numbering()
            where lead_person_id = 'ffffaaaa-2222-4222-8222-000000000007'),
  'member role', 'Newt Notyet is offered for numbering, with the reason');
select is((select count(*)::int from public.preview_membership_numbering()
            where lead_person_id = 'ffffaaaa-2222-4222-8222-000000000008'),
  0, 'Iggy Ignored holds no membership basis and is not offered');
select is((select count(*)::int from public.preview_membership_numbering()
            where lead_person_id = current_setting('mn.ann')::uuid),
  0, 'an already-numbered lead is out of the preview');
reset role;

select * from finish();

rollback;
