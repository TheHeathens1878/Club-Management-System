-- =============================================================================
-- P1.4 — public.person_roles, public.app_role, has_role()
-- =============================================================================
-- PLAN.md task P1.4 ("`roles` / person_roles: club_admin, safeguarding_lead,
-- coach, staff, member, parent, hirer — replaces any ad-hoc role flags";
-- acceptance: "RLS helper functions (has_role()) used by all subsequent
-- policies").
--
-- PURPOSE
--   Creates the role model SAFEGUARDING.md §1.3 describes, the helpers every
--   policy from here on calls, and the one-directional bridge that keeps the
--   legacy `profiles.role` column and the new table in step while the imported
--   function-room app (apps/web) is still the thing writing roles.
--
--   It then re-expresses the P1.1–P1.3 policies that were left carrying
--   "TODO (P1.4)" markers — `people_committee_*` and `guardianships_committee_*`
--   — against the real role model. Those markers are the reason this migration
--   touches other tables at all.
--
-- WHAT IS DELIBERATELY *NOT* CHANGED
--   `public.is_committee()`, `public.is_staff()` and `public.is_bar_manager()`
--   are untouched. They still read `profiles.role`, and the ~38 baseline
--   policies that call them still behave exactly as they did this morning. The
--   imported app's room bookings, timesheets, holiday requests, bar rates and
--   settings screens are therefore unaffected by this migration in every
--   observable way. Policies migrate to `has_role()` table by table, as each
--   table's owning task reaches it; nothing is swept.
--
-- INVARIANTS SATISFIED
--   SG-3 (who may read safeguarding data) — the helper half. SG-3's write model
--     is expressed entirely in terms of "holders of `safeguarding_lead` or
--     `club_admin`", and its enforcement note says each accessor function
--     "checks the caller's authority via the P1.4 `public.has_role()` helper".
--     This migration is what makes that sentence executable. The concerns
--     tables themselves are P4.3.
--   SG-6 (certification gating) — the hook only. SG-6's "Implemented by" reads:
--     "P1.4 (`has_role`), P2.1 (`team_memberships` triggers...)". P2.1's shared
--     evaluation function needs to ask "is this membership child-facing?" of a
--     person who is not the caller, which no `has_role()` shaped like
--     `is_committee()` can answer — hence `public.person_has_role(uuid,
--     app_role)` below, which exists for that trigger and for nothing else
--     today.
--   SG-7 (audit) — role grants and revokes are audit-logged by trigger, with
--     the existing `public.audit_log` conventions followed exactly (baseline
--     columns; no parallel safeguarding audit table).
--   SG-2 (soft delete only) — applied to `person_roles` by analogy, as P1.1
--     applied it to `people`. See §6.
--   SG-0 — untouched. Nothing here reads or derives age.
--
-- THE MAPPING (legacy `public.user_role` -> `public.app_role`)
--   Applied by the backfill (§8) and, from now on, by the sync trigger (§9).
--   One shared IMMUTABLE function (§7) owns it so the two cannot drift.
--
--     | profiles.role | app_role   | why                                       |
--     |---------------|------------|-------------------------------------------|
--     | super_user    | club_admin | is_committee() is true for it today; it is |
--     |               |            | the highest privilege the old app has      |
--     | committee     | club_admin | §1.3: "club_admin — Committee-level        |
--     |               |            | administrator"                             |
--     | bar_manager   | staff      | §1.3 `staff` = "Bar, clubhouse, ground     |
--     |               |            | staff". Managing the bar rota is not       |
--     |               |            | member-data authority                      |
--     | bar           | staff      | as above                                   |
--     | staff         | staff      | identity                                   |
--     | member        | member     | identity                                   |
--
--   NOBODY IS MAPPED TO safeguarding_lead, coach, parent OR hirer.
--     * `safeguarding_lead` is Open Decision **D9** ("Who is the named Club
--       Welfare Officer, and does a second person hold safeguarding_lead for
--       continuity?"). SAFEGUARDING.md §1.3 calls it "the only role whose
--       *purpose* is safeguarding" and SG-3 makes it the sole writer of case
--       notes. Deriving it from `profiles.role in ('committee','super_user')`
--       would hand every committee member the Club Welfare Officer's readership
--       of every concern raised in the club — including concerns about
--       themselves, which SG-3's write model excludes explicitly. Adam assigns
--       it by hand, as a deliberate act, and until he does the role exists with
--       no holders. That is the correct failure mode: SG-3's reads return
--       nothing rather than the wrong thing.
--     * `coach` cannot be derived: the old app has no notion of a team. It
--       arrives with P2.1's `team_memberships`, gated by SG-6.
--     * `parent` is a label, and SAFEGUARDING.md §1.3 is emphatic that it
--       carries no authority: "only the link (P1.3) carries authority over a
--       specific child... Every rule below keys off the link, never the role."
--       Deriving it from `guardianships` would create a second, staler source
--       of truth for a question `guardianships` already answers.
--     * `hirer` belongs to a person who books a room and is "deliberately
--       isolated" (§1.3); the old app's hirers are not `profiles` rows at all.
--
-- DECISIONS TAKEN (long form in docs/migrations/P1.4-roles.md)
--   * Soft revoke only: `revoked_at`, plus `deny_hard_delete()` /
--     `deny_truncate()` and revoked DELETE/TRUNCATE privileges (§6).
--   * The `profiles` -> `person_roles` sync is ONE-DIRECTIONAL (§9).
--   * The backfill writes ONE summary audit row, not 39 (§8).
--   * `is_committee()` / `is_staff()` / `is_bar_manager()` unchanged (above).
--   * `people` write stays club_admin-only; `guardianships` write goes to both
--     admin roles, because SG-4 says so in terms (§10).
--
-- ROLLBACK  (explicit; run as `postgres`, in one transaction, in this order)
--
--     -- 1. Restore the P1.1/P1.3 policies this migration replaced.
--     drop policy if exists "people_admin_read"          on public.people;
--     drop policy if exists "people_admin_insert"        on public.people;
--     drop policy if exists "people_admin_update"        on public.people;
--     create policy "people_committee_read"   on public.people
--       for select using (public.is_committee());
--     create policy "people_committee_insert" on public.people
--       for insert with check (public.is_committee());
--     create policy "people_committee_update" on public.people
--       for update using (public.is_committee()) with check (public.is_committee());
--
--     drop policy if exists "guardianships_admin_read"   on public.guardianships;
--     drop policy if exists "guardianships_admin_insert" on public.guardianships;
--     drop policy if exists "guardianships_admin_update" on public.guardianships;
--     drop policy if exists "guardianships_admin_delete" on public.guardianships;
--     create policy "guardianships_committee_read"   on public.guardianships
--       for select using (public.is_committee());
--     create policy "guardianships_committee_insert" on public.guardianships
--       for insert with check (public.is_committee());
--     create policy "guardianships_committee_update" on public.guardianships
--       for update using (public.is_committee()) with check (public.is_committee());
--     create policy "guardianships_committee_delete" on public.guardianships
--       for delete using (public.is_committee());
--
--     -- 2. Stop the legacy sync.
--     drop trigger if exists trg_profiles_sync_person_roles on public.profiles;
--
--     -- 3. Drop the table. This takes its own policies, indexes and triggers
--     --    with it, and destroys the 39 backfilled grants — which is correct
--     --    for a rollback of the migration that created them, and is the ONLY
--     --    circumstance in which a person_roles row may be destroyed
--     --    (SG-2/§6 forbids it in every other). The audit row at §8 is NOT
--     --    deleted: audit rows are append-only.
--     drop table if exists public.person_roles;
--
--     -- 4. Drop the functions, dependants first.
--     drop function if exists public.profiles_sync_person_roles();
--     drop function if exists public.person_roles_audit();
--     drop function if exists public.backfill_person_roles();
--     drop function if exists public.is_safeguarding_lead();
--     drop function if exists public.is_club_admin();
--     drop function if exists public.has_any_role(public.app_role[]);
--     drop function if exists public.has_role(public.app_role);
--     drop function if exists public.person_has_role(uuid, public.app_role);
--     drop function if exists public.map_user_role_to_app_role(public.user_role);
--     drop type if exists public.app_role;
--
--     -- 5. Record it.
--     insert into public.audit_log (actor_id, actor_email, action, entity, detail)
--     values (null, 'migration', 'migration.rollback', 'person_roles',
--             jsonb_build_object('migration', '20260822130000_roles'));
--
-- PR METADATA (PLAN.md §11)
--   migrations: y
--   RLS changes: y — four new policies on public.person_roles; the three
--     `people_committee_*` policies and the four `guardianships_committee_*`
--     policies are DROPPED AND RECREATED under `_admin_` names against
--     has_role()/has_any_role(). No actor loses access: every profile with
--     role committee/super_user is granted club_admin by §8's backfill in this
--     same migration, and §9's trigger keeps it that way.
--   data touched:
--     * public.person_roles — +39 rows on prod (one per profile; +0 locally,
--       where there are no profiles)
--     * public.audit_log    — +1 row (`migration.backfill` / `person_roles`),
--       always, even at 0 rows. Exactly one: the per-grant SG-7 trigger is
--       suppressed for the backfill via a transaction-local GUC (§8), because
--       39 identical `role.granted` rows attributed to nobody is noise that
--       buries the grants a human actually made.
--     * public.profiles     — untouched (no column added, no value changed)
--   rollback: the block above; no restore procedure needed
--   SG invariants: SG-3 (helper), SG-6 (hook: person_has_role), SG-7 (grant /
--     revoke audit), SG-2 (soft revoke, by analogy), SG-0 (untouched)
--   tests: supabase/tests/roles.test.sql (new),
--          supabase/tests/people_rls.test.sql (policy list updated),
--          supabase/tests/guardianships.test.sql (policy list updated)
--   NO AUTO-MERGE — PLAN.md §2.3: member data, safeguarding, auth and RLS.
--
-- CONTENTS
--   1.  app_role enum
--   2.  Table
--   3.  Indexes
--   4.  Comments
--   5.  Helpers: has_role / has_any_role / person_has_role / is_club_admin /
--       is_safeguarding_lead
--   6.  SG-2 guards (soft revoke only) and set_updated_at
--   7.  The legacy mapping function
--   8.  Backfill + the single summary audit row
--   9.  SG-7 audit trigger, and the profiles -> person_roles sync trigger
--   10. Row Level Security on person_roles
--   11. Re-expressing the P1.1 / P1.3 "TODO P1.4" policies
--   12. Grants
-- =============================================================================


-- =============================================================================
-- 1. app_role
-- =============================================================================
-- Exactly the seven roles SAFEGUARDING.md §1.3 tabulates, in the order PLAN.md
-- P1.4 lists them. An enum rather than `text` + CHECK for the reasons P1.3 gave
-- for `guardian_relationship`: the set is small and closed, the generated
-- TypeScript type becomes a real union so an invalid role is a compile error in
-- apps/web and apps/mobile, and a CHECK costs the same ALTER to extend while
-- giving the app nothing.
--
-- It is a SEPARATE type from the baseline's `public.user_role`, not an
-- extension of it. `user_role` is the old app's account-type column
-- ('bar', 'bar_manager', 'super_user'); `app_role` is a statement about a human
-- being's standing in the club. Merging them would mean either polluting the
-- safeguarding vocabulary with 'bar' or teaching the old app about
-- 'safeguarding_lead'. They are related only by the mapping at §7, and only
-- until P1.6/Phase 4 retires the column.
--
-- EXTENDING IT: `alter type public.app_role add value '...'` in a later
-- migration, and remember the value cannot be *used* in the same transaction
-- that adds it.

create type public.app_role as enum (
  'club_admin',
  'safeguarding_lead',
  'coach',
  'staff',
  'member',
  'parent',
  'hirer'
);


-- =============================================================================
-- 2. TABLE
-- =============================================================================
-- One row per (person, role) GRANT — not per (person, role) pair. A role that
-- is revoked and later re-granted is two rows, and the gap between them is the
-- record. SAFEGUARDING.md §4 asks for "person_roles(person_id, role,
-- granted_at, granted_by)"; `revoked_at` and `notes` are added because a role
-- table with no revocation history cannot answer "who could read this on the
-- day the concern was raised?", which is the question SG-7 exists to make
-- answerable.
--
-- ON DELETE RESTRICT on person_id, matching `profiles.person_id` (P1.2) and
-- both `guardianships` FKs (P1.3). `public.people` cannot be hard-deleted at
-- all, so RESTRICT is the second line rather than the first.
--
-- granted_by references auth.users, NOT people: it records which *login*
-- performed the administrative act, which is what `audit_log.actor_id` records
-- too, and it is ON DELETE SET NULL so that removing a departed admin's login
-- does not destroy the grant they made.

create table public.person_roles (
  id          uuid primary key default gen_random_uuid(),

  person_id   uuid not null references public.people (id) on delete restrict,
  role        public.app_role not null,

  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id) on delete set null,

  -- Soft revoke. NULL means the role is held right now; a timestamp means it
  -- was held until then. See §6 for why there is no hard delete.
  revoked_at  timestamptz,

  -- Why the role was granted or revoked ("Club Welfare Officer from AGM
  -- 2026-06-01", "stepped down"). Not for anything about a member: this table's
  -- readership is wider than `safeguarding_concerns`', and SG-7 forbids
  -- copying narrative into anything with a wider readership.
  notes       text,

  updated_at  timestamptz not null default now(),

  constraint person_roles_revoked_after_granted
    check (revoked_at is null or revoked_at >= granted_at),

  constraint person_roles_notes_not_blank
    check (notes is null or btrim(notes) <> '')
);


-- =============================================================================
-- 3. INDEXES
-- =============================================================================

-- One live grant per (person, role). PARTIAL, over live grants only — the same
-- shape and the same reasoning as P1.3's `guardianships_active_pair_idx`: a
-- full UNIQUE plus a soft revoke would mean a role, once revoked, could never
-- be granted again, and the only way to restore it would be to clear
-- `revoked_at` on the old row, erasing the gap. The gap is the history.
--
-- Unlike P1.3's, this one is not a deviation from anything: SAFEGUARDING.md §4
-- specifies no uniqueness for this table at all, and "a person holds a role, or
-- does not" is the property the helpers at §5 need.
create unique index person_roles_active_idx
  on public.person_roles using btree (person_id, role)
  where (revoked_at is null);

-- "What does this person hold?" — the has_role() direction, and the P2.1
-- SG-6 evaluation function's direction. The unique index above leads on
-- person_id but covers live rows only; a role history read needs this one.
create index person_roles_person_idx
  on public.person_roles using btree (person_id);

-- "Who holds safeguarding_lead?" — the D9 question, and the one the P4.3
-- concern-notification path will ask on every insert.
create index person_roles_role_idx
  on public.person_roles using btree (role)
  where (revoked_at is null);


-- =============================================================================
-- 4. COMMENTS
-- =============================================================================

comment on table public.person_roles is
  'Role grants (P1.4). One row per grant, never per pair: revoking sets '
  'revoked_at and the row survives, because "who could read this at the time?" '
  'is a question SAFEGUARDING.md SG-7 requires to stay answerable. Rows are '
  'never hard-deleted. `parent` here is a label only — authority over a '
  'specific child comes from guardianships (SAFEGUARDING.md §1.3), never from '
  'this table.';

comment on column public.person_roles.revoked_at is
  'Soft revoke. NULL = held now. Set it; never delete the row (SG-2 pattern, '
  'SG-7 history).';

comment on column public.person_roles.granted_by is
  'The auth.users login that made the grant, not the person. NULL for grants '
  'made by a migration or by the legacy profiles.role sync trigger.';

comment on column public.person_roles.notes is
  'Why the grant or revocation happened. Never anything about a safeguarding '
  'matter — this table is read far more widely than safeguarding_concerns '
  '(SG-3, SG-7).';


-- =============================================================================
-- 5. HELPERS
-- =============================================================================
-- The acceptance criterion for P1.4 is "RLS helper functions (has_role()) used
-- by all subsequent policies", and SAFEGUARDING.md §4 asks for
-- "public.has_role(role) / public.has_role(person_id, role) — used by *every*
-- policy from here on".
--
-- All five are STABLE, SECURITY DEFINER and `set search_path to 'public'`,
-- matching the house style of `is_committee()` (baseline), `is_minor()` (P1.1)
-- and `current_person_id()` (P1.3).
--
-- WHY SECURITY DEFINER IS LOAD-BEARING HERE, not stylistic:
--   `person_roles` has RLS, and one of its own policies (§10) calls
--   `is_club_admin()`. If these functions were SECURITY INVOKER the policy
--   would re-enter the table's own RLS to evaluate itself — the classic
--   recursive-policy failure. As SECURITY DEFINER they execute as the function
--   owner (`postgres`), who owns `person_roles` and is therefore not subject to
--   its policies (RLS is not FORCE'd; see §10), so the lookup terminates. This
--   is the same mechanism that lets the baseline's `profiles_self_read` policy
--   call `is_committee()`, which reads `profiles`.
--
-- WHY THE SIGNATURE IS `has_role(app_role)` AND NOT `has_role(text)`:
--   a typo'd role name in a policy becomes a migration-time type error instead
--   of a policy that silently never matches. `has_role('club_amin')` will not
--   deploy.
--
-- NULL BEHAVIOUR: `current_person_id()` is NULL for anon and for a JWT with no
-- profile, so `person_id = NULL` matches nothing and `exists` is FALSE. Every
-- helper returns FALSE, never NULL — a policy reading NULL as "no" is correct
-- but relies on the reader knowing it; returning a real boolean does not.

-- The workhorse. "Does the caller hold this role right now?"
create or replace function public.has_role(p_role public.app_role)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.person_roles pr
     where pr.person_id = public.current_person_id()
       and pr.role = p_role
       and pr.revoked_at is null
  );
$function$;

-- "Does the caller hold ANY of these?" — one index probe instead of a chain of
-- ORs in a policy, and it keeps the policy text readable:
--   using (public.has_any_role(array['club_admin','safeguarding_lead']::public.app_role[]))
create or replace function public.has_any_role(p_roles public.app_role[])
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.person_roles pr
     where pr.person_id = public.current_person_id()
       and pr.role = any (p_roles)
       and pr.revoked_at is null
  );
$function$;

-- The third-person form, for triggers.
--
-- SAFEGUARDING.md §4 lists it as `has_role(person_id, role)`; it is named
-- `person_has_role` rather than being an overload of `has_role` because
-- `has_role(uuid, app_role)` and `has_role(app_role)` are only one implicit
-- cast away from ambiguity in a policy, and because a distinct name makes it
-- obvious at the call site that the answer is about somebody else. Nothing
-- about the caller enters into it.
--
-- SG-6's tier-1 guards are the intended consumer (P2.1): "an uncertified coach
-- is assigned to an adult-only team... a minor is then registered to that team"
-- — the composition-side check has to ask, of every existing membership on the
-- team, whether that *other* person holds a child-facing role.
create or replace function public.person_has_role(p_person_id uuid, p_role public.app_role)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.person_roles pr
     where pr.person_id = p_person_id
       and pr.role = p_role
       and pr.revoked_at is null
  );
$function$;

-- Thin wrappers, for policy readability only. `using (public.is_club_admin())`
-- reads as the sentence SAFEGUARDING.md §1.3 writes; the array form does not.
create or replace function public.is_club_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select public.has_role('club_admin'::public.app_role);
$function$;

create or replace function public.is_safeguarding_lead()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select public.has_role('safeguarding_lead'::public.app_role);
$function$;


-- =============================================================================
-- 6. SG-2 GUARDS (SOFT REVOKE ONLY) AND set_updated_at
-- =============================================================================
-- P1.3 declined `deny_hard_delete()` on `guardianships` and said why. This
-- table gets it. The two are not inconsistent — the reason P1.3 gave is
-- absent here:
--
--   * SG-1.8 required the guardianship DELETE to stay reachable, in terms: "a
--     flat reject makes a mistyped or genuinely-ended guardianship permanently
--     unremovable, which is itself a data-protection problem." There is no
--     equivalent for a role grant: a role entered in error is corrected by
--     revoking it, which is a first-class operation on this table (`revoked_at`)
--     and leaves an honest record — "granted 09:14, revoked 09:15" — rather
--     than an unremovable falsehood. Nothing is stuck.
--   * The history is load-bearing in a way the row's absence would destroy.
--     SG-7 requires that safeguarding access be attributable: "any access to
--     safeguarding_concerns", "any read of guardianships outside a guardian's
--     own links". Every one of those accesses is authorised by a row in THIS
--     table (SG-3: readable "only by holders of safeguarding_lead or
--     club_admin"). Delete the grant and the audit_log row it authorised
--     becomes unexplainable: the log says a person read a concern, and the
--     database says they never had the standing to. SG-6's compliance history
--     ("expired_coach_appears_in_daily_compliance_report") has the same
--     dependency.
--   * SAFEGUARDING.md §1.2's principle applies unchanged: the only controls
--     that bind `service_role` (BYPASSRLS) and the table owner are constraints,
--     triggers and privileges — so the row-level trigger, the statement-level
--     truncate trigger, the revoked DELETE/TRUNCATE grants (§12) and the
--     absence of any FOR DELETE policy (§10) are all four required, exactly as
--     SG-2 spells out.
--
-- This is an extension of SG-2 to a table its statement does not name — the
-- same move P1.1 made for `public.people`, and permitted as a strengthening by
-- SAFEGUARDING.md §6.2, which asks only that it be recorded. It is, in
-- DECISIONS.md.
--
-- The functions are P1.1's generic pair; nothing is re-implemented.

create trigger trg_person_roles_deny_hard_delete
  before delete on public.person_roles
  for each row execute function public.deny_hard_delete();

create trigger trg_person_roles_deny_truncate
  before truncate on public.person_roles
  for each statement execute function public.deny_truncate();

-- The table has `updated_at`, so it gets the baseline's stamper, as
-- `guardianships` does.
create trigger trg_person_roles_updated
  before update on public.person_roles
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 7. THE LEGACY MAPPING
-- =============================================================================
-- One function owns the `user_role` -> `app_role` mapping, so the backfill (§8)
-- and the sync trigger (§9) cannot drift apart — the same reasoning that gave
-- P1.2 a single `split_person_name()`.
--
-- The table of reasons is in the migration header. IMMUTABLE: it is a pure
-- CASE over an enum, no catalog or setting lookups.
--
-- TOTAL, deliberately. Every one of the six `user_role` values has an answer,
-- and there is no ELSE returning NULL, because a NULL here would silently mean
-- "this person gets no role at all" — a member who cannot see their own
-- anything. If a future migration adds a value to `user_role`, this function
-- raises rather than returning NULL, and the sync trigger fails loudly on the
-- first profile that uses it. That is the fail-closed direction for a mapping:
-- an obvious error beats a silent absence of authority.

create or replace function public.map_user_role_to_app_role(p_role public.user_role)
  returns public.app_role
  language sql
  immutable
  set search_path to 'public'
as $function$
  select case p_role
    when 'super_user'  then 'club_admin'::public.app_role
    when 'committee'   then 'club_admin'::public.app_role
    when 'bar_manager' then 'staff'::public.app_role
    when 'bar'         then 'staff'::public.app_role
    when 'staff'       then 'staff'::public.app_role
    when 'member'      then 'member'::public.app_role
    else null
  end;
$function$;

-- The CASE above returns NULL for an unmapped value; this wrapper is where the
-- fail-loud lives, so the mapping itself stays a readable CASE.
create or replace function public.map_user_role_to_app_role_strict(p_role public.user_role)
  returns public.app_role
  language plpgsql
  immutable
  set search_path to 'public'
as $function$
declare
  v_mapped public.app_role;
begin
  v_mapped := public.map_user_role_to_app_role(p_role);

  if v_mapped is null then
    raise exception
      'no app_role mapping for profiles.role = % — add one to public.map_user_role_to_app_role() [P1.4]',
      p_role;
  end if;

  return v_mapped;
end $function$;


-- =============================================================================
-- 8. BACKFILL
-- =============================================================================
-- Every existing profile gains the role its `profiles.role` maps to. On prod
-- that is 39 rows (39 profiles as at the P1.2 push); locally and in CI there
-- are no profiles, so it is 0. Both are correct and both are asserted the same
-- way — the assertions are about the invariant, not the number.
--
-- Idempotent by construction, like P1.2's: the driving query excludes any
-- person who already holds the mapped role live, so a second run inserts
-- nothing and returns 0. It never revokes and never updates.
--
-- ONE AUDIT ROW, NOT 39.
--   SG-7 wants role changes attributable, and §9's trigger writes a
--   `role.granted` row for every grant. For a backfill that is the wrong
--   record: 39 rows attributed to no actor, all at the same instant, all
--   saying the same thing, burying the grants a human actually made in the
--   same table an auditor will read. So the trigger checks a transaction-local
--   GUC, `app.person_roles_audit_suppressed`, which this function sets while
--   it runs and clears afterwards, and the migration writes a single
--   `migration.backfill` summary row instead — carrying the counts and the
--   mapping it applied, so the 39 grants remain fully explained by one row.
--
--   The GUC is set with `set_config(..., is_local => true)`, so it cannot
--   outlive the transaction even if this function raises. It is not a
--   general-purpose escape hatch: it is checked in exactly one place (§9), it
--   is documented there, and the pgTAP suite asserts both that the suppression
--   works during the backfill and that an ordinary grant outside it still
--   writes its row.
--
-- SECURITY DEFINER + pinned search_path, following `backfill_profiles_people()`
-- (P1.2): it writes to `person_roles`, which `authenticated` may only touch
-- through the club_admin policy. EXECUTE is revoked from every API role at
-- §12 — this is a migration tool, not an API surface.

create or replace function public.backfill_person_roles()
  returns table (roles_created integer)
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_created integer := 0;
begin
  perform set_config('app.person_roles_audit_suppressed', 'on', true);

  insert into public.person_roles (person_id, role, granted_by, notes)
  select p.person_id,
         public.map_user_role_to_app_role_strict(p.role),
         null,
         'backfilled from profiles.role = ' || p.role::text
                                            || ' (P1.4, 20260822130000_roles)'
    from public.profiles p
   where not exists (
           select 1
             from public.person_roles pr
            where pr.person_id = p.person_id
              and pr.role = public.map_user_role_to_app_role_strict(p.role)
              and pr.revoked_at is null
         );

  get diagnostics v_created = row_count;

  perform set_config('app.person_roles_audit_suppressed', 'off', true);

  roles_created := v_created;
  return next;
end $function$;


do $do$
declare
  v_created  integer;
  v_profiles integer;
  v_unroled  integer;
begin
  select b.roles_created into v_created from public.backfill_person_roles() b;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (
    null,
    'migration',
    'migration.backfill',
    'person_roles',
    null,
    jsonb_build_object(
      'migration',     '20260822130000_roles',
      'roles_created', v_created,
      'mapping',       jsonb_build_object(
                         'super_user',  'club_admin',
                         'committee',   'club_admin',
                         'bar_manager', 'staff',
                         'bar',         'staff',
                         'staff',       'staff',
                         'member',      'member'
                       ),
      'note',          'no profile was granted safeguarding_lead; SAFEGUARDING.md D9 — Adam assigns it by hand'
    )
  );

  -- Assertion: every profile now holds the role its legacy value maps to.
  -- Written as a count of the failures rather than a count of the successes so
  -- that it is about the invariant and not about 39.
  select count(*) into v_unroled
    from public.profiles p
   where not exists (
           select 1 from public.person_roles pr
            where pr.person_id = p.person_id
              and pr.role = public.map_user_role_to_app_role_strict(p.role)
              and pr.revoked_at is null
         );

  if v_unroled <> 0 then
    raise exception
      'P1.4 backfill incomplete: % profile(s) hold no person_roles row for their mapped role; refusing to continue',
      v_unroled;
  end if;

  select count(*) into v_profiles from public.profiles;

  raise notice
    'P1.4 backfill: % role grant(s) created for % profile(s); nobody was granted safeguarding_lead (D9)',
    v_created, v_profiles;
end $do$;


-- =============================================================================
-- 9. THE TWO TRIGGERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 9a. SG-7 — role grants and revocations are audit-logged
-- ---------------------------------------------------------------------------
-- SG-7: "Every read, write, export or search of safeguarding data writes a row
-- to public.audit_log", and "Writes are logged by ordinary AFTER INSERT/UPDATE
-- triggers." A role grant is not itself safeguarding *data*, but it is what
-- authorises access to all of it — SG-3 restricts concerns to "holders of
-- safeguarding_lead or club_admin" — so the grant is logged for the same
-- reason the access is.
--
-- CONVENTIONS. SG-7: "Follow the existing public.audit_log conventions exactly
-- (baseline migration)... Do not add a parallel safeguarding audit table." So:
-- `actor_id` from auth.uid(), `actor_email` looked up from auth.users,
-- `action` / `entity` / `entity_id` / `detail jsonb`.
--
--   | action         | entity        | entity_id            | detail                  |
--   |----------------|---------------|----------------------|-------------------------|
--   | role.granted   | person_roles  | the person_roles.id  | {person_id, role}       |
--   | role.revoked   | person_roles  | the person_roles.id  | {person_id, role}       |
--
-- `detail` carries the person and the role and nothing else. SG-7: "detail must
-- never contain the content it is logging access to" — `notes` is deliberately
-- not copied in, because `audit_read` is `is_committee()` and therefore wider
-- than this table's own read policies.
--
-- WHAT COUNTS AS A REVOKE: `revoked_at` going from NULL to non-NULL. The
-- reverse (a revocation being undone in place) is logged as a grant, because
-- that is what it is in effect. Everything else — a `notes` edit, a
-- `granted_by` correction — writes nothing; an audit log that records
-- typo fixes is one nobody reads.
--
-- AFTER, not BEFORE: the row must exist and have survived every constraint
-- before it is asserted in the log. SECURITY DEFINER because it reads
-- `auth.users` and writes `public.audit_log`, neither of which `authenticated`
-- may do (audit_log has a read policy only), and because the row must be
-- written whoever the grantor was.
--
-- THE SUPPRESSION GUC is checked here and nowhere else; §8 explains it.

create or replace function public.person_roles_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_action    text;
  v_actor     uuid;
  v_email     text;
begin
  if coalesce(current_setting('app.person_roles_audit_suppressed', true), 'off') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- A row created already revoked is a historical import, not a grant.
    if new.revoked_at is not null then
      return null;
    end if;
    v_action := 'role.granted';
  else
    if old.revoked_at is null and new.revoked_at is not null then
      v_action := 'role.revoked';
    elsif old.revoked_at is not null and new.revoked_at is null then
      v_action := 'role.granted';
    else
      return null;
    end if;
  end if;

  v_actor := (select auth.uid());

  if v_actor is not null then
    select u.email into v_email from auth.users u where u.id = v_actor;
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (
    v_actor,
    v_email,
    v_action,
    'person_roles',
    new.id::text,
    jsonb_build_object('person_id', new.person_id, 'role', new.role::text)
  );

  return null;
end $function$;

create trigger trg_person_roles_audit
  after insert or update on public.person_roles
  for each row execute function public.person_roles_audit();


-- ---------------------------------------------------------------------------
-- 9b. profiles.role -> person_roles, ONE-DIRECTIONAL
-- ---------------------------------------------------------------------------
-- The imported function-room app still writes `profiles.role`, in five places
-- (apps/web/src/app/(app)/super-users/actions.ts:24,
-- .../settings/actions.ts:124,167,225, .../book/actions.ts:25). Until P1.6 and
-- Phase 4 move those screens onto `person_roles`, a promotion made in the old
-- UI must land in the new table or the two models diverge on day one — and the
-- divergence would be silent, which is the worst kind: a demoted committee
-- member would keep `club_admin` and with it every people/guardianships read
-- §11 grants.
--
-- SO: AFTER INSERT OR UPDATE OF role ON profiles, the mapped role is granted,
-- and the previously mapped role — if it is a different one — is revoked.
--
-- ONE-DIRECTIONAL, AND THAT IS A DECISION, NOT AN OMISSION.
--   Nothing propagates back from `person_roles` to `profiles.role`. Three
--   reasons:
--     1. It cannot be expressed. `profiles.role` is a single value; a person
--        may hold several roles. Which of {club_admin, coach, member} would be
--        written back?
--     2. `app_role` has values `user_role` has no equivalent for
--        (safeguarding_lead, coach, parent, hirer). Granting one would have to
--        either pick a wrong legacy value or silently do nothing.
--     3. Writing back would make the old app's RLS (is_committee(), ~38
--        baseline policies) respond to a grant made in the new model, which is
--        precisely the sweeping change this migration says it is not making.
--   The reverse direction is P1.6 / Phase 4 work: the screens move onto
--   `person_roles`, `profiles.role` becomes derived-or-dropped, and this
--   trigger is deleted in the same task. Until then, `profiles.role` is the
--   source of truth for the roles it can express, and `person_roles` is the
--   source of truth for everything else.
--
-- WHY *AFTER INSERT* IS ENOUGH, and why handle_new_user() is NOT changed:
--   A signup path is auth.users insert -> `on_auth_user_created` ->
--   `handle_new_user()` -> `insert into profiles`. An AFTER INSERT trigger on
--   `profiles` fires for that insert like any other — it does not matter that
--   another trigger issued it — so a new member gets their `member` grant
--   without `handle_new_user()` knowing this table exists. Adding it there as
--   well would be a second code path to keep in step for no gain. This is
--   asserted, not assumed: roles.test.sql inserts an auth.users row and checks
--   the grant appears.
--
--   It also covers apps/web's three `profiles` upserts, which PostgREST renders
--   as `insert ... on conflict (id) do update` — the UPDATE branch fires this
--   trigger's UPDATE arm when it changes `role`.
--
-- The grant is `on conflict ... do nothing` against the partial unique index,
-- so a role the person already holds live is left exactly as it was: its
-- `granted_at`, its `granted_by` and its `notes` survive a profile edit that
-- happens to re-assert the same role. Re-granting in place would rewrite the
-- history this table exists to keep.
--
-- SECURITY DEFINER: the caller updating `profiles` (an authenticated super_user
-- through the old app, or service_role) has no route into `person_roles` except
-- the club_admin policy, and the sync must not depend on the actor's own roles.
-- `granted_by` is left NULL rather than filled from auth.uid(): the grant was
-- made by a machine translating a legacy column, and attributing it to the
-- person who clicked "make committee" in the old UI would be a small lie in an
-- audit trail. The SG-7 audit row at §9a still carries auth.uid() as the actor,
-- which is the honest record of who caused it.

create or replace function public.profiles_sync_person_roles()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_new public.app_role;
  v_old public.app_role;
begin
  v_new := public.map_user_role_to_app_role_strict(new.role);

  if tg_op = 'UPDATE' then
    v_old := public.map_user_role_to_app_role_strict(old.role);

    -- 'bar' -> 'bar_manager' both map to `staff`; nothing to do, and revoking
    -- then re-granting would churn granted_at and write two audit rows for a
    -- change that did not alter the person's standing.
    if v_old = v_new and new.person_id = old.person_id then
      return null;
    end if;

    if v_old is distinct from v_new then
      update public.person_roles
         set revoked_at = now()
       where person_id = old.person_id
         and role = v_old
         and revoked_at is null;
    end if;
  end if;

  insert into public.person_roles (person_id, role, granted_by, notes)
  values (
    new.person_id,
    v_new,
    null,
    'synced from profiles.role = ' || new.role::text || ' (P1.4)'
  )
  on conflict (person_id, role) where revoked_at is null do nothing;

  return null;
end $function$;

create trigger trg_profiles_sync_person_roles
  after insert or update of role on public.profiles
  for each row execute function public.profiles_sync_person_roles();


-- =============================================================================
-- 10. ROW LEVEL SECURITY ON person_roles
-- =============================================================================
-- Enabled, not FORCE'd, matching every other table in this project. FORCE would
-- not bind `service_role` anyway (it holds BYPASSRLS), and it WOULD break the
-- helpers at §5, which depend on the owner not being subject to these policies.
-- What binds service_role is the revokes at §12 and the triggers at §6
-- (SAFEGUARDING.md §1.2).

alter table public.person_roles enable row level security;

-- A person reads their OWN LIVE roles. Not their revoked ones: "you used to be
-- a coach" is a fact about an administrative decision, and if it was a
-- safeguarding decision the person should hear it from a human, not discover it
-- in a role list. Admins see the full history (below), which is where the
-- question belongs.
create policy "person_roles_self_read" on public.person_roles
  for select
  using (
    person_id = public.current_person_id()
    and revoked_at is null
  );

-- SAFEGUARDING.md §1.3: club_admin — "Full administrative access";
-- safeguarding_lead — the Club Welfare Officer, who must be able to see who
-- holds `coach` (SG-6) and who else holds `safeguarding_lead` (D9's continuity
-- question) without having to ask a committee member. Revoked rows included:
-- "who held this on the day?" is exactly the SG-7 question this table keeps
-- answerable.
create policy "person_roles_admin_read" on public.person_roles
  for select
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- WRITE IS club_admin ONLY, and safeguarding_lead is deliberately excluded.
--
-- SAFEGUARDING.md §1.3 gives club_admin "full administrative access" and
-- describes safeguarding_lead's remit as safeguarding itself. SG-3 draws the
-- same line from the other side, restricting club_admin from case notes so that
-- neither role can quietly become the other. A safeguarding_lead who could
-- grant roles could grant themselves club_admin — or grant a second
-- safeguarding_lead, which is D9's decision to make and not theirs.
create policy "person_roles_admin_insert" on public.person_roles
  for insert
  with check (public.is_club_admin());

-- The revoke path: `update ... set revoked_at = now()`. There is no FOR DELETE
-- policy and there will not be one (§6).
create policy "person_roles_admin_update" on public.person_roles
  for update
  using (public.is_club_admin())
  with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- DELIBERATELY ABSENT
-- ---------------------------------------------------------------------------
--   * Any `staff` or `hirer` read. §1.3: staff have "no inherent access to
--     member or child data" and hirer has "no member or child data at all.
--     Deliberately isolated". Who holds which role in a club is member data.
--   * Any `coach` read. A coach's need is "who is on my team", which is P2.1's
--     `team_memberships`, not this table.
--   * Any anon access whatsoever: no policy, and no grant at all (§12).
--   * A FOR DELETE policy (§6).


-- =============================================================================
-- 11. RE-EXPRESSING THE P1.1 / P1.3 "TODO P1.4" POLICIES
-- =============================================================================
-- P1.1 §7: "TODO (P1.4): replace the three policies above with has_role()-based
-- ones and add the scoped reads that actually match §1.3".
-- P1.3 §8: "TODO (P1.4): re-express all four committee policies against
-- public.has_role(), splitting club_admin and safeguarding_lead from the
-- committee-at-large, and decide whether a coach needs any read here at all
-- (SAFEGUARDING.md §1.3 gives them none by default)."
--
-- ADDITIVE IN EFFECT, despite being a drop-and-recreate. Every profile whose
-- `role` is 'committee' or 'super_user' — precisely the set `is_committee()`
-- returns true for — holds `club_admin` as of §8's backfill, and §9b keeps that
-- true for every future promotion and demotion. So no actor who could read
-- `people` this morning cannot read it this afternoon. The pgTAP suite asserts
-- this as a regression, not as a hope.
--
-- WHAT CHANGES: `safeguarding_lead` gains reads it did not have (it had no
-- holders and no meaning until now), and the write/read split below is drawn
-- where SAFEGUARDING.md draws it rather than at "committee".
--
-- THE SPLIT, AND WHY IT IS NOT THE SAME ON BOTH TABLES
--
--   public.people — READ for both admin roles, WRITE for club_admin alone.
--     §1.3: club_admin is "Full administrative access"; safeguarding_lead's
--     position is "The only role whose *purpose* is safeguarding. Sole
--     read/write of concerns alongside club_admin; can export conversations."
--     Its stated write remit is concerns; it needs to READ people to do the
--     job at all (SG-6 asks it to be told which people are non-compliant; SG-8
--     makes it the only role that may set `legal_hold`, which will be a
--     column-scoped update added with P4.3, not a blanket one now). Editing a
--     member's name, dob or address is administration, so it stays with
--     club_admin.
--
--   public.guardianships — READ AND WRITE for both admin roles.
--     Because SG-4 says so, in terms, and this document outranks a task
--     description (SAFEGUARDING.md §1): "RLS: a guardian may SELECT their own
--     links and their children's linked records; club_admin and
--     safeguarding_lead may SELECT and write all; nobody else sees the table."
--     SG-4 then makes that write access load-bearing rather than incidental:
--     "Their write access is deliberate and is exactly why SG-1.8 exists: an
--     administrator correcting a family record must not be able to silently
--     strip the guardian out of a conversation the child is in." Narrowing it
--     to club_admin would quietly re-specify SG-1.8's premise.
--
--   No coach policy on either table. §1.3 gives coach no member-data access by
--   default, and the scoped read a coach actually needs ("the players on my
--   team") cannot be written until `team_memberships` exists (P2.1). Inventing
--   a wider one now and narrowing it later is the wrong order.
--
--   No staff policy on either table, unchanged from P1.1's refusal: "no
--   inherent access to member or child data".
--
-- `people_self_read` (P1.2) and `people_guardian_read` (P1.3) are NOT touched:
-- they key off `current_person_id()` and a guardianship link, never a role.
-- Likewise `guardianships_guardian_read`.

-- --- public.people -----------------------------------------------------------

drop policy "people_committee_read"   on public.people;
drop policy "people_committee_insert" on public.people;
drop policy "people_committee_update" on public.people;

create policy "people_admin_read" on public.people
  for select
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

create policy "people_admin_insert" on public.people
  for insert
  with check (public.is_club_admin());

create policy "people_admin_update" on public.people
  for update
  using (public.is_club_admin())
  with check (public.is_club_admin());

-- Still no FOR DELETE policy on public.people, and none may be added (SG-2).

-- --- public.guardianships ----------------------------------------------------

drop policy "guardianships_committee_read"   on public.guardianships;
drop policy "guardianships_committee_insert" on public.guardianships;
drop policy "guardianships_committee_update" on public.guardianships;
drop policy "guardianships_committee_delete" on public.guardianships;

create policy "guardianships_admin_read" on public.guardianships
  for select
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

create policy "guardianships_admin_insert" on public.guardianships
  for insert
  with check (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

create policy "guardianships_admin_update" on public.guardianships
  for update
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]))
  with check (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- The DELETE that SG-1.8 requires to stay reachable (P1.3 §7). The trigger, not
-- the policy, is what will refuse the dangerous case from P5.2.
create policy "guardianships_admin_delete" on public.guardianships
  for delete
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));


-- =============================================================================
-- 12. GRANTS
-- =============================================================================
-- An explicit override of baseline §9's blanket `grant all privileges on all
-- tables in schema public to anon, authenticated, service_role`, per
-- SAFEGUARDING.md §1.2. If a later migration re-runs that blanket grant, this
-- block must be re-asserted after it or the DELETE/TRUNCATE revokes silently
-- disappear.

revoke all privileges on public.person_roles from anon, authenticated, service_role;

-- anon gets nothing: there is no anonymous surface that needs a role.
grant select, insert, update on public.person_roles to authenticated, service_role;

-- Named explicitly, and `service_role` named among them: it holds BYPASSRLS, so
-- no policy will ever stop it and the revoke is the only privilege-level
-- control that does (SAFEGUARDING.md §1.2). This pair is what the pgTAP
-- privilege assertions check, and what catches a later blanket grant restoring
-- the ability to destroy role history.
revoke delete, truncate on public.person_roles from anon, authenticated, service_role;

-- The five helpers. `anon` is revoked BY NAME as well as via PUBLIC: hosted
-- Supabase's default privileges (`alter default privileges for role postgres
-- ... grant execute on functions to anon, authenticated, service_role`) give
-- every new function an explicit grant to all three API roles, which
-- `revoke ... from public` does not touch — found the hard way by the P1.1
-- preview-branch rehearsal, where the local shadow DB had passed.
--
-- anon must not hold these. `has_role()` would answer FALSE for an
-- unauthenticated caller and so leaks nothing, but `person_has_role(uuid,
-- app_role)` is a SECURITY DEFINER lookup on somebody else's roles: granted to
-- anon it is a probe — feed it a uuid and a role and learn whether that person
-- is the club's safeguarding lead. It is granted to `authenticated` because
-- P2.1's SG-6 triggers run as the assigning user.
revoke all privileges on function public.has_role(public.app_role)                 from public, anon;
revoke all privileges on function public.has_any_role(public.app_role[])           from public, anon;
revoke all privileges on function public.person_has_role(uuid, public.app_role)    from public, anon;
revoke all privileges on function public.is_club_admin()                           from public, anon;
revoke all privileges on function public.is_safeguarding_lead()                    from public, anon;

grant execute on function public.has_role(public.app_role)              to authenticated, service_role;
grant execute on function public.has_any_role(public.app_role[])        to authenticated, service_role;
grant execute on function public.person_has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_club_admin()                        to authenticated, service_role;
grant execute on function public.is_safeguarding_lead()                 to authenticated, service_role;

-- Internal: a migration tool, two trigger functions and the mapping pair.
-- None of them is an API surface.
revoke all privileges on function public.backfill_person_roles()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.person_roles_audit()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.profiles_sync_person_roles()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.map_user_role_to_app_role(public.user_role)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.map_user_role_to_app_role_strict(public.user_role)
  from public, anon, authenticated, service_role;

-- Re-assert the revokes P1.1 and P1.3 rely on. Nothing in this migration
-- re-runs the baseline's blanket grant, but re-stating them costs nothing and
-- keeps the guarantee local to the file a reviewer is reading.
revoke delete, truncate on public.people        from anon, authenticated, service_role;
revoke truncate          on public.guardianships from anon, authenticated, service_role;


-- =============================================================================
-- END OF P1.4
-- =============================================================================
