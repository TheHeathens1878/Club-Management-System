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
| P1.7 | `guardian_consents`, `consent_type`, safeguarding settings in `site_settings`, the `profiles` eligibility trigger | SG-10, and the SG-0.1 / SG-0.2 helpers that SG-1.9 and SG-9 depend on |
| P2.1 | `teams`, `team_memberships` | SG-6 (both the staff-side and composition-side guards) |
| P2.2 | `registrations`, consent capture | SG-5 |
| P4.3 | `certifications`, `safeguarding_concerns` | SG-3, SG-6, SG-7, SG-8 |
| P4.5 | media, photo consent | SG-5, SG-7 |
| P5.1–P5.6 | messaging | SG-1, SG-2, SG-7, SG-8 |
| P5.2 | `conversations`, `conversation_participants`, `messages` | SG-1 in full **including SG-1.9**, SG-2, and the SG-9 oversight accessors |

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

### 1.5 Two derived terms: account-eligible and supervision-exempt

SG-0 is unchanged — a minor is a person under 18. Some minors may nevertheless
hold an app account, and some may message adults without a guardian present.
Both are narrow, consented exceptions, and both need a name so that SG-1.9, SG-9
and SG-10 can be stated precisely.

> **SG-0.1 (definitional).** An **account-eligible minor** is a minor who, on
> the date of evaluation, is at least `safeguarding.min_account_age` years old
> **and** for whom an active (granted, not revoked) `app_account` consent is
> held, given by an adult holding an active guardianship to them (SG-10).

> **SG-0.2 (definitional).** A **supervision-exempt minor** is a minor who, on
> the date of evaluation, is at least
> `safeguarding.unsupervised_messaging_min_age` years old **and** for whom an
> active `unsupervised_messaging` consent is held on the same terms (SG-10).

> **SG-0.3 (definitional, added 2026-09-02).** A **known minor** is a person
> whose `dob` **is on record** and who is under 18 on the date of evaluation.
> An unknown DOB is *not* a known minor. This term exists for SG-1 alone —
> `public.is_known_minor(person_id uuid)` — and nothing else in this document
> or in the database may be restated in terms of it. Everywhere else, SG-0
> stands: unknown means minor.

Notes:

- **Both are derived, never stored**, for the same reason SG-0 is a function and
  not a column: they depend on `now()`, on an admin-editable setting, and on a
  consent that can be revoked between one evaluation and the next. The
  enforceable form is `public.is_account_eligible(person_id uuid)` and
  `public.is_supervision_exempt(person_id uuid)`, both `STABLE`, both called by
  triggers and policies alike.
- **Supervision-exemption presupposes account-eligibility.** The settings are
  constrained so that `min_account_age ≤ unsupervised_messaging_min_age`
  (SG-10), and a minor with no app account has no conversation to be exempt in.
- **Unknown DOB is never eligible and never exempt.** SG-0 treats unknown as a
  minor; an unknown DOB also fails every "at least *n* years old" test, so both
  terms fail closed exactly as §1.2 requires.
- **Neither term survives adulthood in any special sense.** At 18 the person is
  simply an adult and neither term applies; the consent rows are retained as
  history (SG-8), not as a continuing permission.
- **Consent is per child and per purpose.** Holding `app_account` says nothing
  about `unsupervised_messaging`; a guardian who wants their child to have an
  account but always to be accompanied in conversations with adults grants the
  first and withholds the second, and that is the expected default.

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
| C1 | **Safe communication with under-18s.** Adults in positions of trust should not communicate one-to-one and privately with a child; communications should be transparent and include the child's parent/guardian, and ideally take place in group settings | SG-1 (including SG-1.9) | `[Adam to verify against current published guidance — URL/section]` |
| C2 | **Photography and filming.** Consent is required before images of children are taken and before they are published or shared; consent is recorded per child and is withdrawable | SG-5 | `[Adam to verify against current published guidance — URL/section]` |
| C3 | **DBS checks and safeguarding qualifications.** Those in eligible roles working with children require an in-date FA DBS check and the relevant safeguarding/first-aid qualifications | SG-6 | `[Adam to verify against current published guidance — URL/section]` |
| C4 | **Reporting concerns.** Concerns are reported to the Club Welfare Officer and, as appropriate, to the County FA Designated Safeguarding Officer and statutory agencies; records are kept confidential and shared strictly on a need-to-know basis | SG-3, SG-7, SG-9 | `[Adam to verify against current published guidance — URL/section]` |
| C5 | **Record keeping and retention.** Safeguarding records are retained securely for a defined period and are not destroyed prematurely | SG-2, SG-8, SG-9 | `[Adam to verify against current published guidance — URL/section]` |
| C6 | **Club Welfare Officer role.** An affiliated club with youth teams must appoint a Club Welfare Officer, who is DBS-checked and trained | SG-3, SG-6, SG-9 | `[Adam to verify against current published guidance — URL/section]` |
| C7 | **UK GDPR / Data Protection Act 2018.** Not FA guidance, but binding: lawful basis, data minimisation, storage limitation, and the heightened protection owed to children's data | SG-2, SG-5, SG-7, SG-8, SG-9, SG-10 | `[Adam to verify — ICO children's code / UK GDPR Art. 5]` |
| C8 | **Young match officials and other under-18s in club roles.** Under-18s act as referees, assistant referees and helpers; guidance addresses how adults supervise and communicate with them, and the fact that they are children first and officials second | SG-1.9, SG-9 | `[Adam to verify against current published guidance — URL/section]` |
| C9 | **Parental consent for a child's online account.** A child's use of an online service run by the club requires the consent of a person with parental responsibility; the consent is recorded, is specific to what it permits, and is withdrawable — and below a stated age no account is offered at all | SG-0.1, SG-0.2, SG-10 | `[Adam to verify — FA guidance on club use of online platforms, plus the ICO Age Appropriate Design Code and the UK age of digital consent under UK GDPR Art. 8 as implemented by the Data Protection Act 2018]` |

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
adult is a guardian of that minor **or the narrow supervision-exempt case of
SG-1.9 is satisfied**. Any operation that would produce such a state is
rejected.

**Guidance.** C1, and C8 for the SG-1.9 exception.

**Enforcement.** Triggers — on `conversation_participants` (INSERT, UPDATE of
`left_at`), on `messages` (INSERT), on `people` (UPDATE of `dob`, SG-1.2), on
`guardianships` (DELETE, and UPDATE of `guardian_person_id` /
`child_person_id`, SG-1.8), on `guardian_consents` (UPDATE of `revoked_at`,
SG-1.9) and on `public.site_settings` (UPDATE of
`safeguarding.unsupervised_messaging_min_age`, SG-1.9) — plus a nightly
re-evaluation job. A `CHECK`
constraint cannot express it: the predicate spans rows. Triggers rather than
policies, because the invariant must also bind `service_role` and the table
owner (§1.2). **The trigger list is the invariant:** any table whose change can
flip a conversation's compliance must appear in it, which is why guardianships
and DOB are in it and not only the two messaging tables.

**Precise form.** Let *A* be the active participants of conversation *c*
(rows with `left_at IS NULL`, excluding participants whose sole basis is an
administrative/oversight capacity — see SG-1.5). The conversation is
**non-compliant** when:

`count(A) = 2 AND exactly one of A is a known minor (SG-0.3) AND no adult in A
is a guardian of that minor AND NOT (that minor is supervision-exempt (SG-0.2)
AND the conversation is flagged supervised_by_lead)`

**Why *known* minor and not simply minor (2026-09-02, Adam's decision — §6.1).**
Read with SG-0's fail-closed sense of "minor", this predicate is not
order-independent, and that is fatal to it. Take a room whose two participants
both have no DOB. It passes: two minors, not one. Record the true date of birth
of *either* of them and it fails: one adult, one "minor". Record the other's
first and it fails identically. There is no order, and no single statement, in
which the club can write down the ages it has just been told — the rule forbids
the recording of the fact that would satisfy it. Seven of this club's team rooms
were in exactly that state, and 33 of its 45 coaches had no DOB with which to
leave it. A safeguarding rule that punishes a club for improving its register
makes children less safe, not more.

Narrowing SG-1 to *known* minors makes the predicate monotone in knowledge: an
age can always be recorded, and recording one never turns a compliant room into
a refusal unless the person recorded really is a child. What is given up is the
shield over a child whose age the club has never held — and since P2.2 makes
`dob` mandatory at registration and `/join` will not create a child without one,
that case no longer arises through any screen the club owns. What is kept is the
whole of SG-1 over every child the club has an age for.

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
  every conversation the person actively participates in.

  **Amended 2026-09-02 (Adam's decision, §6.1): the write is RECORDED, never
  rejected.** It used to be rejected, with an error naming the conversations.
  That was wrong in a way that took three deadlocks to see: an age is a fact
  about a person, not an act. Noah Taylor was ten before anybody typed it and
  Dave Taylor was forty-six before anybody typed it; the pairing the rule
  objected to already existed in the world, and refusing the write achieved
  nothing except keeping the club's register wrong about it. Worse, it was
  circular — the club's own remedy is to record a guardianship, `guardianships`
  will not accept a guardian whose date of birth is unknown, and this guard
  would not let that date be recorded until the guardianship existed.

  The correction is written, an audit row (`safeguarding.sg1_exposed_by_dob`)
  names every conversation it leaves non-compliant, and **SG-1.7 refuses every
  message in those conversations** until a guardian is recorded, a third person
  joins, or the child leaves. The prohibited *conversation* remains impossible;
  only the prohibited *record* is now allowed to be corrected. Tests:
  `sg1_known_minor.test.sql` (recorded, audited, room shut, room reopened),
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
  would become non-compliant once the link no longer holds — and **records the
  change, naming those conversations in an audit row**
  (`safeguarding.sg1_exposed_by_guardianship`).

  **Amended 2026-09-02 (Adam's decision, §6.1).** It used to reject the change
  unless every affected conversation was already closed. That falls to the same
  argument as SG-1.2 above: a placement that has ended has ended, and a register
  that says a child is accompanied by somebody who is no longer their guardian
  is worse than one that says they are not. SG-1.7 refuses every message in the
  affected conversations, so the prohibited conversation is still impossible —
  it is only the prohibited *record* that may now be corrected. Test:
  `sg1_known_minor.test.sql`, and `messaging.test.sql`'s SG-1.8 group.

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
- **SG-1.9 The minor is supervision-exempt.** **Permitted, conditionally** —
  this is the one exception to SG-1 other than SG-1.4, and it exists for a real
  case: a 14-year-old referee has to be able to agree a kick-off time or a
  postponement with an adult fixtures secretary, and putting a parent in every
  such exchange is not workable. Adam's decision, 2026-08-22.

  **Rule.** An adult↔minor conversation with no guardian participant is
  permitted **only** when both of the following hold, and it is rejected the
  moment either stops holding:

  1. **Every** minor among the active participants (SG-1.5) is a
     supervision-exempt minor (SG-0.2) — at or above
     `safeguarding.unsupervised_messaging_min_age`, with an active
     `unsupervised_messaging` consent granted by an active guardian (SG-10);
     and
  2. the conversation carries `conversations.supervised_by_lead = true`, which
     places it inside SG-9's visibility.

  **Below the threshold nothing changes.** For a minor who is not
  supervision-exempt, SG-1 applies exactly as written and a guardian must be a
  participant. The default position for a child under
  `unsupervised_messaging_min_age` (14 as shipped) is therefore unaltered by
  this sub-case, and no consent can waive it — the guardian's only route is to
  join the conversation.

  **The flag is set by the trigger, not by the client.** `supervised_by_lead` is
  written by the same trigger that admits the conversation, so no caller can
  obtain the exemption while opting out of oversight, and a `BEFORE UPDATE`
  guard **rejects clearing it** while any minor participant is active. The
  exemption and the visibility are one decision, not two.

  **Consent revocation and a raised age re-check, on the SG-1.8 pattern.**
  Consent is revocable (SG-10) and the age is admin-editable, so the thing that
  makes such a conversation permissible can be withdrawn with nothing at all
  happening in `conversations`, `conversation_participants` or `messages` —
  precisely the SG-1.8 situation, and the same remedy applies:

  - A trigger on `guardian_consents` (`BEFORE UPDATE OF revoked_at`) finds every
    live conversation that is permitted *only* by the consent being revoked, and
    **rejects the revocation unless every one of those conversations is already
    closed** (`conversations.closed_at IS NOT NULL`).
  - A trigger on `public.site_settings` fires when
    `safeguarding.unsupervised_messaging_min_age` is **raised**, runs the same
    evaluation for every minor the raise drops below the threshold, and
    **rejects the setting change unless every affected conversation is closed**.
    Lowering the setting can only make conversations permissible and needs no
    check.

  Reject-unless-closed rather than a flat reject, for SG-1.8's reason and one
  more: a flat reject would make a consent unrevocable, and a consent that
  cannot be withdrawn is not consent. Rather than auto-closing the
  conversations, which would hide a safeguarding-relevant transition from the
  guardian who asked for it, the guardian or administrator closes them and then
  revokes — two deliberate steps, with the message history preserved for SG-8.
  The error names the conversations, as SG-1.2's and SG-1.8's do.

  Note the deliberate asymmetry with SG-10: raising `min_account_age` is
  *reported*, because an account held by a child who has become too young for
  one is a paperwork gap; raising `unsupervised_messaging_min_age` is
  *rejected-unless-closed*, because the state it would leave behind is a live
  adult↔minor 1:1 with no guardian — a prohibited state under SG-1 itself.

  Tests: `supervision_exempt_minor_can_dm_adult_without_guardian`,
  `minor_below_unsupervised_age_cannot_dm_adult_without_guardian`,
  `minor_without_unsupervised_consent_cannot_dm_adult_without_guardian`,
  `exempt_and_non_exempt_minor_with_one_adult_throws`,
  `exempt_dm_is_flagged_supervised_by_lead`,
  `clearing_supervised_by_lead_with_active_minor_throws`,
  `consent_revocation_blocked_while_dependent_conversation_open`,
  `consent_revocation_allowed_after_conversation_closed`,
  `raising_unsupervised_age_blocked_while_dependent_conversation_open`,
  `raising_unsupervised_age_allowed_after_conversation_closed`,
  `lowering_unsupervised_age_allowed`. All run as `club_admin` **and** as
  `service_role`, for SG-1.8's reason.

**Implemented by.** P1.3 (the SG-1.8 guardianships trigger ships with the
table), P1.7 (`guardian_consents`, the settings and the SG-0.2 helper the
sub-case is stated in terms of), P5.1 (spec), P5.2 (participant/message/DOB
triggers, the SG-1.9 sub-case, the `supervised_by_lead` flag and its guard, the
consent and settings triggers, and the tests), P5.3 (auto-membership must add
guardians of minor players, which is what keeps team conversations compliant by
construction). Where P1.3 lands before the messaging tables exist, the SG-1.8
trigger is written in P1.3 as a no-op-if-absent guard and completed in P5.2; the
P5.2 PR is not complete without its tests.

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

#### SG-2.1 — The super-user purge: one named exception, and its guards

**Decided by Adam, 2026-08-25** ("allow super users to hard delete users and
messages"), and recorded here because §6.2 requires the weakening of an
invariant to be written down with its reason. The two reasons are a UK GDPR
Article 17 erasure request the club must be able to honour, and clearing out
test accounts and mistakes the club made itself. Implemented by migration
`20260825380000_super_user_purge.sql`.

**What is permitted.** `public.purge_message(message_id, reason)` and
`public.purge_person(person_id, reason)`, and nothing else. Both are
`SECURITY DEFINER`, both refuse anyone whose `profiles.role` is not
`super_user` with `42501`, both require a non-empty reason, and both are the
only callers of the door described below.

**How the trigger is honoured rather than bypassed.** `deny_hard_delete()` is
not disabled, dropped, or `ALTER TABLE ... DISABLE TRIGGER`-ed anywhere, and
`deny_truncate()` is untouched. The delete guard gains exactly one condition: a
transaction-local ticket whose value is the id of an `audit_log` row written in
the SAME transaction with action `messages.purged` or `people.purged`. The
audit row is therefore a *precondition* of the destruction, not a promise made
after it. This is the route SG-2 itself anticipates above: "if that role ever
needs to bypass `deny_hard_delete()` it must do so via an explicitly named,
audit-logged function — not by disabling the trigger."

**What the ticket can and cannot open.** Nine tables, named as literals inside
the trigger function: `people`, `person_roles`, `guardian_consents`,
`certifications`, `certification_exemptions`, `identity_documents`, `messages`,
`message_attachments`, `conversation_participants`. **`audit_log`,
`safeguarding_concerns`, `safeguarding_concern_notes` and `media_items` are not
on that list and can never be reached by a purge** — the trail and the evidence
outlive the destruction by construction, and the `people.purged` /
`messages.purged` rows survive the purge that wrote them.

**The privilege layer is unchanged.** `DELETE` and `TRUNCATE` remain revoked
from `anon`, `authenticated` and `service_role` on every guarded table, and no
`FOR DELETE` policy is added anywhere. A forged ticket set from a client buys
nothing, because the privilege refusal comes first.

**Evidence is not the owner's to destroy (SG-8).** `purge_message` refuses a
message cited by a `safeguarding_concerns` narrative or a concern note, a
message in a conversation under `conversations.legal_hold`, a message whose
author is under `people.legal_hold`, and a message covered by a legal-held
concern. `purge_person` refuses a person under `people.legal_hold`, a person
named by any concern as subject, reported person or reporter, a person who
authored a concern note, a person in a conversation under a legal hold, and the
caller themselves. It also refuses where destroying this person would destroy
somebody else's record through a `not null` foreign key that cannot be nulled:
a subscription they merely pay for on another person's behalf, and an SG-6
certification exemption they granted to another person. Every refusal is
`P0001` and says which rule it is.

**The compensating control is the trail (SG-7).** The audit row names the
actor, the entity, and the REASON — a mandatory argument — and never the
message body or any concern content, exactly as SG-7 requires of `detail`.
`purge_person` additionally records the counts per table, so the audit row can
answer "what was destroyed" after the rows are gone.

**Rows that are somebody else's are nulled, not deleted.** `audit_log`,
`bookings`, `payments`, `outbound_messages`, `waiting_list_notes`,
`conversations.created_by_person_id` and the rest keep their rows and lose the
reference. The full table-by-table list is in the migration header.

**Test.** `supabase/tests/super_user_purge.test.sql` — a club_admin is refused
both doors (42501); a cited message, a held conversation, a held author, a held
person, a concern subject, a concern reporter and the caller are each refused
by name (P0001); an ordinary message and an ordinary person are purged and
everything hanging off them goes while other people's rows do not; the audit
row carries the reason and not the body; and the SG-2 guard still refuses a
plain hard delete for the table owner, refuses a forged ticket, and refuses a
REAL ticket used against `audit_log`.

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

> **RETIRED IN THE APP — SG-6.1 (Adam, 2026-08-26, migration
> `20260825440000_retire_sg6_in_app_tier.sql`).** See SG-6.1 immediately
> below. The statement, enforcement tiers and tests set out in this section
> describe machinery that is still present in the database and still tested,
> but is **dormant**: the app neither shows, edits nor reasons about a
> certification, and no signed-in user can write one. Read this section as the
> specification of what would come back if the club ever re-enabled it, not as
> a description of what the app does today.

> **Amendment (Adam, 2026-08-23, migration `20260824240000_sg6_enforcement_off.sql`).**
> Tier-1 enforcement is now a switch —
> `site_settings['safeguarding.sg6_enforcement']` (integer, `1` = enforce,
> `0` = off) — **and the club runs with it OFF**: DBS checks and safeguarding
> qualifications are recorded and enforced on the **FA Clubs Portal**, the
> FA's own system of record, and duplicating the hard block in-app refused
> legitimate approvals for paperwork already verified there. The shared
> evaluator, certifications, exemptions, expiry nudges and the compliance
> report all remain (they record and report; they no longer refuse), and every
> tier-1 test below still runs with the switch set to `1` so the machinery
> cannot rot. Flipping the switch back to `1` restores the rule below in full.

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

#### SG-6.1 — The in-app tier is retired; the FA Clubs Portal is the record

**The weakening, and who owns it.** Adam, club owner, 2026-08-26: *"remove all
DBS, Safeguarding and Coaching qualifications from the App. We use the FA's Club
Portal for this."* This is a weakening of SG-6 and is recorded here under §6.2
with its reason and its owner; the §6.1 review log carries the same entry, and
`DECISIONS.md` carries the decision row. The request is Adam's, and this
subsection is that record.

**What it means.** SG-6 above is unchanged as a *statement about the club* — a
coach working with children must hold an in-date DBS check and the safeguarding
qualification C3 requires. What has changed is **where that is recorded and
enforced**. It is the FA Clubs Portal, and only the FA Clubs Portal. This
application:

- does not display a certification, a DBS status, a safeguarding or coaching
  qualification, a compliance status or an exemption, anywhere;
- has no screen for recording, verifying, revoking or exempting one;
- sends no expiry nudge and no daily compliance report;
- cannot write to `certifications` or `certification_exemptions` at all —
  `INSERT`, `UPDATE` and `DELETE` on both tables are revoked from
  `authenticated`, so the refusal is a grant, not a policy anyone could relax
  by editing a `WHERE` clause.

**Why the app stopping is the honest position.** The 2026-08-23 amendment above
already turned the hard block off, for the good reason that the block refused
approvals for paperwork the FA had already verified. What it left behind was
worse than either state: screens showing a DBS status nobody in the club
maintains, next to an "expiring" badge nobody acts on, next to an exemption
button for a rule that no longer refuses anything. A safeguarding screen that
is decorative teaches people to ignore safeguarding screens. Removing it says
plainly where the answer lives.

**What is KEPT, and why.** `certifications`,
`certification_exemptions`, `child_facing_roles`, the shared evaluator
`is_child_facing_compliant()`, the tier-1 triggers, the tier-2 functions
(`due_certification_nudges()`, `compliance_report()`,
`person_compliance_status()`) and every SG-7 audit row they ever wrote all
remain in the database, with their RLS policies and their SG-2 delete/truncate
guards intact. `authenticated` still **reads** them under exactly the policies
it always had. These rows are the evidence of what the club held and when — a
DBS the club recorded in 2026, an exemption a safeguarding lead granted and
signed for — and destroying that is not what "stop using it" means. Dropping
the tables is a separate, irreversible step, available on request and not taken
here.

**The switch stays off, and the migration asserts it.** With the app unable to
write a certification, a tier-1 guard that started refusing again would block
every child-facing team assignment with no way in the app to satisfy it. So
`20260825440000` does not assume the state it inherits: it verifies that
`sg6_enforcement_enabled()` still reads
`site_settings['safeguarding.sg6_enforcement']`, ensures that key is `'0'`,
and fails the migration if the function then still reports enforcement on.

**Re-enabling, in full.** Nothing here is destructive, so the rollback is the
forward path run backwards:

1. `grant insert, update on public.certifications, public.certification_exemptions to authenticated;`
2. restore the app's certification panels and the two retired
   `safeguarding-nudges` jobs;
3. `update public.site_settings set value = '1' where key = 'safeguarding.sg6_enforcement';`

**Test.** `supabase/tests/certifications_retired.test.sql` states this
subsection: the app cannot write (as club_admin, as the safeguarding lead),
nothing was destroyed (tables, rows, reads, policies, functions), and the
switch is off. Every tier-1 test named in SG-6 above still runs in
`teams_seasons.test.sql` with the switch flipped on, except the three that
went through `authenticated` — those now assert the 42501 refusal instead,
because no signed-in user reaches the trigger any more; the trigger rules
themselves are still proved as the owner. Nothing named in SG-6 has been
deleted or skipped (§6.3).

**Implemented by.** `20260825440000_retire_sg6_in_app_tier.sql` and the app
change in the same commit.

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
| `messaging.conversation.export` | `conversations` | `{ "message_count": n, "includes_deleted": true, "reason": "…", "includes_minor": true }` |
| `messaging.conversation.admin_read` | `conversations` | `{ "reason": "…", "includes_minor": true }` |
| `safeguarding.consent.granted` | `guardian_consents` | `{ "child_person_id": …, "guardian_person_id": …, "consent_type": "app_account", "notice_version": … }` (SG-10) |
| `safeguarding.consent.revoked` | `guardian_consents` | `{ "child_person_id": …, "consent_type": "unsupervised_messaging" }` (SG-10) |
| `settings.changed` | `site_settings` | `{ "key": "safeguarding.min_account_age", "old": 13, "new": 14 }` (SG-10) |
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

### SG-9 — Minors' private messages are visible to the safeguarding lead

**Statement.** A holder of `safeguarding_lead` or `club_admin` may open or
export **any** conversation in which a minor is, or has been, a participant —
including a private one-to-one — and every such access is audit-logged. The
access happens only through a `SECURITY DEFINER` accessor: no role holds a table
grant that would let it read a conversation it does not participate in.

This is what makes SG-1.9 acceptable rather than reckless. The exemption removes
the guardian from the room; it does not make the room private.

**Guidance.** C1 (transparency is the point of the guardian requirement, and
oversight is how transparency survives the guardian's absence), C4 (need-to-know
sharing), C6, C7, C8.

**Enforcement.** Privileges and `SECURITY DEFINER` functions, exactly as SG-3
— not RLS, and for the same reason: `service_role` holds `BYPASSRLS` and a
policy that widened reads for administrators would widen them for every Edge
Function too, with no audit row written.

1. **No widened table grant, ever.** The `messages` and `conversations` policies
   written in P5.2 are participant-scoped and stay that way. There is no
   "admin can read all conversations" policy, because such a policy is a silent
   read: it produces the data and leaves no trace.
2. **Two accessors, and only they.**
   `public.read_conversation_as_lead(conversation_id uuid, reason text)` and
   `public.export_conversation_as_lead(conversation_id uuid, reason text)`,
   `SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` revoked from
   `PUBLIC` and from `anon` by name and granted to `authenticated`. Each checks
   `public.has_role('safeguarding_lead')` or `public.has_role('club_admin')`
   and raises otherwise.
3. **`reason` is mandatory and non-empty.** A blank or whitespace-only reason
   raises; there is no default. The reason is the difference between oversight
   and browsing, and it is the field the club will be asked about if the access
   is ever challenged.
4. **Scoped to conversations involving a minor.** The accessors raise for a
   conversation that has never had a minor participant. This document authorises
   oversight of children's messages; it does not authorise reading adult
   members' private messages, and the mechanism must not quietly provide it.
5. **Audit before returning (SG-7).** `messaging.conversation.admin_read` /
   `messaging.conversation.export` on entity `conversations`, `entity_id` the
   conversation id, `detail` carrying the reason, the message count and
   `includes_minor` — and **never a message body**, per SG-7's rule that
   `detail` must not contain the content whose access it records. The row is
   written even when the conversation is empty or the export returns nothing.
6. **Reading is not participating (SG-1.5).** Neither accessor may create a
   `conversation_participants` row, so an oversight read can neither satisfy nor
   break SG-1.

**Told in advance, and shown while it is true.** Monitoring that nobody knows
about is surveillance. Two requirements, one of them testable in the database:

- **At consent time:** the `unsupervised_messaging` consent screen states
  plainly, to the guardian and to the child, that conversations permitted by
  this consent can be read and exported by the club's safeguarding lead. The
  consent row records which version of that notice was shown
  (`guardian_consents.notice_version`), so what they were told is evidenceable
  later — that part is a data requirement and is tested.
- **While it is true:** any conversation flagged `supervised_by_lead` shows a
  persistent banner to every participant saying so. That is a UI requirement and
  is an acceptance criterion of P5.4 (web) and P6.3 (mobile), not a database
  invariant — but a conversation that is monitored without the banner is a
  defect, not a cosmetic issue.

**Retention (SG-8) applies unchanged.** Being monitored neither extends nor
shortens a conversation's retention; supervised conversations sit in the
ordinary "message content" category and legal hold behaves as it does anywhere
else. An export is a copy that leaves the system: the audit row is the club's
record that it was made, and the exported file is handled under the same
retention as the conversation it came from.

**Test.** `lead_can_read_conversation_with_minor`,
`club_admin_can_read_conversation_with_minor`,
`coach_calling_accessor_throws`, `member_calling_accessor_throws`,
`accessor_read_writes_audit_row`,
`accessor_export_writes_audit_row_with_message_count`,
`accessor_with_blank_reason_throws`,
`accessor_on_conversation_without_any_minor_throws`,
`accessor_audit_detail_contains_no_message_body`,
`accessor_read_does_not_create_participant_row` (the SG-1.5 pairing),
`audit_row_written_even_when_conversation_has_no_messages`,
`conversation_accessor_execute_revoked_from_public`,
`no_admin_read_policy_on_messages_for_api_roles` — a privilege/policy
assertion: `authenticated` reading a conversation it does not participate in
returns zero rows even when it holds `safeguarding_lead`, proving the accessor
is the only path,
and `consent_row_records_notice_version`.

**Implemented by.** P1.7 (`notice_version` on the consent row), P5.2 (the
accessors, the `supervised_by_lead` flag, the participant-scoped policies they
sit beside), P5.4 / P6.3 (the banner), P5.6 (export tooling and retention),
P4.3 (`public.write_audit()` and the SG-7 conventions the accessors call).

---

### SG-10 — A minor may hold an app account only with consent

**Statement.** A `profiles` row — an app account — may exist for a **known**
minor only while that minor is an account-eligible minor (SG-0.1): at or above
`safeguarding.min_account_age`, with an active `app_account` consent granted by
an adult holding an active guardianship to them. Creating one otherwise is
rejected, as is a `dob` correction that turns an existing account holder into an
ineligible minor.

**Guidance.** C9, C7, C1.

**Enforcement.** Triggers, because this must bind the auth admin path: signup
runs as `service_role` through `handle_new_user()`, so RLS on `profiles` never
sees it (§1.2).

- **`BEFORE INSERT ON public.profiles`.** If the linked person is a known minor
  and `public.is_account_eligible(person_id)` is false, raise `P0001` naming
  which limb failed — too young, or no active consent — so the administrator or
  the signup screen can say something useful.
- **The single `people` `UPDATE OF dob` trigger** re-runs the same check for a
  person who already holds a profile. This is the third invariant carried by
  that one trigger, alongside SG-1.2 and SG-6 tier 1(c); §4's "one dob trigger,
  never two competing ones" still holds.
- **Consent, recorded per child and per purpose.** `guardian_consents` holds one
  row per grant: child, guardian, `consent_type`, `granted_at`/`granted_by`,
  `revoked_at`/`revoked_by`, `expires_at` (left null until **D12** is settled;
  `has_active_consent()` treats a past `expires_at` as inactive from the day it
  exists, so settling D12 later is a data change rather than a schema change),
  `notice_version`. A trigger requires, at grant
  time, that the child is a minor (`is_minor`) and that the granting adult holds
  an **active** guardianship to that child — the link, never the `parent` role
  (§1.3). A partial unique index on `(child_person_id, consent_type) WHERE
  revoked_at IS NULL` means one live consent per purpose at a time.
- **Revocation is a column, not a delete.** `deny_hard_delete()` and
  `deny_truncate()` are attached to `guardian_consents` and `DELETE`/`TRUNCATE`
  revoked from `anon`, `authenticated` and `service_role`. This **extends SG-2's
  named list of four tables** and is recorded as a strengthening under §6.2: the
  evidence that a consent was given, by whom, and when it was withdrawn is
  exactly the record a safeguarding enquiry would ask for, and a consent that
  can be deleted leaves the club unable to show either that it had permission or
  that it acted on the withdrawal.
- **Every grant and revoke audit-logged** — `safeguarding.consent.granted` /
  `safeguarding.consent.revoked` (SG-7).
- **RLS on `guardian_consents`:** a guardian may read, grant and revoke consents
  for their own children (via `current_person_id()` plus an active
  guardianship); the child reads their own; `club_admin` and
  `safeguarding_lead` read all and may revoke; nobody else sees the table.

**Revoking `app_account` consent does not delete the account.** It blocks the
creation of a new profile and is reported to the `safeguarding_lead`; it does
not cascade into destroying an existing one. Deleting a person's account is an
administrative act with its own audit trail and its own conversation with the
family — a trigger that did it as a side effect of a consent edit would be a
worse outcome than the gap it closes, and it would take the child's message
history with it (SG-2, SG-8).

**The settings.** Both ages are admin-editable in the app and live in the
existing `public.site_settings` key/value table:

| Key | Default | Meaning |
|---|---|---|
| `safeguarding.min_account_age` | `13` | Youngest age at which a minor may hold an app account at all (SG-0.1) |
| `safeguarding.unsupervised_messaging_min_age` | `14` | Youngest age at which a minor may be supervision-exempt (SG-0.2, SG-1.9) |

**Validated in the database, not in the settings screen.** A
`BEFORE INSERT OR UPDATE` trigger on `site_settings` for keys beginning
`safeguarding.` requires:

- the value to be an integer (a settings table is `text`; "fourteen" or `14 `
  must not become a silently-failing comparison);
- `min_account_age ≤ unsupervised_messaging_min_age < 18` — each write
  evaluated against the other key's *current* value, so neither editing order
  can pass through an invalid pair;
- a floor of **13** on `min_account_age`, the UK age of digital consent (C9),
  unless Adam decides otherwise — **Open Decision D11**.

Reads go through `public.safeguarding_setting_int(key text)`, `STABLE`, which
returns the documented default when the row is absent, so a deleted or renamed
settings row fails closed to 13/14 rather than to "no limit". Every change
writes a `settings.changed` audit row (SG-7) carrying the key, the old value and
the new.

**Lowering an age is not retroactive; raising one is reported.**

- **Lowering `min_account_age`** grants nobody anything automatically: a
  newly-old-enough child still needs a consent before an account can exist, so
  there is nothing to re-check.
- **Raising `min_account_age`** leaves accounts held by children now below it.
  They are **reported nightly** to the `safeguarding_lead` and `club_admin`,
  **not auto-disabled** — **Open Decision D10**. Auto-disabling cuts a child off
  from the club's messaging with no human in the loop, at the moment they may
  most need to reach a trusted adult; doing nothing leaves a rule that is not
  the rule. A report with a one-click suspend is the recommendation, on the same
  reasoning as SG-6 tier 3.
- Raising `unsupervised_messaging_min_age` is **not** merely reported: see
  SG-1.9, where it is rejected unless the affected conversations are closed.

**The signup path, and the invite flow.** Because the trigger binds
`handle_new_user()`, a minor cannot obtain an account unaided — which is the
intent. The route that does work is an invite: an adult with an active
guardianship creates the child's `people` row and grants the `app_account`
consent, and the resulting signup carries that person's id.
`handle_new_user()` therefore honours `raw_user_meta_data->>'person_id'`:
where it names a person who has an active `app_account` consent and no profile
yet, that person is adopted; in every other case it creates a new person exactly
as it does today. Since 2026-09-05 (20260905100000) the id alone is not enough:
the sign-up must also arrive at the address the club holds for that person,
because the id is user-editable metadata visible to anybody who can see the
child, and only the address is something the confirmation link proves
possession of. (Linking by email for people with no login was added on
2026-09-02, 20260902100000, on the terms set out there; P1.2's objection —
families share addresses — is answered by that migration's guardianship limb.)

**Unknown DOB: the one place this invariant does not fail closed, deliberately,
and Adam should confirm it.** SG-0 treats an unknown `dob` as a minor. Read
literally, SG-10 would then refuse *every* account whose DOB the club does not
hold — including every ordinary adult self-signup, since `handle_new_user()`
creates the person with `dob` NULL, and including the three
`auth.admin.createUser()` paths the live function-room app already uses. The
invariant is therefore scoped to a **known** minor
(`people.dob IS NOT NULL AND public.is_minor_dob(dob)`), and an unknown-DOB
person may hold a profile. What makes that tolerable is that it buys an attacker
nothing: SG-0 still treats them as a minor everywhere it matters — SG-1 refuses
them a 1:1 with an adult, SG-5 gives them no photo consent, SG-6 counts them as
a minor in a team — so the account exists but is the *most* constrained kind of
account, not the least. Mitigations: unknown-DOB profiles appear in the same
nightly report as the raised-age cases, and P2.2 makes `dob` mandatory at
registration (D1). This is a documented deviation from §1.2's fail-closed
principle and needs Adam's agreement under §6.2.

**Test.** Eligibility: `profile_for_minor_without_consent_throws`,
`profile_for_minor_below_min_account_age_throws_even_with_consent`,
`profile_for_minor_with_revoked_consent_throws`,
`profile_for_eligible_minor_succeeds`,
`profile_for_unknown_dob_person_allowed` (documents the boundary above; flip it
if Adam decides otherwise),
`revoking_app_account_consent_does_not_delete_existing_profile`,
`dob_correction_making_profile_holder_an_ineligible_minor_throws`.
Consent integrity: `consent_granted_by_non_guardian_throws`,
`consent_granted_by_ended_guardianship_throws`,
`consent_for_adult_child_throws`,
`duplicate_active_consent_throws`,
`consent_after_revocation_can_be_granted_again`,
`hard_delete_consent_throws`, `truncate_consents_throws`,
`consent_grant_writes_audit_row`, `consent_revoke_writes_audit_row`,
`guardian_sees_only_own_children_consents`,
`coach_reads_zero_consents`.
Settings: `min_account_age_below_floor_throws`,
`min_account_age_above_unsupervised_age_throws`,
`unsupervised_age_of_18_or_more_throws`,
`non_integer_safeguarding_setting_throws`,
`safeguarding_setting_int_returns_default_when_row_absent`,
`settings_change_writes_audit_row`.
Signup: `underage_signup_without_consent_refused`,
`invited_eligible_minor_signup_succeeds`,
`handle_new_user_ignores_person_id_without_active_consent`,
`handle_new_user_ignores_person_id_that_already_has_a_profile`,
`adult_signup_unaffected`.

The eligibility and signup tests run as `authenticated`, as `service_role`
**and** as the table owner: the trigger, not a grant or a policy, is what must
refuse.

**Implemented by.** P1.7 (enum, table, helpers, settings, validation, the
`profiles` trigger, `handle_new_user()`, tests), P2.2 (adds the SG-5
photo-consent values to `consent_type`; whether `photo_consents` then becomes a
view over `guardian_consents` or stays a separate table is P2.2's decision and
must not change SG-5's meaning), P5.2 (SG-1.9's use of these helpers), P6.2 /
apps/web admin (settings screen, guardian consent UI, child invite flow).

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
- [ ] One `people` `UPDATE OF dob` trigger, carrying SG-1.2, SG-6 tier 1(c) **and** SG-10's re-check — not several triggers on the same column
- [ ] `person_roles(person_id, role, granted_at, granted_by)` and `public.has_role(role)` / `public.has_role(person_id, role)` — used by *every* policy from here on
- [ ] A designation of which roles are **child-facing** (drives SG-6) — a lookup table, not a hard-coded list in a trigger

**Consents and safeguarding settings (P1.7)**
- [ ] `public.consent_type` enum — `app_account`, `unsupervised_messaging`; P2.2 adds the SG-5 photo-consent values by `alter type … add value`
- [ ] `guardian_consents(id, child_person_id, guardian_person_id, consent_type, granted_at, granted_by, revoked_at, revoked_by, expires_at, notice_version, notes)` — partial unique `(child_person_id, consent_type) where revoked_at is null`; `expires_at` null until D12 is settled, and honoured by `has_active_consent()` from the outset
- [ ] A trigger on `guardian_consents` requiring, at grant time, `is_minor(child_person_id)` and an **active** guardianship from the granting adult to that child (the link, never the `parent` role)
- [ ] `deny_hard_delete()` + `deny_truncate()` on `guardian_consents`, with `DELETE`/`TRUNCATE` revoked from `anon`, `authenticated` **and `service_role`** — an extension of SG-2's four tables, recorded under §6.2
- [ ] Grant/revoke audit triggers writing `safeguarding.consent.granted` / `safeguarding.consent.revoked` (SG-7)
- [ ] `guardian_consents.notice_version` — which version of the SG-9 monitoring notice the guardian and child were shown at consent time
- [ ] `public.has_active_consent(child_person_id uuid, consent_type public.consent_type)` — `STABLE`, `SECURITY DEFINER`, `search_path = public`, `EXECUTE` revoked from `public` and `anon` by name (the P1.1 lesson)
- [ ] `public.is_account_eligible(person_id uuid)` (SG-0.1) and `public.is_supervision_exempt(person_id uuid)` (SG-0.2), declared the same way
- [ ] `public.safeguarding_setting_int(key text)` reading `public.site_settings`, returning the documented default when the row is absent
- [ ] `site_settings` rows `safeguarding.min_account_age` (13) and `safeguarding.unsupervised_messaging_min_age` (14), seeded if absent
- [ ] A `BEFORE INSERT OR UPDATE` validation trigger on `site_settings` for `safeguarding.%` keys (integer; `min_account_age ≤ unsupervised_messaging_min_age < 18`; floor 13 per D11) plus a `settings.changed` audit trigger
- [ ] A `BEFORE INSERT` trigger on `profiles` implementing SG-10 — the layer that binds the auth admin path, which RLS cannot reach
- [ ] `handle_new_user()` honouring `raw_user_meta_data->>'person_id'`: adopt that person when it has an active `app_account` consent and no profile yet (the invite route for an account-eligible minor); otherwise create a new person exactly as today, and never match on email (P1.2)

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
- [ ] `conversations.closed_at` is load-bearing, not cosmetic: SG-1.8 and SG-1.9 both key off it
- [ ] `conversations.supervised_by_lead boolean not null default false` (SG-1.9) — written by the trigger that admits the conversation, never by the client, and not clearable while a minor participant is active
- [ ] The SG-1 evaluation function, called by triggers on `conversation_participants`, `messages`, `people.dob`, `guardianships`, `guardian_consents` (revocation) and `site_settings` (a raised `unsupervised_messaging_min_age`), and by the nightly checker
- [ ] `public.read_conversation_as_lead(conversation_id, reason)` and `public.export_conversation_as_lead(conversation_id, reason)` — `SECURITY DEFINER`, no widened table grant behind them, mandatory non-empty `reason`, refusing conversations that have never held a minor, each writing its SG-7 row before returning (SG-9)
- [ ] `deny_hard_delete()` (`BEFORE DELETE ... FOR EACH ROW`) applied to `messages`, `conversation_participants`, `safeguarding_concerns`, `audit_log`
- [ ] `deny_truncate()` (`BEFORE TRUNCATE ... FOR EACH STATEMENT`) applied to the same four tables — the delete trigger does not fire on `TRUNCATE`
- [ ] `REVOKE DELETE, TRUNCATE` on those four tables from `anon`, `authenticated` **and `service_role`**, re-asserted after any blanket grant
- [ ] Attachments in Supabase Storage with short-TTL signed URLs (Q4)

**Audit (Phase 1 review + all later tasks)**
- [ ] `public.audit_log` gains the SG-2 delete guard **and** truncate guard
- [ ] The `audit_read` policy is re-expressed against `person_roles`, and safeguarding actions are narrowed to `safeguarding_lead`/`club_admin`
- [ ] A single `public.write_audit(action, entity, entity_id, detail)` helper so `actor_id`/`actor_email` are populated consistently
- [ ] The SG-7 action vocabulary gains `safeguarding.consent.granted` / `safeguarding.consent.revoked` on `guardian_consents`, `settings.changed` on `site_settings`, and `includes_minor` in the `detail` of the two `messaging.conversation.*` actions

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
| **D10** | SG-10: when `safeguarding.min_account_age` is **raised**, what happens to accounts already held by children who are now below it — auto-disable, or report? | Report nightly to the `safeguarding_lead` with a one-click suspend; do not auto-disable. Cutting a child off from the club's messaging with no human in the loop is the wrong default, and the SG-6 tier-3 reasoning applies unchanged. (Raising `unsupervised_messaging_min_age` is a different case and is already decided — SG-1.9, reject-unless-closed) |
| **D11** | SG-10: should `min_account_age` have a hard floor of **13** in the database, or may an admin set it lower? | Keep the floor at 13, the UK age of digital consent (C9). It is one constant in one validation function, so lowering it later is a small, deliberate, reviewable change — which is exactly what it should be |
| **D12** | Does an `unsupervised_messaging` consent **expire** — per season, annually, or only on revocation? | Recommend per season, re-confirmed at registration (P2.2). A consent given for a 14-year-old two seasons ago is not evidence of a current decision, and re-asking costs a checkbox. If Adam prefers "until revoked", the expiry column still exists and is simply left null |

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

- **2026-09-02 (later the same day) — recording a fact is never refused
  (Adam's decision, §6.2 record):** *"Please can you remove all these
  safeguarding rules leaving a player alone in an adult conversation. They are
  stopping us from actually using the app properly. I couldn't update Dave
  Taylor's DOB… I can't add a guardianship as Dave doesn't have a DOB."* He had
  found the circle: SG-1.2 would not record that the coach is an adult until
  the room was compliant, SG-4 would not accept him as a guardian until his age
  was known, and the room could not become compliant without that guardianship.
  Three rules, each right on its own, arranged so the club could not move.
  **SG-1.2 and SG-1.8 now record and audit instead of refusing** — see their
  entries above for the reasoning, which is that an age and an ended placement
  are facts, not acts, and refusing to write them protects nobody while making
  the register wrong. **SG-1.1 and SG-1.7 are untouched**, so putting a child
  alone in a room with an adult, and saying anything in such a room, are both
  still impossible; that is where SG-1's protection actually lives. Adam asked
  for SG-1 to be removed outright and it has not been: what is removed is the
  pair of guards that refused the cure rather than the disease, which is what
  was blocking him. Migration
  `20260902160000_recording_a_fact_is_never_refused.sql`, which also adds
  `sg1_open_breaches()` so the backlog can be read rather than inferred.
- **2026-09-02 — SG-1 reads "known minor" (Adam's decision, §6.2 record):**
  Adam hit the rule twice in an afternoon — once approving a fifty-year-old's
  registration for the over-45s, once typing a coach's date of birth into his
  own record — and said *"remove these restrictive safeguarding rules."* He was
  offered three answers: narrow SG-1 to children the club has a DOB for; keep
  SG-1 whole and move its enforcement off the DOB write; or remove SG-1
  altogether. He chose the first, and this entry is the record of it. **SG-0.3**
  defines *known minor* and **SG-1's precise form** now uses it; the reasoning,
  including why the old form could not be satisfied in any order, is written
  under SG-1. This is a weakening and touches PLAN.md §2.4, so it needed his
  agreement and has it. Scope: `conversation_is_compliant`,
  `conversation_exemptable`, `conversation_has_minor` and `conversations_guard`,
  and nothing else — `is_minor()` keeps SG-0's fail-closed reading in SG-4,
  SG-6, SG-9, SG-10, registrations, media and the venue groups. SG-1.4, SG-1.7,
  SG-1.8, SG-1.9 and SG-1.10 are unchanged in substance and still tested.
  Migration `20260902120000_sg1_known_minor.sql` audits every open conversation
  that the narrower reading exposes as non-compliant rather than silently
  admitting it; one did — a U11 team room holding a ten-year-old and a coach
  with no recorded guardianship between them, which the old reading had been
  hiding behind the coach's missing date of birth.
- **2026-08-26 — SG-6's in-app tier retired (Adam's decision, §6.2 record):**
  "remove all DBS, Safeguarding and Coaching qualifications from the App. We
  use the FA's Club Portal for this." Written up as **SG-6.1**: every screen,
  action and scheduled mail that showed, edited or reasoned about a
  certification, a DBS check, a safeguarding or coaching qualification or a
  certification exemption is deleted, and `INSERT`/`UPDATE`/`DELETE` on
  `certifications` and `certification_exemptions` are revoked from
  `authenticated` so nothing in the app can add to records nobody maintains
  here any more. The FA Clubs Portal is the system of record. **Nothing is
  dropped:** both tables, their rows, their reads, their policies, their SG-2
  guards, the shared evaluator and the tier-2 functions all stay, because they
  are the evidence of what the club held and when; dropping them is a separate,
  irreversible step available on request. The tier-1 switch stays at `0` and
  the migration asserts it rather than assuming it. This is a weakening of SG-6
  and needs Adam's explicit agreement on the record — the request is his, and
  this entry is that record. The SAFEGUARDING module itself (concerns, reports,
  oversight, SG-1/3/7/9) is untouched.
- **2026-08-25 — the super-user purge (Adam's decision, §6.2 record):** "allow
  super users to hard delete users and messages." SG-2 gains its first and only
  exception, written up as **SG-2.1**: two named, audited, super-user-only
  functions, gated on an audit row that must exist before anything is
  destroyed, scoped to nine tables that exclude `audit_log`,
  `safeguarding_concerns`, `safeguarding_concern_notes` and `media_items`, and
  refusing every legal hold and every person or message a safeguarding concern
  names. The triggers are not disabled and the DELETE/TRUNCATE revokes stand.
  This is a weakening of SG-2 and needs Adam's explicit agreement on the record
  — the request is his, and this entry is that record.
- **2026-08-22 — Codex review on PR #3:** four P1 findings (service_role
  bypass, TRUNCATE, guardianship-change re-evaluation, team-composition
  certification check) incorporated into SG-3 / SG-2 / SG-1 / SG-6.
- **2026-08-22 — child accounts, guardian consent and configurable ages
  (Adam's decision):** children may hold their own app account where a guardian
  consents; the minimum account age is admin-editable, default 13; up to 14 a
  guardian must still be a participant in any adult↔child conversation, so SG-1
  is unchanged below the threshold; from 14 (also admin-editable), with a
  guardian's `unsupervised_messaging` consent, a child may message an adult
  one-to-one — the driving case is young referees — and any conversation
  involving a minor can be opened or exported by the `safeguarding_lead` or
  `club_admin` through a logged accessor, rather than by copying message content
  into `audit_log`. Added: SG-0.1 / SG-0.2 (§1.5 defined terms), sub-case
  SG-1.9 with its consent-revocation and setting-raise guards on the SG-1.8
  reject-unless-closed pattern, **SG-9** (visibility of minors' private
  messages), **SG-10** (account eligibility, `guardian_consents`, and the two
  `site_settings` keys with DB validation); citation rows **C8** and **C9**
  added and awaiting verification; open decisions **D10**–**D12** raised; §4
  extended. Implemented by the new task **P1.7** and by **P5.2**. Two points
  need Adam's explicit agreement beyond the decision itself: the unknown-DOB
  carve-out in SG-10 (a documented deviation from §1.2's fail-closed principle,
  without which every adult self-signup would be refused), and the extension of
  SG-2's delete/truncate guards to `guardian_consents` (a strengthening, §6.2).
