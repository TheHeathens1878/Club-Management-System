# `@club/web` — AoM Sports Club web app

Next.js 15 (App Router) / React 19 / Tailwind 3, deployed on Vercel, talking to the
Supabase project `aomsc-function-room` (`rwpglslbkhsqyxjhnpue`).

## What was imported (P0.4)

The whole live function-room booking app was lifted from
`AoM-Sports-Club-Function-Room` into this workspace package unchanged — same routes,
same server actions, same Supabase queries, same RLS/audit-log conventions.

Only the source repo's `src/` tree was live. Its root-level `app/`, `components/` and
`lib/` directories were empty leftovers from an older layout (no tracked files) and were
not imported. Its `supabase/migrations/` are historical and are already represented by
`supabase/migrations/20260821000000_baseline.sql` at the repo root, so they were not
copied either. `package.json` referenced `scripts/import-members.ts` and
`scripts/set-admin.ts`, but no `scripts/` directory exists in the source repo; those
scripts and their `tsx`/`dotenv` dev dependencies were dropped.

The import was untyped; that is history now. The Supabase clients in
`src/lib/supabase/` (`server.ts`, `admin.ts`, the browser client) are typed against
`@club/db`'s generated `Database`, and `src/lib/types.ts` derives its role vocabulary
from the generated enums. One untyped client survives — `legacy.ts`, a service-role
client for a handful of imported call sites (`settings/actions.ts`, `super-users/actions.ts`,
`login/actions.ts`, `email-templates/actions.ts`, `lib/login-history.ts`) that still address
tables and columns the schema does not have; its header lists them. Delete each use as the
schema and the app are reconciled.

## Layout

| Path | Contents |
|---|---|
| `src/app/(app)/` | Staff area: room bookings, rooms, bar, email templates, settings, super users |
| `src/app/book/`, `src/app/portal/` | Public booking form and the booker's self-service portal |
| `src/app/auth/`, `src/app/login/` | Magic-link callback, set-password, sign-out |
| `src/app/api/` | Cron + SumUp webhook route handlers |
| `src/components/` | Shared UI (`ui/` primitives, nav, notice bell, push prompt) |
| `src/lib/` | Supabase clients (browser / server / service-role admin), email + calendar via Microsoft Graph, SumUp, push, settings, audit log, template engine |
| `src/middleware.ts` | Session refresh + the public-route allowlist |
| `public/` | favicon |
| `docs/` | `PAYMENTS_AND_BOOKER_PORTAL.md` (imported design notes) |

Path alias `@/*` → `./src/*`.

## Cron routes

`vercel.json` in this directory holds the app's Vercel Cron schedule:

| Path | Schedule | What it does |
|---|---|---|
| `/api/cron/payment-reminders` | `0 9 * * *` (daily 09:00 UTC) | Sends deposit and balance reminder emails and auto-cancels unpaid-deposit bookings |
| `/api/cron/finance-billing` | `30 7 * * *` (daily 07:30 UTC) | Runs `run_billing_cycle()`, collects due charges from stored cards through `collectChargeFromStoredCard()` (claimed in `collection_attempts` before SumUp is asked), and emails each lead member a receipt or a "please pay" |

Both routes require `CRON_SECRET` and reject the request unless Vercel presents it as a
Bearer token; they return 500 if the variable is unset. `middleware.ts` lets `/api/cron/*`
through without a session for exactly this reason.

`/api/sumup/webhook` (public in middleware, idempotent by checkout id) records SumUp
payments for both bookings and finance charges; it answers 5xx when a ledger write fails
so SumUp redelivers.

## Environment

See `.env.example` in this directory for the full annotated list; every variable the app
reads is documented there. Summary:

- **Required**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server-only), `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.
- **Microsoft Graph** (booking email + Outlook calendar sync): `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `MAIL_FROM`, `CALENDAR_USER`.
- **Web push**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
- **SumUp** (booker portal payments): `SUMUP_MERCHANT_CODE`, `SUMUP_API_KEY` *or*
  `SUMUP_CLIENT_ID` + `SUMUP_CLIENT_SECRET`, `SUMUP_API_BASE`.
- **Stripe** (legacy, no longer in the booker flow): `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`.

`next build` needs none of these to hold real values — the Graph, push, SumUp and Stripe
integrations all degrade to "not configured" no-ops, and `getSettings()` falls back to
its built-in defaults if Supabase is unreachable. CI runs lint, typecheck and the vitest
suite (`.github/workflows/ci.yml`); the build itself is Vercel's, on every PR preview and
on `main`.

## Commands

```sh
pnpm --filter @club/web dev        # next dev
pnpm --filter @club/web build      # next build
pnpm --filter @club/web lint       # eslint src (repo flat config)
pnpm --filter @club/web typecheck  # tsc --noEmit
pnpm --filter @club/web test       # vitest (src/**/*.test.ts — pure library units)
```

`lint` uses the repo's flat config (`eslint.config.mjs` extending the root one), not the
legacy `next lint` the source repo used. Two relaxations are scoped to `src/**` and are
documented inline in `eslint.config.mjs`: `@typescript-eslint/no-unused-vars` is a warning
(the count is kept at zero), and `@typescript-eslint/no-unused-expressions` allows ternary
statements. `tsconfig.json` has `noUncheckedIndexedAccess` on, like the rest of the repo.

## History

The Vercel project was repointed at this package on 2026-08-23 (`club-management-web`,
`portal.aomsportsclub.co.uk`); the old `AoM-Sports-Club-Function-Room` deployment is
retired. Earlier notes on the P0.4 import and the deferred repoint are in `DECISIONS.md`
and PLAN.md §4.
