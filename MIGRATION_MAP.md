# MIGRATION_MAP — Neon pitch-booking app → `aomsc-function-room` (P3.1)

Status: **schema-complete, data pending** (2026-08-23). §1–§4 are now
established from the **source code** (`C:/Projects/aom-fc-pitch-booking`,
cloned 2026-08-23 at commit `6881cca`, 2026-07-03) rather than inferred from
the live site. §5 (row counts, date ranges, data-quality checks) still needs
the read-only Neon connection described in `docs/runbooks/P3-unblock.md`.
Adam approves §6 before P3.2 runs.

## 1. The application

| Fact | Evidence |
|---|---|
| Repo `github.com/TheHeathens1878/aom-fc-pitch-booking`, branch `main`, Vercel auto-deploys every push (region lhr1) | `HANDOVER.md`, `vercel.json` |
| Next.js 15 App Router, React 19, **Prisma 6** ORM, **NextAuth 4** (Credentials, JWT sessions), `bcryptjs`, `nodemailer`/Resend scaffold, `web-push`, `@vercel/blob` for uploads | `package.json`, `lib/auth.ts` |
| Database: **Neon Postgres**, `DATABASE_URL` in Vercel env; schema managed by 59 Prisma migrations (`20260518092228_init` → `20260601130000_user_sex_address`) plus two SQL blocks the handover says were run by hand in the Neon SQL editor | `prisma/migrations/`, `HANDOVER.md` |
| Live at `coaches.` / `membership.aomsportsclub.co.uk` (+ `aom-pitch-booking.vercel.app`) — one app, "AoM Pitch Booking" | live probes 2026-08-23 |
| Far broader than "pitch booking": pitch bookings and training sessions, **teams with member/guardian links, attendance & availability, team chat, coach groups, a club-wide lobby, a player waiting list and team applications, push subscriptions** | `prisma/schema.prisma` (62 models) |
| No payments, invoices, Stripe, fixtures or Full-Time anywhere in the schema or code | grep of `prisma/schema.prisma`, `app/`, `lib/` |
| Roles: `OWNER`, `ADMIN`, `COACH`, `PARENT`, `PLAYER` (`lib/roles.ts`); `/register` creates `isActive=false` users that an admin approves | `app/register/actions.ts` |

## 2. Auth mechanism (PLAN §3 Q1) — **answered and confirmed from code**

- `lib/auth.ts`: NextAuth `CredentialsProvider` ("Staff login"), `session.strategy = "jwt"`, no adapter → **no `accounts`/`sessions`/`verificationTokens` tables**; the only auth state is `User.passwordHash`.
- Hashes: `bcrypt.hash(password, 12)` via `bcryptjs` everywhere a real password is set (`register`, `admin/users`, `account`, `forgot-password`, `my-family`) ⇒ **`$2a$12$…`**, which Supabase Auth's admin `createUser({ password_hash })` accepts (Strategy A in `docs/runbooks/P3.2-auth-mapping.md`).
- **Locked accounts:** `my-family` creates child players who cannot log in with email `nologin-<uuid>@placeholder.invalid` and `bcrypt.hash(randomUUID(), 10)` — these must **not** get `auth.users` rows (they are `people` only).
- `email` is lower-cased on login and registration; `User.email` is unique.
- `isActive=false` = awaiting admin approval (or deactivated) — login throws "Account inactive".
- Password reset: `PasswordResetToken` (email, token, expiresAt, usedAt) — dropped; Supabase Auth owns reset.

## 3. The data model (from `prisma/schema.prisma`)

Prisma quotes identifiers, so the Neon tables are **CamelCase and case-sensitive** (`"User"`, `"UserTeam"`, …) with `cuid()` text ids. Grouped:

| Group | Tables |
|---|---|
| Identity & family | `User` (name, email, passwordHash, role, clubRole, contactPhone, **dateOfBirth?**, emergency contact, medicalNotes, sex, address, isActive, isDelegatedOwner, email prefs), `UserContact` (parent→child link, relationship, isPrimary), `ChildAdultInvitation`, `PasswordResetToken`, `RoleAuditLog` |
| Teams | `Team` (name, ageGroup, ageGroupTo, teamGender, recruiting/join fields, contacts, isActive), `UserTeam` (user↔team, displayName), `TeamVenueLink`, `TeamApplication` |
| Venues & pitches | `Venue`, `Pitch` (type FIVE_A_SIDE…ELEVEN_FULL), `PitchTimeslot`, `Closure`, `VenueDocument`, `AdminVenueSubscription`, `ClubSettings` |
| Bookings | `Booking` (pitch, team, opponentTeam/opponentName, bookingType MATCH/TRAINING/OTHER, start/end, status PENDING/CONFIRMED/CANCELLED/REJECTED, proposal fields, blockId, flags), `BookingAvailability`, `BookingAttendance` |
| Training | `TrainingSession` (pitch, start/end, recurringGroupId, status), `TrainingSessionTeam`, `TrainingAvailability`, `TrainingAttendance` |
| Team chat | `TeamMessage` (threaded, pinned, soft-deleted), `MessageAttachment` (Vercel Blob URLs), `TeamPoll`/`Option`/`Vote`, `TeamEvent`/`Rsvp`, `Notification` |
| Coach groups | `CoachGroup`, `CoachGroupMember`, `CoachGroupEligibleTeam`, `CoachGroupMessage`/`Attachment`, `CoachGroupPoll`/`Option`/`Vote`, `CoachGroupEvent`/`Rsvp`, `CoachGroupLastRead` |
| Lobby | `LobbyPost`, `LobbyPostVenuePush`, `LobbyPoll`/`Option`/`Vote`, `LobbyEvent`/`Rsvp`, `LobbyLastRead` |
| Waiting list | `WaitingListEntry` (playerName, **dob**, ageGroup, biologicalSex, school, healthConditions, parent name/email/phone, dataConsent, status, priority), `WaitingListNote`, `WaitingListAccess`, `WaitingListAgeGroupConfig` |
| Push | `PushSubscription` (Web Push endpoint/p256dh/auth — browser, not Expo) |

**DOB:** `User.dateOfBirth` is nullable and is only collected on `my-family`
child accounts and the `/account` personal-info form; `/register` does not ask
for it. Expect most adults to have NULL and most children created via
`my-family` to have a value. `WaitingListEntry.dob` is mandatory.

## 4. Mapping onto the unified schema (proposal for Adam)

### 4.1 People, auth, roles, guardianship

| Legacy | Target | Rule |
|---|---|---|
| `User` (all rows, active or not) | `people` | one row each: `first_name`/`last_name` via `split_person_name(name)`; `dob` = `dateOfBirth::date`; `email` (NULL for `@placeholder.invalid`); `phone`; `address` jsonb from the four address columns; `notes` = `clubRole` + `medicalNotes` + emergency contact (**decision D-P3-1: where medical/emergency data lives — `people.notes` is visible to staff; proposal is a `legacy_neon_user_profile` jsonb on `people` until P2.2's registration fields exist**). `legacy_neon_user_id text` column added for reconciliation |
| `User` with a real email and `isActive=true` | `auth.users` + `profiles` | Strategy A: `auth.admin.createUser({ email, password_hash, email_confirm: true, user_metadata: { person_id } })`; P1.7's `handle_new_user` adopts the person. `isActive=false` users: **people only**, no auth row (they never completed approval) |
| `User.role` OWNER/ADMIN | `person_roles.club_admin` | `isDelegatedOwner` ignored |
| `User.role` COACH | `person_roles.coach` + `team_memberships(role coach)` per `UserTeam` | SG-6 staff guard: memberships import as history (`left_at = now()`) unless a `certifications` row exists — **D-P3-2** |
| `User.role` PLAYER | `person_roles.member` + `team_memberships(role player)` per `UserTeam`, current season | SG-6 composition guard may refuse minors on teams whose coach lacks certifications — same D-P3-2 |
| `User.role` PARENT | **no role**; guardianship below. `UserTeam` rows for parents → `notes` only (a parent "following" a team is not a membership) | `parent` exists in `app_role` but is never granted by import |
| `UserContact` | `guardianships(guardian_person_id, child_person_id, relationship)` | `relationship` text → enum: Mother/Father/Parent → `parent`, Step* → `step_parent`, Grand* → `grandparent`, Foster → `foster_carer`, Guardian → `legal_guardian`, else `other`. SG-1 requires guardians to exist **before** child memberships: import order is people → guardianships → memberships |
| `ChildAdultInvitation`, `PasswordResetToken`, `RoleAuditLog` | dropped (`RoleAuditLog` archived into `neon_legacy` only) | |

Identity rule carried over from P1.2: **never auto-link by email** — an
imported user whose email matches an existing `people` row becomes a new
person; merging is a human act. Exception to record: if the *same* email is
already in `auth.users` (a function-room admin who also uses the pitch app),
`createUser` will fail — those few are listed in the reconcile report for Adam
to merge by hand.

### 4.2 Teams, venues, pitches, bookings

| Legacy | Target | Rule |
|---|---|---|
| `Team` | `teams(name, age_group, active, notes)` | `age_group` = `ageGroup` (+`–ageGroupTo`); gender and recruiting/join fields → `notes` jsonb-ish text until a recruitment feature exists; dedupe by exact name against teams created since P2.1. `legacy_neon_team_id` added |
| `UserTeam` | `team_memberships` | per 4.1; `displayName` → `notes` |
| `Venue`, `Pitch` | `resources(type='pitch', name = venue.name ‖ ' – ' ‖ pitch.name, description, information, active)` | prices NULL (the app has no pricing); `legacy_neon_pitch_id` added. `VenueDocument`, `AdminVenueSubscription`, `TeamVenueLink`, `PitchTimeslot` → not migrated (`PitchTimeslot` becomes `schedules` later if wanted) |
| `Booking` | `bookings(kind, status, starts_at, ends_at, booker_person_id, occasion, notes, team_name, resource_id)` | `kind`: MATCH → `fixture`, TRAINING/OTHER → `block`; status PENDING → `pending`, CONFIRMED → `confirmed`, CANCELLED/REJECTED → `cancelled`; `occasion` = title + opponent; money columns 0/NULL; `legacy_neon_booking_id`. The GiST exclusion will reject overlapping confirmed legacy rows — the reconcile report lists them; cancelled rows are imported with `blocked_*` NULL |
| `TrainingSession` (+`TrainingSessionTeam`) | `bookings(kind='block')` | `recurringGroupId` → `recurrence_group_id`; `legacy_neon_training_id` |
| `Closure` | `bookings(kind='maintenance')` per pitch (VENUE scope expands to every pitch of the venue) | |
| `BookingAvailability`/`TrainingAvailability` | **not migrated** — target `availability` is keyed on `fixtures`, not bookings; `BookingAttendance`/`TrainingAttendance` likewise | archived in `neon_legacy` for P3.5; **D-P3-3** if Adam wants history |
| `ClubSettings` | `site_settings` (timezone already Europe/London) | nothing to import |

### 4.3 Messaging, groups, lobby

| Legacy | Target | Rule |
|---|---|---|
| `TeamMessage` (+attachments) | `conversations(type='team', team_id)` + `messages` | one team conversation per team (P5.3 creates them anyway); `deletedAt` → `deleted_at`; `parentMessageId` → `reply_to_id`; attachments re-uploaded from Vercel Blob into `message_attachments` storage (**needs `BLOB_READ_WRITE_TOKEN` or public URLs — D-P3-4**). **SG-1 applies retroactively**: a team conversation whose participants would violate SG-1 today is created with `supervised_by_lead = true` |
| `CoachGroup*` | `conversations(type='group')` with the group's members | messages as above; polls/events → not migrated (no target) |
| `Lobby*` | `conversations(type='announcement')` "Club lobby", posts as messages | polls/events/RSVPs → not migrated |
| `Notification`, `*LastRead`, `*PollVote`, `*Rsvp` | not migrated | `last_read_message_id` left NULL |
| `PushSubscription` | not migrated (Web Push ≠ Expo tokens) | users re-enable push in the app |

### 4.4 Waiting list & applications

| Legacy | Target | Rule |
|---|---|---|
| `WaitingListEntry`, `WaitingListNote`, `WaitingListAgeGroupConfig`, `WaitingListAccess` | **new tables `waiting_list_entries`, `waiting_list_notes`, `waiting_list_age_groups`** (P3.3 migration, RLS: club_admin + coaches granted per age group) | the public `/waiting-list` and `/recruitment` forms must keep working from the new web app (P3.4 smoke test) |
| `TeamApplication` | `waiting_list_entries` with `team_preference` set and `source = 'team_application'` | |

## 5. Data findings (read-only connection, 2026-08-23)

Connected as `claude_ro` (SELECT only; `has_table_privilege('"User"','INSERT') = false`), Postgres 17.11, database `neondb`, **pooler host** in `.env.neon` (pg_dump for P3.3 needs the direct host — swap `-pooler` out of the hostname). 57 tables + `_prisma_migrations` (27 of 59 migrations recorded; the rest were applied by hand — every Prisma model has its table) + Neon's sample `playing_with_neon` (ignored).

### 5.1 Volumes — this is a small dataset

| Table | Rows | Notes |
|---|---|---|
| `User` | **61** | OWNER 1, ADMIN 4, COACH 47, PARENT 4, PLAYER 5. All `isActive`. Hash prefix **`$2a$` × 61** (bcrypt, Strategy A confirmed). 3 `@placeholder.invalid` locked players. No bad or case-duplicate emails |
| `User.dateOfBirth` | **NULL for all 56 adults**; known for 4 of 5 players (all four are minors, each with a `UserContact` guardian) | `medicalNotes`, emergency contact, address, `sex`: **0 rows** — D-P3-1 is moot |
| `UserContact` | 4 | relationship = "Son" ×4 → `parent` |
| `Team` | 73 (67 active, 5 recruiting) | 72 distinct names: "Lions" exists at U05 and U18 → `name` must carry the age group (`U05 Lions`), matching the live register page. **0 collisions** with prod `teams` (prod has 0 teams) |
| `UserTeam` | 70 | coach/parent/player ↔ team |
| `Venue` / `Pitch` | 5 / 15 (13 active) | Ashton Park ×2, AoM Sports Club ×5, Dainewell Park ×2, Weathercock Farm ×2, Wellfield Junior School ×4; types 5/7/9/11-a-side. Prod `resources(type='pitch')` = 0 |
| `Booking` | 76 | CONFIRMED 49 MATCH + 21 TRAINING, CANCELLED 3, REJECTED 2, PENDING 1; all 2026-05-23 → 2026-08-30; **0 overlapping confirmed pairs**, 0 bad ranges, every row has a team and a creator |
| `TrainingSession` / `…Team` | 6 / 12 | one recurring group, 2026-06-01 → 07-06 |
| `Closure` | 6 | all VENUE scope, active |
| `PitchTimeslot` | 88 | weekly slot templates |
| Chat: `TeamMessage` 4, `CoachGroupMessage` 2, `LobbyPost` 11 (10 deleted), attachments **0**, polls/events **0** | | 2 teams with chat, 3 coach groups (55 members, 87 eligible teams) |
| `WaitingListEntry` | 73 | PENDING 48, CONTACTED 9, TRIALLING 5, REJECTED 10, WITHDRAWN 1; 39 with `dataConsent`; DOBs 2014–2022; 68 distinct parent emails. `WaitingListNote` 14, `WaitingListAccess` 62, `WaitingListAgeGroupConfig` 14, `TeamApplication` 1 |
| `Notification` 640, `PushSubscription` 2, `BookingAvailability` 2, attendance 0, `PasswordResetToken` 9, `RoleAuditLog` 0, `VenueDocument` 3 | | not migrated |

`HANDOVER.md`'s hand-run SQL was applied (`school`, `healthConditions`, `reconfirmRequestedAt` exist; `UNCONTACTABLE` in the enum).

### 5.2 Prod overlap

- **6 Neon emails already exist in prod `auth.users` / `people`** (the function-room admins who also use the pitch app). Per the P1.2 identity rule these are *not* auto-linked: the import creates no auth row for them (it would fail on the unique email anyway) and lists the six in the reconcile report for Adam to merge by hand — or, simpler, **D-P3-5: treat an exact email match with an existing `auth.users` row as the same person** (attach roles/memberships to the existing `people` row, keep their current Supabase password). Recommendation: D-P3-5, because these six are all staff Adam knows.
- prod `seasons.is_current` = 0 rows → P3.3 must create the 2026/27 season before memberships import.

### 5.3 Consequences for §4 (simplifications)

- **Chat (§4.3): drop.** 7 live messages, 10 of 11 lobby posts deleted, 0 attachments. Team conversations come from P5.3 as normal; D-P3-4 is moot.
- **Attendance/availability (D-P3-3): drop** — 2 rows.
- **Medical/emergency/address (D-P3-1): moot** — no data.
- **The real decision is DOB.** 56 adults (1 owner, 4 admins, 47 coaches, 4 parents) have no DOB; SG-0 treats NULL as minor, so an imported coach could not be staff on a team, could not be in a DM with another adult, etc. Options for **D-P3-6**:
  1. *(recommended)* Import adults with `dob` NULL **and** mark them `people.legacy_adult_attested = true` (new column, settable only by the import and `club_admin`, attested by Adam who knows all 56), and let `is_minor()` return false when the flag is set and dob is NULL. First login forces DOB entry (profile-completion gate, already planned in P1.7's open items), after which the flag is irrelevant. This is the P1.7 unknown-DOB carve-out, scoped to imported rows.
  2. Collect all 56 DOBs from people before cutover (a form + chasing) — blocks Q5 "ASAP".
  3. Import with NULL and no carve-out — coaches become unusable until an admin enters each DOB by hand.
- **SG-6 (D-P3-2)** is unchanged: no `certifications` rows exist in prod, so coach memberships import as history (`left_at = now()`) *or* Adam enters certifications first. With only 47 coaches and 73 teams the alternative — import live memberships with a temporary `certification_exemptions` row per coach, expiring in 60 days — is proportionate; recommendation: exemptions, so the club is usable on day one.

## 6. Approval

- [ ] Adam confirms §2 (bcrypt import, Strategy A; the 3 locked placeholder accounts get no login).
- [ ] D-P3-2 coach memberships: 60-day `certification_exemptions` (recommended) vs. history-only.
- [ ] D-P3-5 the 6 email matches: same person (recommended) vs. manual merge.
- [ ] D-P3-6 adult DOB: option 1 carve-out (recommended) vs. collect first vs. none.
- [x] Read-only Neon URL provided and verified; §5 filled in (2026-08-23).
