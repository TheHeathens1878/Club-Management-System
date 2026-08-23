# MIGRATION_MAP — Neon pitch-booking app → `aomsc-function-room` (P3.1)

Status: **partial, evidence-based** (2026-08-23). Everything in §1–§4 was
established from the live application without credentials. §5 (every table,
row counts, hash algorithm confirmation) requires the read-only Neon
connection described in `docs/runbooks/P3-unblock.md`. Adam approves §6
before P3.2 runs.

## 1. The application (what it is, where it runs)

| Fact | Evidence |
|---|---|
| Live at `https://coaches.aomsportsclub.co.uk` and `https://membership.aomsportsclub.co.uk` — **one app, two hostnames** (identical responses, identical CSRF behaviour) | both return the same `manifest.json` ("AoM Pitch Booking", start_url `/calendar`), same login page, same `/api/auth/providers` |
| Next.js **App Router** on **Vercel** (region lhr1) | `X-Powered-By: Next.js`, `Server: Vercel`, `X-Vercel-Id: lhr1::…`, `_next/static/chunks/app/…` |
| Everything except `/login`, `/register`, `/forgot-password`, `/recruitment` is behind middleware (any other path, including `/api/*`, 307s to `/login?callbackUrl=…`) | probed 17 paths |
| Linked from the club's WordPress site as "coaches." and "membership.…/recruitment" | `https://aomsportsclub.co.uk/` nav links |

## 2. Auth mechanism (PLAN §3 Q1) — **answered**

**NextAuth / Auth.js with a single Credentials provider.** Evidence:

- `GET /api/auth/providers` → `{"credentials":{"id":"credentials","name":"Staff login","type":"credentials","signinUrl":"…/api/auth/signin/credentials","callbackUrl":"…/api/auth/callback/credentials"}}`
- `GET /api/auth/csrf` → `{"csrfToken":"…"}`; `GET /api/auth/session` → `{}` (anonymous)
- the redirect shape `/login?callbackUrl=%2F` is NextAuth's
- login form: `email` + `password`; "Forgot password" → `/forgot-password` (email → "Send Reset Link")
- **No Clerk** (no Clerk script, cookies, or `/v1/client` calls), **no OAuth providers**, **no Supabase Auth**.

Consequence: **the Neon database holds local password hashes** (a `users`-style
table with `email`, `password`/`passwordHash`, plus NextAuth's usual
`accounts`/`sessions`/`verificationTokens` tables if the Prisma/Drizzle adapter
is used; a pure Credentials setup may have only the users table). The hash
algorithm is almost certainly **bcrypt** (the Next.js/NextAuth credentials
convention; `bcryptjs` is the usual dependency) — **to be confirmed from a
sample hash prefix (`$2a$`/`$2b$`) via the read-only connection**. Password
reset is email-token based (own table or a `resetToken`/`resetTokenExpiry` pair
on users).

## 3. The user model, from the public registration form

`/register` posts a server action with: `role` ∈ **Parent / Guardian | Player
| Coach**, `name`, `email`, `password`, `confirmPassword`, `contactPhone`,
and **`teamIds[]`** (one checkbox per team — 67 teams listed, from "U05 Lions"
to "Vets O45 Men's XI"). So the legacy model has at least:

- `users` (name, email, password hash, phone, role — three values; "Staff
  login" suggests admins/staff are a further role or flag)
- `teams` (67 live rows; names carry age group and gender — "U13 Owls Girls")
- a user↔team link (many-to-many from the form)
- `/recruitment` (public): teams flagged recruiting, with free-text session
  details, contacts, and a **waiting list / register-interest** form → a
  `recruitment`/`waiting_list` table
- behind auth, routes that exist (307, not 404, so the middleware matcher covers
  them; not individually proven): `/calendar` (the start URL — the booking
  grid), `/bookings`, `/pitches`, `/teams`, `/members`, `/admin`, `/settings`,
  `/fixtures`, `/reports`, `/invoices`, `/payments`

## 4. Mapping onto the unified schema (proposal for Adam)

| Legacy (expected) | Target | Rule |
|---|---|---|
| `users` | `auth.users` + `public.people` + `public.profiles` | one person per user; `dob` **NULL** (the form has no DOB — SG-0 treats everyone as a minor until an admin enters it; see P3.2 §3) — `first_name`/`last_name` via `split_person_name()` exactly as P1.2 did |
| `users.role = Parent / Guardian` | `person_roles` → **no role**; guardianship links cannot be derived (the form has no child) — `parent` is never a role (§1.3) | left for registration (P2.2) to establish real links |
| `users.role = Player` | `person_roles.member`; `team_memberships(role player)` for each linked team in the current season | SG-6 composition guard will refuse a minor on a team whose coach lacks certifications — **expect refusals; import coaches' certifications first or import memberships as `left_at = now()` history** (decision for Adam) |
| `users.role = Coach` | `person_roles.coach` + `team_memberships(role coach)` | SG-6 staff guard applies: only if `certifications` rows exist; otherwise import as history |
| staff/admin flag | `person_roles.club_admin` / `staff` | mapping confirmed from data |
| `teams` | `public.teams` (name, `age_group` parsed from the prefix, gender parsed from "Girls"/"Ladies"/"Women") | 67 rows; dedupe against any team created since |
| `pitches` | `public.resources(type = 'pitch')` | `default_pre/post_buffer_minutes` 0 |
| `bookings` | `public.bookings(kind = 'hire' or 'block', status, starts_at/ends_at, booker_person_id)` | `legacy_*`-style id column to add (`legacy_neon_booking_id`) for reconciliation, same pattern as P1.6 |
| payments / invoices | `public.payments(kind = 'hire' …)` | sum of amounts reconciled |
| fixtures (if stored) | `public.fixtures(source = 'manual')` | only if Full-Time refs are absent |
| recruitment / waiting list | new small table `recruitment_interest` (P3.3) | public form keeps working from the new app |
| NextAuth `sessions`, `verificationTokens` | dropped | sessions are re-established by login |

Identity rule carried over from P1.2: **never auto-link by email**. An
imported user whose email matches an existing `people` row (e.g. a
function-room hirer) becomes a *new* person; merging is a human act.

## 5. Requires the read-only connection

- the actual table list, columns and constraints (`\d+` per table)
- row counts per table; `sum(amount)` for payments/invoices; date ranges
- one password hash prefix (bcrypt vs argon2 vs scrypt) and whether NextAuth
  adapter tables exist
- whether DOB exists anywhere (it is not on the public form)
- Stripe references on payments/invoices (to keep webhook history coherent)

## 6. Approval

- [ ] Adam confirms §2 (auth) and the mapping rules in §4, in particular the
  SG-6 handling of imported memberships and the DOB-unknown consequence.
- [ ] Adam provides the two inputs in `docs/runbooks/P3-unblock.md`; §5 is then
  filled in and this file re-reviewed before P3.2.
