-- =============================================================================
-- P1.1 — public.people constraints, guards and indexes
-- =============================================================================
-- Runs as the session owner (postgres), so RLS is out of the picture and each
-- assertion is about the constraint, trigger or index alone.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(19);

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.people (first_name, last_name) values ('', 'Blank')$$,
  '23514',
  null,
  'an empty first_name is rejected'
);

select throws_ok(
  $$insert into public.people (first_name, last_name) values ('Blank', '   ')$$,
  '23514',
  null,
  'a whitespace-only last_name is rejected'
);

select throws_ok(
  $$insert into public.people (first_name, last_name, preferred_name)
    values ('Real', 'Name', '')$$,
  '23514',
  null,
  'a present-but-blank preferred_name is rejected'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, preferred_name)
    values ('Jonathan', 'Smith', 'Jonny')$$,
  'a normal name with a preferred name is accepted'
);

-- ---------------------------------------------------------------------------
-- Date of birth
-- ---------------------------------------------------------------------------
-- "Not in the future" is a trigger (people_dob_guard), not a CHECK: current_date
-- is STABLE and Postgres refuses non-immutable functions in check constraints.
-- So this one throws P0001, not 23514 — and that difference is the test.

select throws_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('Not', 'Bornyet', current_date + 1)$$,
  'P0001',
  null,
  'a dob in the future is rejected by people_dob_guard'
);

select throws_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('Way', 'Future', date '2999-01-01')$$,
  'P0001',
  null,
  'a wildly future dob is rejected'
);

select throws_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('Too', 'Old', date '1899-12-31')$$,
  '23514',
  null,
  'a dob before 1900 is rejected by the check constraint'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('Edge', 'Nineteenhundred', date '1900-01-01')$$,
  '1900-01-01 itself is accepted'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('Born', 'Today', current_date)$$,
  'a dob of today is accepted'
);

-- The guard must also fire on UPDATE, not only INSERT.
insert into public.people (id, first_name, last_name, dob)
values ('22222222-2222-4222-8222-000000000001', 'Update', 'Target', date '1990-03-04');

select throws_ok(
  $$update public.people set dob = current_date + 30
     where id = '22222222-2222-4222-8222-000000000001'$$,
  'P0001',
  null,
  'updating a dob into the future is rejected'
);

-- ---------------------------------------------------------------------------
-- Email format and uniqueness
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.people (first_name, last_name, email)
    values ('Bad', 'Email', 'not-an-email')$$,
  '23514',
  null,
  'an email with no @ is rejected'
);

select throws_ok(
  $$insert into public.people (first_name, last_name, email)
    values ('Padded', 'Email', '  spaced@example.com  ')$$,
  '23514',
  null,
  'an email with surrounding whitespace is rejected'
);

select lives_ok(
  $$insert into public.people (id, first_name, last_name, email)
    values ('22222222-2222-4222-8222-000000000002', 'Ada', 'Lovelace', 'Ada.Lovelace@Example.COM')$$,
  'a valid email is accepted'
);

-- The uniqueness rule: one live person per email address, case-insensitively.
-- A child with no email of their own is reached through their guardian
-- (P1.3), never by copying the parent's address onto the child's record.
select throws_ok(
  $$insert into public.people (first_name, last_name, email)
    values ('Imposter', 'Lovelace', 'ada.lovelace@example.com')$$,
  '23505',
  null,
  'a duplicate email in a different case is rejected'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, email) values
      ('No', 'Email', null),
      ('Also', 'Nomail', null)$$,
  'any number of people may have no email (partial index)'
);

-- Soft-deleting a person releases their email for re-use, which is the whole
-- reason the unique index is partial on deleted_at.
update public.people
   set deleted_at = now()
 where id = '22222222-2222-4222-8222-000000000002';

select lives_ok(
  $$insert into public.people (first_name, last_name, email)
    values ('Ada', 'Lovelace', 'ada.lovelace@example.com')$$,
  'a soft-deleted row does not block re-using its email'
);

-- ---------------------------------------------------------------------------
-- Address
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.people (first_name, last_name, address)
    values ('Array', 'Address', '["1 High Street"]'::jsonb)$$,
  '23514',
  null,
  'address must be a json object, not an array'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, address)
    values ('Object', 'Address',
            '{"line1":"1 High Street","town":"Sale","postcode":"M33 1AA"}'::jsonb)$$,
  'an address object is accepted'
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
-- now() is frozen for the transaction, so "updated_at moved forward" is not
-- observable here. Instead: write a deliberately wrong value and prove the
-- trigger overwrites it.
insert into public.people (id, first_name, last_name)
values ('22222222-2222-4222-8222-000000000003', 'Stamp', 'Me');

update public.people
   set updated_at = timestamptz '2000-01-01 00:00:00+00'
 where id = '22222222-2222-4222-8222-000000000003';

select is(
  (select updated_at from public.people
    where id = '22222222-2222-4222-8222-000000000003'),
  now(),
  'trg_people_updated overwrites updated_at on every update'
);

select * from finish();

rollback;
