# AoM Sports Club Platform — Consolidation & CRM Build Plan

> This document is the working plan for Claude Code. Read it fully before starting any task.
> Work through phases in order. Do not start a task whose dependencies or open questions are unresolved.
> Update the Status column as you go and record decisions in `DECISIONS.md`.

---

## 1. Context

The club currently runs four separate systems:

| System | Where | Notes |
|---|---|---|
| Pitch booking + early CRM | **Neon** (Postgres) | To be migrated and decommissioned |
| Function room booking + staff ops | **Supabase** project `aomsc-function-room` (`rwpglslbkhsqyxjhnpue`) | Live data; becomes the base project. Already contains: profiles, room_bookings, booking_payments, booking_emails, audit_log, timesheets, holiday_requests, sickness_records, clubhouse_projects, clubhouse_checklists, site_settings, email_templates |
| Fixtures | Supabase project `fixtures-system` (`boeaggxhkxbzuiojlbqi`) | **Unrelated standalone system — never touch it.** Fixtures for this platform are imported from **FA Full-Time** (fulltime.thefa.com), see P2.3–P2.5. |
| USC-Sale | Supabase project `nxmtjolusgeblmgucptn` | **Out of scope** (decision 2026-08-21). Do not touch. |

**End state:** one Supabase project (`aomsc-function-room`, to be renamed) holding the entire club platform: unified bookings (pitches + rooms), full CRM (members, teams, seasons, payments, safeguarding, media), WhatsApp-style messaging, staff ops. One Next.js web app, one Expo mobile app (iOS + Android), one monorepo.

**Stack (decided):** Supabase (Postgres 17, Auth, Realtime, Storage, Edge Functions), Next.js 14+ on Vercel, Expo/React Native with EAS, Stripe, Resend, Twilio (fallback SMS), Cloudinary or Supabase Storage for media (decide in Phase 4).

---

## 2. Hard rules (apply to every task)

1. **Never run destructive SQL against the production project directly.** All schema changes go through Supabase CLI migrations in the repo, rehearsed on a Supabase branch first.
2. **RLS on every table, written with the table, not after.** A migration adding a table without policies fails review.
3. **No auto-merge** on any PR touching: member/person data, safeguarding module, messaging, auth, payments, or RLS policies. These require human review from Adam. (This applies to Finn-loop `finn-review` too.)
4. **Safeguarding invariants are enforced in the database** (RLS/constraints/triggers), never only in application UI:
   - No conversation may contain exactly one adult and one minor with no guardian participant.
   - Messages are soft-deleted only; no hard deletes of messages or audit rows.
   - Safeguarding concern records readable only by `safeguarding_lead` and `club_admin` roles.
5. **Migrations are additive during the transition.** Legacy tables are only dropped in the explicit decommission tasks, after sign-off.
6. **Secrets** live in Vercel/EAS/Supabase env config, never in the repo. `.env.example` documents every variable.
7. Generated DB types (`supabase gen types typescript`) are regenerated in the same PR as any migration.
8. Every phase ends with a working, deployable system. No task may leave main in a broken state.

---

## 3. Decisions & remaining unknowns (resolved with Adam, 2026-08-21)

| # | Item | Decision |
|---|---|---|
| Q1 | Neon app auth mechanism | **Unknown to Adam.** Discover it in P3.1: inspect the Neon codebase and schema for Clerk tables/SDK usage, a local `users`/`sessions` table with password hashes, NextAuth tables, etc. Document findings in `MIGRATION_MAP.md` and get Adam's sign-off on the mapping approach before P3.2. |
| Q2 | Fixtures | **`fixtures-system` is an unrelated standalone project — never migrate, modify, or integrate with it.** The platform gets its own fixtures module (main project), populated automatically from **FA Full-Time**. The FA provides no official API; import is via scraping/parsing Full-Time pages using stored team/division identifiers (the approach used by Teamo and community libraries). Treat as an unofficial integration: isolate the parser, monitor for breakage, and always keep a manual paste/CSV fallback working. Fixtures + availability + pitch allocation are **in scope for mobile v1**. |
| Q3 | `USC-Sale` project | **Fully out of scope.** Never touch it. |
| Q4 | Media storage | **Supabase Storage** (with image transforms + signed URLs). Cloudinary not used. |
| Q5 | Cutover timing | **ASAP** — cutover proceeds as soon as the P3.3 rehearsal and reconciliation pass cleanly. Still requires a scheduled write-freeze window (a quiet weekday evening) and the P3.4 go/no-go checklist; "ASAP" does not mean skipping the rehearsal gate. |
| Q6 | Safeguarding framework | **Cheshire FA safeguarding requirements** (the FA Safeguarding Children Policy and guidance as applied by Cheshire FA). P5.1's spec must cite the specific rules it encodes; Adam verifies against current Cheshire FA published guidance at spec time. |

---

## 4. Phase 0 — Repo & environment foundation

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P0.1 | Create monorepo (Turborepo + pnpm): `apps/web`, `apps/mobile`, `packages/shared`, `packages/db` (migrations + generated types), `supabase/` (CLI config) | Repo builds; CI runs lint + typecheck + tests on PR | ☑ 2026-08-21 — scaffold builds; `turbo lint typecheck test` green locally; CI workflow added (first PR will prove it) |
| P0.2 | Link Supabase CLI to project `rwpglslbkhsqyxjhnpue`; pull current schema into versioned migrations as baseline | `supabase db diff` is clean against prod; baseline migration committed | ☑ 2026-08-22 — baseline `supabase/migrations/20260821000000_baseline.sql` reconstructed from live prod catalogs; types regenerated; CLI linked; `migration repair --status applied 20260821000000` on prod; history in sync. Verified by executing the baseline on a throwaway preview branch (`baseline-verify`, deleted after) and diffing catalogs vs prod: columns/constraints/indexes/triggers/policies/RLS/grants/sequences all identical. Docker Desktop installed (needed VT-x enabling in BIOS); `supabase db diff --linked -s public` run: after making grants explicit in the baseline, the only output is 5 `create or replace function` statements caused by CRLF bodies on prod (dashboard-authored). No-op migration `20260822000000_normalise_function_line_endings.sql` re-saves them with LF; pushed to prod with Adam's approval 2026-08-22; `supabase db diff --linked -s public` is now EMPTY. Acceptance criteria met. |
| P0.3 | Set up CI (GitHub Actions): typecheck, tests, `supabase db lint`, migration dry-run against a branch DB | CI green on a no-op PR; required checks configured | ☑ 2026-08-22 — ruleset `main` active: PR required, both checks required, deletion/force-push blocked. `.github/workflows/ci.yml` has two jobs: `verify` (lint/typecheck/test) and `database` (replays all migrations + seed on a fresh local Postgres, `db lint --fail-on error`, and `db push --dry-run` against prod when `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` secrets exist). PR #1 green on both jobs and merged; repo secrets added; run 32560047110 on `main` green incl. prod dry-run ("Remote database is up to date"). Phase 0 complete except P0.4 deploy smoke test (deferred with Vercel repoint). |
| P0.5 | Create `DECISIONS.md`, `SAFEGUARDING.md` (invariants from §2.4 expanded), and Linear project structure per phase | Docs exist; Linear issues created for Phase 1 | ☑ 2026-08-22 (PR #3 merged; four Codex review findings incorporated; open decisions D1–D9 + citations tracked as Linear TH1-16) — `SAFEGUARDING.md` written at repo root: expands §2.4 into invariants SG-0 (definition of minor; unknown DOB fails closed) and SG-1…SG-8, each with statement, guidance area, enforcement layer (constraint/trigger/RLS), the violation-attempting pgTAP test that must exist, and the implementing task. Also carries a citation table for the FA / Cheshire FA rule areas (per §3 Q6) with `[Adam to verify]` placeholders, a data-model checklist for Phases 1/2/4/5, 9 open decisions, and a change-control section tied to §2.3. AWAITING ADAM: review of the 9 open decisions and completion of the citation table — no SG-invariant is signed off until its citation row is filled in; P5.1 is blocked on this. `DECISIONS.md` created (lands on `main` with PR #2). Linear workspace `th1878` connected 2026-08-22: projects "Phase 0"…"Phase 6", labels `migration`/`rls`/`safeguarding`/`human-review`, issues TH1-5…TH1-9 (P0.1–P0.5, with real status) and TH1-10…TH1-15 (P1.1–P1.6, fully specified, dependency-chained; P1.1 blocked by P0.5 sign-off). REMAINING: Adam's review of SAFEGUARDING.md open decisions + citations. |
| P0.4 | Import existing function-room app code into `apps/web` (or link as first app if it stays separate short-term — confirm with Adam) | Existing room booking works unchanged from monorepo deploy | ◑ 2026-08-22 — lift-and-shift of `AoM-Sports-Club-Function-Room` into `apps/web` complete. Imported its live `src/` tree unchanged (85 files: 58 `src/app`, 9 `src/components`, 17 `src/lib`, `middleware.ts`) plus `public/`, `docs/`, `vercel.json` (cron `/api/cron/payment-reminders` daily 09:00), `tailwind.config.ts` (incl. typography + animate plugins) and `postcss.config.mjs`; `next.config.mjs` merged (source's `serverActions.bodySizeLimit: 6mb` + monorepo's `transpilePackages`). The source repo's root `app/`/`components/`/`lib/` are empty dead leftovers and its `supabase/migrations` are historical (already in our baseline) — neither imported. No data-access refactor: `src/lib/types.ts` is hand-written domain interfaces, not a copy of the generated `Database` type, so there was nothing trivially drop-in to swap for `@club/db`. Deps merged at source versions (`stripe` pinned to `22.2.0` to keep its `apiVersion` literal valid); `recharts`/`resend`/`tsx`/`dotenv`/`@types/nodemailer` dropped as unreferenced (`scripts/` does not exist in the source). Lint moved off legacy `next lint` onto the repo flat config; two `src/**`-scoped relaxations documented inline in `apps/web/eslint.config.mjs` (`no-unused-vars` → warn, `no-unused-expressions` allows ternary/short-circuit) and `noUncheckedIndexedAccess: false` in `apps/web/tsconfig.json`. Env fully documented in `apps/web/.env.example` + root `.env.example`; `turbo.json` build env extended with `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Verified: `pnpm turbo run lint typecheck` 8/8 green, `pnpm test` 4/4 green, `pnpm --filter @club/web build` green with placeholder Supabase env (no real secret needed at build time). REMAINING: (a) Vercel repoint — deliberately deferred per DECISIONS.md 2026-08-22, the live site still deploys from the old repo; when cut over, set root directory to `apps/web`, carry all env vars from `apps/web/.env.example`, and re-add the cron from `apps/web/vercel.json`; (b) smoke-test a real deploy against `rwpglslbkhsqyxjhnpue` before the acceptance criterion ("works unchanged from monorepo deploy") can be ticked; (c) archive/retire the `AoM-Sports-Club-Function-Room` repo once the repoint is done. |

---

## 5. Phase 1 — Unified core schema (the member model)

New tables land alongside existing ones; nothing is dropped.

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P1.1 | `people` — every human the club knows (players incl. minors, parents, coaches, staff, hirers). Fields: names, DOB, contact (nullable), `is_minor` derived/generated from DOB | Migration + RLS + types; unit tests for minor derivation | ☐ |
| P1.2 | Rework `profiles` to link `auth.users` → `people` (one-to-one). Backfill: every existing profile gets a person row | All 38 existing profiles linked; room booking app unaffected | ☐ |
| P1.3 | `guardianships` (guardian_person → child_person, relationship type) | Constraint: child must be minor; RLS: guardians see own links | ☐ |
| P1.4 | `roles` / person_roles: `club_admin`, `safeguarding_lead`, `coach`, `staff`, `member`, `parent`, `hirer` — replaces any ad-hoc role flags | RLS helper functions (`has_role()`) used by all subsequent policies | ☐ |
| P1.5 | `resources` (type: `function_room`, `pitch`, extensible) and unified `bookings` + generalised `booking_payments` | New booking API path works for a test pitch resource; conflict-check function has tests | ☐ |
| P1.6 | Migrate `function_rooms`/`room_bookings`/`booking_payments`/`booking_emails` data into the unified structure; keep legacy tables as read-only views or renamed `_legacy` | Row counts reconcile; web app reads/writes unified tables; audit_log records migration | ☐ |

---

## 6. Phase 2 — Teams, seasons, fixtures

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P2.1 | `teams`, `seasons`, `team_memberships` (person, team, season, role: player/coach/manager) | RLS: coaches see own teams; admins see all | ☐ |
| P2.2 | `registrations` (person, season, status, forms/consents captured) | Registration flow spec'd; consent fields include photo consent per child | ☐ |
| P2.3 | Fixtures schema in main project: `fixtures` (home/away, opponent, competition, kickoff, status, `source` = fulltime/manual, `external_ref`, venue → nullable FK to pitch `resources`), `availability`, `selections`. Team settings store the team's FA Full-Time identifiers — **editable in-app by club admins**: a team settings screen where the admin pastes the team's Full-Time URL; the app parses out league/season/division/team IDs, test-fetches, and shows a preview of upcoming fixtures for confirmation before saving. Changing the URL (e.g. new season, league change) re-links without orphaning existing fixtures; a bad URL shows a clear validation error. RLS: club_admin only | Admin can add, update, and remove a team's Full-Time link entirely in-app with fixture preview; no config files or DB edits involved | ☐ |
| P2.4 | **FA Full-Time importer**: scheduled Edge Function fetches each mapped team's fixtures from fulltime.thefa.com and upserts by `external_ref` (stable hash of teams+competition+date if no ID). Handles reschedules/postponements as updates, never duplicates; imports results after matches. Parser isolated in `packages/fulltime` with recorded-HTML fixture tests; import failures alert admin. Manual fallback: paste a Full-Time URL or CSV to import on demand | Importer runs nightly against Adam's real team pages; reconciles cleanly on repeat runs; parser tests pass against saved page snapshots; fallback works with importer disabled | ☐ |
| P2.5 | **Pitch allocation**: club admin allocates a home fixture to a pitch — this creates a linked `booking` on that pitch resource (kickoff + configurable pre/post buffer), running the same conflict-check as all bookings. Admin dashboard: unallocated home fixtures list, weekend pitch grid view, drag/reassign. Reschedule from Full-Time moves the linked booking and flags conflicts to admin rather than silently double-booking | Allocation blocks a conflicting hire booking and vice versa; reschedule test moves booking; unallocated-fixtures view accurate | ☐ |

---

## 7. Phase 3 — Neon migration & cutover

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P3.1 | Audit Neon schema **and discover the auth mechanism** (per Q1: check for Clerk SDK/tables, NextAuth tables, local password hashes). Document every table, row counts, auth findings, and mapping to target schema in `MIGRATION_MAP.md` | Auth mechanism identified with evidence; Adam has reviewed and approved the mapping | ☐ |
| P3.2 | Auth mapping plan based on P3.1 findings: legacy users → `auth.users` + `people`. If Clerk: export users, create Supabase users, send password-reset comms. If custom hashes: attempt hash import via Supabase Auth admin API, else password reset | Dry-run creates users on a branch DB; comms email drafted for Adam | ☐ |
| P3.3 | Import: `pg_dump` Neon → restore into `neon_legacy` schema; write transformation SQL (legacy users/bookings/payments → unified tables) | Full rehearsal passes on a Supabase branch; reconciliation script (row counts, sums of payment amounts) passes | ☐ |
| P3.4 | Cutover **as soon as P3.3 passes** (per Q5): schedule a quiet-evening write-freeze, freeze Neon writes, run migration, repoint pitch app + Stripe webhooks, smoke test. Go/no-go checklist and abort procedure written before the window | Checklist executed; pitch bookings working against Supabase; Neon set read-only | ☐ |
| P3.5 | Decommission: after 30 days clean, archive final Neon dump to cold storage, delete Neon project, drop `neon_legacy` | Sign-off from Adam recorded in DECISIONS.md | ☐ |

---

## 8. Phase 4 — CRM modules

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P4.1 | Subs & payments: Stripe products/subscriptions per season/team pricing; webhook Edge Function; `payments` ledger | Test-mode subscription lifecycle covered by tests; arrears view per team for coaches | ☐ |
| P4.2 | Arrears comms: scheduled Edge Function → Resend reminders with escalation tiers; all sends logged | Dry-run mode; opt-out honoured; audit_log entries | ☐ |
| P4.3 | Safeguarding: `certifications` (DBS, first aid, coaching badges; expiry dates), expiry-nudge scheduler (90/30/7 days), `safeguarding_concerns` (restricted RLS per §2.4) | Access tests prove only safeguarding_lead/admin can read concerns; nudges fire in test | ☐ |
| P4.4 | Comms preferences & audit: per-person channel preferences (email/SMS/push/in-app), suppression list | Every outbound message routed through one internal API that checks preferences | ☐ |
| P4.5 | Media on **Supabase Storage** (per Q4; image transforms + signed URLs, no Cloudinary): albums per team/event, per-child photo-consent enforcement — children without consent excluded from bulk downloads and public galleries at query level | Test: unconsented child's photos never appear in bulk export; signed URLs expire | ☐ |

---

## 9. Phase 5 — Messaging (WhatsApp-style)

Design against `SAFEGUARDING.md` first. P5.1 is a written spec, human-reviewed before code.

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P5.1 | Messaging spec against **Cheshire FA safeguarding guidance** (per Q6): conversation types (`dm`, `group`, `team`, `announcement`), participant rules, retention, moderation & export. Encode adult/minor rules as testable invariants, each citing the guidance it implements; Adam verifies citations against current published Cheshire FA / FA Safeguarding Children Policy | Adam approves spec | ☐ |
| P5.2 | Schema: `conversations`, `conversation_participants` (with `last_read_message_id`, joined/left), `messages` (reply_to, soft-delete), attachments in Supabase Storage | RLS: participants only; DB-level enforcement of §2.4 invariants with tests that attempt violations and fail | ☐ |
| P5.3 | Team conversations auto-membership: triggers sync participants from `team_memberships` + guardians of minor players | Adding a player adds their guardians; leaving team marks participant left (history retained) | ☐ |
| P5.4 | Realtime delivery in web app: subscribe, send, read receipts, typing indicator (broadcast) | Two-browser manual test passes; unread counts correct | ☐ |
| P5.5 | Push fan-out: DB webhook → Edge Function → Expo push API for offline participants; respects preferences (P4.4) | Push received on test devices; no push for muted conversations | ☐ |
| P5.6 | Safeguarding tooling: conversation export for safeguarding_lead, report-message flow, retention job | Export produces complete history incl. soft-deleted messages, access-logged in audit_log | ☐ |

---

## 10. Phase 6 — Mobile app (Expo)

| Task | Description | Acceptance criteria | Status |
|---|---|---|---|
| P6.1 | Expo app scaffold in `apps/mobile`; Supabase auth (email + magic link), shared client from `packages/shared`; EAS build profiles | Dev build signs in on iOS + Android simulators | ☐ |
| P6.2 | v1 screens: my teams, fixtures (auto-imported from Full-Time, with pitch shown once allocated) + availability toggle, subs status + pay (Stripe payment sheet), profile. Admin-role users additionally get the pitch allocation view and Full-Time link management per team (both can be web-views initially) | Coach and parent test personas complete core journeys incl. seeing next fixture with pitch and setting availability | ☐ |
| P6.3 | Messaging UI: conversation list, thread view, attachments, read receipts, push handling (`expo-notifications`) | Feature parity with web messaging for participants | ☐ |
| P6.4 | Store readiness: icons/splash, privacy policy (messaging + minors data — flag for Adam's review), App Store/Play data-safety forms, EAS Submit | TestFlight + internal Play track builds distributed to club testers | ☐ |
| P6.5 | Web parity check: bookings remain web-first; deep links from push into app | Documented in README | ☐ |

---

## 11. Working agreements for Claude Code / Finn-loop

- One Linear issue per task above; branch naming `phase-N/task-id-slug`.
- `finn-spec` output for any task in Phases 3, 5, or touching §2.4 must be approved by Adam before `finn-build` runs.
- PR description must state: migrations included (y/n), RLS changes (y/n), data touched, rollback step.
- Rollback: every migration has a down path or a documented restore procedure; cutover tasks (P3.4) have a written go/no-go checklist and abort procedure.
- When blocked on an open question (§3), stop and ask — do not assume.
