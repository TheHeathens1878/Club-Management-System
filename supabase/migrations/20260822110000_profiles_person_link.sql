-- =============================================================================
-- P1.2 — public.profiles.person_id  (auth.users → profiles → people, 1:1)
-- =============================================================================
-- PLAN.md task P1.2 ("Rework `profiles` to link `auth.users` → `people`
-- (one-to-one). Backfill: every existing profile gets a person row").
--
-- PURPOSE
--   Gives every login a person. `auth.users` is the credential, `profiles` is
--   the app account (role + bar pay settings, read all over apps/web), and
--   `public.people` (P1.1) is the human. This migration adds the single column
--   that joins the last two, backfills one `people` row per existing profile,
--   makes the column NOT NULL, and rewires `handle_new_user()` so every future
--   signup arrives with its person already created.
--
--   It also lands the self-read policy P1.1 left as a marked TODO in its §7:
--   `people_self_read` could not be written until `profiles.person_id` existed.
--
-- ADDITIVE ONLY (PLAN.md §2.5)
--   Nothing existing is dropped or renamed. `profiles` keeps `role`,
--   `full_name`, `created_at`, `bar_hourly_rate_pence`, `bar_pay_type`,
--   `bar_overtime_rate_pence`, `bar_contracted_hours` and
--   `holiday_allowance_days` exactly as the imported function-room app
--   (apps/web) reads and writes them. The only change to the table is one new
--   column, one unique constraint, one FK and one BEFORE INSERT trigger.
--
-- INVARIANTS
--   SG-0 — consumer, not implementer. The link makes `is_minor(person_id)`
--     answerable for a logged-in user for the first time. No change to the
--     definition or to `people.dob`.
--   SG-2 — nothing new. `people` already carries the delete/truncate guards
--     from P1.1 and this migration adds no FOR DELETE policy anywhere. Note the
--     interaction at §5: the FK is ON DELETE RESTRICT, but a `people` row
--     cannot be hard-deleted at all, so RESTRICT is the second line, not the
--     first. (The SG-2 guard for `public.audit_log` itself is a separate small
--     Phase 1 migration, per SAFEGUARDING.md §3 SG-2 "Implemented by"; it is
--     deliberately not smuggled in here.)
--   SG-1 / safeguarding rule decided here — NO AUTO-LINK BY EMAIL.
--     `handle_new_user()` always creates a NEW person for a new auth user. It
--     never looks for an existing `people` row with the same email and attaches
--     to it. Families share an email address: a child registered by a parent
--     may legitimately carry the parent's contact email, and matching on it
--     would silently hand a new login the child's (or the parent's) identity,
--     with everything that hangs off it — guardianships (P1.3), roles (P1.4),
--     conversations (P5.2). Merging two people is an administrative act with a
--     human decision behind it, and will be a deliberate P1.4+ tool. See
--     DECISIONS.md 2026-08-22.
--
-- DECISIONS (long form in docs/migrations/P1.2-profiles-person-link.md)
--   * NOT NULL, set in this migration immediately after the backfill, guarded
--     by an assertion that fails the migration if any profile is still
--     unlinked. Nullable "during the transition" would mean forever: nothing
--     later would ever be entitled to tighten it, and every consumer from P1.3
--     on would have to carry a null branch that must never be taken.
--   * A plain UNIQUE constraint, not a partial unique index. A partial index
--     `where person_id is not null` is the right shape only while nulls are
--     possible; once the column is NOT NULL the partial predicate is
--     tautological and costs a reader a moment working out why it is there. The
--     constraint also gives a `unique` a future FK could reference.
--   * Single-token full names get `last_name = '(unknown)'`. `people` has
--     `check (btrim(last_name) <> '')` so the empty string is not available,
--     and duplicating the token into both fields would fabricate a surname that
--     then propagates into correspondence and team sheets. A visible
--     placeholder is greppable and obviously wrong to a human.
--   * A BEFORE INSERT trigger on `profiles` (`trg_profiles_ensure_person`) is
--     what makes NOT NULL safe for apps/web. See §7 — it is load-bearing, not
--     decoration.
--
-- ROLLBACK
--   See the block at the end of this file (§11). It includes the previous
--   `handle_new_user()` body verbatim.
--
-- PR METADATA (PLAN.md §11)
--   migrations: y
--   RLS changes: y — one new policy, `people_self_read` on public.people
--   data touched:
--     * public.profiles — 38 rows on prod gain `person_id` (0 locally)
--     * public.people   — +38 rows on prod (+0 locally)
--     * public.audit_log — +1 row (`migration.backfill`), always, even at 0/0
--   rollback: §11 below; the backfilled people are identified by
--     `audit_log.detail -> 'people_ids'` and are SOFT-deleted (SG-2 forbids the
--     hard delete)
--   SG invariants: SG-0 (consumer), SG-2 (none new), no-auto-link-by-email
--     (new rule, recorded in DECISIONS.md)
--   tests: supabase/tests/profiles_person_link.test.sql (new),
--          supabase/tests/people_rls.test.sql (updated for the new policy)
--   NO AUTO-MERGE — PLAN.md §2.3: member data, auth and RLS.
--
-- CONTENTS
--   1.  Name splitting helper
--   2.  Column, FK, unique constraint
--   3.  Backfill function
--   4.  Run the backfill, write the audit row, assert
--   5.  NOT NULL
--   6.  Index
--   7.  profiles BEFORE INSERT guard (keeps apps/web's upserts working)
--   8.  handle_new_user()
--   9.  people_self_read policy (the P1.1 §7 TODO)
--   10. Grants
--   11. Rollback
-- =============================================================================


-- =============================================================================
-- 1. NAME SPLITTING HELPER
-- =============================================================================
-- `profiles.full_name` is one free-text field; `people` has `first_name` and
-- `last_name`, both mandatory and both `btrim(...) <> ''`. One function owns
-- the split so the backfill, the signup trigger and the profiles guard cannot
-- drift apart.
--
-- The rule, exactly as P1.2 specifies it:
--   * collapse whitespace, then split on it;
--   * last token          -> last_name;
--   * everything before it -> first_name (joined with single spaces);
--   * one token           -> first_name = the token, last_name = '(unknown)';
--   * no usable name      -> both '(unknown)'.
--
-- '(unknown)' rather than '' because `people_last_name_not_blank` rejects the
-- empty string, and rather than repeating the single token because that invents
-- a surname. It is deliberately conspicuous: an admin list sorted by last name
-- puts every one of them together, which is the cleanup queue.
--
-- This is a naive split and is meant to be. "van der Berg", "Smith-Jones QC"
-- and "Dr A Patel" all come out imperfectly. It is a starting value for a field
-- a human will correct, not an attempt at name parsing — and it is applied only
-- to legacy `full_name` strings and to signup metadata, never to a name someone
-- typed into a form that had two boxes.
--
-- IMMUTABLE: pure text manipulation, no catalog or setting lookups.

create or replace function public.split_person_name(p_full_name text)
  returns table (first_name text, last_name text)
  language plpgsql
  immutable
  set search_path to 'public'
as $function$
declare
  v_clean  text;
  v_parts  text[];
begin
  v_clean := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));

  if v_clean = '' then
    first_name := '(unknown)';
    last_name  := '(unknown)';
    return next;
    return;
  end if;

  v_parts := string_to_array(v_clean, ' ');

  if array_length(v_parts, 1) = 1 then
    first_name := v_parts[1];
    last_name  := '(unknown)';
  else
    last_name  := v_parts[array_length(v_parts, 1)];
    first_name := array_to_string(v_parts[1:array_length(v_parts, 1) - 1], ' ');
  end if;

  return next;
end $function$;


-- =============================================================================
-- 2. COLUMN, FK, UNIQUE CONSTRAINT
-- =============================================================================
-- Added nullable, because §4's backfill has to run before it can be NOT NULL.
-- It stops being nullable at §5, in this same migration, so the window in which
-- a null is legal is a few statements wide and never observable by the app.
--
-- ON DELETE RESTRICT: a person may not be destroyed out from under the login
-- that points at them. In practice `public.people` cannot be hard-deleted at
-- all — P1.1 attached `deny_hard_delete()` / `deny_truncate()` and revoked
-- DELETE/TRUNCATE from all three API roles — so RESTRICT is the belt to that
-- pair of braces, and it is what would speak up if a future migration ever
-- disabled the trigger. The reverse direction is deliberately not symmetric:
-- `profiles.id references auth.users on delete cascade` (baseline), so deleting
-- an auth user still removes the profile and simply leaves the person row
-- standing. That is correct — the club's record of a human outlives their
-- login.

alter table public.profiles
  add column person_id uuid references public.people (id) on delete restrict;

comment on column public.profiles.person_id is
  'The human behind this login (P1.2). One-to-one: unique, not null. Never '
  'auto-matched by email — see the migration header and DECISIONS.md.';

-- One person, one login. UNIQUE rather than a partial unique index: see the
-- header. The constraint is added before the backfill so a backfill bug that
-- reused a person id fails loudly here rather than being discovered later.
alter table public.profiles
  add constraint profiles_person_id_key unique (person_id);


-- =============================================================================
-- 3. BACKFILL FUNCTION
-- =============================================================================
-- Factored out of the migration body for two reasons: the pgTAP suite calls it
-- a second time to prove idempotence ((0, 0) and no new rows), and a
-- reconciliation run after the prod push can call it to prove there is nothing
-- left to do.
--
-- Idempotent by construction: the driving query is `where person_id is null`,
-- so a second run has nothing to iterate. It creates people; it never updates
-- or deletes one.
--
-- Returns the created ids as well as the two counts P1.2 asks for, because the
-- rollback needs to identify exactly the rows this migration created and
-- nothing else — see §11. Deriving them any other way (a timestamp window, a
-- name pattern, a marker in `notes`) is either fragile or pollutes the data
-- model with a migration artefact.
--
-- SECURITY DEFINER + pinned search_path, following the house style of
-- `is_committee()` / `is_minor()` / `handle_new_user()`: it writes to
-- `public.people`, which `authenticated` may only do through the
-- `people_committee_insert` policy, and it reads `auth.users`.
-- EXECUTE is revoked from every API role at §10 — this is a migration tool, not
-- an API surface.

create or replace function public.backfill_profiles_people()
  returns table (profiles_linked integer, people_created integer, people_ids uuid[])
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_linked  integer := 0;
  v_created integer := 0;
  v_ids     uuid[]  := array[]::uuid[];
  r         record;
  v_names   record;
  v_email   text;
  v_person  uuid;
begin
  for r in
    select p.id, p.full_name, p.created_at, u.email as auth_email
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.person_id is null
     order by p.created_at, p.id
  loop
    select s.first_name, s.last_name
      into v_names
      from public.split_person_name(r.full_name) s;

    -- Email is copied from auth.users, defensively.
    --
    -- `auth.users.email` is unique and `people_email_unique_live_idx` is unique
    -- on lower(email) among live rows, so in a clean database no collision is
    -- possible. Three things make "impossible" not good enough here: a person
    -- row may already exist from another source (a Phase 3 Neon import lands in
    -- the same table), `auth.users.email` is nullable (phone-only signups), and
    -- `people_email_format` is stricter than Supabase's own validation. A
    -- backfill that aborts on any of those takes the whole migration with it,
    -- and an email is recoverable data — the person row is what matters. So the
    -- email is dropped to NULL and the row is still created; the profile is
    -- still linked. `people.email` is nullable and the partial unique index
    -- permits any number of NULLs.
    v_email := nullif(btrim(r.auth_email), '');

    if v_email is not null
       and (
         length(v_email) not between 6 and 320
         or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
         or exists (
              select 1
                from public.people pe
               where pe.deleted_at is null
                 and lower(pe.email) = lower(v_email)
            )
       )
    then
      v_email := null;
    end if;

    insert into public.people (
      first_name, last_name, email, dob, created_at, updated_at, created_by
    )
    values (
      v_names.first_name,
      v_names.last_name,
      v_email,
      null,          -- dob unknown, and unknown means minor (SG-0). Correct:
                     -- nobody should be treated as an adult on the strength of
                     -- having had a login on the old function-room app.
      r.created_at,  -- the person has existed at least as long as the profile
      r.created_at,
      null           -- created_by: this is a migration, not a person's act
    )
    returning id into v_person;

    update public.profiles
       set person_id = v_person
     where id = r.id;

    v_created := v_created + 1;
    v_linked  := v_linked + 1;
    v_ids     := v_ids || v_person;
  end loop;

  profiles_linked := v_linked;
  people_created  := v_created;
  people_ids      := v_ids;
  return next;
end $function$;


-- =============================================================================
-- 4. RUN THE BACKFILL, WRITE THE AUDIT ROW, ASSERT
-- =============================================================================
-- Prod: 38 profiles, so 38 people created and 38 profiles linked.
-- Local / CI: 0 profiles, so 0 and 0. Both are correct and both are asserted
-- the same way — the assertions are about the *invariant*, not the number.
--
-- The audit row is written unconditionally, including the 0/0 case: the fact
-- that the backfill ran and found nothing to do is itself the record we want
-- when reconciling prod against a fresh environment.
--
-- audit_log conventions are the baseline's, followed exactly: `actor_id` NULL
-- (no human did this), `actor_email` = 'migration', `action`, `entity`,
-- nullable `entity_id`, `detail jsonb`. `id` is generated always as identity.

do $do$
declare
  r          record;
  v_unlinked integer;
  v_people   integer;
  v_profiles integer;
begin
  select * into r from public.backfill_profiles_people();

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (
    null,
    'migration',
    'migration.backfill',
    'profiles',
    null,
    jsonb_build_object(
      'migration',       '20260822110000_profiles_person_link',
      'profiles_linked', r.profiles_linked,
      'people_created',  r.people_created,
      'people_ids',      to_jsonb(r.people_ids)
    )
  );

  -- Assertion 1 — the reason NOT NULL at §5 is safe.
  select count(*) into v_unlinked from public.profiles where person_id is null;
  if v_unlinked <> 0 then
    raise exception
      'P1.2 backfill incomplete: % profile(s) still have a null person_id; refusing to continue',
      v_unlinked;
  end if;

  -- Assertion 2 — every profile has its own person, and people may also exist
  -- for humans with no login (children, parents, hirers), so >= not =.
  select count(*) into v_people   from public.people;
  select count(*) into v_profiles from public.profiles;
  if v_people < v_profiles then
    raise exception
      'P1.2 backfill inconsistent: % people rows for % profiles',
      v_people, v_profiles;
  end if;

  raise notice
    'P1.2 backfill: % profile(s) linked, % person row(s) created (% profiles, % people total)',
    r.profiles_linked, r.people_created, v_profiles, v_people;
end $do$;


-- =============================================================================
-- 5. NOT NULL
-- =============================================================================
-- Safe because §4 just proved it, and stays safe because of §7 and §8: every
-- path that can create a profile row now supplies or manufactures a person.

alter table public.profiles
  alter column person_id set not null;


-- =============================================================================
-- 6. INDEX
-- =============================================================================
-- The UNIQUE constraint at §2 already provides a btree on `person_id`, which is
-- the index the people -> profiles direction needs. No further index is added.


-- =============================================================================
-- 7. profiles BEFORE INSERT GUARD
-- =============================================================================
-- This trigger is what lets §5's NOT NULL coexist with apps/web unchanged, and
-- it is worth being explicit about why, because it looks optional and is not.
--
-- Three server actions in apps/web upsert into `profiles` immediately after
-- `auth.admin.createUser()`:
--   apps/web/src/app/book/actions.ts:25          { id, role, full_name }
--   apps/web/src/app/(app)/super-users/actions.ts:118  { id, role, full_name }
--   apps/web/src/app/(app)/settings/actions.ts:225     { id, role, ..., full_name }
-- PostgREST renders each as `insert into profiles (...) values (...) on
-- conflict (id) do update set ...`. The profile already exists by then (the
-- `on_auth_user_created` trigger made it), so the statement resolves to the
-- UPDATE branch and nothing is really inserted — but Postgres evaluates the
-- table's constraints against the *proposed* tuple before it arbitrates the
-- conflict. The proposed tuple has no `person_id`, so with a bare NOT NULL the
-- upsert fails 23502 and the invite / staff-account / booker-account flows all
-- break. The acceptance criterion for P1.2 is "room booking app unaffected", so
-- the constraint has to be made satisfiable rather than the app made to change.
--
-- The trigger does two things, in this order:
--   1. If a profile row with this id already exists (the upsert-as-update case
--      above), adopt its existing person_id. This is the branch that matters:
--      manufacturing a fresh person here would leave one orphan per upsert.
--   2. Otherwise create a person, from `profiles.full_name` and the matching
--      `auth.users.email`, via the same helper §3 and §8 use.
--
-- It is a net, not the main path — `handle_new_user()` (§8) sets `person_id`
-- explicitly, so on an ordinary signup this trigger sees a non-null value and
-- does nothing at all.
--
-- SECURITY DEFINER: an insert into `profiles` can come from `authenticated`,
-- who holds no `people` insert route except the committee policy.

create or replace function public.profiles_ensure_person()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_existing uuid;
  v_names    record;
  v_email    text;
  v_person   uuid;
begin
  if new.person_id is not null then
    return new;
  end if;

  -- (1) upsert against an existing profile: keep the person it already has.
  select p.person_id into v_existing from public.profiles p where p.id = new.id;
  if v_existing is not null then
    new.person_id := v_existing;
    return new;
  end if;

  -- (2) a genuinely new profile with no person supplied. Note the deliberate
  -- absence of any lookup by email: a new login never adopts an existing
  -- person (see the migration header, and DECISIONS.md 2026-08-22).
  select s.first_name, s.last_name
    into v_names
    from public.split_person_name(new.full_name) s;

  select nullif(btrim(u.email), '') into v_email
    from auth.users u
   where u.id = new.id;

  if v_email is not null
     and (
       length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or exists (
            select 1 from public.people pe
             where pe.deleted_at is null
               and lower(pe.email) = lower(v_email)
          )
     )
  then
    v_email := null;
  end if;

  insert into public.people (first_name, last_name, email)
  values (v_names.first_name, v_names.last_name, v_email)
  returning id into v_person;

  new.person_id := v_person;
  return new;
end $function$;

create trigger trg_profiles_ensure_person
  before insert on public.profiles
  for each row execute function public.profiles_ensure_person();


-- =============================================================================
-- 8. handle_new_user()
-- =============================================================================
-- Replaces the baseline body (reproduced verbatim in §11). Same signature, same
-- SECURITY DEFINER, same pinned search_path, same `on conflict (id) do nothing`
-- semantics on `profiles`, same default role 'member'.
--
-- The person is created FIRST, and the profile carries its id from the start —
-- rather than leaving §7's trigger to do it — so that the ordinary signup path
-- reads as one obvious statement of intent and does not depend on a trigger
-- firing for correctness.
--
-- NO AUTO-LINK BY EMAIL. This function does not look for an existing person
-- with `new.email` and attach to it, and it must never be changed to. Families
-- share an email address; a child's `people` row may legitimately carry a
-- parent's contact email; matching on it would hand a brand-new login somebody
-- else's identity together with every guardianship, role, certification and
-- conversation attached to it. A duplicate person is a tidy-up. A wrongly
-- merged person is a safeguarding incident. Merging is an administrative act
-- with a human decision behind it and gets a deliberate tool later.
--
-- ORPHAN NOTE: if the `profiles` insert hits `on conflict do nothing` — a
-- profile already existed for this auth user, which the trigger being AFTER
-- INSERT on auth.users makes very unlikely — the person created two statements
-- earlier is left unreferenced. That is the fail-safe direction (an unused
-- person row, versus a login with no person and a NOT NULL violation), it is
-- visible via `people` with no matching profile, and it is preferred to
-- adopting whatever person the pre-existing profile already points at, which
-- would be the auto-link this section forbids by another route.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_names  record;
  v_email  text;
  v_person uuid;
begin
  select s.first_name, s.last_name
    into v_names
    from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;

  v_email := nullif(btrim(new.email), '');

  -- Same defensive email handling as the backfill (§3): a person row that
  -- cannot be created would mean a login that cannot be created.
  if v_email is not null
     and (
       length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or exists (
            select 1 from public.people pe
             where pe.deleted_at is null
               and lower(pe.email) = lower(v_email)
          )
     )
  then
    v_email := null;
  end if;

  insert into public.people (first_name, last_name, email)
  values (v_names.first_name, v_names.last_name, v_email)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_person)
  on conflict (id) do nothing;

  return new;
end $function$;


-- =============================================================================
-- 9. people_self_read  (the P1.1 §7 TODO)
-- =============================================================================
-- P1.1 wrote this policy out in a comment and refused to invent the column it
-- needs. The column now exists, so the policy lands, verbatim in shape.
--
-- A logged-in user may read exactly one `people` row: their own. The subquery
-- runs as the caller, so `profiles`' own RLS (`profiles_self_read`:
-- `id = auth.uid() or is_committee()`) applies to it and it can only ever
-- resolve to the caller's own person_id. There is no recursion — the `profiles`
-- policy does not reference `people`.
--
-- NO SELF-UPDATE, DELIBERATELY. A person must not be able to edit their own
-- `dob`: SG-0 derives minority from it, so a self-service dob edit is a
-- self-service exit from every child-protection rule in SAFEGUARDING.md. If
-- Adam wants members to maintain their own contact details, that is a
-- column-scoped update policy (email/phone/address/preferred_name only, dob and
-- legal_hold excluded) plus a `people_dob_guard()` extension that rejects a dob
-- change made by the subject — a P1.4 decision, not something to slip in here.

create policy "people_self_read" on public.people
  for select
  using (
    id = (select pr.person_id from public.profiles pr where pr.id = (select auth.uid()))
  );


-- =============================================================================
-- 10. GRANTS
-- =============================================================================
-- Nothing new on `public.people` — P1.1's grants stand unchanged (select,
-- insert, update to authenticated and service_role; nothing to anon; delete and
-- truncate revoked from all three).
--
-- `profiles` needs nothing either: grants are per-table, so the new column is
-- covered by the baseline's existing grant.
--
-- The three new functions are internal. `split_person_name()` is harmless but
-- unnecessary; `backfill_profiles_people()` writes people rows; and
-- `profiles_ensure_person()` is a trigger function that must never be called
-- directly. All three are reachable only from SECURITY DEFINER code owned by
-- `postgres`, so no API role needs EXECUTE on any of them.
--
-- `anon` is revoked BY NAME as well as via PUBLIC: hosted Supabase's default
-- privileges (`alter default privileges for role postgres ... grant execute on
-- functions to anon, authenticated, service_role`) hand every new function an
-- explicit grant to all three roles, which `revoke ... from public` does not
-- touch. This was found the hard way by the P1.1 preview-branch rehearsal,
-- where the local shadow DB had passed.

revoke all privileges on function public.split_person_name(text)      from public, anon, authenticated, service_role;
revoke all privileges on function public.backfill_profiles_people()   from public, anon, authenticated, service_role;
revoke all privileges on function public.profiles_ensure_person()     from public, anon, authenticated, service_role;

-- Re-assert P1.1's people revokes. The baseline's blanket
-- `grant all privileges on all tables in schema public` is exactly the thing
-- SAFEGUARDING.md §1.2 warns silently undoes these; nothing in this migration
-- re-runs it, but re-stating the two that matter costs nothing and makes the
-- guarantee local to the file a reviewer is reading.
revoke delete, truncate on public.people from anon, authenticated, service_role;


-- =============================================================================
-- 11. ROLLBACK
-- =============================================================================
-- Run as `postgres`, in one transaction, in this order.
--
-- Step 4 is a SOFT delete, not a hard one. `public.people` carries P1.1's
-- `trg_people_deny_hard_delete`, so `delete from public.people` raises P0001
-- for every role including the owner — which is the intended behaviour and not
-- something to work around by disabling the trigger (SAFEGUARDING.md §3 SG-2
-- forbids exactly that). Soft-deleting also releases the rows' email addresses
-- from `people_email_unique_live_idx` (it is partial on `deleted_at is null`),
-- so re-applying this migration afterwards works and simply creates a fresh set
-- of person rows.
--
--   -- 1. Restore the baseline handle_new_user(), VERBATIM:
--   create or replace function public.handle_new_user()
--     returns trigger
--     language plpgsql
--     security definer
--     set search_path to 'public'
--   as $function$
--   begin
--     insert into profiles (id, role, full_name)
--     values (new.id, 'member', new.raw_user_meta_data->>'full_name')
--     on conflict (id) do nothing;
--     return new;
--   end $function$;
--
--   -- 2. Remove the profiles guard.
--   drop trigger if exists trg_profiles_ensure_person on public.profiles;
--
--   -- 3. Remove the policy P1.1 had deferred.
--   drop policy if exists "people_self_read" on public.people;
--
--   -- 4. Soft-delete exactly the people this migration created, identified from
--   --    the audit row it wrote. No timestamp windows, no name patterns.
--   update public.people
--      set deleted_at = now()
--    where id in (
--      select (jsonb_array_elements_text(a.detail -> 'people_ids'))::uuid
--        from public.audit_log a
--       where a.action = 'migration.backfill'
--         and a.detail ->> 'migration' = '20260822110000_profiles_person_link'
--    )
--      and deleted_at is null;
--
--   -- 5. Drop the column. This takes profiles_person_id_key and the FK with it.
--   alter table public.profiles drop column person_id;
--
--   -- 6. Drop the functions this migration introduced.
--   drop function if exists public.profiles_ensure_person();
--   drop function if exists public.backfill_profiles_people();
--   drop function if exists public.split_person_name(text);
--
--   -- 7. Record the rollback. The audit row from §4 is NOT deleted — audit rows
--   --    are append-only (SAFEGUARDING.md SG-2) and step 4 depends on it.
--   insert into public.audit_log (actor_id, actor_email, action, entity, detail)
--   values (null, 'migration', 'migration.rollback', 'profiles',
--           jsonb_build_object('migration', '20260822110000_profiles_person_link'));


-- =============================================================================
-- END OF P1.2
-- =============================================================================
