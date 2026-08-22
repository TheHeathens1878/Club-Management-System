-- =============================================================================
-- P1.7 — public.guardian_consents, public.consent_type, safeguarding settings
-- =============================================================================
-- PLAN.md task P1.7 ("guardian_consents (per child, per purpose, granted by an
-- active guardian; revocable; audited), consent_type enum, safeguarding
-- settings in site_settings (min_account_age 13, unsupervised_messaging_min_age
-- 14, admin-editable, DB-validated), SG-10 account-eligibility trigger on
-- profiles, handle_new_user() invite flow"; acceptance: "Violation tests for
-- SG-10; under-age signup refused; invited eligible minor succeeds; settings
-- validation; audit rows").
--
-- PURPOSE
--   SAFEGUARDING.md SG-10 in full, plus the two derived-term helpers that
--   §1.5 defines and that SG-1.9 and SG-9 are stated in terms of.
--
--   A `profiles` row — an app account — may exist for a KNOWN minor only while
--   that minor is an account-eligible minor (SG-0.1). The consent that makes
--   that true is recorded per child and per purpose in `guardian_consents`, is
--   granted by an adult holding an ACTIVE guardianship to the child (the link,
--   never the `parent` role — §1.3), is revocable, is never deleted, and every
--   grant and revocation is audit-logged. The two age thresholds live in the
--   existing `public.site_settings` key/value table and are validated in the
--   database rather than in the settings screen.
--
-- INVARIANTS SATISFIED
--   SG-10 — in full, and this migration is its "Implemented by" entry for
--     everything except P2.2's photo-consent enum values and P5.2's use of the
--     helpers: the enum, the table, the helpers, the settings, the validation,
--     the `profiles` trigger, `handle_new_user()`, and the tests.
--   SG-0.1 / SG-0.2 (§1.5) — `public.is_account_eligible(uuid)` and
--     `public.is_supervision_exempt(uuid)`, both derived and never stored,
--     because both depend on now(), on an admin-editable setting, and on a
--     consent that can be revoked between one evaluation and the next.
--   SG-7 — `safeguarding.consent.granted` / `safeguarding.consent.revoked` on
--     `guardian_consents` and `settings.changed` on `site_settings`, exactly the
--     three rows SG-7's action table adds for SG-10. `detail` never carries
--     `notes`.
--   SG-9 — the data half only: `guardian_consents.notice_version` records which
--     version of the monitoring notice the guardian and child were shown. The
--     accessors, the `supervised_by_lead` flag and the banner are P5.2/P5.4.
--   SG-2 — EXTENDED to `guardian_consents`, beyond the four tables SG-2's
--     statement names. SG-10 requires the extension in terms ("This extends
--     SG-2's named list of four tables and is recorded as a strengthening under
--     §6.2"). Recorded in DECISIONS.md.
--   SG-0 — unchanged. `is_minor()` / `is_minor_dob()` are called, never
--     redefined, and nothing here presumes anybody an adult.
--   SG-1.9 — the helper and the consent row it keys off. The revocation guard
--     and the raised-age guard are P5.2's, because both need `conversations`.
--
-- WHAT IS DELIBERATELY *NOT* CHANGED
--   * `public.site_settings`' two baseline policies ("Anyone can read
--     site_settings", "Committee can manage site_settings") are untouched, and
--     so are their names, which contain spaces because they were created
--     through the dashboard. Both safeguarding values are non-secret integers —
--     an age threshold published on the club's own consent form — so the
--     world-readable SELECT policy is correct for them as it stands.
--   * The three apps/web settings screens keep working unchanged: every
--     trigger added here is scoped to keys matching 'safeguarding.%', and none
--     of the 27 keys `apps/web/src/lib/settings.ts` knows about matches it.
--   * `public.is_minor()`, `public.is_minor_dob()`, `public.has_role()`,
--     `public.current_person_id()`, `public.deny_hard_delete()`,
--     `public.deny_truncate()` and `public.set_updated_at()` are reused, never
--     re-implemented.
--   * `public.guardianships_guard()` is not refactored. Its adult-with-known-dob
--     test is duplicated (minimally) at §9a rather than being factored out,
--     because factoring it would mean rewriting a P1.3 function whose exact
--     error messages are asserted by `guardianships.test.sql`. See §9a.
--
-- DECISIONS TAKEN (long form in docs/migrations/P1.7-consents-settings.md)
--   * `granted_by`, when not null, must resolve to the guardian named on the
--     row or to a `club_admin` (§9a).
--   * `safeguarding_lead` MAY revoke, alongside `club_admin` (§13).
--   * `has_active_consent()` re-checks revocation and expiry, NOT the
--     guardianship: the active-guardianship requirement is a grant-time rule,
--     exactly as SG-4's age rules are creation-time rules (§8b).
--   * The identity columns of a consent row are immutable, and a revocation
--     cannot be undone in place — a re-grant is a new row (§9b).
--   * `expires_at` ships present and honoured but always NULL, pending D12.
--
-- PR METADATA (PLAN.md §11)
--   migrations: y
--   RLS changes: y — RLS enabled on the new `public.guardian_consents` with six
--     policies (guardian read/insert/update, child self-read, admin read, admin
--     update). No existing policy on any table is altered, dropped or recreated.
--   data touched:
--     * public.guardian_consents — +0 rows. Nothing is backfilled: a consent is
--       a statement a human made, and there is nobody to attribute a
--       manufactured one to.
--     * public.site_settings — +2 rows (`safeguarding.min_account_age` = '13',
--       `safeguarding.unsupervised_messaging_min_age` = '14'), inserted only if
--       absent. On prod both are absent, so +2.
--     * public.audit_log — +0 rows. The seed is an INSERT and
--       `settings.changed` fires on UPDATE only (§6c); the migration itself is
--       the record of the seed.
--     * public.profiles, public.people — untouched (no column added, no value
--       changed; two trigger functions are redefined).
--   rollback: §15; no restore procedure needed
--   SG invariants: SG-10 (in full), SG-0.1, SG-0.2, SG-7, SG-9 (notice_version),
--     SG-2 (extended to guardian_consents — a strengthening, §6.2), SG-1.9
--     (helper only)
--   tests: supabase/tests/consents_settings.test.sql (new)
--   NO AUTO-MERGE — PLAN.md §2.3: member data, safeguarding, auth and RLS.
--
-- CONTENTS
--   1.  consent_type enum
--   2.  Table
--   3.  Indexes
--   4.  Comments
--   5.  safeguarding_setting_int()
--   6.  site_settings: validation, delete refusal, settings.changed audit
--   7.  Seeding the two keys
--   8.  has_active_consent / is_account_eligible / is_supervision_exempt
--   9.  guardian_consents triggers: grant guard, change guard, SG-7 audit,
--       set_updated_at, SG-2 guards
--   10. The SG-10 trigger on public.profiles
--   11. Extending the single people_dob_guard()
--   12. handle_new_user(): the invite flow
--   13. Row Level Security on guardian_consents
--   14. Grants
--   15. Rollback
-- =============================================================================


-- =============================================================================
-- 1. consent_type
-- =============================================================================
-- SAFEGUARDING.md §4: "public.consent_type enum — app_account,
-- unsupervised_messaging; P2.2 adds the SG-5 photo-consent values by
-- `alter type … add value`."
--
-- An enum rather than text + CHECK, for the reasons P1.3 gave for
-- `guardian_relationship` and P1.4 for `app_role`: the set is small and closed,
-- the generated TypeScript type becomes a real union so an invalid purpose is a
-- compile error in apps/web and apps/mobile, and a CHECK costs the same ALTER to
-- extend while giving the apps nothing.
--
-- The two values are different decisions and must stay separable. §1.5:
-- "Consent is per child and per purpose. Holding app_account says nothing about
-- unsupervised_messaging; a guardian who wants their child to have an account
-- but always to be accompanied in conversations with adults grants the first and
-- withholds the second, and that is the expected default."
--
-- EXTENDING IT (P2.2, SG-5): `alter type public.consent_type add value
-- 'team_album';` and so on for 'club_website', 'social_media', 'press'. Since
-- Postgres 12 that may run inside a transaction block, so an ordinary CLI
-- migration is fine — but the new value cannot be USED in the same transaction
-- that adds it, so add the values in one migration and reference them in the
-- next. P2.2 also decides whether `photo_consents` becomes a view over this
-- table or stays separate; SG-10 is explicit that whichever it picks "must not
-- change SG-5's meaning".

create type public.consent_type as enum (
  'app_account',
  'unsupervised_messaging'
);


-- =============================================================================
-- 2. TABLE
-- =============================================================================
-- SAFEGUARDING.md §4: "guardian_consents(id, child_person_id,
-- guardian_person_id, consent_type, granted_at, granted_by, revoked_at,
-- revoked_by, expires_at, notice_version, notes)".
--
-- One row per GRANT, not per (child, purpose) pair — the same shape as
-- `person_roles` (P1.4) and for the same reason. SG-10's test list contains
-- `consent_after_revocation_can_be_granted_again`, so a revoked consent and its
-- successor are two rows and the gap between them is the record: "we asked, they
-- said yes, they changed their mind in March, they said yes again in August" is
-- exactly what a safeguarding enquiry asks for.
--
-- ON DELETE RESTRICT on both person foreign keys, matching `profiles.person_id`
-- (P1.2), both `guardianships` FKs (P1.3) and `person_roles.person_id` (P1.4).
-- `public.people` cannot be hard-deleted at all, so RESTRICT is the second line
-- rather than the first. Emphatically not CASCADE: a consent record disappearing
-- as a side effect of anything is the silent transition this table exists to
-- make impossible.
--
-- `granted_by` / `revoked_by` reference auth.users, NOT people: they record
-- which LOGIN performed the act, which is what `audit_log.actor_id` records too,
-- and both are ON DELETE SET NULL so that removing a departed administrator's
-- login does not destroy the evidence that a consent was given or withdrawn.

create table public.guardian_consents (
  id                  uuid primary key default gen_random_uuid(),

  -- The child the consent is about. A minor at grant time (§9a).
  child_person_id     uuid not null references public.people (id) on delete restrict,

  -- The adult who gave it. Must hold an ACTIVE guardianship to the child at
  -- grant time, and must be an adult with a known date of birth (§9a).
  guardian_person_id  uuid not null references public.people (id) on delete restrict,

  consent_type        public.consent_type not null,

  granted_at          timestamptz not null default now(),
  granted_by          uuid references auth.users (id) on delete set null,

  -- Revocation is a column, not a delete (SG-10). NULL means the consent is
  -- held right now.
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users (id) on delete set null,

  -- SG-10: "expires_at (left null until D12 is settled; has_active_consent()
  -- treats a past expires_at as inactive from the day it exists, so settling
  -- D12 later is a data change rather than a schema change)". Nothing in this
  -- migration ever writes it; §8b honours it from the outset.
  expires_at          timestamptz,

  -- SG-9: "the consent row records which version of that notice was shown
  -- (guardian_consents.notice_version), so what they were told is evidenceable
  -- later — that part is a data requirement and is tested." NOT NULL, because a
  -- consent whose terms cannot be reconstructed is not evidence of anything.
  notice_version      text not null,

  -- The circumstances of the grant or the withdrawal ("signed at registration
  -- 2026-08-22", "withdrawn by phone"). NEVER anything about a safeguarding
  -- matter: this table is read by the child, by every guardian of that child and
  -- by both admin roles, and SG-3 keeps narrative in `safeguarding_concerns`.
  -- Deliberately excluded from the SG-7 audit rows at §9c for the same reason.
  notes               text,

  updated_at          timestamptz not null default now(),

  -- A person cannot consent on their own behalf. The whole point of the row is
  -- that somebody else decided.
  constraint guardian_consents_not_self
    check (child_person_id <> guardian_person_id),

  constraint guardian_consents_revoked_after_granted
    check (revoked_at is null or revoked_at >= granted_at),

  -- revoked_by without revoked_at would be a withdrawal nobody made.
  constraint guardian_consents_revoked_by_needs_revoked_at
    check (revoked_by is null or revoked_at is not null),

  constraint guardian_consents_expires_after_granted
    check (expires_at is null or expires_at > granted_at),

  constraint guardian_consents_notice_version_not_blank
    check (btrim(notice_version) <> ''),

  constraint guardian_consents_notes_not_blank
    check (notes is null or btrim(notes) <> '')
);


-- =============================================================================
-- 3. INDEXES
-- =============================================================================

-- SG-10, in terms: "A partial unique index on (child_person_id, consent_type)
-- WHERE revoked_at IS NULL means one live consent per purpose at a time."
--
-- Note what it is NOT keyed on: the guardian. Two guardians of the same child
-- cannot hold two simultaneous live `app_account` consents, and that is correct
-- — the question "does this child have consent for an app account?" must have
-- one answer, not one per parent. Whichever guardian gave it is recorded on the
-- row; a second guardian who disagrees revokes it, which is a visible,
-- attributable act rather than a silent second opinion.
create unique index guardian_consents_active_idx
  on public.guardian_consents using btree (child_person_id, consent_type)
  where (revoked_at is null);

-- "What has this child's history been?" — the admin/lead read direction, and
-- the one the nightly D10 report will use. The unique index above leads on
-- child_person_id but covers live rows only.
create index guardian_consents_child_idx
  on public.guardian_consents using btree (child_person_id);

-- "Which consents has this guardian given?" — the `guardian_consents_guardian_*`
-- policy direction (§13).
create index guardian_consents_guardian_idx
  on public.guardian_consents using btree (guardian_person_id);


-- =============================================================================
-- 4. COMMENTS
-- =============================================================================

comment on table public.guardian_consents is
  'Per-child, per-purpose guardian consents (P1.7, SAFEGUARDING.md SG-10). One '
  'row per grant, never per pair: revoking sets revoked_at and the row '
  'survives, because "did the club have permission, and when was it '
  'withdrawn?" is the question a safeguarding enquiry asks. Rows are never '
  'hard-deleted (SG-2, extended here). Authority to grant comes from an ACTIVE '
  'guardianships link, never from the `parent` role (SAFEGUARDING.md §1.3).';

comment on column public.guardian_consents.consent_type is
  'The purpose consented to. Per SAFEGUARDING.md §1.5 the purposes are '
  'independent: app_account says nothing about unsupervised_messaging.';

comment on column public.guardian_consents.revoked_at is
  'Soft revoke. NULL = held now. Set it; never delete the row, and never clear '
  'it — a fresh consent is a new row, so the gap survives (SG-10).';

comment on column public.guardian_consents.expires_at is
  'Always NULL as shipped, pending Open Decision D12 (does an '
  'unsupervised_messaging consent expire per season?). has_active_consent() '
  'honours it from the outset, so settling D12 is a data change, not a schema '
  'change.';

comment on column public.guardian_consents.notice_version is
  'Which version of the SG-9 monitoring notice the guardian and the child were '
  'shown at consent time. SG-9: "so what they were told is evidenceable '
  'later". Mandatory: a consent whose terms cannot be reconstructed is not '
  'evidence.';

comment on column public.guardian_consents.notes is
  'The circumstances of the grant or withdrawal. Never a safeguarding matter — '
  'that is safeguarding_concerns (SG-3), and this table is read far more '
  'widely. Deliberately not copied into the SG-7 audit rows.';


-- =============================================================================
-- 5. safeguarding_setting_int()
-- =============================================================================
-- SG-10: "Reads go through public.safeguarding_setting_int(key text), STABLE,
-- which returns the documented default when the row is absent, so a deleted or
-- renamed settings row fails closed to 13/14 rather than to 'no limit'."
--
-- FAIL CLOSED, TWICE OVER. A missing row returns the documented default; so
-- does a row whose value is not a plain integer. The validation trigger at §6a
-- should make the second case unreachable, but §6a is a trigger and
-- SAFEGUARDING.md §1.2 is clear that a trigger can be disabled by the owner.
-- The direction of the default matters: falling back to 13/14 means an
-- administrator who deletes the row gets the shipped policy, not "no limit".
--
-- An UNKNOWN key RAISES rather than returning anything. There is no documented
-- default for a key this function has never heard of, and inventing one (0? 18?)
-- would be a silent answer to a question nobody has asked. A future
-- safeguarding integer setting adds its default here, in one obvious place.
--
-- STABLE / SECURITY DEFINER / search_path = public, the house style of
-- `is_committee()` (baseline), `is_minor()` (P1.1), `current_person_id()` (P1.3)
-- and the five P1.4 helpers. SECURITY DEFINER is not load-bearing for reads —
-- "Anyone can read site_settings" already permits them — but it is what keeps
-- the answer stable if that policy is ever narrowed, and it matches every other
-- helper a policy or trigger calls.

create or replace function public.safeguarding_setting_int(p_key text)
  returns integer
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $function$
declare
  v_default integer;
  v_value   text;
begin
  v_default := case p_key
    when 'safeguarding.min_account_age'                then 13
    when 'safeguarding.unsupervised_messaging_min_age' then 14
    else null
  end;

  if v_default is null then
    raise exception
      'safeguarding_setting_int: no documented default for key % — add one here before reading it [SAFEGUARDING.md SG-10]',
      p_key;
  end if;

  select s.value into v_value
    from public.site_settings s
   where s.key = p_key;

  -- Absent, blank, padded or non-numeric all take the documented default.
  if v_value is null or v_value !~ '^[0-9]+$' then
    return v_default;
  end if;

  return v_value::integer;
end $function$;


-- =============================================================================
-- 6. site_settings — VALIDATION, DELETE REFUSAL, AUDIT
-- =============================================================================
-- SG-10: "Validated in the database, not in the settings screen." All three
-- triggers are scoped to keys matching 'safeguarding.%', so the 27 keys the
-- imported function-room app writes (apps/web/src/lib/settings.ts) are
-- completely unaffected — club_name, logo_url, deposit_default_pence and the
-- rest go through exactly as they did this morning.

-- ---------------------------------------------------------------------------
-- 6a. The validation trigger
-- ---------------------------------------------------------------------------
-- SG-10 requires, for keys beginning `safeguarding.`:
--   * "the value to be an integer (a settings table is text; 'fourteen' or
--     '14 ' must not become a silently-failing comparison)";
--   * "min_account_age ≤ unsupervised_messaging_min_age < 18 — each write
--     evaluated against the other key's *current* value, so neither editing
--     order can pass through an invalid pair";
--   * "a floor of 13 on min_account_age, the UK age of digital consent (C9),
--     unless Adam decides otherwise — Open Decision D11". D11's recommendation
--     is to keep the floor, and it is "one constant in one validation function,
--     so lowering it later is a small, deliberate, reviewable change".
--
-- EVERY 'safeguarding.%' KEY MUST BE AN INTEGER, not only the two age keys.
-- That is what SG-10 says ("A BEFORE INSERT OR UPDATE trigger on site_settings
-- for keys beginning `safeguarding.` requires: the value to be an integer"), and
-- it fails in the safe direction: a future non-integer safeguarding setting is
-- refused loudly at the first write, which sends its author to this function to
-- decide deliberately how it should be validated, rather than letting an
-- unvalidated safeguarding setting into the table unnoticed.
--
-- THE CROSS-KEY CHECK reads the OTHER key through §5, so an absent counterpart
-- resolves to its documented default rather than to NULL — which would make the
-- comparison NULL, which a plain `if` treats as false, which would let an
-- invalid pair through. Both orders of editing are therefore covered, which is
-- exactly what SG-10 asks for.
--
-- NOT A TRIGGER, DELIBERATELY: the SG-1.9 guard on a RAISED
-- unsupervised_messaging_min_age ("rejects the setting change unless every
-- affected conversation is closed"). It needs `conversations`, which does not
-- exist until P5.2, and SG-1.9's "Implemented by" assigns it there. P5.2 must
-- EXTEND this function rather than adding a second trigger to the same table —
-- the same rule §4 lays down for the one `people.dob` trigger. The extension
-- point is marked below.

create or replace function public.site_settings_safeguarding_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_value       integer;
  v_min_account integer;
  v_min_unsup   integer;
begin
  if new.key not like 'safeguarding.%' then
    return new;
  end if;

  if new.value is null or new.value !~ '^[0-9]+$' then
    raise exception
      'site_settings: % must be a plain integer with no padding (got %) [SAFEGUARDING.md SG-10]',
      new.key, coalesce(quote_literal(new.value), 'NULL');
  end if;

  v_value := new.value::integer;

  -- Resolve the pair being proposed: the value under change, plus the other
  -- key's CURRENT value (or its documented default if the row is absent).
  if new.key = 'safeguarding.min_account_age' then
    v_min_account := v_value;
    v_min_unsup   := public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age');
  elsif new.key = 'safeguarding.unsupervised_messaging_min_age' then
    v_min_account := public.safeguarding_setting_int('safeguarding.min_account_age');
    v_min_unsup   := v_value;
  else
    -- Some other safeguarding.* integer. It passed the integer test, which is
    -- all SG-10 specifies for keys it does not name.
    return new;
  end if;

  -- The floor (D11, C9: the UK age of digital consent).
  if v_min_account < 13 then
    raise exception
      'site_settings: safeguarding.min_account_age may not be below 13, the UK age of digital consent (got %) [SAFEGUARDING.md SG-10, D11]',
      v_min_account;
  end if;

  -- The ceiling. At 18 a person is not a minor at all (SG-0), so a threshold of
  -- 18 or more describes nobody and would quietly disable the rule.
  if v_min_unsup >= 18 then
    raise exception
      'site_settings: safeguarding.unsupervised_messaging_min_age must be below 18 (got %) — at 18 a person is not a minor [SAFEGUARDING.md SG-10]',
      v_min_unsup;
  end if;

  -- §1.5: "Supervision-exemption presupposes account-eligibility... a minor
  -- with no app account has no conversation to be exempt in."
  if v_min_account > v_min_unsup then
    raise exception
      'site_settings: safeguarding.min_account_age (%) may not exceed safeguarding.unsupervised_messaging_min_age (%) [SAFEGUARDING.md SG-10, §1.5]',
      v_min_account, v_min_unsup;
  end if;

  -- P5.2 (SG-1.9) EXTENDS THIS FUNCTION HERE: when
  -- safeguarding.unsupervised_messaging_min_age is RAISED, reject the change
  -- unless every conversation the raise would leave non-compliant is already
  -- closed. Lowering it can only make conversations permissible and needs no
  -- check. Do not add a second trigger to this table.

  return new;
end $function$;

create trigger trg_site_settings_safeguarding_guard
  before insert or update on public.site_settings
  for each row execute function public.site_settings_safeguarding_guard();


-- ---------------------------------------------------------------------------
-- 6b. Deletion of a safeguarding key is refused
-- ---------------------------------------------------------------------------
-- §5 fails closed to 13/14 if a row vanishes, so a deletion is not a hole in
-- the rule. It is still refused, for two reasons:
--
--   * A deleted row and a row set back to its default are indistinguishable to
--     §5 but say very different things about what the club decided. Refusing
--     the delete keeps the settings table an honest record of the current
--     policy rather than a cache of the exceptions to it.
--   * SG-10 makes these two keys load-bearing for SG-0.1, SG-0.2, SG-1.9 and
--     SG-9. A row that other invariants read should not be removable by an
--     UPDATE-shaped mistake in a settings screen.
--
-- Scoped to 'safeguarding.%'. Every other key in this table remains deletable
-- exactly as it was — nothing in apps/web deletes one, but nothing here forbids
-- it either, and widening the refusal would be a change to the imported app's
-- behaviour that P1.7 has no business making.

create or replace function public.site_settings_deny_safeguarding_delete()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
begin
  if old.key like 'safeguarding.%' then
    raise exception
      'site_settings: the safeguarding setting % may not be deleted — set its value instead [SAFEGUARDING.md SG-10]',
      old.key;
  end if;

  return old;
end $function$;

create trigger trg_site_settings_safeguarding_no_delete
  before delete on public.site_settings
  for each row execute function public.site_settings_deny_safeguarding_delete();


-- ---------------------------------------------------------------------------
-- 6c. settings.changed  (SG-7)
-- ---------------------------------------------------------------------------
-- SG-7's action table, verbatim:
--   | settings.changed | site_settings | { "key": "safeguarding.min_account_age",
--                                          "old": 13, "new": 14 } (SG-10) |
--
-- ON UPDATE ONLY, and only when the value actually changes. Three consequences,
-- all deliberate:
--   * The §7 seed writes no audit row. The migration is the record of the seed,
--     and two rows attributed to nobody at the same instant is the noise P1.4's
--     backfill went to some trouble to avoid.
--   * An UPDATE that rewrites the same value writes nothing — apps/web's
--     settings screens upsert every key in a section on every save, so logging
--     no-ops would fill the table with non-events.
--   * A DELETE writes nothing because §6b makes it unreachable.
--
-- `old` and `new` are rendered as JSON NUMBERS when the value is an integer, as
-- SG-7's example shows, and as strings otherwise — the `otherwise` being
-- reachable only for a pre-existing row written before §6a was attached.
--
-- SECURITY DEFINER because it writes `public.audit_log`, which `authenticated`
-- may only read (`audit_read` is `is_committee()`), and because the row must be
-- written whoever made the change. AFTER, so the change has survived §6a and
-- every constraint before it is asserted in the log.

create or replace function public.site_settings_safeguarding_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_email text;
begin
  if new.key not like 'safeguarding.%' then
    return null;
  end if;

  if new.value is not distinct from old.value then
    return null;
  end if;

  v_actor := (select auth.uid());

  if v_actor is not null then
    select u.email into v_email from auth.users u where u.id = v_actor;
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (
    v_actor,
    v_email,
    'settings.changed',
    'site_settings',
    new.key,
    jsonb_build_object(
      'key', new.key,
      'old', case when old.value ~ '^[0-9]+$'
                  then to_jsonb(old.value::integer)
                  else to_jsonb(old.value) end,
      'new', case when new.value ~ '^[0-9]+$'
                  then to_jsonb(new.value::integer)
                  else to_jsonb(new.value) end
    )
  );

  return null;
end $function$;

create trigger trg_site_settings_safeguarding_audit
  after update on public.site_settings
  for each row execute function public.site_settings_safeguarding_audit();


-- =============================================================================
-- 7. SEEDING THE TWO KEYS
-- =============================================================================
-- SG-10's table:
--   | safeguarding.min_account_age                | 13 | Youngest age at which
--     a minor may hold an app account at all (SG-0.1) |
--   | safeguarding.unsupervised_messaging_min_age | 14 | Youngest age at which
--     a minor may be supervision-exempt (SG-0.2, SG-1.9) |
--
-- `on conflict do nothing`, so a re-run — or a prod that somehow already holds
-- a value — is left alone. An administrator's decision outranks a migration's
-- default.
--
-- Ordered min_account_age first only for readability; either order passes §6a,
-- because the cross-key check resolves the absent counterpart to its documented
-- default rather than to NULL.

insert into public.site_settings (key, value)
values ('safeguarding.min_account_age', '13')
on conflict (key) do nothing;

insert into public.site_settings (key, value)
values ('safeguarding.unsupervised_messaging_min_age', '14')
on conflict (key) do nothing;

do $do$
begin
  raise notice
    'P1.7 settings: safeguarding.min_account_age = %, safeguarding.unsupervised_messaging_min_age = %',
    public.safeguarding_setting_int('safeguarding.min_account_age'),
    public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age');
end $do$;


-- =============================================================================
-- 8. THE THREE CONSENT HELPERS
-- =============================================================================
-- §1.5: "Both are derived, never stored, for the same reason SG-0 is a function
-- and not a column: they depend on now(), on an admin-editable setting, and on
-- a consent that can be revoked between one evaluation and the next. The
-- enforceable form is public.is_account_eligible(person_id uuid) and
-- public.is_supervision_exempt(person_id uuid), both STABLE, both called by
-- triggers and policies alike."
--
-- All three are STABLE, SECURITY DEFINER, `set search_path to 'public'`, with
-- EXECUTE revoked from `public` AND from `anon` BY NAME at §14 — the P1.1
-- preview-branch lesson: hosted Supabase's default privileges grant every new
-- function an explicit EXECUTE to all three API roles, which
-- `revoke ... from public` does not touch.
--
-- anon must not hold them for a stronger reason here than for `has_role()`.
-- Every one of the three takes somebody else's person id and returns a fact
-- about that person's age and their family's decisions. Granted to an
-- unauthenticated caller they are a probe: feed it uuids and learn which of the
-- club's people are children with consented accounts.

-- ---------------------------------------------------------------------------
-- 8a. The age test
-- ---------------------------------------------------------------------------
-- "At least N years old on the date of evaluation", expressed the same way
-- `is_minor_dob()` (P1.1) expresses its complement, so the two can never
-- disagree about a birthday: `is_minor_dob(d)` is `d > current_date - 18 years`,
-- and being at least N is `d <= current_date - N years`.
--
-- Interval arithmetic, not age(): subtracting N years from a date with no
-- counterpart in the target year clamps to the last day of the month, so a
-- person born on 29 February reaches N on 1 March in a non-leap year — the
-- fail-closed direction (a day later, never a day early) and the ordinary
-- English-law reading. A NULL dob is never at least anything: the expression is
-- NULL, and every caller coalesces it to false.

create or replace function public.is_at_least_age(d date, p_years integer)
  returns boolean
  language sql
  stable
  set search_path to 'public'
as $function$
  select d is not null
     and p_years is not null
     and d <= (current_date - make_interval(years => p_years));
$function$;

-- ---------------------------------------------------------------------------
-- 8b. has_active_consent()
-- ---------------------------------------------------------------------------
-- SAFEGUARDING.md §4: "public.has_active_consent(child_person_id uuid,
-- consent_type public.consent_type) — STABLE, SECURITY DEFINER,
-- search_path = public, EXECUTE revoked from public and anon by name".
--
-- ACTIVE means: a row exists for this child and this purpose, it has not been
-- revoked, and it has not expired. SG-10: "has_active_consent() treats a past
-- expires_at as inactive from the day it exists".
--
-- WHAT IT DELIBERATELY DOES NOT RE-CHECK: that the granting guardian still holds
-- an active guardianship. That is a GRANT-TIME condition, enforced at §9a,
-- exactly as SG-4's age rules are creation-time conditions ("the age tests apply
-- at creation only"). Re-checking it here would mean that ending a guardianship
-- — a routine administrative act, and one SG-1.8 already guards for its effect
-- on conversations — silently invalidated a child's app account with nothing
-- happening in this table at all. SG-10 is emphatic about the opposite
-- direction: "Revoking app_account consent does not delete the account... a
-- trigger that did it as a side effect of a consent edit would be a worse
-- outcome than the gap it closes". A guardian who no longer wants the consent to
-- stand revokes it, which is one column and one audit row. Recorded in
-- DECISIONS.md.
--
-- The partial unique index at §3 means at most one row can match, so this is a
-- single index probe.

create or replace function public.has_active_consent(
  p_child_person_id uuid,
  p_consent_type    public.consent_type
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.guardian_consents gc
     where gc.child_person_id = p_child_person_id
       and gc.consent_type    = p_consent_type
       and gc.revoked_at is null
       and (gc.expires_at is null or gc.expires_at > now())
  );
$function$;

-- ---------------------------------------------------------------------------
-- 8c. is_account_eligible()  —  SG-0.1
-- ---------------------------------------------------------------------------
-- SG-0.1, verbatim: "An account-eligible minor is a minor who, on the date of
-- evaluation, is at least safeguarding.min_account_age years old AND for whom an
-- active (granted, not revoked) app_account consent is held, given by an adult
-- holding an active guardianship to them (SG-10)."
--
-- READ THE NAME CAREFULLY. This answers SG-0.1's question — "is this person an
-- ACCOUNT-ELIGIBLE MINOR?" — and nothing wider. It returns FALSE for an ordinary
-- adult, who has no consent row and needs none, so it must never be used as a
-- general "may this person have an account?" test. Every caller gates on
-- known-minority first: §10's trigger and §11's dob guard both ask
-- "dob IS NOT NULL AND is_minor_dob(dob)" before they ask this. That two-step is
-- SG-10's own structure — "If the linked person is a known minor and
-- public.is_account_eligible(person_id) is false, raise" — and it is what keeps
-- the unknown-DOB carve-out working.
--
-- UNKNOWN DOB IS NEVER ELIGIBLE (§1.5: "Unknown DOB is never eligible and never
-- exempt... an unknown DOB also fails every 'at least n years old' test, so both
-- terms fail closed exactly as §1.2 requires"). An unknown person id likewise:
-- no row, no dob, false.

create or replace function public.is_account_eligible(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (
      select public.is_at_least_age(
               p.dob,
               public.safeguarding_setting_int('safeguarding.min_account_age')
             )
         and public.has_active_consent(p.id, 'app_account'::public.consent_type)
        from public.people p
       where p.id = p_person_id
    ),
    false
  );
$function$;

-- ---------------------------------------------------------------------------
-- 8d. is_supervision_exempt()  —  SG-0.2
-- ---------------------------------------------------------------------------
-- SG-0.2, verbatim: "A supervision-exempt minor is a minor who, on the date of
-- evaluation, is at least safeguarding.unsupervised_messaging_min_age years old
-- AND for whom an active unsupervised_messaging consent is held on the same
-- terms (SG-10)."
--
-- "On the same terms" is why this is built on top of §8c rather than beside it.
-- §1.5: "Supervision-exemption presupposes account-eligibility. The settings are
-- constrained so that min_account_age ≤ unsupervised_messaging_min_age (SG-10),
-- and a minor with no app account has no conversation to be exempt in."
--
-- So a child whose guardian granted `unsupervised_messaging` but revoked
-- `app_account` is NOT exempt, and that is the correct answer: they have no
-- account to message from. §6a's cross-key constraint makes the age half of the
-- same point unfalsifiable.
--
-- P5.2 (SG-1.9) is the only intended consumer. Nothing in Phase 1 calls it —
-- it ships now because SG-1.9 and SG-9 are stated in terms of it and P1.7 is
-- their "Implemented by" entry for the definitions.

create or replace function public.is_supervision_exempt(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select public.is_account_eligible(p_person_id)
     and coalesce(
       (
         select public.is_at_least_age(
                  p.dob,
                  public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age')
                )
            and public.has_active_consent(p.id, 'unsupervised_messaging'::public.consent_type)
           from public.people p
          where p.id = p_person_id
       ),
       false
     );
$function$;


-- =============================================================================
-- 9. guardian_consents TRIGGERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 9a. The grant guard  (BEFORE INSERT)
-- ---------------------------------------------------------------------------
-- SG-10: "A trigger requires, at grant time, that the child is a minor
-- (is_minor) and that the granting adult holds an ACTIVE guardianship to that
-- child — the link, never the `parent` role (§1.3)."
--
-- A trigger rather than policies, because SAFEGUARDING.md §1.2 is explicit that
-- only constraints, triggers and privileges bind `service_role` and the table
-- owner. §13's RLS scopes the write for `authenticated`; this is what holds
-- against an Edge Function and against the SQL editor.
--
-- FOUR CHECKS, each with its own message, because each needs a different action
-- from the administrator:
--   1. The child must be a minor. `is_minor()` is TRUE for an unknown dob
--      (SG-0, fail closed), so an unknown-dob child may be consented for — the
--      same protective direction P1.3 took for guardianships, and the direction
--      that keeps a child the club knows least about from being the one child
--      with no recorded consent.
--   2. The guardian must be an adult with a KNOWN dob. SG-4's deliberate
--      asymmetry, restated: "a guardianship record with an unidentified adult is
--      not a safeguarding control", and neither is a consent from one. This
--      DUPLICATES the two tests inside `public.guardianships_guard()` rather
--      than calling a shared function, because factoring them out would mean
--      rewriting a P1.3 function whose exact P0001 messages `guardianships.
--      test.sql` asserts. The duplication is four lines; the alternative is a
--      change to a tested safeguarding trigger in a migration that has no other
--      reason to touch it. Re-checked here and not merely inherited from the
--      link, because a dob correction since the link was made could have
--      changed the answer.
--   3. There must be an ACTIVE guardianship from that adult to that child —
--      `guardianships.ended_at IS NULL`. The link, never the role.
--   4. `granted_by`, WHEN IT IS NOT NULL, must resolve to the guardian named on
--      the row or to a `club_admin`.
--
-- CHECK 4 IS A DECISION, recorded in DECISIONS.md. SG-10's RLS sentence gives
-- the grant to the guardian ("a guardian may read, grant and revoke consents for
-- their own children"), and §13 implements exactly that for `authenticated`. But
-- consent is overwhelmingly given on paper at registration, and the person
-- typing it in is a club administrator. Refusing that would either push the club
-- into logging in as the parent — destroying the attribution the row exists for
-- — or leave `granted_by` empty on most real rows. So a `club_admin` may record
-- a consent, and the audit row at §9c names them. `safeguarding_lead` is NOT
-- admitted as a grantor: SG-10 gives the lead "read all and may revoke", and
-- P1.4 drew the same line on `person_roles` for the same reason — the role whose
-- purpose is oversight should not be able to manufacture the permission it
-- oversees.
--
-- A NULL `granted_by` IS PERMITTED, for the Phase 3 legacy import and for any
-- migration-authored row: the same position `person_roles.granted_by` and
-- `guardianships.created_by` already take, and the honest one — attributing an
-- imported consent to whichever login happened to run the import would be a
-- small lie in the record that matters most.

-- SECURITY DEFINER, unlike P1.3's `guardianships_guard()`. The difference is
-- who inserts: a guardianship is written by an administrator who can read all of
-- `public.people` and all of `public.guardianships`, whereas a consent is
-- written by a parent whose reads of both tables are scoped by RLS. A guard that
-- ran as the caller could therefore fail to FIND the very link it is checking
-- for and raise "holds no active guardianship" at a guardian who does — and,
-- worse, the reverse shape of that mistake is a check that silently passes. A
-- safeguarding guard must give the same answer whoever asks. It reads and
-- raises; it writes nothing.

create or replace function public.guardian_consents_grant_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_guardian_dob    date;
  v_actor_person_id uuid;
begin
  -- 1. The child must be a minor.
  if not public.is_minor(new.child_person_id) then
    raise exception
      'guardian_consents: consent may only be recorded for a minor (person % is an adult) [SAFEGUARDING.md SG-10]',
      new.child_person_id;
  end if;

  -- 2. The guardian must be an adult with a known date of birth (SG-4's rule,
  --    re-checked at grant time).
  select p.dob
    into v_guardian_dob
    from public.people p
   where p.id = new.guardian_person_id;

  if not found then
    -- Unreachable while the foreign key stands; fail closed anyway.
    raise exception
      'guardian_consents: guardian person % does not exist [SAFEGUARDING.md SG-10]',
      new.guardian_person_id;
  end if;

  if v_guardian_dob is null then
    raise exception
      'guardian_consents: the guardian''s date of birth must be known (person % has none) [SAFEGUARDING.md SG-10, SG-4]',
      new.guardian_person_id;
  end if;

  if public.is_minor_dob(v_guardian_dob) then
    raise exception
      'guardian_consents: the guardian must be an adult (person % has dob %) [SAFEGUARDING.md SG-10, SG-4]',
      new.guardian_person_id, v_guardian_dob;
  end if;

  -- 3. An ACTIVE guardianship link. The link, never the `parent` role.
  if not exists (
    select 1
      from public.guardianships g
     where g.guardian_person_id = new.guardian_person_id
       and g.child_person_id    = new.child_person_id
       and g.ended_at is null
  ) then
    raise exception
      'guardian_consents: person % holds no active guardianship to child % — consent requires the link, never the parent role [SAFEGUARDING.md SG-10, §1.3]',
      new.guardian_person_id, new.child_person_id;
  end if;

  -- 4. granted_by, when supplied, must be the guardian or a club_admin.
  if new.granted_by is not null then
    select pr.person_id
      into v_actor_person_id
      from public.profiles pr
     where pr.id = new.granted_by;

    if v_actor_person_id is distinct from new.guardian_person_id
       and not coalesce(
             public.person_has_role(v_actor_person_id, 'club_admin'::public.app_role),
             false
           )
    then
      raise exception
        'guardian_consents: granted_by % is neither the guardian on this row nor a club_admin [SAFEGUARDING.md SG-10]',
        new.granted_by;
    end if;
  end if;

  return new;
end $function$;

create trigger trg_guardian_consents_grant_guard
  before insert on public.guardian_consents
  for each row execute function public.guardian_consents_grant_guard();


-- ---------------------------------------------------------------------------
-- 9b. The change guard  (BEFORE UPDATE)
-- ---------------------------------------------------------------------------
-- Two rules, and the reasoning for both is that this table is evidence.
--
-- (i) THE IDENTITY COLUMNS ARE IMMUTABLE FOR EVERYONE.
--     child_person_id, guardian_person_id, consent_type, granted_at, granted_by
--     and notice_version record what happened. Retargeting a consent from one
--     child to another — or quietly changing which notice the guardian was shown
--     — is not a correction, it is a rewrite of the record a safeguarding
--     enquiry would rely on. A consent entered against the wrong child is
--     revoked and re-granted, which leaves both facts visible. This is the
--     `guardian_consents` analogue of SG-1.8's refusal to let a guardianship be
--     retargeted silently, and it applies to `service_role` and the owner
--     because it is a trigger (§1.2).
--
-- (ii) A REVOCATION CANNOT BE UNDONE IN PLACE.
--     SG-10's test list contains `consent_after_revocation_can_be_granted_again`
--     — as a NEW ROW, which the partial unique index at §3 permits precisely
--     because the old row is revoked. Clearing `revoked_at` instead would erase
--     the gap, which is the history the table exists to hold (the same argument
--     P1.3 made for `guardianships.ended_at` and P1.4 for `person_roles`).
--
-- (iii) A NON-ADMIN MAY CHANGE ONLY revoked_at AND revoked_by.
--     A guardian's write on this table is a withdrawal, and nothing else. Notes
--     and `expires_at` are administrative fields; a guardian editing the note
--     that records the circumstances of their own consent is not a use case, and
--     `expires_at` is D12's to settle.
--
--     "ADMIN" HERE MEANS `club_admin` OR `safeguarding_lead`, resolved through
--     `has_any_role()`, which resolves `current_person_id()`, which is NULL for
--     `service_role` and for the owner. So a caller with no JWT is treated as a
--     non-admin and may only revoke. That is deliberate and fail-closed: an
--     Edge Function has no legitimate reason to rewrite a consent's notes, and
--     if one ever does it will do it through a named accessor with its own audit
--     row, on the SG-3/SG-9 pattern.
--
-- `updated_at` is excluded from the comparison throughout: the baseline's
-- `set_updated_at()` stamps it on every update, and it is not a field anybody
-- chose to change.

create or replace function public.guardian_consents_change_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  -- (i) Immutable identity.
  if new.child_person_id    is distinct from old.child_person_id
     or new.guardian_person_id is distinct from old.guardian_person_id
     or new.consent_type       is distinct from old.consent_type
     or new.granted_at         is distinct from old.granted_at
     or new.granted_by         is distinct from old.granted_by
     or new.notice_version     is distinct from old.notice_version
  then
    raise exception
      'guardian_consents: a consent record is evidence — child, guardian, type, grant and notice_version are immutable; revoke it and grant a new one [SAFEGUARDING.md SG-10]';
  end if;

  -- (ii) No un-revoking, and no rewriting a revocation timestamp.
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception
      'guardian_consents: a revocation cannot be undone or altered in place — a fresh consent is a new row [SAFEGUARDING.md SG-10]';
  end if;

  -- (iii) Non-admins may only revoke.
  v_is_admin := coalesce(
    public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]),
    false
  );

  if not v_is_admin then
    if new.notes is distinct from old.notes
       or new.expires_at is distinct from old.expires_at
    then
      raise exception
        'guardian_consents: only revoked_at/revoked_by may be changed here — notes and expires_at are administrative fields [SAFEGUARDING.md SG-10]';
    end if;
  end if;

  -- P5.2 (SG-1.9) EXTENDS THIS FUNCTION HERE: when revoked_at goes from NULL to
  -- non-NULL, reject the revocation unless every conversation permitted only by
  -- this consent is already closed. It needs `conversations`, which arrives with
  -- P5.2. Do not add a second BEFORE UPDATE trigger to this table.

  return new;
end $function$;

create trigger trg_guardian_consents_change_guard
  before update on public.guardian_consents
  for each row execute function public.guardian_consents_change_guard();


-- ---------------------------------------------------------------------------
-- 9c. SG-7 — every grant and revocation is audit-logged
-- ---------------------------------------------------------------------------
-- SG-10: "Every grant and revoke audit-logged — safeguarding.consent.granted /
-- safeguarding.consent.revoked (SG-7)." SG-7's action table gives the shapes:
--
--   | action                       | entity            | detail                |
--   |------------------------------|-------------------|-----------------------|
--   | safeguarding.consent.granted | guardian_consents | {child_person_id,     |
--   |                              |                   |  guardian_person_id,  |
--   |                              |                   |  consent_type,        |
--   |                              |                   |  notice_version}      |
--   | safeguarding.consent.revoked | guardian_consents | as above              |
--
-- SG-7's example for the revoke row carries the shorter {child_person_id,
-- consent_type}; the same four keys are written for both, because the table
-- introduces the columns with "detail SHOULD carry" and a revocation that does
-- not say which guardian's consent was withdrawn, or under which notice, is
-- harder to reconcile than one that does. A superset, never a different set.
--
-- `notes` IS NOT COPIED IN. SG-7: "detail must never contain the content it is
-- logging access to", and `audit_read` is `is_committee()` — wider than this
-- table's own read policies (§13), which do not admit the committee at large at
-- all.
--
-- WHAT COUNTS AS AN EVENT: an INSERT that is not already revoked is a grant; an
-- UPDATE taking `revoked_at` from NULL to non-NULL is a revocation. Nothing else
-- writes a row — a `notes` correction or an `expires_at` edit by an admin is
-- housekeeping, and §9b makes the un-revoke case unreachable. A row inserted
-- already revoked is a historical import, not a grant, exactly as P1.4 treats
-- one.
--
-- THE SUPPRESSION GUC, `app.guardian_consents_audit_suppressed`, follows P1.4's
-- pattern exactly: transaction-local (`set_config(..., is_local => true)`), read
-- in exactly ONE place — here — and checked before anything else. NOTHING IN
-- THIS MIGRATION SETS IT: there is no backfill, because a consent is a statement
-- a human made and there is nobody to attribute a manufactured one to. It exists
-- for the Phase 3 legacy import, which will insert historical consent rows in
-- bulk and must write one summary `migration.backfill` row rather than one
-- attributed-to-nobody grant per child. The pgTAP suite asserts both halves —
-- that the suppression works, and that an ordinary grant immediately afterwards
-- is still logged.

create or replace function public.guardian_consents_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_action text;
  v_actor  uuid;
  v_email  text;
begin
  if coalesce(current_setting('app.guardian_consents_audit_suppressed', true), 'off') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.revoked_at is not null then
      return null;
    end if;
    v_action := 'safeguarding.consent.granted';
  else
    if old.revoked_at is null and new.revoked_at is not null then
      v_action := 'safeguarding.consent.revoked';
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
    'guardian_consents',
    new.id::text,
    jsonb_build_object(
      'child_person_id',    new.child_person_id,
      'guardian_person_id', new.guardian_person_id,
      'consent_type',       new.consent_type::text,
      'notice_version',     new.notice_version
    )
  );

  return null;
end $function$;

create trigger trg_guardian_consents_audit
  after insert or update on public.guardian_consents
  for each row execute function public.guardian_consents_audit();


-- ---------------------------------------------------------------------------
-- 9d. set_updated_at, and the SG-2 guards
-- ---------------------------------------------------------------------------
-- SG-10, in terms: "Revocation is a column, not a delete. deny_hard_delete() and
-- deny_truncate() are attached to guardian_consents and DELETE/TRUNCATE revoked
-- from anon, authenticated and service_role. This EXTENDS SG-2's named list of
-- four tables and is recorded as a strengthening under §6.2: the evidence that a
-- consent was given, by whom, and when it was withdrawn is exactly the record a
-- safeguarding enquiry would ask for, and a consent that can be deleted leaves
-- the club unable to show either that it had permission or that it acted on the
-- withdrawal."
--
-- All four SG-2 layers, because SG-2 says all four are required:
--   * the row-level BEFORE DELETE trigger (here) — the layer that binds the
--     owner, who is not stopped by a revoked privilege;
--   * the statement-level BEFORE TRUNCATE trigger (here) — a separate trigger
--     and a separate function, because a row-level BEFORE DELETE trigger does
--     not fire on TRUNCATE and RLS does not apply to TRUNCATE at all;
--   * the revoked DELETE/TRUNCATE privileges, `service_role` named (§14);
--   * the absence of any FOR DELETE policy (§13).
--
-- The functions are P1.1's generic pair; nothing is re-implemented.

create trigger trg_guardian_consents_updated
  before update on public.guardian_consents
  for each row execute function public.set_updated_at();

create trigger trg_guardian_consents_deny_hard_delete
  before delete on public.guardian_consents
  for each row execute function public.deny_hard_delete();

create trigger trg_guardian_consents_deny_truncate
  before truncate on public.guardian_consents
  for each statement execute function public.deny_truncate();


-- =============================================================================
-- 10. THE SG-10 TRIGGER ON public.profiles
-- =============================================================================
-- SG-10's enforcement note: "Triggers, because this must bind the auth admin
-- path: signup runs as service_role through handle_new_user(), so RLS on
-- profiles never sees it (§1.2)." And then, precisely:
--
--   "BEFORE INSERT ON public.profiles. If the linked person is a known minor and
--    public.is_account_eligible(person_id) is false, raise P0001 naming which
--    limb failed — too young, or no active consent — so the administrator or the
--    signup screen can say something useful."
--
-- ALSO ON `BEFORE UPDATE OF person_id`, which SG-10 does not name. A profile
-- whose `person_id` is repointed at a known ineligible minor reaches exactly the
-- state the INSERT arm exists to prevent, with nothing happening in `people` or
-- `guardian_consents` — the SG-1.8 shape of hole, and the same remedy. A
-- strengthening under §6.2, recorded in DECISIONS.md. It is a reachable path:
-- `profiles_person_link.test.sql` itself updates `person_id`.
--
-- "KNOWN MINOR" IS THE WHOLE OF THE SCOPE, and SG-10 devotes a section to why:
-- "Unknown DOB: the one place this invariant does not fail closed, deliberately.
-- ... Read literally, SG-10 would then refuse EVERY account whose DOB the club
-- does not hold — including every ordinary adult self-signup, since
-- handle_new_user() creates the person with dob NULL, and including the three
-- auth.admin.createUser() paths the live function-room app already uses. The
-- invariant is therefore scoped to a known minor (people.dob IS NOT NULL AND
-- public.is_minor_dob(dob)), and an unknown-DOB person may hold a profile."
-- That carve-out is what keeps apps/web working, and it is a documented
-- deviation from §1.2 that still needs Adam's agreement under §6.2.
--
-- TRIGGER ORDER MATTERS AND IS NOT ACCIDENTAL. Postgres fires BEFORE ROW
-- triggers in name order, and `trg_profiles_ensure_person` (P1.2 §7) is what
-- supplies `person_id` on an upsert that arrives without one. This trigger is
-- named to sort AFTER it — `trg_profiles_ensure_person` <
-- `trg_profiles_sg10_account_eligibility` under any collation, since the
-- comparison is decided at the first character of the suffix ('e' < 's') and no
-- punctuation is involved. Were it to run first it would see a NULL person_id
-- and wave through the very insert the guard is for.
--
-- A NULL `person_id` returns without complaint: §7's trigger has either just
-- filled it or is about to, and the column's NOT NULL is what refuses it if
-- neither happens.

-- SECURITY DEFINER for §9a's reason: it reads `public.people`, and a guard whose
-- answer depends on whether the caller happens to be able to see the dob is not
-- a guard. `is_account_eligible()` is already SECURITY DEFINER; this makes the
-- known-minor test in front of it consistent with it.

create or replace function public.profiles_account_eligibility_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_dob      date;
  v_min_age  integer;
begin
  if new.person_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id then
    return new;
  end if;

  select p.dob into v_dob from public.people p where p.id = new.person_id;

  -- Unknown dob, or an adult: SG-10's carve-out and SG-10's ordinary case.
  if v_dob is null or not public.is_minor_dob(v_dob) then
    return new;
  end if;

  if public.is_account_eligible(new.person_id) then
    return new;
  end if;

  -- Name the limb that failed, as SG-10 requires.
  v_min_age := public.safeguarding_setting_int('safeguarding.min_account_age');

  if not public.is_at_least_age(v_dob, v_min_age) then
    raise exception
      'profiles: person % is % and the minimum account age is % — no app account may exist for them [SAFEGUARDING.md SG-10]',
      new.person_id,
      date_part('year', age(current_date, v_dob))::integer,
      v_min_age;
  end if;

  raise exception
    'profiles: person % is a minor with no active app_account consent — a guardian must grant one first [SAFEGUARDING.md SG-10]',
    new.person_id;
end $function$;

create trigger trg_profiles_sg10_account_eligibility
  before insert or update of person_id on public.profiles
  for each row execute function public.profiles_account_eligibility_guard();


-- =============================================================================
-- 11. EXTENDING THE SINGLE people_dob_guard()
-- =============================================================================
-- SAFEGUARDING.md §4: "One `people` UPDATE OF dob trigger, carrying SG-1.2,
-- SG-6 tier 1(c) AND SG-10's re-check — not several triggers on the same
-- column." SG-10 says the same from its own side: "The single people UPDATE OF
-- dob trigger re-runs the same check for a person who already holds a profile.
-- This is the third invariant carried by that one trigger, alongside SG-1.2 and
-- SG-6 tier 1(c)."
--
-- So this is a `create or replace` of P1.1's function, keeping its existing body
-- verbatim and adding one block. No second trigger is created; the existing
-- `trg_people_dob_guard` (BEFORE INSERT OR UPDATE OF dob) picks the new
-- behaviour up. The P2.1 (SG-6 1c) and P5.2 (SG-1.2) extension markers survive.
--
-- RAISE, NOT REPORT. SG-10's statement says so in terms — "Creating one
-- otherwise is rejected, AS IS a dob correction that turns an existing account
-- holder into an ineligible minor" — and names the test:
-- `dob_correction_making_profile_holder_an_ineligible_minor_throws`. This is not
-- in tension with D10, which is a different transition: raising
-- `min_account_age` is REPORTED nightly because it can sweep a cohort of
-- existing accounts at once with no human in the loop, whereas a dob correction
-- is one administrator changing one record and receiving an immediate, fixable
-- error.
--
-- SCOPED TO UPDATE, and to a dob that actually changed. On INSERT there is no
-- profile to protect — `profiles.person_id` references `people`, so the person
-- exists before the account can — and an unchanged dob cannot have changed the
-- answer.
--
-- ONE ATTRIBUTE OF P1.1'S FUNCTION DOES CHANGE: it becomes SECURITY DEFINER.
-- The new block reads `public.profiles` to ask "does this person hold an
-- account?", and `profiles_self_read` is `id = auth.uid() or is_committee()` —
-- so a `club_admin` who is not also `profiles.role = 'committee'` (a person P1.4
-- makes possible and P1.6 makes ordinary) would see only their own profile, the
-- EXISTS would answer false, and the SG-10 re-check would be skipped without a
-- word. A silently-skipped safeguarding check is the worst available outcome, so
-- the guard reads as the owner. The pre-existing "dob not in the future" branch
-- is unaffected: it touches no table.

create or replace function public.people_dob_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_min_age integer;
begin
  if new.dob is not null and new.dob > current_date then
    raise exception
      'people.dob may not be in the future (got %, today is %)',
      new.dob, current_date;
  end if;

  -- SG-10: a dob correction must not turn an existing account holder into an
  -- ineligible minor.
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and new.dob is not null
     and public.is_minor_dob(new.dob)
     and exists (select 1 from public.profiles pr where pr.person_id = new.id)
     and not public.is_account_eligible(new.id)
  then
    v_min_age := public.safeguarding_setting_int('safeguarding.min_account_age');

    if not public.is_at_least_age(new.dob, v_min_age) then
      raise exception
        'people: dob % would make person % a minor of %, below the minimum account age of %, and they already hold an app account [SAFEGUARDING.md SG-10]',
        new.dob,
        new.id,
        date_part('year', age(current_date, new.dob))::integer,
        v_min_age;
    end if;

    raise exception
      'people: dob % would make person % a minor with no active app_account consent, and they already hold an app account [SAFEGUARDING.md SG-10]',
      new.dob, new.id;
  end if;

  -- P2.1 (SG-6 1c) and P5.2 (SG-1.2) re-evaluation goes here.

  return new;
end $function$;


-- =============================================================================
-- 12. handle_new_user() — THE INVITE FLOW
-- =============================================================================
-- SG-10: "The signup path, and the invite flow. Because the trigger binds
-- handle_new_user(), a minor cannot obtain an account unaided — which is the
-- intent. The route that does work is an invite: an adult with an active
-- guardianship creates the child's people row and grants the app_account
-- consent, and the resulting signup carries that person's id.
-- handle_new_user() therefore honours raw_user_meta_data->>'person_id': where it
-- names a person who has an active app_account consent and no profile yet, that
-- person is adopted; in every other case it creates a new person exactly as it
-- does today. It never matches on email — P1.2's decision is untouched and is
-- doubly important here, since families share addresses."
--
-- This is a `create or replace` that keeps every part of P1.2's body: the same
-- signature, SECURITY DEFINER, the pinned search_path, `split_person_name()`,
-- the defensive email handling, the default role 'member', and the
-- `on conflict (id) do nothing`. One branch is added in front of it.
--
-- THREE CONDITIONS, ALL REQUIRED, and each is a named SG-10 test:
--   * the metadata value must parse as a uuid and name a person that exists —
--     an invite link that has been tampered with, or a person deleted since,
--     falls through to the ordinary path rather than failing the signup;
--   * that person must have NO profile yet
--     (`handle_new_user_ignores_person_id_that_already_has_a_profile`) — the
--     `profiles.person_id` UNIQUE would refuse it anyway, but a raised 23505
--     during signup is a worse experience than an ordinary new account, and the
--     one-to-one link is the thing being protected;
--   * there must be an ACTIVE `app_account` consent
--     (`handle_new_user_ignores_person_id_without_active_consent`).
--
-- FALLING THROUGH IS NOT THE SAME AS REFUSING, and SG-10 chose falling through:
-- "in every other case it creates a new person exactly as it does today". A
-- self-signup quoting a stranger's person id therefore gets an ordinary, empty
-- account with a fresh person and a NULL dob — it adopts nothing. What it does
-- NOT get is somebody else's identity, which is the property that matters.
--
-- THE ELIGIBILITY CHECK IS STILL §10's, NOT THIS FUNCTION'S. An adopted person
-- who is a known minor below `min_account_age` is caught by
-- `trg_profiles_sg10_account_eligibility` when this function inserts the
-- profile, and the whole `auth.users` insert fails. One enforcement point, and
-- it is the one that also binds a direct `insert into profiles`.
--
-- STILL NO AUTO-LINK BY EMAIL, and there must never be one. The adoption above
-- is keyed on an explicit person id carried by the invite AND on a consent
-- somebody granted; neither is an email address. DECISIONS.md 2026-08-22.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_names       record;
  v_email       text;
  v_person      uuid;
  v_meta_person text;
  v_invited     uuid;
begin
  -- --- the invite flow (SG-10) ---------------------------------------------
  v_meta_person := new.raw_user_meta_data ->> 'person_id';

  if v_meta_person is not null
     and v_meta_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_invited := v_meta_person::uuid;

    if exists (select 1 from public.people p where p.id = v_invited)
       and not exists (select 1 from public.profiles pr where pr.person_id = v_invited)
       and public.has_active_consent(v_invited, 'app_account'::public.consent_type)
    then
      insert into profiles (id, role, full_name, person_id)
      values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_invited)
      on conflict (id) do nothing;

      return new;
    end if;
  end if;

  -- --- the ordinary path, exactly as P1.2 wrote it -------------------------
  select s.first_name, s.last_name
    into v_names
    from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;

  v_email := nullif(btrim(new.email), '');

  -- Same defensive email handling as the backfill: a person row that cannot be
  -- created would mean a login that cannot be created.
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
-- 13. ROW LEVEL SECURITY ON guardian_consents
-- =============================================================================
-- SG-10: "RLS on guardian_consents: a guardian may read, grant and revoke
-- consents for their own children (via current_person_id() plus an active
-- guardianship); the child reads their own; club_admin and safeguarding_lead
-- read all and may revoke; nobody else sees the table."
--
-- Enabled, not FORCE'd, matching every other table in this project. FORCE would
-- not bind `service_role` anyway (it holds BYPASSRLS) and it WOULD break the
-- SECURITY DEFINER helpers at §8, which depend on the owner not being subject to
-- these policies. What binds `service_role` is the revokes at §14 and the
-- triggers at §9 (SAFEGUARDING.md §1.2).

alter table public.guardian_consents enable row level security;

-- --- the guardian -----------------------------------------------------------
-- Keyed on the LINK, not on the `parent` role, and on a LIVE link
-- (`ended_at is null`) — §1.3: "A person holding `parent` for child A has no
-- standing whatsoever in respect of child B."
--
-- Note the guardian sees consents for their children granted by ANY guardian,
-- not only their own: two parents of the same child both need to know that an
-- account consent exists, and the partial unique index at §3 means there is only
-- ever one live one to see.

create policy "guardian_consents_guardian_read" on public.guardian_consents
  for select
  using (
    exists (
      select 1
        from public.guardianships g
       where g.child_person_id = guardian_consents.child_person_id
         and g.guardian_person_id = public.current_person_id()
         and g.ended_at is null
    )
  );

-- The grant. `guardian_person_id` must be the caller: a guardian may consent for
-- their own child, not record somebody else's decision. §9a's trigger re-checks
-- the link, so this policy and that trigger say the same thing twice — which is
-- the point, since only the trigger binds `service_role`.
create policy "guardian_consents_guardian_insert" on public.guardian_consents
  for insert
  with check (
    guardian_person_id = public.current_person_id()
    and exists (
      select 1
        from public.guardianships g
       where g.child_person_id = guardian_consents.child_person_id
         and g.guardian_person_id = public.current_person_id()
         and g.ended_at is null
    )
  );

-- The revocation path: `update ... set revoked_at = now(), revoked_by = ...`.
-- §9b is what confines it to those two columns; a policy cannot express
-- "only these columns may change" without a column-level grant, and a
-- column-level grant would not bind `service_role`.
--
-- Any live guardian may revoke, not only the one who granted: a consent is about
-- the child, and a second parent who objects must not have to find the first.
create policy "guardian_consents_guardian_update" on public.guardian_consents
  for update
  using (
    exists (
      select 1
        from public.guardianships g
       where g.child_person_id = guardian_consents.child_person_id
         and g.guardian_person_id = public.current_person_id()
         and g.ended_at is null
    )
  )
  with check (
    exists (
      select 1
        from public.guardianships g
       where g.child_person_id = guardian_consents.child_person_id
         and g.guardian_person_id = public.current_person_id()
         and g.ended_at is null
    )
  );

-- --- the child --------------------------------------------------------------
-- SG-10: "the child reads their own". A young person is entitled to know what
-- has been decided about them and, with SG-9 in mind, that a consent they hold
-- carries the safeguarding lead's visibility. Read only: the consent is not
-- theirs to withdraw.
create policy "guardian_consents_child_read" on public.guardian_consents
  for select
  using (child_person_id = public.current_person_id());

-- --- the two admin roles ----------------------------------------------------
create policy "guardian_consents_admin_read" on public.guardian_consents
  for select
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- "club_admin and safeguarding_lead read all AND MAY REVOKE" — the sentence
-- names both roles and attaches both verbs to them, and SAFEGUARDING.md outranks
-- a task description (§1); the same precedent P1.4 followed when SG-4 gave both
-- admin roles write on `guardianships`. It is also the right answer on the
-- merits: a Club Welfare Officer who learns that an unsupervised-messaging
-- consent should not stand must be able to withdraw it that minute, without
-- finding a committee member first.
--
-- The grant is NOT extended to either role. SG-10's sentence gives them "read
-- all and may revoke", and §9a additionally admits a `club_admin` as the
-- `granted_by` of a consent whose `guardian_person_id` is a real guardian —
-- which is the paper-form case, and is a different thing from an administrator
-- being able to consent on a family's behalf. `safeguarding_lead` is excluded
-- from that too, for P1.4's reason: the role whose purpose is oversight should
-- not be able to manufacture the permission it oversees.
create policy "guardian_consents_admin_update" on public.guardian_consents
  for update
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]))
  with check (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- DELIBERATELY ABSENT
-- ---------------------------------------------------------------------------
--   * A FOR DELETE policy, and there will not be one (§9d, SG-2 as extended by
--     SG-10).
--   * Any `staff`, `coach` or `hirer` read. §1.3: staff have "no inherent access
--     to member or child data"; a hirer has "no member or child data at all.
--     Deliberately isolated"; a coach's legitimate need is "who is on my team"
--     (P2.1), which is not this. SG-10's own sentence ends "nobody else sees the
--     table".
--   * Any `anon` access whatsoever: no policy, and no grant at all (§14).
--   * Any admin INSERT policy — see above.


-- =============================================================================
-- 14. GRANTS
-- =============================================================================
-- An explicit override of baseline §9's blanket `grant all privileges on all
-- tables in schema public to anon, authenticated, service_role`, per
-- SAFEGUARDING.md §1.2. If a later migration re-runs that blanket grant, this
-- block must be re-asserted after it or the DELETE/TRUNCATE revokes silently
-- disappear.

revoke all privileges on public.guardian_consents from anon, authenticated, service_role;

-- anon gets nothing: there is no anonymous surface that needs a consent.
grant select, insert, update on public.guardian_consents to authenticated, service_role;

-- Named explicitly, `service_role` among them: it holds BYPASSRLS, so no policy
-- will ever stop it and the revoke is the only privilege-level control that does
-- (§1.2). This pair is what the pgTAP privilege assertions check, and what
-- catches a later blanket grant restoring the ability to destroy the evidence
-- that a consent was given or withdrawn.
revoke delete, truncate on public.guardian_consents from anon, authenticated, service_role;

-- The four public helpers. `anon` is revoked BY NAME as well as via PUBLIC:
-- hosted Supabase's default privileges (`alter default privileges for role
-- postgres ... grant execute on functions to anon, authenticated, service_role`)
-- give every new function an explicit grant to all three API roles, which
-- `revoke ... from public` does not touch — found the hard way by the P1.1
-- preview-branch rehearsal, where the local shadow DB had passed.
revoke all privileges on function public.safeguarding_setting_int(text)                         from public, anon;
revoke all privileges on function public.has_active_consent(uuid, public.consent_type)          from public, anon;
revoke all privileges on function public.is_account_eligible(uuid)                              from public, anon;
revoke all privileges on function public.is_supervision_exempt(uuid)                            from public, anon;

grant execute on function public.safeguarding_setting_int(text)                to authenticated, service_role;
grant execute on function public.has_active_consent(uuid, public.consent_type) to authenticated, service_role;
grant execute on function public.is_account_eligible(uuid)                     to authenticated, service_role;
grant execute on function public.is_supervision_exempt(uuid)                   to authenticated, service_role;

-- Internal. `is_at_least_age()` is a date helper with no table access and would
-- be harmless, but it is an implementation detail of §8c/§8d rather than an API
-- surface, and P1.2 set the precedent with `split_person_name()`. The five
-- trigger functions must never be called directly by anybody.
revoke all privileges on function public.is_at_least_age(date, integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.guardian_consents_grant_guard()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.guardian_consents_change_guard()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.guardian_consents_audit()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.site_settings_safeguarding_guard()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.site_settings_deny_safeguarding_delete()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.site_settings_safeguarding_audit()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.profiles_account_eligibility_guard()
  from public, anon, authenticated, service_role;

-- P1.1 left `people_dob_guard()` with the platform's default EXECUTE grants
-- because it was SECURITY INVOKER and calling it outside a trigger only raises.
-- §11 makes it SECURITY DEFINER, so the grants are withdrawn: a definer function
-- nobody needs to call is one nobody should be able to call.
revoke all privileges on function public.people_dob_guard()
  from public, anon, authenticated, service_role;

-- Re-assert the revokes P1.1, P1.3 and P1.4 rely on. Nothing in this migration
-- re-runs the baseline's blanket grant, but re-stating them costs nothing and
-- keeps the guarantee local to the file a reviewer is reading.
revoke delete, truncate on public.people        from anon, authenticated, service_role;
revoke delete, truncate on public.person_roles  from anon, authenticated, service_role;
revoke truncate          on public.guardianships from anon, authenticated, service_role;


-- =============================================================================
-- 15. ROLLBACK  (explicit; run as `postgres`, in one transaction, in this order)
-- =============================================================================
--
--     -- 1. Restore handle_new_user() to its P1.2 body (the invite branch goes).
--     create or replace function public.handle_new_user()
--       returns trigger
--       language plpgsql
--       security definer
--       set search_path to 'public'
--     as $function$
--     declare
--       v_names  record;
--       v_email  text;
--       v_person uuid;
--     begin
--       select s.first_name, s.last_name
--         into v_names
--         from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;
--
--       v_email := nullif(btrim(new.email), '');
--
--       if v_email is not null
--          and (
--            length(v_email) not between 6 and 320
--            or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
--            or exists (
--                 select 1 from public.people pe
--                  where pe.deleted_at is null
--                    and lower(pe.email) = lower(v_email)
--               )
--          )
--       then
--         v_email := null;
--       end if;
--
--       insert into public.people (first_name, last_name, email)
--       values (v_names.first_name, v_names.last_name, v_email)
--       returning id into v_person;
--
--       insert into profiles (id, role, full_name, person_id)
--       values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_person)
--       on conflict (id) do nothing;
--
--       return new;
--     end $function$;
--
--     -- 2. Restore people_dob_guard() to its P1.1 body (the SG-10 block goes).
--     create or replace function public.people_dob_guard()
--       returns trigger
--       language plpgsql
--       set search_path to 'public'
--     as $function$
--     begin
--       if new.dob is not null and new.dob > current_date then
--         raise exception
--           'people.dob may not be in the future (got %, today is %)',
--           new.dob, current_date;
--       end if;
--       return new;
--     end $function$;
--
--     -- 3. Remove the profiles guard and the three site_settings triggers.
--     drop trigger if exists trg_profiles_sg10_account_eligibility     on public.profiles;
--     drop trigger if exists trg_site_settings_safeguarding_guard      on public.site_settings;
--     drop trigger if exists trg_site_settings_safeguarding_no_delete  on public.site_settings;
--     drop trigger if exists trg_site_settings_safeguarding_audit      on public.site_settings;
--
--     -- 4. Remove the two seeded settings rows. This is the ONE circumstance in
--     --    which they may be deleted, and step 3 has just removed the trigger
--     --    that would otherwise refuse it.
--     delete from public.site_settings
--      where key in ('safeguarding.min_account_age',
--                    'safeguarding.unsupervised_messaging_min_age');
--
--     -- 5. Drop the table. This takes its policies, indexes and triggers with
--     --    it, and destroys any consent rows — which is correct for a rollback
--     --    of the migration that created the table, and is the ONLY circumstance
--     --    in which a guardian_consents row may be destroyed (§9d forbids it in
--     --    every other). Any audit rows it wrote are NOT deleted: audit rows are
--     --    append-only (SG-2).
--     drop table if exists public.guardian_consents;
--
--     -- 6. Drop the functions, dependants first.
--     drop function if exists public.profiles_account_eligibility_guard();
--     drop function if exists public.site_settings_safeguarding_audit();
--     drop function if exists public.site_settings_deny_safeguarding_delete();
--     drop function if exists public.site_settings_safeguarding_guard();
--     drop function if exists public.guardian_consents_audit();
--     drop function if exists public.guardian_consents_change_guard();
--     drop function if exists public.guardian_consents_grant_guard();
--     drop function if exists public.is_supervision_exempt(uuid);
--     drop function if exists public.is_account_eligible(uuid);
--     drop function if exists public.has_active_consent(uuid, public.consent_type);
--     drop function if exists public.is_at_least_age(date, integer);
--     drop function if exists public.safeguarding_setting_int(text);
--     drop type     if exists public.consent_type;
--
--     -- 7. Record it.
--     insert into public.audit_log (actor_id, actor_email, action, entity, detail)
--     values (null, 'migration', 'migration.rollback', 'guardian_consents',
--             jsonb_build_object('migration', '20260822140000_consents_settings'));


-- =============================================================================
-- END OF P1.7
-- =============================================================================
