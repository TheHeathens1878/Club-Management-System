-- =============================================================================
-- P1.1 — public.is_minor_dob(date) / public.is_minor(uuid)
-- =============================================================================
-- SAFEGUARDING.md SG-0 (§1.4): a person is a minor if they are under 18 on the
-- date of evaluation; an unknown DOB means minor; the 18th birthday itself
-- makes an adult.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(20);

-- ---------------------------------------------------------------------------
-- is_minor_dob — the pure age predicate
-- ---------------------------------------------------------------------------

-- SG-0 / Open Decision D1: fail closed. This is the assertion the whole
-- document leans on; if it ever flips, every downstream guard weakens.
select is(
  public.is_minor_dob(null),
  true,
  'null dob is a minor (SG-0 fail-closed default)'
);

select is(
  public.is_minor_dob((current_date - interval '18 years')::date),
  false,
  '18th birthday itself: adult from the day, not the day after'
);

select is(
  public.is_minor_dob((current_date - interval '18 years' + interval '1 day')::date),
  true,
  'one day short of 18 is a minor'
);

select is(
  public.is_minor_dob(date '1950-01-01'),
  false,
  'a dob far in the past is an adult'
);

select is(
  public.is_minor_dob(current_date),
  true,
  'born today is a minor'
);

-- ---------------------------------------------------------------------------
-- 29 February
-- ---------------------------------------------------------------------------
-- The function compares `dob > current_date - interval '18 years'`. Postgres
-- clamps an interval subtraction that lands on a non-existent date to the last
-- day of the target month, so a 29-Feb birth attains majority on 1 March in a
-- non-leap year — a day later than a 28-Feb reading would give. That is the
-- fail-closed direction and matches the ordinary English-law treatment of a
-- leap-day anniversary.
--
-- The two dobs below are computed relative to today (the single leap year in
-- any four consecutive years), so these assertions do not rot.

select is(
  public.is_minor_dob((
    select make_date(y, 2, 29)
    from generate_series(
      extract(year from current_date)::int - 11,
      extract(year from current_date)::int - 8
    ) as g(y)
    where (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0))
    limit 1
  )),
  true,
  'a 29-Feb child born 8-11 years ago is a minor'
);

select is(
  public.is_minor_dob((
    select make_date(y, 2, 29)
    from generate_series(
      extract(year from current_date)::int - 30,
      extract(year from current_date)::int - 27
    ) as g(y)
    where (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0))
    limit 1
  )),
  false,
  'a 29-Feb person born 27-30 years ago is an adult'
);

-- Pins the interval-arithmetic convention the function body depends on, with
-- fixed dates so the rule itself is documented rather than merely exercised.
select ok(
  date '2008-02-29' > (date '2026-02-28' - interval '18 years'),
  '29-Feb 2008: still a minor on 28 Feb 2026 (that year has no 29 Feb)'
);

select ok(
  not (date '2008-02-29' > (date '2026-03-01' - interval '18 years')),
  '29-Feb 2008: an adult from 1 Mar 2026'
);

-- ---------------------------------------------------------------------------
-- is_minor — the person lookup
-- ---------------------------------------------------------------------------

insert into public.people (id, first_name, last_name, dob) values
  ('11111111-1111-4111-8111-000000000001', 'Nula',  'Unknown', null),
  ('11111111-1111-4111-8111-000000000002', 'Seven', 'Teen',    (current_date - interval '17 years')::date),
  ('11111111-1111-4111-8111-000000000003', 'Bertha','Birthday',(current_date - interval '18 years')::date),
  ('11111111-1111-4111-8111-000000000004', 'Adult', 'Grown',   date '1980-06-15'),
  ('11111111-1111-4111-8111-000000000005', 'Gone',  'Deleted',  date '1975-01-02');

update public.people
   set deleted_at = now()
 where id = '11111111-1111-4111-8111-000000000005';

select is(
  public.is_minor('11111111-1111-4111-8111-000000000001'::uuid),
  true,
  'a person with an unknown dob is a minor'
);

select is(
  public.is_minor('11111111-1111-4111-8111-000000000002'::uuid),
  true,
  'a 17-year-old is a minor'
);

select is(
  public.is_minor('11111111-1111-4111-8111-000000000003'::uuid),
  false,
  'a person whose 18th birthday is today is an adult'
);

select is(
  public.is_minor('11111111-1111-4111-8111-000000000004'::uuid),
  false,
  'a 40-something is an adult'
);

select is(
  public.is_minor('11111111-1111-4111-8111-000000000005'::uuid),
  false,
  'a soft-deleted person is still evaluated on their dob (deleted_at says nothing about age)'
);

-- The other half of fail-closed: a uuid that matches nothing must not come back
-- as "not a minor" just because the lookup found no row.
select is(
  public.is_minor('99999999-9999-4999-8999-999999999999'::uuid),
  true,
  'an unknown person_id is a minor (SG-0 fail-closed)'
);

select is(
  public.is_minor(null),
  true,
  'a null person_id is a minor (SG-0 fail-closed)'
);

-- ---------------------------------------------------------------------------
-- Function properties SG-0 requires
-- ---------------------------------------------------------------------------
-- STABLE, never IMMUTABLE: the answer depends on current_date. An IMMUTABLE
-- marking here would let Postgres fold the result into an index or a cached
-- plan and a child would silently stay 17 forever.

select is(
  (select provolatile::text from pg_proc where oid = 'public.is_minor_dob(date)'::regprocedure),
  's',
  'is_minor_dob is STABLE'
);

select is(
  (select provolatile::text from pg_proc where oid = 'public.is_minor(uuid)'::regprocedure),
  's',
  'is_minor is STABLE'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.is_minor(uuid)'::regprocedure),
  true,
  'is_minor is SECURITY DEFINER (callable without read access to people)'
);

select is(
  (select proconfig from pg_proc where oid = 'public.is_minor(uuid)'::regprocedure),
  array['search_path=public'],
  'is_minor pins search_path (house style for SECURITY DEFINER helpers)'
);

select * from finish();

rollback;
