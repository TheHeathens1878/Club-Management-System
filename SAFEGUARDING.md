# SAFEGUARDING.md — safeguarding invariants for the AoM Sports Club platform

> **Status:** draft awaiting Adam's review of the open decisions (§5) and the
> citation table (§2.3).
> **Authority:** this document expands `PLAN.md` §2.4 into precise, testable
> statements. Where this document and a task description disagree, **this
> document wins** and the task must be re-specified.
> **Change control:** see §6. Any change here, or to the enforcement of any
> SG-invariant, requires Adam's review (`PLAN.md` §2.3).

---

## 1. Purpose & scope

### 1.1 Purpose

Every schema and feature task that touches people, guardianships, roles,
certifications, concerns, media or messaging must be able to point at a numbered
invariant in §3 and say how it satisfies it, and which test proves it.

The tasks in scope today are:

| Task | Area | Invariants it must satisfy |
|---|---|---|
| P1.1 | `people`, `is_minor` | SG-0 |
| P1.3 | `guardianships` | SG-4, and SG-1.8 (guardianship-change guard) |
| P1.4 | `roles` / `person_roles`, `has_role()` | SG-3, SG-6, and the helper every other policy uses |
| P2.1 | `teams`, `team_memberships` | SG-6 (both the staff-side and composition-side guards) |
| P2.2 | `registrations`, consent capture | SG-5 |
| P4.3 | `certifications`, `safeguarding_concerns` | SG-3, SG-6, SG-7, SG-8 |
| P4.5 | media, photo consent | SG-5, SG-7 |
| P5.1–P5.6 | messaging | SG-1, SG-2, SG-7, SG-8 |

### 1.2 The governing principle

**Safeguarding invariants are enforced in the database.** A rule that is
enforced only by the web or mobile UI is not enforced. Every invariant below
names its enforcement layer — a `CHECK` constraint, an exclusion constraint, a
trigger, an RLS policy, or a combination — and every invariant has a test that
*attempts the violation* and expects a failure.

Two consequences follow, and both are binding:

1. **`service_role` is not exempt — and cannot be made subject to RLS.**
   `service_role` holds `BYPASSRLS`, and the project relies on that for
   server-side code and Edge Functions (baseline migration §6). `FORCE ROW LEVEL
   SECURITY` does **not** change that: FORCE removes the *table owner's*
   implicit exemption, it does not re-subject a `BYPASSRLS` role to policies.
   Against `service_role` — and against the owner — there are therefore exactly
   two controls that work:
   - **Constraints and triggers**, which no role can bypass. Anything that must
     hold *unconditionally* (SG-1, SG-2, SG-4, SG-6 tier 1) is enforced this
     way.
   - **Privileges.** `REVOKE` applies to a `BYPASSRLS` role like any other.
     Where a table must not be touched directly at all (SG-3), the grant is
     removed and access exists only through `SECURITY DEFINER` functions that
     perform their own authority checks and write their own audit rows.

   RLS is used *in addition*, to scope reads for `authenticated`/`anon`; it is
   never the sole enforcement of an invariant. **Every revocation named in this
   document is an override of the baseline.** Baseline migration §9 grants
   `ALL PRIVILEGES ON ALL TABLES IN SCHEMA public` to `anon`, `authenticated`
   and `service_role`; a migration that re-runs that blanket grant silently
   undoes these controls, so each revocation is written in the same migration as
   its table and re-asserted after any later blanket grant.
2. **Fail closed.** Where data needed to evaluate a rule is missing (most
   importantly an unknown date of birth), the protective branch is taken.

### 1.3 Roles

Roles are defined in P1.4 as `person_roles` (a person may hold several). The
safeguarding-relevant set:

| Role | Meaning | Safeguarding position |
|---|---|---|
| `club_admin` | Committee-level administrator | Full administrative access; sees safeguarding concerns; all access audit-logged |
| `safeguarding_lead` | Club Welfare Officer (the FA's term) | The only role whose *purpose* is safeguarding. Sole read/write of concerns alongside `club_admin`; can export conversations |
| `coach` | Coaches, managers, assistants attached to a team | May work with children. Subject to SG-6 (DBS/qualification) and SG-1 (no 1:1 with a minor) |
| `staff` | Bar, clubhouse, ground staff | No inherent access to member or child data |
| `member` | An adult member/player | Ordinary participant |
| `parent` / guardian | An adult linked to a child by a `guardianships` row | Sees their own children's data; is the guardian participant that makes an adult↔minor conversation permissible |
| `hirer` | Books the function room or a pitch | No member or child data at all. Deliberately isolated |

`parent` as a *role* and a **guardianship** as a *link* are different things.
The role is a label; only the link (P1.3) carries authority over a specific
child. **Every rule below keys off the link, never the role.** A person holding
`parent` for child A has no standing whatsoever in respect of child B.

### 1.4 Definition of "minor"

> **SG-0 (definitional).** A person is a **minor** if they are under 18 years of
> age on the date of evaluation, derived from `people.dob`. Where `dob` is
> `NULL`, the person is **treated as a minor** for every purpose in this
> document.

Notes:

- **Derived, never a stored snapshot.** A boolean set once at registration goes
  stale on the person's 18th birthday. A Postgres generated column cannot depend
  on `now()`, so the enforceable form is a `STABLE` function
  `public.is_minor(person_id uuid)` (plus `public.is_minor_dob(d date)`), called
  by constraints, triggers and policies alike. A materialised `is_minor` column
  is permitted for indexing only if refreshed nightly *and* every enforcement
  point still calls the function. Age crossing 18 is an event: see SG-1.2.
- **Unknown DOB → minor is a fail-closed default (Open Decision D1).** The cost
  is asymmetric: an adult wrongly treated as a minor is inconvenienced (their
  DMs need a third participant); a child wrongly treated as an adult is exposed.
  Mitigation: `dob` is **mandatory at registration** (P2.2) for anyone joining a
  team, so unknown DOB should be limited to legacy imports (Phase 3) and hirers
  — and hirers are excluded from member messaging entirely (confirm in P5.1).

---

## 2. Framework

### 2.1 The governing guidance

Per `PLAN.md` §3 Q6, the governing framework is **the FA Safeguarding Children
Policy and the associated FA guidance, as applied by Cheshire FA** to affiliated
clubs in its county.

### 2.2 Honesty about citations

This document deliberately **does not quote FA or Cheshire FA text and does not
cite section numbers.** Guidance is revised, renumbered and re-issued; a
fabricated or stale reference in a safeguarding document is worse than none.
What follows is a list of *rule areas* we are confident exist within FA
safeguarding guidance, each verified by Adam against the current published
guidance at spec time — exactly what Q6 requires before P5.1 is approved.

### 2.3 Citation table

| Ref | Rule area (as we understand it) | Invariants it supports | Verified source |
|---|---|---|---|
| C1 | **Safe communication with under-18s.** Adults in positions of trust should not communicate one-to-one and privately with a child; communications should be transparent and include the child's parent/guardian, and ideally take place in group settings | SG-1 | `[Adam to verify against current published guidance — URL/section]` |
| C2 | **Photography and filming.** Consent is required before images of children are taken and before they are published or shared; consent is recorded per child and is withdrawable | SG-5 | `[Adam to verify against current published guidance — URL/section]` |
| C3 | **DBS checks and safeguarding qualifications.** Those in eligible roles working with children require an in-date FA DBS check and the relevant safeguarding/first-aid qualifications | SG-6 | `[Adam to verify against current published guidance — URL/section]` |
| C4 | **Reporting concerns.** Concerns are reported to the Club Welfare Officer and, as appropriate, to the County FA Designated Safeguarding Officer and statutory agencies; records are kept confidential and shared strictly on a need-to-know basis | SG-3, SG-7 | `[Adam to verify against current published guidance — URL/section]` |
| C5 | **Record keeping and retention.** Safeguarding records are retained securely for a defined period and are not destroyed prematurely | SG-2, SG-8 | `[Adam to verify against current published guidance — URL/section]` |
| C6 | **Club Welfare Officer role.** An affiliated club with youth teams must appoint a Club Welfare Officer, who is DBS-checked and trained | SG-3, SG-6 | `[Adam to verify against current published guidance — URL/section]` |
| C7 | **UK GDPR / Data Protection Act 2018.** Not FA guidance, but binding: lawful basis, data minimisation, storage limitation, and the heightened protection owed to children's data | SG-2, SG-5, SG-7, SG-8 | `[Adam to verify — ICO children's code / UK GDPR Art. 5]` |

**No invariant below may be implemented until its citation row is filled in.**
Implementation of the *mechanism* may proceed; sign-off may not.

---

## 3. Invariants

Each invariant states: the rule; the guidance area behind it; the enforcement
layer; the test that must exist; the PLAN task that implements it.

Test convention: pgTAP under `supabase/tests/safeguarding/`, run in CI against
the fresh local Postgres already stood up by the `database` job (P0.3). Every
test named below **attempts the prohibited action and asserts that it fails**
(`throws_ok`, or `is_empty` for read-scoping). A test that only asserts the
happy path does not satisfy the invariant.

---

### SG-1 — No unaccompanied adult↔minor conversation

**Statement.** A conversation must never be in a state where its set of active
participants consists of exactly one adult and exactly one minor, unless the
adult is a guardian of that minor. Any operation that would produce such a state
is rejected.

**Guidance.** C1.

**Enforcement.** Triggers — on `conversation_participants` (INSERT, UPDATE of
`left_at`), on `messages` (INSERT), on `people` (UPDATE of `dob`, SG-1.2) and on
`guardianships` (DELETE, and UPDATE of `guardian_person_id` /
`child_person_id`, SG-1.8) — plus a nightly re-evaluation job. A `CHECK`
constraint cannot express it: the predicate spans rows. Triggers rather than
policies, because the invariant must also bind `service_role` and the table
owner (§1.2). **The trigger list is the invariant:** any table whose change can
flip a conversation's compliance must appear in it, which is why guardianships
and DOB are in it and not only the two messaging tables.

**Precise form.** Let *A* be the active participants of conversation *c*
(rows with `left_at IS NULL`, excluding participants whose sole basis is an
administrative/oversight capacity — see SG-1.5). The conversation is
**non-compliant** when:

`count(A) = 2 AND exactly one of A is a minor (SG-0) AND no adult in A is a
guardian of that minor`

**Edge cases — all of these are part of the invariant and all need tests:**

- **SG-1.1 A guardian leaves.** Removing a participant (setting `left_at`) is an
  operation like any other and is evaluated *after* the change. If a
  coach + child + parent group becomes coach + child, the parent's departure is
  **rejected**. The correct flows are: another guardian joins first, or the
  conversation is closed/archived. Test: `guardian_cannot_leave_leaving_1to1`.
- **SG-1.2 A participant turns 18.** Time can make a conversation compliant
  (child turns 18 → two adults → fine) but cannot make it non-compliant, so no
  scheduled *blocking* is needed for this direction. The reverse — an adult
  becoming a minor — is impossible. However, a *correction* to `dob` can flip a
  participant to minor. `people.dob` UPDATE therefore fires a re-evaluation of
  every conversation the person actively participates in, and is **rejected** if
  any becomes non-compliant, with an error naming the conversations, so an admin
  can fix the DOB and the participants in one deliberate sequence. Tests:
  `dob_correction_blocked_when_it_creates_1to1`,
  `minor_turning_18_does_not_break_existing_conversation`.
- **SG-1.3 One adult + two minors.** **Permitted by this invariant** (it is not
  a 1:1) but it is *not* good practice under C1 and it is **Open Decision D2**.
  Recommended default: permit at DB level, and require in P5.1 that any
  club-created group containing a minor auto-includes that minor's guardians
  via P5.3 — so the situation is reachable only by guardians declining/leaving,
  which SG-1.1 already blocks. Test: `one_adult_two_minors_allowed` (documents
  the boundary; flip it if Adam decides otherwise).
- **SG-1.4 The adult is the minor's own guardian.** **Permitted.** A parent
  messaging their own child privately is not a safeguarding matter for the club.
  The check is against `guardianships` for *that specific child*, not the
  `parent` role. Test: `guardian_can_dm_own_child`, and
  `parent_of_other_child_cannot_dm_this_child`.
- **SG-1.5 `club_admin` / `safeguarding_lead` visibility.** Oversight must not
  itself create a compliant-looking 1:1 nor a non-compliant one. Two rules:
  (a) a `safeguarding_lead` or `club_admin` **reading or exporting** a
  conversation is not a participant and does not appear in the participant set
  (their access is SG-7 audit-logged instead); (b) if such a person is a
  *genuine* participant they count normally. A participant row must therefore
  never be created as a side effect of viewing. Test:
  `admin_read_does_not_create_participant`, `lead_as_third_party_does_not_satisfy_guardian_requirement`.
- **SG-1.6 Announcements.** One-way `announcement` conversations where minors
  cannot reply are outside the 1:1 risk, but must still be excluded explicitly
  in the trigger rather than by accident. Test:
  `announcement_to_single_minor_allowed`.
- **SG-1.7 Messaging into a non-compliant conversation.** Belt and braces: even
  if a conversation somehow reaches a non-compliant state (e.g. a data fix
  applied with triggers disabled), `messages` INSERT re-evaluates and refuses.
  Test: `cannot_post_into_noncompliant_conversation`.
- **SG-1.8 The guardianship itself changes.** The guardian link is the only
  thing that makes an adult↔minor 1:1 permissible (SG-1.4), so **deleting** a
  `guardianships` row — or **retargeting** it by updating `guardian_person_id`
  or `child_person_id` — turns an existing, compliant conversation into a
  prohibited one with nothing at all happening in `conversations`,
  `conversation_participants` or `messages`. SG-4 deliberately gives
  `club_admin` and `safeguarding_lead` write access to that table, so this is a
  reachable administrative transition, not a theoretical one. Waiting for the
  nightly checker or for the next message insert (SG-1.7) is too late: the
  prohibited state exists in the meantime.

  **Rule — decided here, not an open decision.** A trigger on `guardianships`
  (`BEFORE DELETE`, and `BEFORE UPDATE OF guardian_person_id, child_person_id`)
  finds every conversation in which the outgoing guardian was the **qualifying
  participant** — every conversation whose active participant set (SG-1.5)
  would become non-compliant once the link no longer holds — and **rejects the
  change unless every one of those conversations is already closed or
  archived** (`conversations.closed_at IS NOT NULL`). The error names the
  conversations, exactly as SG-1.2's does.

  Why "reject unless closed" rather than a flat reject: a flat reject makes a
  mistyped or genuinely-ended guardianship permanently unremovable, which is
  itself a data-protection problem. Requiring the conversations to be closed
  first gives the administrator a deliberate two-step sequence — close the
  conversation, then remove the link — and preserves the message history for
  SG-8. Closing is the correct first step rather than removing participants,
  because SG-1.1 already blocks removing the guardian from a live conversation.

  A retarget is evaluated as a delete of the old pair plus an insert of the new
  pair: the old pair is checked as above, and the new pair must independently
  satisfy SG-4.

  Tests: `guardianship_delete_blocked_when_it_creates_1to1`,
  `guardianship_delete_allowed_after_conversation_closed`,
  `guardianship_retarget_blocked_when_it_creates_1to1`,
  `guardianship_delete_allowed_when_no_affected_conversation`. All four run as
  `club_admin` **and** as `service_role`, since SG-4's RLS is what grants the
  write and the trigger is what must survive the bypass.

**Implemented by.** P1.3 (the SG-1.8 guardianships trigger ships with the
table), P5.1 (spec), P5.2 (participant/message/DOB triggers + tests), P5.3
(auto-membership must add guardians of minor players, which is what keeps team
conversations compliant by construction). Where P1.3 lands before the messaging
tables exist, the SG-1.8 trigger is written in P1.3 as a no-op-if-absent guard
and completed in P5.2; the P5.2 PR is not complete without its tests.

---

### SG-2 — Messages and audit rows are soft-delete only

**Statement.** No row in `messages`, `audit_log`, `safeguarding_concerns`, or
`conversation_participants` may ever be hard-deleted, by any role, including
`service_role`. Deletion is expressed as `deleted_at`/`deleted_by`; the row and
its metadata survive.

**Guidance.** C5, C7 (storage limitation is satisfied by *redaction*, not by
destroying the record of the exchange).

**Enforcement.** Four layers, and all four are required:
- **Row-level delete guard:** `BEFORE DELETE ... FOR EACH ROW EXECUTE FUNCTION
  public.deny_hard_delete()`, which unconditionally `RAISE EXCEPTION`s. This is
  the one that binds `service_role` and the SQL editor.
- **Statement-level truncate guard:** `BEFORE TRUNCATE ... FOR EACH STATEMENT
  EXECUTE FUNCTION public.deny_truncate()`, likewise unconditional. A separate
  trigger and a separate function, because **a row-level `BEFORE DELETE` trigger
  does not fire on `TRUNCATE`**. Without it the entire table can be emptied
  without `deny_hard_delete()` being called once — the complete loss of the
  messages and the audit trail that would evidence it.
- **Privileges:** `REVOKE DELETE, TRUNCATE ON public.messages, public.audit_log,
  public.safeguarding_concerns, public.conversation_participants FROM anon,
  authenticated, service_role`. `service_role` **must be named** — baseline §9
  grants it `ALL PRIVILEGES`, and its `BYPASSRLS` means no policy will ever stop
  it. Revoking is the only thing that does (§1.2).
- **RLS:** no `FOR DELETE` policy exists on these tables, so `authenticated` and
  `anon` cannot delete regardless. Note that RLS does not apply to `TRUNCATE` at
  all, which is the other half of why the statement-level trigger is required.

**The table owner remains able to truncate, and that is closed by process.**
`postgres` owns these tables; an owner or superuser is not stopped by a revoked
privilege, only by the `BEFORE TRUNCATE` trigger — which an owner could disable
first. So: **no migration may `TRUNCATE`, `DROP`, or `ALTER TABLE ... DISABLE
TRIGGER` on `messages`, `audit_log`, `safeguarding_concerns` or
`conversation_participants`.** This is the safeguarding case of `PLAN.md` §2.5
(migrations are additive; tables are dropped only in an explicit, signed-off
decommission task). A PR that does any of it is a §6 change-control matter and
requires Adam's review; it may not auto-merge.

**Retention interacts, it does not exempt.** The retention job (SG-8) **redacts
content in place** — nulls `body`, drops the attachment object from Storage,
sets `redacted_at` and a reason — leaving sender, conversation, timestamp and
audit trail intact. It never deletes rows. It runs as a dedicated role, and if
that role ever needs to bypass `deny_hard_delete()` it must do so via an
explicitly named, audit-logged function — not by disabling the trigger.

**Test.** `hard_delete_message_throws`, `hard_delete_audit_row_throws`,
`hard_delete_concern_throws`, `hard_delete_participant_throws`,
`truncate_messages_throws`, `truncate_audit_log_throws`,
`truncate_concerns_throws`, `truncate_participants_throws`,
`retention_job_redacts_but_row_count_unchanged`, plus
`delete_and_truncate_privileges_revoked_for_api_roles` — a privilege assertion,
not a behavioural one: `has_table_privilege('service_role', 'public.messages',
'TRUNCATE')` is false, and likewise for `anon` and `authenticated`, for
`DELETE` and `TRUNCATE`, across all four tables. It is what catches a later
blanket `grant all on all tables` silently restoring access.

Every delete and truncate test runs as `authenticated`, as `service_role`
**and** as the table owner. The owner run is the one that matters: it proves
the trigger, not the grant, is doing the work.

**Implemented by.** P5.2 (messages), P4.3 (concerns), and a small migration in
Phase 1 that adds the guard to the existing `public.audit_log`.

---

### SG-3 — Safeguarding concerns are restricted

**Statement.** Rows in `safeguarding_concerns` (and any attachment, note or
comment child table) are readable **only** by holders of `safeguarding_lead` or
`club_admin`. `club_admin` alone does not confer write access to case notes.

**Guidance.** C4, C6.

**Enforcement.** Privileges and `SECURITY DEFINER` functions first; RLS second.

This is the one place where RLS alone is not acceptable, and the reason is
worth stating plainly: `service_role` holds `BYPASSRLS` and every Edge Function
in the project runs as it. **`FORCE ROW LEVEL SECURITY` does not close that**
— FORCE removes the *owner's* exemption, it does not re-subject a `BYPASSRLS`
role to policies. An earlier draft of this section relied on FORCE and was
wrong: under it, an Edge Function could `SELECT * FROM safeguarding_concerns`
directly, read every narrative, and never write the SG-7 audit row. The design
is therefore:

1. **Revoke everything, from everyone.** In the same migration that creates the
   tables (§2.2 hard rule): `REVOKE ALL PRIVILEGES ON
   public.safeguarding_concerns, public.safeguarding_concern_notes FROM anon,
   authenticated, service_role;` — and the same for any future attachment or
   comment child table, and for the sequences behind them. This is an explicit
   override of baseline §9's blanket `grant all privileges on all tables ... to
   anon, authenticated, service_role`, and it is void the moment that blanket
   grant is re-run, so it is re-asserted after any such migration (§1.2). The
   three API roles end with **no direct access whatsoever** to these tables:
   not SELECT, not INSERT, not UPDATE, not DELETE.
2. **Expose the audited path, and only it.** All reads and writes go through
   `SECURITY DEFINER` functions owned by a dedicated role that owns the tables
   (`safeguarding_owner`, or `postgres` if a separate owner is judged
   unnecessary — the owner must not be a role the application can authenticate
   as), declared `SET search_path = public`, with `EXECUTE` revoked from
   `PUBLIC` and granted to `authenticated` alone. Each function (a) checks the
   caller's authority via the P1.4 `public.has_role()` helper plus the
   exclusions in the write model below, and (b) writes its SG-7 audit row
   **before returning**, including when it returns zero rows. Because the table
   grant is gone, this is the only path that exists — for Edge Functions
   running as `service_role` exactly as much as for the browser.
3. **Keep the SG-2 guards.** `deny_hard_delete()` and `deny_truncate()` apply
   to these tables as to any other. A trigger binds the function owner too,
   which is what stops a `SECURITY DEFINER` function from being the way round
   SG-2.
4. **RLS in addition, never instead.** RLS is enabled and `FORCE`d on the
   concerns tables, with no permissive fallback policy, and the policies
   express the write model below. With the grants revoked this is defence in
   depth — it is what protects the tables if a grant is ever restored by
   accident. It is *not* what stops `service_role`, and this document should
   never again be read as claiming that it is.

**Roles with `BYPASSRLS` are controlled by privileges and triggers, not by
policies.** That sentence is the whole of the reasoning above, and it applies
wherever this document says an invariant binds "even `service_role`".

**Write model — recommended, and Open Decision D3.** Every row of this table is
implemented *inside the accessor functions* of (2) above, and mirrored in the
policies of (4). The functions are the enforcement; the policies are the
backstop.

| Actor | Can do |
|---|---|
| Any authenticated person | **INSERT** a concern (report it). Anyone may raise a concern; this is the point of a reporting route |
| Reporter | **SELECT their own submitted row, restricted to a "receipt" view** — their own narrative, the reference number, and the status (`received` / `under review` / `closed`), and nothing added afterwards |
| `safeguarding_lead` | SELECT all; INSERT; UPDATE status, triage, case notes |
| `club_admin` | SELECT all; **no** UPDATE of case notes (avoids a committee member editing a case that may concern them) |
| Anyone | No DELETE, ever (SG-2) |
| Subject of a concern | **No implicit access whatsoever.** A person named in a concern must not be able to read it, even if they are a `club_admin`. Rows where `subject_person_id` or `reported_person_id` = the requester's person are excluded from every policy, `club_admin` included |

The "reporter sees their own submission" allowance is deliberately narrow: it is
a receipt, not a case file, and it is implemented as a separate view with its
own policy rather than a wider policy on the base table. Recommended, but Adam
should confirm — some clubs prefer a fully one-way reporting route (submit and
receive an out-of-band acknowledgement only).

**Test.** `coach_cannot_read_concerns`, `club_admin_can_read_concerns`,
`reporter_sees_only_own_receipt_view`, `reporter_cannot_read_case_notes`,
`subject_cannot_read_concern_about_self_even_as_admin`,
`anon_reads_zero_concerns`, and — covering the privilege layer, which is the
part RLS tests cannot reach:

- `no_table_grant_on_concerns_for_api_roles` — `has_table_privilege` is false
  for SELECT/INSERT/UPDATE/DELETE/TRUNCATE for each of `anon`,
  `authenticated`, `service_role`, on the concerns table and every child table.
- `direct_select_on_concerns_throws_for_service_role` — the violation attempt
  that the earlier FORCE-RLS design would have allowed. Run as `service_role`;
  expects `permission denied for table safeguarding_concerns`, not an empty
  result set. An empty result set would mean the grant is still there.
- `service_role_read_via_accessor_writes_audit_row` — the audited path works
  for an Edge Function caller, and leaves the SG-7 row behind.
- `concern_accessor_execute_revoked_from_public` — `EXECUTE` is not held by
  `PUBLIC`.
- An owner-role test proving FORCE RLS holds for the owner (defence in depth,
  layer 4 — explicitly *not* the test that covers `service_role`).

**Implemented by.** P4.3.

---

### SG-4 — Guardianship integrity

**Statement.** A `guardianships` row `(guardian_person_id, child_person_id,
relationship)` is valid only if, **at creation**: the child is a minor (SG-0);
the guardian is an adult with a known DOB; and guardian ≠ child.

**Guidance.** C1 (the guardian link is what makes adult↔minor contact
permissible, so its integrity is load-bearing), C7.

**Enforcement.**
- `CHECK (guardian_person_id <> child_person_id)` — a plain constraint, always
  true, no self-guardianship.
- `UNIQUE (guardian_person_id, child_person_id)` — no duplicate links.
- **Trigger** for the age rules, because they depend on `now()` and on another
  table and so cannot be a `CHECK`.
- **Trigger for guardianship *changes*, not only creation.** The statement above
  is about creation; deleting or retargeting a link is the other half, and it
  can break SG-1 for a conversation that is already live. The
  `BEFORE DELETE` / `BEFORE UPDATE OF guardian_person_id, child_person_id` guard
  is specified in full at **SG-1.8**, lives on this table, and ships with P1.3 —
  not with P5.2. The RLS immediately below is what makes that transition
  reachable, so the two must be read together.
- **RLS:** a guardian may SELECT their own links and their children's linked
  records; `club_admin` and `safeguarding_lead` may SELECT and write all;
  nobody else sees the table. Their write access is **deliberate and is exactly
  why SG-1.8 exists**: an administrator correcting a family record must not be
  able to silently strip the guardian out of a conversation the child is in.
  Since the write is granted by RLS but the guard is a trigger, `service_role`
  is bound by the guard too (§1.2).

**Deliberate asymmetry — the guardian's DOB must be known.** SG-0 treats unknown
DOB as a minor, so an unknown-DOB "guardian" fails the adult test and the link
is rejected. This is intended: a guardianship record with an unidentified adult
is not a safeguarding control.

**The link outlives the minority.** When the child turns 18 the row is **not**
invalidated or deleted — the age tests apply at creation only. Its *effects*
lapse: guardian access to the young person's data ends at 18 (or at a
transition age — Open Decision D5), which is enforced in the reading policies,
not by mutating the guardianship row. Test:
`guardianship_survives_child_turning_18_but_access_lapses`.

**Test.** `guardianship_of_adult_child_throws`,
`guardianship_by_minor_guardian_throws`, `self_guardianship_throws`,
`guardianship_with_unknown_guardian_dob_throws`, `duplicate_guardianship_throws`,
`guardian_sees_only_own_children`, plus the four SG-1.8 change tests
(`guardianship_delete_blocked_when_it_creates_1to1`,
`guardianship_delete_allowed_after_conversation_closed`,
`guardianship_retarget_blocked_when_it_creates_1to1`,
`guardianship_delete_allowed_when_no_affected_conversation`), which belong to
this table even though the invariant they defend is SG-1.

**Implemented by.** P1.3 (constraints, both triggers, RLS), with the SG-1.8
guard completed against the messaging tables in P5.2 and the access-lapse rule
revisited in P4.5 and P5.2.

---

### SG-5 — Photo consent is enforced at query level

**Statement.** A media item depicting a child without a current, positive photo
consent for that child must not appear in any bulk export, public gallery,
shared album, or any other multi-item read path. Consent is recorded per child,
is versioned, and is withdrawable with immediate effect.

**Guidance.** C2, C7.

**Enforcement.** Both:
- **RLS + views:** the *only* supported read paths for media are views/functions
  that join to consent and filter. Direct `SELECT` on the raw `media_items`
  table is not granted to `authenticated`. "Filter in the application" is not
  acceptable — a missed `WHERE` is a safeguarding breach, so the filter lives
  where it cannot be forgotten.
- **Signed URLs only, short-lived,** from Supabase Storage (Q4). A URL minted
  while consent existed must not outlive its withdrawal by long; cap TTL
  (recommend ≤ 15 minutes) and, on withdrawal, move the object so existing
  signatures break.

**Model.** Consent is a row per (child, consent type, season/period) with
`granted boolean`, `granted_by_person_id` (a guardian, verified against
`guardianships`), `granted_at`, `withdrawn_at`. **Absence of a row = no
consent** (fail closed). Consent types are separated because they are different
decisions: internal team album; club website/public gallery; social media;
press/local media. A blanket single flag will not survive contact with a parent
who is happy with the team album and not with Facebook. Recommended, and part of
Open Decision D4.

Depiction is recorded as `media_subjects(media_item_id, person_id)`. **Untagged
media is unknown, and unknown fails closed:** an item with no subject rows is
excluded from public and bulk paths until a human confirms it contains no
unconsented child.

**Test.** `bulk_export_excludes_unconsented_child`,
`public_gallery_excludes_unconsented_child`,
`withdrawing_consent_removes_from_gallery_immediately`,
`untagged_media_excluded_from_public_paths`,
`consent_granted_by_non_guardian_throws`,
`signed_url_expires` (integration test, P4.5).

**Implemented by.** P2.2 (capture at registration), P4.5 (storage, views,
export).

---

### SG-6 — Certification currency gates work with children

**Statement.** A person may not hold the `coach` role (or any role designated as
child-facing) for a team containing minors unless they hold an in-date DBS check
and the safeguarding qualification required by C3.

This is a statement about the **state of the team**, not about the moment a
coach is assigned. It must hold after any change to the team's *composition*
just as much as after any change to its *staff*, and after a `dob` correction
that turns an existing member into a minor.

**Guidance.** C3, C6.

**Enforcement — recommended, and Open Decision D6.** Three tiers, of which we
recommend implementing 1 and 2 now and deciding on 3:

1. **Hard block at assignment, in *both* directions (recommended, implement in
   P2.1/P4.3).** Guarding only the staff side leaves an ordering hole that
   defeats the statement above: an uncertified coach is assigned to an
   adult-only team (permitted, and explicitly tested as such), a minor is then
   registered to that team, and the prohibited state now exists with no trigger
   having fired. All three entry points are therefore guarded, by one shared
   `STABLE` evaluation function so the rule cannot drift between them:

   - **(a) Staff side.** `team_memberships` INSERT, or UPDATE that creates or
     retargets a child-facing role, on a team containing minors: refused when
     that person's certifications are missing or expired at that moment.
   - **(b) Composition side.** `team_memberships` INSERT, or UPDATE, that puts a
     **minor** (SG-0, so including unknown DOB) into a team — or moves one in —
     revalidates **every** child-facing membership already on that team and is
     **refused** if any of them is non-compliant. The error names the
     non-compliant people, so the administrator can see precisely what must be
     fixed before the child can be registered.
   - **(c) DOB side.** An UPDATE of `people.dob` that makes an existing team
     member a minor runs check (b) for every team they belong to, on the same
     terms. This is the same `people.dob` trigger SG-1.2 requires; one trigger
     evaluates both invariants.

   **Reject, do not flag.** A rejected membership insert is recoverable in
   seconds and produces an immediate, actionable error naming the people at
   fault. A flag raised on a team that already contains the child is a
   safeguarding gap that stays open for as long as nobody reads the report —
   and (b) exists precisely because reports were the only thing covering this
   case.

   **The operational escape hatch is a logged exemption, never a silent
   override.** A club will occasionally need to register a child before the
   paperwork clears. That is handled by
   `certification_exemptions(person_id, team_id, reason, expires_on,
   granted_by_person_id, granted_at)`, which the shared evaluation function
   consults: **`safeguarding_lead` only** (a `club_admin` cannot grant one),
   `reason` mandatory and non-empty, `expires_on` capped at 30 days from grant
   by a `CHECK`, no renewal without a fresh row, and every grant, use and
   expiry audit-logged under `safeguarding.certification.exemption` (SG-7).
   Nothing bypasses the check without leaving a named, dated, attributable row.
2. **Scheduled backstop (recommended, implement in P4.3).** 90/30/7 days before
   expiry, notify the person, the `safeguarding_lead` and the team's manager.
   Plus a **nightly full re-evaluation** of every team's child-facing
   memberships against that team's current composition, reported to the
   `safeguarding_lead` as "non-compliant and still assigned". This is the
   backstop for everything a trigger structurally cannot catch: an expiry that
   arrives by the mere passage of time, an exemption lapsing overnight, and any
   state reached by a data fix applied with triggers disabled. It reports; it
   does not auto-suspend (see tier 3 and D6).
3. **Hard block on *continuation* (flagged, default OFF).** Auto-suspending an
   existing coach the moment a DBS lapses is operationally severe — it could
   strip a team of its only coach an hour before kick-off, and a lapse is
   usually administrative delay, not a safeguarding event. Recommended: flag
   loudly (`compliance_status = expired`, dashboard banner, daily report) and
   give the `safeguarding_lead` a one-click suspend. If Adam wants a hard
   cut-off, use a **grace period** (e.g. expiry + 30 days), not midnight on the
   expiry date.

Tier 1 is a set of triggers and therefore also binds `service_role`. Tiers 2 and
3 are scheduled jobs — controls, not invariants — so only tier 1 gets an
"attempt the violation" test.

**Test.** Staff side:
`assign_coach_without_dbs_to_youth_team_throws`,
`assign_coach_with_expired_dbs_throws`,
`assign_coach_without_dbs_to_adult_team_allowed` (the boundary case that makes
the composition-side tests necessary — it must stay permitted, and must stay
paired with the next test).
Composition side:
`add_minor_to_team_with_uncertified_coach_throws`,
`add_minor_to_team_with_certified_coach_allowed`,
`move_minor_into_team_with_expired_dbs_coach_throws`,
`add_adult_to_team_with_uncertified_coach_allowed`.
DOB side:
`dob_correction_making_member_a_minor_throws_when_team_coach_uncertified`.
Exemptions:
`exemption_granted_by_safeguarding_lead_allows_membership`,
`exemption_granted_by_club_admin_throws`,
`expired_exemption_does_not_allow_membership`,
`exemption_longer_than_30_days_throws`,
`exemption_use_writes_audit_row`.
Jobs: `expiry_nudge_fires_at_90_30_7`,
`expired_coach_appears_in_daily_compliance_report`,
`nightly_check_reports_team_that_gained_a_minor`.

The composition-side and DOB-side tests run as `club_admin` and as
`service_role`.

**Implemented by.** P1.4 (`has_role`), P2.1 (`team_memberships` triggers, both
directions, and the shared evaluation function), P4.3 (`certifications`,
`certification_exemptions`, scheduler). The `people.dob` trigger is created in
P2.1 carrying the SG-6 check and extended in P5.2 to carry SG-1.2 as well — one
trigger, two invariants, never two competing triggers on the same column.

---

### SG-7 — All safeguarding access is audit-logged

**Statement.** Every read, write, export or search of safeguarding data writes a
row to `public.audit_log`. Specifically: any access to `safeguarding_concerns`;
any conversation export; any admin read of a conversation the actor does not
participate in; any read of `guardianships` outside a guardian's own links; any
bulk media export; any change to a certification or a photo consent.

**Guidance.** C4, C7.

**Enforcement.** `SECURITY DEFINER` access functions plus triggers. **Reads
cannot be logged by a trigger** (Postgres has no SELECT trigger), so the pattern
is: the sensitive read paths are *functions*, not tables — `authenticated` has
no direct grant on the underlying table, and each function writes its audit row
before returning. Writes are logged by ordinary `AFTER INSERT/UPDATE` triggers.

**Follow the existing `public.audit_log` conventions exactly** (baseline
migration): columns `actor_id uuid` (FK `auth.users`), `actor_email text`,
`action text not null`, `entity text not null`, `entity_id text`,
`detail jsonb`, `created_at timestamptz not null default now()`; `id` is a
`bigint generated always as identity`. Do not add a parallel safeguarding audit
table.

Proposed values, to be fixed in P4.3 and reused verbatim thereafter:

| `action` | `entity` | `detail` should carry |
|---|---|---|
| `safeguarding.concern.read` | `safeguarding_concerns` | `{ "concern_ref": … }` |
| `safeguarding.concern.create` | `safeguarding_concerns` | `{ "channel": "web"｜"mobile" }` |
| `safeguarding.concern.update` | `safeguarding_concerns` | changed fields, **never** the narrative text |
| `messaging.conversation.export` | `conversations` | `{ "message_count": n, "includes_deleted": true, "reason": "…" }` |
| `messaging.conversation.admin_read` | `conversations` | `{ "reason": "…" }` |
| `media.bulk_export` | `media_albums` | `{ "item_count": n, "excluded_unconsented": n }` |
| `safeguarding.certification.change` | `certifications` | `{ "type": "dbs", "old_expiry": …, "new_expiry": … }` |
| `safeguarding.certification.exemption` | `certification_exemptions` | `{ "person_id": …, "team_id": …, "expires_on": …, "event": "granted"｜"used"｜"expired" }` (SG-6) |
| `safeguarding.consent.change` | `photo_consents` | `{ "type": "public_gallery", "granted": false }` |

**`detail` must never contain the content it is logging access to.** The audit
log has a wider readership than the concern itself (today `audit_read` is
`is_committee()`); copying a narrative into `detail` would defeat SG-3. This is
itself a testable invariant.

**Test.** `concern_read_writes_audit_row`,
`conversation_export_writes_audit_row`,
`audit_detail_contains_no_concern_narrative`,
`audit_row_written_even_when_read_returns_zero_rows` (an unsuccessful fishing
attempt is exactly what we most want logged),
plus SG-2's `hard_delete_audit_row_throws`.

**Implemented by.** P4.3, P4.5, P5.6, and an audit_log RLS review in Phase 1
(the current `is_committee()` read policy must be re-expressed against the new
role model, and probably narrowed for safeguarding actions).

---

### SG-8 — Retention

**Statement.** Safeguarding-relevant data is retained for a defined period, then
**redacted, not deleted** (SG-2). Every category has a stated period, a stated
trigger for the clock starting, and an owner.

**Guidance.** C5, C7.

**This is an explicit open decision (D7).** Retention periods are a legal and
policy question for the club, informed by FA guidance and, for concerns
involving children, by statutory guidance that can require records to be kept
for many years. **We must not invent a number and quietly build it in.** The
recommended defaults below are placeholders that must be confirmed before the
retention job (P5.6) is enabled — and the job ships **disabled**, in dry-run
mode, logging what it *would* redact, until Adam signs off.

| Category | Recommended default | Clock starts | Notes |
|---|---|---|---|
| Message content in ordinary conversations | 24 months | Message sent | Row, sender, timestamp retained forever; body and attachments redacted |
| Message content in a conversation attached to an open concern | **Never, while open** | — | A legal-hold flag on the conversation suspends the job entirely |
| `safeguarding_concerns` | **Adam to confirm — likely many years; do not default** | Case closed | The category most likely to be governed by statutory guidance rather than club preference |
| `audit_log` | 7 years | Row written | Never redacted; it holds no content by design (SG-7) |
| `certifications` | 7 years after expiry | Expiry date | Needed to evidence historic compliance |
| Media without consent | Immediate | Consent withdrawn/refused | Object deleted from Storage; the `media_items` row is retained, redacted |
| Media with consent | Duration of consent + 12 months | Consent withdrawn | |
| `people` for a departed member | 24 months, then pseudonymise | Membership lapses | Cannot pseudonymise anyone named in an open concern or an unexpired retention window |

**Legal hold beats retention, always.** A `legal_hold` flag on a conversation,
person, or media item causes the retention job to skip it and log the skip.
Only the `safeguarding_lead` may set or clear it, and both are audit-logged.

**Test.** `retention_job_dry_run_changes_nothing`,
`retention_skips_legal_held_conversation`,
`retention_redacts_body_but_keeps_row`,
`retention_never_touches_audit_log_content`,
`pseudonymise_person_with_open_concern_throws`.

**Implemented by.** P5.1 (periods written into the spec), P5.6 (job),
P4.3 (concern retention), P4.5 (media retention).

---

## 4. Data model implications

A checklist for the Phase 1/2/4/5 tasks. No SQL here — this is what the
invariants above *require to exist*.

**People and relationships (P1.1, P1.3, P1.4)**
- [ ] `people.dob date` — nullable, but nullable means "minor" (SG-0)
- [ ] `public.is_minor(person_id uuid)` and `public.is_minor_dob(d date)`, both `STABLE`, `SECURITY DEFINER`, `search_path = public` — following the existing `is_committee()` house style
- [ ] `people.legal_hold boolean not null default false` (SG-8)
- [ ] `people.pseudonymised_at timestamptz` (SG-8)
- [ ] `guardianships(guardian_person_id, child_person_id, relationship, created_at, created_by)` with the SG-4 constraints, unique pair, and no-self-reference check
- [ ] A `BEFORE DELETE` / `BEFORE UPDATE OF guardian_person_id, child_person_id` trigger on `guardianships` implementing SG-1.8 (reject unless every affected conversation is closed)
- [ ] One `people` `UPDATE OF dob` trigger, carrying **both** SG-1.2 and SG-6 tier 1(c) — not two triggers on the same column
- [ ] `person_roles(person_id, role, granted_at, granted_by)` and `public.has_role(role)` / `public.has_role(person_id, role)` — used by *every* policy from here on
- [ ] A designation of which roles are **child-facing** (drives SG-6) — a lookup table, not a hard-coded list in a trigger

**Teams (P2.1)**
- [ ] A way to answer "does this team contain minors?" cheaply — a `STABLE` function over `team_memberships` + `is_minor`; SG-6's triggers call it on every assignment
- [ ] A shared `STABLE` "is every child-facing membership on this team compliant?" evaluation function, called by all three SG-6 tier-1 entry points
- [ ] `team_memberships` triggers for SG-6 tier 1 — **both** the staff side (a) and the composition side (b); a minor joining a team revalidates the team's coaches

**Registrations and consent (P2.2, P4.5)**
- [ ] `photo_consents(person_id, consent_type, granted, granted_by_person_id, granted_at, withdrawn_at, season_id)` — per child, per type, versioned; absence = refused
- [ ] `consent_types` lookup: `team_album`, `club_website`, `social_media`, `press`
- [ ] `granted_by_person_id` validated against `guardianships` by trigger
- [ ] `media_items`, `media_albums`, `media_subjects(media_item_id, person_id)`
- [ ] `media_items.legal_hold`, `media_items.redacted_at`
- [ ] Consent-filtered **views/functions** as the only granted read path

**Certifications and concerns (P4.3)**
- [ ] `certifications(person_id, type, reference, issued_on, expires_on, verified_by, verified_at)` — types at least `fa_dbs`, `safeguarding_children`, `first_aid`, `coaching_badge`
- [ ] A derived `compliance_status` per person per child-facing role: `valid` / `expiring` / `expired` / `missing`
- [ ] `certification_exemptions(person_id, team_id, reason, expires_on, granted_by_person_id, granted_at)` — `safeguarding_lead` only, `CHECK` capping the term at 30 days, audit-logged (SG-6 tier 1)
- [ ] `safeguarding_concerns(ref, reported_by_person_id, subject_person_id, reported_person_id, narrative, status, severity, created_at, closed_at, legal_hold, deleted_at, deleted_by)` — FORCE RLS **and** all privileges revoked from `anon`/`authenticated`/`service_role` (SG-3); the revoke is the control, FORCE is the backstop
- [ ] `safeguarding_concern_notes` — `safeguarding_lead` write only, never visible to the reporter; same revoke
- [ ] `SECURITY DEFINER` accessor functions for every concerns read and write, owned by the table owner (not a role the app can log in as), `EXECUTE` revoked from `PUBLIC`, each writing its SG-7 audit row before returning
- [ ] A reporter-receipt view, separately policied (SG-3), reached through the same accessor pattern
- [ ] Nudge scheduler state so 90/30/7 nudges are not re-sent on every run

**Messaging (P5.2, P5.3)**
- [ ] `conversations(type, created_by, legal_hold, closed_at)` — types `dm`, `group`, `team`, `announcement`
- [ ] `conversation_participants(conversation_id, person_id, joined_at, left_at, last_read_message_id, basis)` — `basis` distinguishes a genuine participant from an oversight/administrative presence (SG-1.5)
- [ ] `messages(conversation_id, sender_person_id, body, reply_to_id, created_at, deleted_at, deleted_by, redacted_at, redaction_reason)`
- [ ] `conversations.closed_at` is load-bearing, not cosmetic: SG-1.8 keys off it
- [ ] The SG-1 evaluation function, called by triggers on `conversation_participants`, `messages`, `people.dob` and `guardianships`, and by the nightly checker
- [ ] `deny_hard_delete()` (`BEFORE DELETE ... FOR EACH ROW`) applied to `messages`, `conversation_participants`, `safeguarding_concerns`, `audit_log`
- [ ] `deny_truncate()` (`BEFORE TRUNCATE ... FOR EACH STATEMENT`) applied to the same four tables — the delete trigger does not fire on `TRUNCATE`
- [ ] `REVOKE DELETE, TRUNCATE` on those four tables from `anon`, `authenticated` **and `service_role`**, re-asserted after any blanket grant
- [ ] Attachments in Supabase Storage with short-TTL signed URLs (Q4)

**Audit (Phase 1 review + all later tasks)**
- [ ] `public.audit_log` gains the SG-2 delete guard **and** truncate guard
- [ ] The `audit_read` policy is re-expressed against `person_roles`, and safeguarding actions are narrowed to `safeguarding_lead`/`club_admin`
- [ ] A single `public.write_audit(action, entity, entity_id, detail)` helper so `actor_id`/`actor_email` are populated consistently

---

## 5. Open decisions for Adam

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Unknown DOB → treat as a **minor** for all safeguarding purposes (fail closed)? And is DOB mandatory at registration for anyone joining a team? | Yes to both. Accept the inconvenience for the small number of adults with missing DOB |
| **D2** | Is one adult + two or more minors in a conversation, with no guardian, permitted at DB level? | Permit at DB level; prevent in practice by auto-including guardians (P5.3). Revisit if Cheshire FA guidance is stricter |
| **D3** | Can a person who reports a concern see their own submission? | Yes, but only a narrow "receipt" view: their own words, a reference, and a status. Never case notes, never anything added later |
| **D4** | Photo consent: separate types (team album / club website / social media / press), or one blanket flag? | Separate types. One flag will not survive real parents |
| **D5** | At what age does guardian access to a young person's data lapse? Straight to zero at 18, or a stepped transition (e.g. reduced at 16)? | Needs Adam's view — some clubs give 16–17s control of their own messaging while guardians retain visibility. Affects SG-4 and P5.3 |
| **D6** | SG-6: should an *existing* coach be auto-suspended the moment a DBS expires? | No auto-suspend by default. Hard-block new assignments, flag loudly, give the lead a one-click suspend. If a hard cut-off is wanted, use a grace period, not midnight on the expiry date |
| **D7** | Retention periods (SG-8), especially for `safeguarding_concerns` — this is a legal/policy question and the numbers in §3 SG-8 are placeholders | Confirm against FA/Cheshire FA guidance and the ICO before the retention job is enabled. The job ships in dry-run |
| **D8** | Fill in the §2.3 citation table against currently published FA / Cheshire FA guidance (this is `PLAN.md` Q6, and blocks P5.1 sign-off) | Adam to complete. Record the URLs and the date checked |
| **D9** | Who is the named Club Welfare Officer, and does a second person hold `safeguarding_lead` for continuity? | At least two, or an absence leaves concerns unreadable by anyone |

---

## 6. Change control

1. This file, and the enforcement of any SG-invariant, is covered by the
   `PLAN.md` §2.3 no-auto-merge rule. Any PR that changes this file, or changes
   a constraint, trigger, policy or test named in §3, **requires Adam's review**.
   `finn-review` may not approve it and auto-merge is disabled on it.
2. Weakening or removing an invariant requires a note in `DECISIONS.md` giving
   the reason, the date, and Adam's explicit agreement. Strengthening one does
   not, but should still be recorded.
3. A test named in §3 may not be deleted, skipped, or marked `TODO`. If a test
   is wrong, the invariant is re-specified here first and the test is then
   changed to match.
4. New tasks that touch people, guardianships, roles, certifications, concerns,
   media or messaging must state in the PR description which SG-invariants apply
   and which tests cover them — alongside the migrations/RLS/rollback statement
   already required by `PLAN.md` §11.
5. When the FA or Cheshire FA publishes revised guidance, §2.3 is re-verified
   and the date recorded. Treat this as an annual pre-season task.

### 6.1 Review log

- **2026-08-22 — Codex review on PR #3:** four P1 findings (service_role
  bypass, TRUNCATE, guardianship-change re-evaluation, team-composition
  certification check) incorporated into SG-3 / SG-2 / SG-1 / SG-6.
