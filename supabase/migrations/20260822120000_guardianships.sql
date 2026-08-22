-- =============================================================================
-- P1.3 — public.guardianships
-- =============================================================================
-- PLAN.md task P1.3 ("guardianships (guardian_person -> child_person,
-- relationship type)"; acceptance: "Constraint: child must be minor; RLS:
-- guardians see own links").
--
-- PURPOSE
--   The guardian link is the single thing that makes adult<->minor contact
--   permissible anywhere in this platform (SAFEGUARDING.md SG-1.4), so its
--   integrity is load-bearing rather than administrative. This migration
--   creates the table, the relationship enum, the SG-4 age/self guard, the
--   SG-1.8 change guard (scaffolded — see §7), the RLS that SG-4 specifies,
--   and `public.current_person_id()`, the auth.uid() -> people.id helper every
--   policy from here on will use.
--
--   SAFEGUARDING.md §1.3 is emphatic that `parent` as a *role* and a
--   guardianship as a *link* are different things: "The role is a label; only
--   the link (P1.3) carries authority over a specific child. Every rule below
--   keys off the link, never the role." Nothing in this file reads a role to
--   decide authority over a child.
--
-- INVARIANTS SATISFIED
--   SG-4 (guardianship integrity) — in full.
--     * "A guardianships row (guardian_person_id, child_person_id,
--       relationship) is valid only if, at creation: the child is a minor
--       (SG-0); the guardian is an adult with a known DOB; and guardian !=
--       child."
--       - child minor        -> public.is_minor(child) must be true. NULL dob
--                               is a minor (SG-0), so a child with unknown dob
--                               is ACCEPTED. Fail-closed runs in the
--                               protective direction here: it admits the link
--                               rather than refusing it.
--       - guardian adult     -> dob IS NOT NULL and not is_minor_dob(dob).
--                               SG-4's "Deliberate asymmetry" paragraph:
--                               "SG-0 treats unknown DOB as a minor, so an
--                               unknown-DOB 'guardian' fails the adult test
--                               and the link is rejected. This is intended: a
--                               guardianship record with an unidentified adult
--                               is not a safeguarding control."
--       - guardian != child  -> a plain CHECK, §3.
--     * "at creation" is taken literally, and it matters — see §6 for why the
--       guard fires on INSERT and on a *retarget* only, never on an ordinary
--       UPDATE.
--     * "The link outlives the minority. When the child turns 18 the row is
--       not invalidated or deleted — the age tests apply at creation only. Its
--       effects lapse: guardian access to the young person's data ends at 18
--       (or at a transition age — Open Decision D5), which is enforced in the
--       reading policies, not by mutating the guardianship row." Implemented
--       at §9 (`people_guardian_read` carries `public.is_minor(people.id)`).
--     * "UNIQUE (guardian_person_id, child_person_id) — no duplicate links."
--       Implemented as a PARTIAL unique index over live links only; see §4.
--     * RLS per SG-4: "a guardian may SELECT their own links and their
--       children's linked records; club_admin and safeguarding_lead may SELECT
--       and write all; nobody else sees the table." §8 and §9.
--   SG-1.8 (guardianship-change guard) — scaffolded here, completed in P5.2.
--     SAFEGUARDING.md §3 SG-1 "Implemented by": "Where P1.3 lands before the
--     messaging tables exist, the SG-1.8 trigger is written in P1.3 as a
--     no-op-if-absent guard and completed in P5.2; the P5.2 PR is not complete
--     without its tests." That is exactly what §7 is.
--   SG-2 (soft delete only) — deliberately PARTIAL, and the asymmetry is the
--     point. See §7 and the DELETE note in §10.
--   SG-0 — consumer only. Every age question goes through P1.1's
--     `is_minor()` / `is_minor_dob()`; nothing here re-implements the rule.
--   SG-7 — NOT satisfied here, and knowingly so. SG-7 requires an audit row for
--     "any read of guardianships outside a guardian's own links", i.e. every
--     committee read below. Postgres has no SELECT trigger, so SG-7's own
--     enforcement note makes those reads SECURITY DEFINER accessor functions
--     that write their audit row before returning. That pattern arrives with
--     P4.3 (which also owns `public.write_audit()` per §4). Until then the
--     committee read policy at §8 is an open SG-7 gap, recorded in
--     docs/migrations/P1.3-guardianships.md and in DECISIONS.md.
--
-- DECISIONS TAKEN (long form in docs/migrations/P1.3-guardianships.md)
--   * An enum, not text + CHECK, for `relationship`.
--   * `ended_at` for soft ending; hard DELETE stays available, because SG-1.8
--     requires it to be (§7).
--   * Partial unique index on live links, not a full UNIQUE (§4).
--   * The SG-4 guard fires BEFORE INSERT and on retarget only (§6).
--   * Guardian read of a child's `people` row lapses at 18 (D5 default, §9).
--   * A child does not see their own guardianship rows (§8).
--
-- ROLLBACK
--   Run as `postgres`, in one transaction, in this order. Nothing here is
--   destructive of anything but this migration's own objects: the table is new
--   and empty, and no backfill runs.
--
--     drop policy if exists "people_guardian_read"          on public.people;
--     drop policy if exists "guardianships_guardian_read"   on public.guardianships;
--     drop policy if exists "guardianships_committee_read"  on public.guardianships;
--     drop policy if exists "guardianships_committee_insert" on public.guardianships;
--     drop policy if exists "guardianships_committee_update" on public.guardianships;
--     drop policy if exists "guardianships_committee_delete" on public.guardianships;
--     drop trigger if exists trg_guardianships_guard              on public.guardianships;
--     drop trigger if exists trg_guardianships_conversation_guard on public.guardianships;
--     drop trigger if exists trg_guardianships_updated            on public.guardianships;
--     drop trigger if exists trg_guardianships_deny_truncate      on public.guardianships;
--     drop table if exists public.guardianships;
--     drop function if exists public.guardianships_guard();
--     drop function if exists public.guardianships_conversation_guard();
--     drop function if exists public.current_person_id();
--     drop type if exists public.guardian_relationship;
--
--   (`drop table` would remove its own triggers, indexes and policies; they are
--    listed explicitly because PLAN.md §11 asks for a rollback that can be read
--    and reasoned about, and because `people_guardian_read` lives on a table
--    this migration does not drop. `current_person_id()` is dropped last of the
--    functions because the policies reference it.)
--
-- PR METADATA (PLAN.md §11)
--   migrations: y
--   RLS changes: y — five new policies on public.guardianships, one new policy
--     (`people_guardian_read`) on public.people
--   data touched: none. New empty table; no backfill, no updates, no audit row.
--   rollback: the statements above; no restore procedure needed
--   SG invariants: SG-4 (implemented in full), SG-1.8 (scaffolded per SG-1's
--     "Implemented by" note), SG-2 (truncate guard only — see §7), SG-0
--     (consumer), SG-7 (gap recorded, not closed)
--   tests: supabase/tests/guardianships.test.sql (new),
--          supabase/tests/people_rls.test.sql (policy set updated)
--   NO AUTO-MERGE — PLAN.md §2.3: member data, safeguarding and RLS.
--
-- CONTENTS
--   1.  current_person_id()
--   2.  guardian_relationship enum
--   3.  Table
--   4.  Indexes
--   5.  Comments
--   6.  SG-4 guard
--   7.  SG-1.8 guard (scaffold) and the SG-2 truncate guard
--   8.  Row Level Security and policies on public.guardianships
--   9.  people_guardian_read
--   10. Grants
-- =============================================================================


-- =============================================================================
-- 1. current_person_id()
-- =============================================================================
-- auth.uid() -> profiles.id -> profiles.person_id. Every policy from P1.3
-- onwards that has to answer "which human is asking?" calls this, so the join
-- is written once and cannot drift.
--
-- SECURITY DEFINER, matching the house style of `is_committee()` (baseline) and
-- `is_minor()` (P1.1): the caller must be able to resolve their own person
-- without holding a read on `public.profiles`, and — more importantly — a
-- policy that inlined the subquery would be evaluated under the *reading*
-- table's context every time, which is how recursive-policy bugs start.
--
-- STABLE, not IMMUTABLE: it reads a table and a session setting.
--
-- Returns NULL for `anon` (auth.uid() is null, so no row matches) and NULL for
-- a JWT whose subject has no profile. Every policy below therefore compares a
-- column against a possibly-NULL value, which yields NULL, which RLS treats as
-- "no". That is the fail-closed direction and it is deliberate: a NULL person
-- must never match a NULL column, and the columns it is compared against are
-- all NOT NULL anyway.
--
-- Not an oracle: it discloses only the caller's own person id, which
-- `people_self_read` (P1.2) already lets them read.

create or replace function public.current_person_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select pr.person_id
    from public.profiles pr
   where pr.id = (select auth.uid());
$function$;


-- =============================================================================
-- 2. guardian_relationship
-- =============================================================================
-- An enum rather than `text` + a CHECK constraint.
--
-- Why an enum: the set is small, closed, and read by humans on a form; the
-- generated TypeScript type (packages/db) becomes a real union rather than
-- `string`, so an invalid relationship is a compile error in the web and mobile
-- apps as well as a database error; and a `CHECK (relationship in (...))`
-- costs exactly the same `ALTER TABLE` to extend while giving the app nothing.
--
-- EXTENDING IT: `alter type public.guardian_relationship add value
-- 'special_guardian';` in a new migration. Since Postgres 12 that may run
-- inside a transaction block (so an ordinary CLI migration is fine), but the
-- new value cannot be *used* in that same transaction — so add the value in one
-- migration and backfill or reference it in the next. Values cannot be removed
-- or renamed in place; retiring one means a new type and a column rewrite, which
-- is the honest cost of a closed set and is not expected to be paid.
--
-- 'other' exists so that an unusual arrangement (an aunt with a residence
-- order, a supported-lodgings host) is recorded truthfully with the detail in
-- `notes`, rather than being forced into 'legal_guardian' because that is the
-- nearest available lie. Nothing in this schema treats 'other' differently: SG-4
-- and SG-1.8 key off the existence of the link, never off the relationship
-- type.

create type public.guardian_relationship as enum (
  'parent',
  'step_parent',
  'grandparent',
  'foster_carer',
  'legal_guardian',
  'other'
);


-- =============================================================================
-- 3. TABLE
-- =============================================================================
-- One row per (guardian, child) relationship.
--
-- ON DELETE RESTRICT on both foreign keys. `public.people` cannot be
-- hard-deleted at all (P1.1 attached `deny_hard_delete()` / `deny_truncate()`
-- and revoked DELETE/TRUNCATE from all three API roles), so in practice
-- RESTRICT is the belt to that pair of braces — the layer that would still
-- speak up if the trigger were ever disabled. It is emphatically not CASCADE: a
-- guardian link disappearing as a side effect of anything is precisely the
-- silent transition SG-1.8 exists to prevent.

create table public.guardianships (
  id                  uuid primary key default gen_random_uuid(),

  guardian_person_id  uuid not null references public.people (id) on delete restrict,
  child_person_id     uuid not null references public.people (id) on delete restrict,

  relationship        public.guardian_relationship not null,

  -- Free text for the arrangement itself ("court order 2024, contact
  -- supervised"), not for safeguarding concerns — those are
  -- `safeguarding_concerns` (P4.3, SG-3) and must not be written here, where
  -- the reading policy is far wider.
  notes               text,

  -- Soft end. SG-4: the link "is not invalidated or deleted" when the child
  -- turns 18 and its *effects* lapse in the reading policies — so `ended_at` is
  -- NOT the 18th birthday. It is for an arrangement that has actually ended: a
  -- foster placement concluded, a residence order discharged, a
  -- mis-entered link superseded. NULL means live.
  ended_at            timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,

  -- SG-4: "CHECK (guardian_person_id <> child_person_id) — a plain constraint,
  -- always true, no self-guardianship." A CHECK rather than a line in the
  -- trigger because it is expressible as one, and a constraint no role, no
  -- trigger-disabling and no future ALTER can quietly not-fire.
  constraint guardianships_not_self
    check (guardian_person_id <> child_person_id),

  -- A link cannot end before it began. Cheap, and it catches a backwards
  -- timestamp in a Phase 3 import.
  constraint guardianships_ended_after_created
    check (ended_at is null or ended_at >= created_at),

  constraint guardianships_notes_not_blank
    check (notes is null or btrim(notes) <> '')
);


-- =============================================================================
-- 4. INDEXES
-- =============================================================================

-- SG-4 says "UNIQUE (guardian_person_id, child_person_id) — no duplicate
-- links". This implements that as a PARTIAL unique index over LIVE links, and
-- the deviation is deliberate and recorded in DECISIONS.md.
--
-- SG-4 was written before this table had an `ended_at` column. A full UNIQUE
-- and a soft end are incompatible in a way that damages the record: once a
-- foster placement is ended, the same carer could never be recorded as the
-- child's guardian again, and the only way to express a resumed arrangement
-- would be to clear `ended_at` on the old row — erasing the gap, which is
-- exactly the history a safeguarding record exists to hold. Restricting the
-- uniqueness to live rows keeps SG-4's actual intent (a child cannot have two
-- simultaneous live links to the same guardian, so an "is X the guardian of Y?"
-- question always has one answer) and makes the honest record possible.
--
-- The two are not equivalent, so this needs Adam's confirmation under
-- SAFEGUARDING.md §6.2 rather than being treated as a free refinement.
create unique index guardianships_active_pair_idx
  on public.guardianships using btree (guardian_person_id, child_person_id)
  where (ended_at is null);

-- "Who are this child's guardians?" — the SG-1 question, asked by P5.2's
-- evaluation function on every participant change and every message insert.
create index guardianships_child_idx
  on public.guardianships using btree (child_person_id);

-- "Which children is this person guardian of?" — the `people_guardian_read`
-- (§9) and `guardianships_guardian_read` (§8) direction. The unique index above
-- leads on this column, but only over live rows; a guardian listing their
-- history needs the unpartitioned one.
create index guardianships_guardian_idx
  on public.guardianships using btree (guardian_person_id);


-- =============================================================================
-- 5. COMMENTS
-- =============================================================================

comment on table public.guardianships is
  'Guardian(adult) -> child links (P1.3). SAFEGUARDING.md SG-4: age rules are '
  'enforced at creation only and the link outlives the child''s minority; its '
  'effects lapse in the reading policies. SG-1.8: deleting, retargeting or '
  'ending a row is guarded, because it can turn a compliant conversation into '
  'a prohibited one with nothing happening in the messaging tables.';

comment on column public.guardianships.ended_at is
  'The arrangement actually ended (placement concluded, order discharged, link '
  'entered in error and superseded). NOT the child''s 18th birthday — SG-4 '
  'keeps the link and lapses its effects instead.';

comment on column public.guardianships.notes is
  'The arrangement, not a safeguarding concern. Concerns belong in '
  'safeguarding_concerns (P4.3, SG-3), whose readership is far narrower.';


-- =============================================================================
-- 6. SG-4 GUARD
-- =============================================================================
-- The age half of SG-4. A trigger and not a CHECK for the reason SG-4 gives:
-- "Trigger for the age rules, because they depend on now() and on another table
-- and so cannot be a CHECK."
--
-- WHEN IT FIRES, AND WHY NOT ON EVERY UPDATE
--   SG-4's statement is scoped to creation: "valid only if, AT CREATION" (its
--   emphasis), and then: "The link outlives the minority. When the child turns
--   18 the row is not invalidated or deleted — the age tests apply at creation
--   only."
--
--   A guard on `BEFORE INSERT OR UPDATE` (all columns) would contradict that
--   directly: the day after the child's 18th birthday, setting `ended_at` on
--   the link — the ordinary administrative act of closing it — would re-run the
--   "child must be a minor" test against a person who is now an adult and be
--   refused, leaving the row frozen forever. So the trigger is
--   `BEFORE INSERT OR UPDATE OF guardian_person_id, child_person_id`, and the
--   UPDATE branch additionally checks that a column really changed
--   (`IS DISTINCT FROM`), because `UPDATE OF col` fires when the column is
--   named in the SET list even if the value is identical.
--
--   That is exactly the "retarget" case SG-1.8 defines: "A retarget is
--   evaluated as a delete of the old pair plus an insert of the new pair: the
--   old pair is checked as above, and the new pair must independently satisfy
--   SG-4." This function is the "must independently satisfy SG-4" half; §7 is
--   the other.
--
-- ERROR REPORTING
--   Every raise is P0001 (plpgsql's default for RAISE EXCEPTION without a
--   custom SQLSTATE) with a distinct, self-explaining message naming the
--   invariant. No custom SQLSTATEs: PostgREST surfaces the message to the
--   client either way, a bespoke five-character class would have to be
--   documented and remembered in three languages, and P1.1 set the house
--   precedent (`people_dob_guard()`, `deny_hard_delete()`, `deny_truncate()`
--   are all P0001). The tests assert the code AND the message text, so the
--   messages are part of the contract, not decoration.
--
-- It binds `service_role`. SG-4: "Since the write is granted by RLS but the
-- guard is a trigger, service_role is bound by the guard too (§1.2)."

create or replace function public.guardianships_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_guardian_dob date;
begin
  -- Only evaluate on creation, or on a retarget that genuinely changes a
  -- party. See the header: the age rules are creation-time rules.
  if tg_op = 'UPDATE'
     and new.guardian_person_id is not distinct from old.guardian_person_id
     and new.child_person_id    is not distinct from old.child_person_id
  then
    return new;
  end if;

  -- 1. No self-guardianship. Also a CHECK constraint
  -- (guardianships_not_self), which is what SG-4 specifies. Restated here so
  -- that the trigger reads as a complete statement of SG-4 and so that the
  -- error the administrator sees names the rule rather than a constraint name.
  --
  -- ORDER OF FIRING, since it is not obvious: a BEFORE ROW trigger runs
  -- *before* the table's CHECK constraints are evaluated, so in practice this
  -- branch raises P0001 and the constraint is never reached. The constraint is
  -- not therefore redundant — it is the layer that still holds if this trigger
  -- is ever disabled or dropped, which is exactly the scenario SG-4 has in
  -- mind when it calls for "a plain constraint, always true".
  if new.guardian_person_id = new.child_person_id then
    raise exception
      'guardianships: a person cannot be their own guardian (person %) [SAFEGUARDING.md SG-4]',
      new.guardian_person_id;
  end if;

  -- 2. The guardian must be an adult with a KNOWN date of birth.
  --
  -- Two separate messages, because the two failures need different actions
  -- from the administrator: "go and find out this person's date of birth"
  -- versus "this person cannot be a guardian".
  select p.dob
    into v_guardian_dob
    from public.people p
   where p.id = new.guardian_person_id;

  if not found then
    -- Unreachable while the foreign key stands; fail closed anyway rather than
    -- letting a NULL flow into the age test as "not a minor".
    raise exception
      'guardianships: guardian person % does not exist [SAFEGUARDING.md SG-4]',
      new.guardian_person_id;
  end if;

  if v_guardian_dob is null then
    raise exception
      'guardianships: the guardian''s date of birth must be known (person % has none) [SAFEGUARDING.md SG-4]',
      new.guardian_person_id;
  end if;

  if public.is_minor_dob(v_guardian_dob) then
    raise exception
      'guardianships: the guardian must be an adult (person % has dob %) [SAFEGUARDING.md SG-4]',
      new.guardian_person_id, v_guardian_dob;
  end if;

  -- 3. The child must be a minor at creation.
  --
  -- `is_minor()` returns TRUE for a NULL dob and for an unknown id (SG-0, fail
  -- closed), so an unknown-dob child is accepted. That is the protective
  -- direction: refusing the link would leave a child the club knows least about
  -- with no recorded guardian at all.
  if not public.is_minor(new.child_person_id) then
    raise exception
      'guardianships: the child must be a minor at creation (person % is an adult) [SAFEGUARDING.md SG-4]',
      new.child_person_id;
  end if;

  return new;
end $function$;

create trigger trg_guardianships_guard
  before insert or update of guardian_person_id, child_person_id
  on public.guardianships
  for each row execute function public.guardianships_guard();


-- =============================================================================
-- 7. SG-1.8 GUARD (SCAFFOLD) AND THE SG-2 TRUNCATE GUARD
-- =============================================================================
-- SG-1.8, in full: "deleting a guardianships row — or retargeting it by
-- updating guardian_person_id or child_person_id — turns an existing, compliant
-- conversation into a prohibited one with nothing at all happening in
-- conversations, conversation_participants or messages... Waiting for the
-- nightly checker or for the next message insert (SG-1.7) is too late: the
-- prohibited state exists in the meantime."
--
-- The rule it lays down: "A trigger on guardianships (BEFORE DELETE, and BEFORE
-- UPDATE OF guardian_person_id, child_person_id) finds every conversation in
-- which the outgoing guardian was the qualifying participant... and rejects the
-- change unless every one of those conversations is already closed or archived
-- (conversations.closed_at IS NOT NULL). The error names the conversations."
--
-- WHY THIS IS A STUB TODAY, AND WHAT P5.2 MUST DO
--   SG-1 "Implemented by": "Where P1.3 lands before the messaging tables exist,
--   the SG-1.8 trigger is written in P1.3 as a no-op-if-absent guard and
--   completed in P5.2; the P5.2 PR is not complete without its tests."
--
--   So: the trigger, its timing and its column list are created now and are
--   part of the table's shape from the first day. The body is a single
--   `to_regclass` test. While `public.conversations` does not exist there is no
--   conversation to protect and the change is allowed through. The moment it
--   does exist and this body has not been replaced, the guard raises rather
--   than waving the change past — fail closed (§1.2), and a forcing function:
--   P5.2 cannot create `conversations` without also completing this function,
--   because its own migration would otherwise be unable to touch the table.
--
--   P5.2 REPLACES THE BODY of this function (create or replace, same name, same
--   signature). It must not add a second trigger, and must not drop this one.
--   The four tests SG-1.8 names —
--     guardianship_delete_blocked_when_it_creates_1to1
--     guardianship_delete_allowed_after_conversation_closed
--     guardianship_retarget_blocked_when_it_creates_1to1
--     guardianship_delete_allowed_when_no_affected_conversation
--   — belong to that PR, each run as club_admin AND as service_role.
--
-- ONE ADDITION TO SG-1.8'S COLUMN LIST: `ended_at`.
--   SG-1.8 names DELETE and UPDATE OF (guardian_person_id, child_person_id). It
--   was written before this table had `ended_at`. Setting `ended_at` retires
--   the link, and a retired link cannot be what makes an adult<->minor 1:1
--   permissible — so for SG-1 purposes ending a link is indistinguishable from
--   deleting it, and leaving it out would be a hole with a soft edge: the
--   administrator blocked from deleting the row could simply end it instead and
--   reach the same prohibited state. Adding a column to the guard's watch list
--   strengthens the invariant, which SAFEGUARDING.md §6.2 permits without
--   Adam's agreement but asks to be recorded; it is in DECISIONS.md.
--   P5.2's completed body must honour it: an `ended_at` transition from NULL to
--   non-NULL is evaluated exactly as a delete of the pair.

create or replace function public.guardianships_conversation_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
begin
  -- P5.2: REPLACE THIS BODY. See the block comment above for the exact rule,
  -- the four required tests, and the `ended_at` case.
  if to_regclass('public.conversations') is null then
    -- No messaging tables yet, so no conversation can be made non-compliant by
    -- this change. Allow it.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'guardianships: public.conversations exists but the SG-1.8 guard has not been completed; P5.2 must replace public.guardianships_conversation_guard() [SAFEGUARDING.md SG-1.8]';
end $function$;

create trigger trg_guardianships_conversation_guard
  before delete or update of guardian_person_id, child_person_id, ended_at
  on public.guardianships
  for each row execute function public.guardianships_conversation_guard();

-- Generic updated_at stamper from the baseline.
create trigger trg_guardianships_updated
  before update on public.guardianships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- SG-2, applied ASYMMETRICALLY here, and the asymmetry is the point.
-- ---------------------------------------------------------------------------
-- NO `deny_hard_delete()` ON THIS TABLE.
--
-- SG-2's statement names four tables and this is not one of them: "No row in
-- `messages`, `audit_log`, `safeguarding_concerns`, or
-- `conversation_participants` may ever be hard-deleted". More decisively,
-- SG-1.8 requires the DELETE to remain possible and explains why in terms:
--
--   "Why 'reject unless closed' rather than a flat reject: a flat reject makes
--    a mistyped or genuinely-ended guardianship permanently unremovable, which
--    is itself a data-protection problem."
--
-- A `deny_hard_delete()` trigger here would BE that flat reject — it would make
-- SG-1.8's carefully specified two-step sequence (close the conversation, then
-- remove the link) impossible, and would leave a link typed against the wrong
-- child standing forever, which is a worse record than none. The guard on
-- deletion is therefore SG-1.8's conditional one at §7, not SG-2's
-- unconditional one, and `DELETE` is granted at §10 to the roles SG-4 gives
-- write access to.
--
-- THE TRUNCATE GUARD DOES APPLY.
-- `deny_truncate()` is attached and TRUNCATE is revoked, because a row-level
-- BEFORE DELETE trigger does not fire on TRUNCATE — so a single TRUNCATE would
-- strip every guardian link in the club without the SG-1.8 guard being
-- consulted once, which is the entire prohibited state SG-1.8 exists to
-- prevent, applied to every child at once. There is also no administrative act
-- that TRUNCATE serves and a targeted DELETE does not. This is a strengthening
-- beyond SG-2's literal table list; §6.2 permits it and asks that it be
-- recorded, and it is, in DECISIONS.md.

create trigger trg_guardianships_deny_truncate
  before truncate on public.guardianships
  for each statement execute function public.deny_truncate();


-- =============================================================================
-- 8. ROW LEVEL SECURITY AND POLICIES
-- =============================================================================
-- Enabled, not FORCE'd, matching every other table in this project. FORCE would
-- not bind `service_role` anyway (it holds BYPASSRLS); what binds it is the
-- revokes at §10 and the triggers at §6 and §7 (SAFEGUARDING.md §1.2).

alter table public.guardianships enable row level security;

-- SG-4: "a guardian may SELECT their own links". Live and ended alike — a
-- guardian is entitled to see that a link they held has been ended, and
-- concealing it would make the record unauditable from the one side that is
-- always entitled to it.
create policy "guardianships_guardian_read" on public.guardianships
  for select
  using (guardian_person_id = public.current_person_id());

-- SG-4: "club_admin and safeguarding_lead may SELECT and write all". Those
-- roles do not exist until P1.4, so the stand-in is the baseline's
-- `is_committee()` (profiles.role in ('committee','super_user')) — the same
-- stand-in P1.1 used on `public.people`, and it is replaced in the same sweep.
--
-- TODO (P1.4): re-express all four committee policies against
-- `public.has_role()`, splitting `club_admin` and `safeguarding_lead` from the
-- committee-at-large, and decide whether a `coach` needs any read here at all
-- (SAFEGUARDING.md §1.3 gives them none by default).
create policy "guardianships_committee_read" on public.guardianships
  for select
  using (public.is_committee());

create policy "guardianships_committee_insert" on public.guardianships
  for insert
  with check (public.is_committee());

create policy "guardianships_committee_update" on public.guardianships
  for update
  using (public.is_committee())
  with check (public.is_committee());

-- The FOR DELETE policy that P1.1 deliberately did not write for `people`, and
-- that is deliberately written here. SG-4 gives club_admin and
-- safeguarding_lead write access to this table and SG-1.8 calls that "a
-- reachable administrative transition, not a theoretical one" — the whole
-- design of SG-1.8 assumes an administrator can, in the end, remove a link.
-- What stops the dangerous removal is the trigger at §7, which binds every
-- role including `service_role` and the owner; what stops everyone else is
-- this policy plus the grants at §10.
create policy "guardianships_committee_delete" on public.guardianships
  for delete
  using (public.is_committee());

-- ---------------------------------------------------------------------------
-- DELIBERATELY ABSENT: a policy letting a CHILD read their own guardianship
-- rows (`child_person_id = public.current_person_id()`).
-- ---------------------------------------------------------------------------
-- Guardian and committee only, for now. The reasoning, and why it is not
-- obviously right:
--
--   * A minor with a login reading "Jane Smith is recorded as your foster
--     carer" is, in the ordinary case, harmless and arguably their right. In
--     the case that matters — a contested arrangement, a parent without contact
--     — the same row tells a child something the club is not the right body to
--     be telling them, and `notes` may carry the shape of a court order.
--   * SAFEGUARDING.md §1.3 derives parental authority from the link. It says
--     nothing about the child's own sight of it, and inventing a read here
--     would be inventing policy in a migration.
--   * Open Decision D5 ("At what age does guardian access to a young person's
--     data lapse? ... some clubs give 16-17s control of their own messaging
--     while guardians retain visibility") is the decision that settles this
--     too: whatever transition age D5 lands on is the age at which a young
--     person should see, and be able to question, the links held over them.
--
-- So: no child-read policy until D5 is answered. Adding one later is a
-- one-policy migration; removing a read a child has already had is not.
-- A minor is not shut out of the *fact* of their own record: `people_self_read`
-- (P1.2) still shows them their own person row.


-- =============================================================================
-- 9. people_guardian_read
-- =============================================================================
-- SG-4: "a guardian may SELECT their own links AND THEIR CHILDREN'S LINKED
-- RECORDS". This is that second half, on `public.people` — the fifth policy on
-- that table, after P1.1's three committee ones and P1.2's self-read.
--
-- THE LAPSE AT 18 (Open Decision D5)
--   SG-4: "Its effects lapse: guardian access to the young person's data ends
--   at 18 (or at a transition age — Open Decision D5), which is enforced in the
--   reading policies, not by mutating the guardianship row." D5's recommendation
--   is unresolved and explicitly needs Adam's view, so this implements the
--   invariant's stated default — access ends at 18 — as `public.is_minor(id)`
--   in the USING clause. The guardianship row itself is untouched by the
--   birthday; only what it lets its holder read changes, which is precisely
--   what SG-4 asks for.
--
--   Changing this later is a one-line policy replacement (e.g. an age-16 cutoff
--   for some columns, or a column-scoped view), which is why the rule lives
--   here rather than in a materialised flag anywhere.
--
--   Note the interaction with SG-0: `is_minor()` is TRUE for a child with an
--   unknown dob, so the guardian keeps the read. Fail-closed on the SG-1 axis
--   and fail-open on this one is not an inconsistency — it is the same rule
--   (treat the unknown as a child) producing the protective answer in both
--   places.
--
-- ONLY LIVE LINKS (`ended_at is null`). An ended arrangement is an ended
-- arrangement; the guardian keeps sight of the link itself (§8) but not of the
-- child's record.
--
-- NO RECURSION: the `guardianships` subquery is evaluated as the caller, so
-- `guardianships_guardian_read` applies to it — and that policy references
-- `current_person_id()` and `profiles`, never `people`.
--
-- READ ONLY. There is deliberately no guardian INSERT or UPDATE on `people`: a
-- parent may not edit their child's record, least of all `dob`, for the same
-- reason P1.2 refused a self-update. Registration data is captured through the
-- P2.2 flow with the club as the writer.

create policy "people_guardian_read" on public.people
  for select
  using (
    public.is_minor(people.id)
    and exists (
      select 1
        from public.guardianships g
       where g.guardian_person_id = public.current_person_id()
         and g.child_person_id = people.id
         and g.ended_at is null
    )
  );


-- =============================================================================
-- 10. GRANTS
-- =============================================================================
-- An explicit override of baseline §9's blanket `grant all privileges on all
-- tables in schema public to anon, authenticated, service_role`, per
-- SAFEGUARDING.md §1.2. If a later migration re-runs that blanket grant, this
-- block must be re-asserted after it or the TRUNCATE revoke silently
-- disappears.

revoke all privileges on public.guardianships from anon, authenticated, service_role;

-- anon gets nothing: there is no anonymous surface that needs a guardian link.
--
-- DELETE is granted, unlike on `public.people`. See §7: SG-1.8 requires the
-- deletion to be reachable and guards it conditionally instead of forbidding
-- it. `service_role` holds it too, deliberately — SG-1.8's tests are specified
-- to run "as club_admin AND as service_role, since SG-4's RLS is what grants
-- the write and the trigger is what must survive the bypass", which is only a
-- meaningful test if the privilege is there for the trigger to be the thing
-- that stops it.
grant select, insert, update, delete on public.guardianships
  to authenticated, service_role;

-- TRUNCATE stays revoked from all three, and is named explicitly so the intent
-- survives someone later adding a broader grant on one line. It is the half of
-- SG-2 that does apply here (§7).
revoke truncate on public.guardianships from anon, authenticated, service_role;

-- current_person_id(). anon is revoked BY NAME as well as via PUBLIC: hosted
-- Supabase's default privileges (`alter default privileges for role postgres
-- ... grant execute on functions to anon, authenticated, service_role`) give
-- every new function an explicit grant to all three API roles, which
-- `revoke ... from public` does not touch. Found the hard way by the P1.1
-- preview-branch rehearsal, where the local shadow DB had passed.
--
-- anon would get NULL from it in any case (auth.uid() is null), so this is
-- tidiness rather than a hole being closed — but the same reflex applied
-- without exception is what makes the one case that matters get it too.
revoke all privileges on function public.current_person_id() from public;
revoke all privileges on function public.current_person_id() from anon;
grant execute on function public.current_person_id() to authenticated, service_role;

-- The two trigger functions are never called directly by anyone. Revoked from
-- PUBLIC and from all three API roles by name.
revoke all privileges on function public.guardianships_guard()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.guardianships_conversation_guard()
  from public, anon, authenticated, service_role;

-- Re-assert P1.1's `people` revokes. Nothing in this migration re-runs the
-- baseline's blanket grant, but re-stating the pair that matters costs nothing
-- and keeps the guarantee local to the file a reviewer is reading.
revoke delete, truncate on public.people from anon, authenticated, service_role;


-- =============================================================================
-- END OF P1.3
-- =============================================================================
