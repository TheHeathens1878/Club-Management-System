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

Nothing in the app was refactored onto `@club/shared` / `@club/db`. `src/lib/types.ts`
is a set of hand-written domain interfaces, not a copy of the generated `Database` type,
so there was no drop-in replacement to make. The Supabase clients in
`src/lib/supabase/` are the app's own (untyped) ones. Wiring the app to `@club/db`
types belongs with the Phase 1 schema work.

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

The route requires `CRON_SECRET` and rejects the request unless Vercel presents it as a
Bearer token; it returns 500 if the variable is unset. `middleware.ts` lets `/api/cron/*`
through without a session for exactly this reason.

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
its built-in defaults if Supabase is unreachable. CI builds with placeholders.

## Commands

```sh
pnpm --filter @club/web dev        # next dev
pnpm --filter @club/web build      # next build
pnpm --filter @club/web lint       # eslint src (repo flat config)
pnpm --filter @club/web typecheck  # tsc --noEmit
```

`lint` uses the repo's flat config (`eslint.config.mjs` extending the root one), not the
legacy `next lint` the source repo used. Two relaxations are scoped to `src/**` for the
imported code and are documented inline in `eslint.config.mjs`:
`@typescript-eslint/no-unused-vars` is a warning (4 dead locals), and
`@typescript-eslint/no-unused-expressions` allows ternary statements (1 site).
`tsconfig.json` also turns `noUncheckedIndexedAccess` back off for this package; the
imported code predates it.

## Not yet done

Vercel still deploys this app from the old `AoM-Sports-Club-Function-Room` repo. The
repoint (project root → `apps/web`, build command → the pnpm/Turborepo one, env vars
carried over) is deliberately deferred — see `DECISIONS.md`.
