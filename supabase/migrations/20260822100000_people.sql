-- =============================================================================
-- P1.1 — public.people
-- =============================================================================
-- PLAN.md task P1.1 ("every human the club knows": players including minors,
-- parents, coaches, staff, hirers).
--
-- PURPOSE
--   Creates the single identity table the rest of the platform hangs off, plus
--   the two age-derivation helpers that SAFEGUARDING.md SG-0 requires, and the
--   SG-2-style hard-delete / truncate guards.
--
--   `people` is deliberately *not* linked to auth.users yet. P1.2 reworks
--   public.profiles to carry `person_id` (one-to-one with auth.users) and
--   backfills a person row per existing profile; the self-read policy below is
--   left as a marked TODO until that column exists.
--
-- INVARIANTS SATISFIED
--   SG-0 (definition of minor)
--     * `dob` is nullable, and NULL means "minor" — fail closed (Open Decision
--       D1). Derived, never a stored snapshot: `public.is_minor_dob(date)` and
--       `public.is_minor(uuid)` are STABLE functions evaluated against
--       current_date, exactly as SG-0 §1.4 mandates. No generated column, no
--       nightly-refreshed boolean.
--     * An unknown person_id also evaluates to `true` (fail closed).
--   SG-2 (soft delete only), applied here by analogy
--     * SAFEGUARDING.md §3 SG-2 names four tables (messages, audit_log,
--       safeguarding_concerns, conversation_participants). `people` is not one
--       of them, but §4 (SG-8 row) requires that a departed member's record be
--       *pseudonymised*, never destroyed, and forbids pseudonymising anyone
--       named in an open concern. A person row is therefore also soft-delete
--       only, and gets the same four-layer guard: row-level BEFORE DELETE
--       trigger, statement-level BEFORE TRUNCATE trigger, revoked DELETE /
--       TRUNCATE privileges (service_role named explicitly — it holds
--       BYPASSRLS, so only the revoke and the triggers bind it), and no FOR
--       DELETE policy.
--     * `public.deny_hard_delete()` and `public.deny_truncate()` are created
--       here with the *generic* names SAFEGUARDING.md §4 uses, not a
--       people-specific pair, so that P4.3 and P5.2 attach the same two
--       functions to their own tables instead of re-implementing them.
--   SG-8 (retention) — groundwork only
--     * `legal_hold` and `pseudonymised_at` columns exist per the §4 checklist.
--       Nothing reads them yet; the retention job is P5.6 and ships disabled.
--
-- DECISIONS TAKEN (see docs/migrations/P1.1-people.md for the long form)
--   * email is `text`, not `citext` — a partial unique index on lower(email)
--     gives case-insensitive uniqueness without adding an extension whose
--     collation behaviour is a known footgun.
--   * address is a single `address jsonb` object, not columns.
--   * lower(email) is UNIQUE among live, non-null rows — accepted, with the
--     rule that a child's contact email lives on their guardian's record and is
--     reached through `guardianships` (P1.3), not copied onto the child.
--   * 29 February birthdays attain majority on 1 March in non-leap years.
--   * `staff` deliberately get NO read policy here (SAFEGUARDING.md §1.3:
--     "Bar, clubhouse, ground staff — no inherent access to member or child
--     data"). Committee only, until P1.4's has_role() allows scoped reads.
--
-- ROLLBACK
--   drop table if exists public.people cascade;
--   drop function if exists public.is_minor(uuid);
--   drop function if exists public.is_minor_dob(date);
--   drop function if exists public.people_dob_guard();
--   drop function if exists public.deny_truncate();
--   drop function if exists public.deny_hard_delete();
--   (dropping the table removes its triggers, indexes and policies with it;
--    the two guard functions are dropped last because the triggers reference
--    them. No data is touched — the table is new and empty.)
--
-- PR METADATA (PLAN.md §11)
--   migrations: y
--   RLS changes: y (new table, policies written with the table per §2.2)
--   data touched: none (new empty table; no backfill, no updates)
--   rollback: the drop statements above; no restore procedure needed
--   SG invariants: SG-0 (implemented), SG-2 (guard pattern), SG-8 (columns only)
--   tests: supabase/tests/people_is_minor.test.sql,
--          supabase/tests/people_rls.test.sql,
--          supabase/tests/people_constraints.test.sql
--
-- CONTENTS
--   1. Guard functions (generic, reused by P4.3 / P5.2)
--   2. Table
--   3. Indexes
--   4. Age helpers (SG-0)
--   5. Triggers
--   6. Row Level Security
--   7. Policies
--   8. Grants
-- =============================================================================


-- =============================================================================
-- 1. GUARD FUNCTIONS
-- =============================================================================
-- Created before the table because its triggers reference them.
--
-- These are the two functions named in SAFEGUARDING.md §3 SG-2 and §4. They
-- are unconditional: no role check, no escape hatch. That is the point — they
-- are the only control that binds `service_role` (BYPASSRLS) and the table
-- owner, neither of whom is stopped by an RLS policy.
--
-- Two separate functions and two separate triggers, because a row-level
-- BEFORE DELETE trigger does NOT fire on TRUNCATE.

create or replace function public.deny_hard_delete()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
begin
  raise exception
    'hard delete is not permitted on %.% (row id %): set deleted_at instead (SAFEGUARDING.md SG-2)',
    tg_table_schema,
    tg_table_name,
    coalesce(to_jsonb(old) ->> 'id', '<unknown>');
  return null;
end $function$;

create or replace function public.deny_truncate()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
begin
  raise exception
    'truncate is not permitted on %.%: rows are soft-deleted, never destroyed (SAFEGUARDING.md SG-2)',
    tg_table_schema,
    tg_table_name;
  return null;
end $function$;


-- =============================================================================
-- 2. TABLE
-- =============================================================================
-- One row per human. Names are the only mandatory identity fields: a child
-- registered by a parent may have no email, no phone and no address, and a
-- hirer may be nothing but a name and an email.

create table public.people (
  id                uuid primary key default gen_random_uuid(),

  first_name        text not null,
  last_name         text not null,
  preferred_name    text,

  -- Nullable, and NULL means "minor" for every safeguarding purpose (SG-0,
  -- Open Decision D1). P2.2 makes dob mandatory at registration for anyone
  -- joining a team, so NULL should be confined to legacy imports and hirers.
  dob               date,

  -- Contact. All nullable; see the email uniqueness note at §3.
  email             text,
  phone             text,

  -- Single JSON object rather than five columns. Justification: the club
  -- never filters, joins or aggregates on an address component — it is
  -- correspondence data, printed or posted as a block. UK address shape is
  -- irregular (sub-buildings, no street, BFPO), and the fields the club
  -- actually wants are not settled until the P2.2 registration form is
  -- designed. jsonb defers that without a migration per field, and the day a
  -- component does need indexing, an expression index on
  -- (address ->> 'postcode') costs nothing to add.
  -- Recommended keys: line1, line2, town, county, postcode, country.
  address           jsonb,

  notes             text,

  -- SG-8 groundwork. Nothing consumes these yet: the retention/pseudonymisation
  -- job is P5.6 and ships disabled, and only safeguarding_lead may set
  -- legal_hold once P1.4 exists.
  legal_hold        boolean not null default false,
  pseudonymised_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,

  -- Soft delete. There is no FOR DELETE policy and no DELETE grant; see §1.
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,

  -- A name that is present but blank is worse than absent: it defeats every
  -- "do we know who this is?" check downstream.
  constraint people_first_name_not_blank
    check (btrim(first_name) <> ''),
  constraint people_last_name_not_blank
    check (btrim(last_name) <> ''),
  constraint people_preferred_name_not_blank
    check (preferred_name is null or btrim(preferred_name) <> ''),
  constraint people_phone_not_blank
    check (phone is null or btrim(phone) <> ''),

  -- Deliberately light: one @, a dot in the domain, no whitespace, no
  -- surrounding padding, RFC 5321 length ceiling. Anything stricter rejects
  -- valid addresses; delivery is the real validator.
  constraint people_email_format
    check (
      email is null
      or (
        email = btrim(email)
        and length(email) between 6 and 320
        and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),

  -- Lower bound only. The "not in the future" half CANNOT be a CHECK —
  -- current_date is STABLE, not IMMUTABLE, and Postgres rejects non-immutable
  -- functions in check constraints — so it lives in people_dob_guard() at §5.
  constraint people_dob_not_before_1900
    check (dob is null or dob >= date '1900-01-01'),

  constraint people_address_is_object
    check (address is null or jsonb_typeof(address) = 'object')
);


-- =============================================================================
-- 3. INDEXES
-- =============================================================================

-- The one ordering every admin list and every person-picker uses.
create index people_name_idx
  on public.people using btree (last_name, first_name);

-- Live rows only, so a soft-deleted record never blocks re-creating someone,
-- and expression-based so the uniqueness is case-insensitive without citext.
--
-- Why unique at all, given that families share an email address? Because the
-- alternative is worse: duplicate person rows split a member's history,
-- mis-address safeguarding correspondence, and make P1.2's profile→person
-- backfill ambiguous (auth.users.email is itself unique). The club rule this
-- encodes is that a minor's contact route is their guardian, expressed as a
-- `guardianships` row in P1.3 — not the parent's email copied onto the child's
-- record. A person with no email of their own simply leaves it NULL, and the
-- partial index permits any number of those.
--
-- Consequence for Phase 3: the Neon import must dedupe or NULL colliding
-- emails rather than loading them as-is. That is a feature, not an obstacle.
create unique index people_email_unique_live_idx
  on public.people using btree (lower(email))
  where (email is not null and deleted_at is null);


-- =============================================================================
-- 4. AGE HELPERS (SG-0)
-- =============================================================================
-- SAFEGUARDING.md §1.4: "A person is a minor if they are under 18 years of age
-- on the date of evaluation, derived from people.dob. Where dob is NULL, the
-- person is treated as a minor for every purpose in this document."
--
-- Both are STABLE, not IMMUTABLE: they read current_date. That is also why the
-- rule cannot be a generated column or a CHECK constraint, and why every
-- enforcement point from here on calls the function rather than a stored flag.
--
-- 29 FEBRUARY: the comparison is `dob > current_date - interval '18 years'`,
-- which uses Postgres interval arithmetic. Subtracting 18 years from a date
-- that has no counterpart in the target year clamps to the last day of the
-- month, so someone born on 29 Feb 2008 is still a minor on 28 Feb 2026 and
-- becomes an adult on 1 March 2026. This is both the fail-closed direction (an
-- extra day of protection, never a day short) and the ordinary English-law
-- reading, under which a leap-day anniversary falls on 1 March in a non-leap
-- year. `age()` was the alternative and produces the same answer here; the
-- interval form is used because it is a single sargable comparison against a
-- column, which `age(current_date, dob) < interval '18 years'` is not.
--
-- 18th BIRTHDAY: an adult from the birthday itself. On the day, dob equals
-- current_date - 18 years, the strict `>` is false, and the person is not a
-- minor.

create or replace function public.is_minor_dob(d date)
  returns boolean
  language sql
  stable
  set search_path to 'public'
as $function$
  -- NULL dob is not "unknown, so skip the check" — it is "unknown, so protect"
  -- (SG-0 / Open Decision D1).
  select d is null or d > (current_date - interval '18 years');
$function$;

-- SECURITY DEFINER because callers (policies, triggers, and eventually the
-- `authenticated` role directly) must be able to answer "is this person a
-- minor?" without holding read access to public.people. It returns a single
-- boolean and nothing else, so it leaks no personal data.
--
-- A person_id that matches no row returns TRUE — fail closed. The same applies
-- to a soft-deleted person: the row is still found and still evaluated on its
-- dob, because a deleted_at stamp says nothing about the person's age.
create or replace function public.is_minor(person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select public.is_minor_dob(p.dob) from public.people p where p.id = person_id),
    true
  );
$function$;


-- =============================================================================
-- 5. TRIGGERS
-- =============================================================================

-- The single `people` dob guard.
--
-- SAFEGUARDING.md §4 is explicit that there must be ONE trigger on
-- people.dob — "carrying both SG-1.2 and SG-6 tier 1(c), not two triggers on
-- the same column". This is that trigger, created now with only the range
-- validation in it. P2.1 (SG-6 (c): a dob correction that turns an existing
-- team member into a minor revalidates that team's coaches) and P5.2 (SG-1.2: a
-- dob correction that would make a live conversation a 1:1) EXTEND THIS
-- FUNCTION. They must not add a second trigger to the column.
create or replace function public.people_dob_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
begin
  if new.dob is not null and new.dob > current_date then
    raise exception
      'people.dob may not be in the future (got %, today is %)',
      new.dob, current_date;
  end if;

  -- P2.1 (SG-6 1c) and P5.2 (SG-1.2) re-evaluation goes here.

  return new;
end $function$;

create trigger trg_people_dob_guard
  before insert or update of dob on public.people
  for each row execute function public.people_dob_guard();

-- Generic updated_at stamper from the baseline.
create trigger trg_people_updated
  before update on public.people
  for each row execute function public.set_updated_at();

-- SG-2 guards. The row-level one binds every DELETE; the statement-level one
-- exists because BEFORE DELETE row triggers do not fire on TRUNCATE, and RLS
-- does not apply to TRUNCATE at all.
create trigger trg_people_deny_hard_delete
  before delete on public.people
  for each row execute function public.deny_hard_delete();

create trigger trg_people_deny_truncate
  before truncate on public.people
  for each statement execute function public.deny_truncate();


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================
-- Enabled, not FORCE'd — matching every other table in this project (baseline
-- §6). FORCE would not bind service_role anyway (it holds BYPASSRLS); the
-- controls that do bind it are the revokes at §8 and the triggers at §5.

alter table public.people enable row level security;


-- =============================================================================
-- 7. POLICIES
-- =============================================================================
-- Written with the table, per PLAN.md §2.2.
--
-- These use the EXISTING baseline helpers. P1.4 introduces person_roles and
-- public.has_role(), at which point every policy here is re-expressed against
-- the real role model — `is_committee()` reads profiles.role, which P1.4
-- replaces.
--
-- Committee (public.is_committee() = role in ('committee','super_user')) is the
-- only actor with any access to this table today.

create policy "people_committee_read" on public.people
  for select
  using (public.is_committee());

create policy "people_committee_insert" on public.people
  for insert
  with check (public.is_committee());

create policy "people_committee_update" on public.people
  for update
  using (public.is_committee())
  with check (public.is_committee());

-- No FOR DELETE policy, and none may be added: people rows are soft-deleted
-- (SG-2 pattern, §1/§5/§8).

-- ---------------------------------------------------------------------------
-- DELIBERATELY ABSENT: a `people_staff_read` policy.
-- ---------------------------------------------------------------------------
-- The P1.1 task description asked for "staff = read", implemented with the
-- baseline helper public.is_staff(). That helper resolves TRUE for roles
-- 'bar', 'bar_manager' and 'staff' as well as committee — and
-- SAFEGUARDING.md §1.3 says of `staff` ("bar, clubhouse, ground staff"):
-- "No inherent access to member or child data."
--
-- A blanket staff read on this table is exactly that access: every child's
-- date of birth, home address and notes, readable by whoever is behind the bar
-- on a Saturday. SAFEGUARDING.md §1 states that where it and a task
-- description disagree, the document wins and the task is re-specified, so the
-- policy is not written. Nothing is lost today: the table is empty until P1.2's
-- backfill.
--
-- TODO (P1.4): replace the three policies above with has_role()-based ones and
-- add the scoped reads that actually match §1.3 — a coach reading the players
-- on their own team, a safeguarding_lead reading all, `hirer` reading nothing.
-- Whether operational staff need any people read at all is a question for Adam.
--
-- ---------------------------------------------------------------------------
-- TODO (P1.2): self-read.
-- ---------------------------------------------------------------------------
-- A person must be able to read their own row. The linkage does not exist yet:
-- public.profiles has no person_id column until P1.2 reworks it. When it does,
-- add — and do not invent the column earlier than that:
--
--   create policy "people_self_read" on public.people
--     for select
--     using (
--       id = (select pr.person_id from public.profiles pr where pr.id = auth.uid())
--     );
--
-- with the same shape for a self-update of contact fields if Adam wants it
-- (note that a self-update policy must not permit editing dob — SG-0 is
-- load-bearing and a dob change is an administrative act).


-- =============================================================================
-- 8. GRANTS
-- =============================================================================
-- An explicit override of baseline §9's blanket
-- `grant all privileges on all tables in schema public to anon, authenticated,
-- service_role`, per SAFEGUARDING.md §1.2. If a later migration re-runs that
-- blanket grant, this block must be re-asserted after it, or the DELETE and
-- TRUNCATE guards below silently disappear.

revoke all privileges on public.people from anon, authenticated, service_role;

-- anon gets nothing at all: there is no anonymous surface that needs a person.
grant select, insert, update on public.people to authenticated, service_role;

-- Belt and braces, and the thing the pgTAP privilege assertions check. Named
-- explicitly (rather than left implicit in the revoke above) so that the
-- intent survives someone later adding a broader grant on one line.
-- service_role must be named: it holds BYPASSRLS, so no policy will ever stop
-- it and the revoke is the only privilege-level control that does.
revoke delete, truncate on public.people from anon, authenticated, service_role;

-- Age helpers. anon is excluded on purpose: public.is_minor() is SECURITY
-- DEFINER over public.people, so granting it to anon would hand an
-- unauthenticated caller an oracle — probe a uuid, and a `false` answer proves
-- both that the person exists and that they are an adult.
revoke all privileges on function public.is_minor_dob(date) from public;
revoke all privileges on function public.is_minor(uuid) from public;
-- Hosted Supabase's default ACL (`alter default privileges for role postgres
-- ... grant execute on functions to anon, authenticated, service_role`) gives
-- anon an *explicit* EXECUTE grant on every new function, which revoking from
-- PUBLIC does not touch. Revoke from anon by name — found by the P1.1
-- rehearsal on a preview branch, where the local shadow DB had passed.
revoke all privileges on function public.is_minor_dob(date) from anon;
revoke all privileges on function public.is_minor(uuid) from anon;

grant execute on function public.is_minor_dob(date) to authenticated, service_role;
grant execute on function public.is_minor(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF P1.1
-- =============================================================================
