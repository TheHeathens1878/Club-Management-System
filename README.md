# AoM Sports Club Platform

Monorepo for the consolidated club platform (bookings, CRM, messaging, staff ops).
See [PLAN.md](PLAN.md) for phases and hard rules.

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js web app (Vercel) — the function-room booking app, imported in P0.4. See [apps/web/README.md](apps/web/README.md) for its layout, env vars and cron routes |
| `apps/mobile` | Expo app (iOS + Android, EAS) |
| `packages/shared` | `@club/shared` — Supabase client factory, zod schemas, utils |
| `packages/db` | `@club/db` — generated Database types (`supabase gen types`) |
| `supabase/` | Supabase CLI config, migrations, edge functions |

## Getting started

```sh
npm i -g pnpm@10        # or: corepack enable (needs admin on Windows)
pnpm install
cp .env.example .env    # fill in values; see per-app .env.example too
pnpm dev
```

## Commands

```sh
pnpm lint        # eslint across workspace
pnpm typecheck   # tsc --noEmit across workspace
pnpm test        # vitest in packages
pnpm build
```

## Database

All schema changes are Supabase CLI migrations in `supabase/migrations/`, rehearsed on a
Supabase branch before merging. Every table ships with RLS. After any migration, regenerate
`packages/db/src/database.types.ts` in the same PR (PLAN §2.7).

### One-time CLI link (P0.2 — needs Adam's credentials)

The baseline `supabase/migrations/20260821000000_baseline.sql` was reconstructed from the live
prod catalogs and **must not be re-run against prod**. To finish linking:

```sh
npx supabase login                                   # or set SUPABASE_ACCESS_TOKEN
npx supabase link --project-ref rwpglslbkhsqyxjhnpue # prompts for the DB password
npx supabase migration repair --status applied 20260821000000
npx supabase db diff --linked                        # expect: no schema changes found
```

If the diff is not empty, amend the baseline (never prod) until it is, then commit.

## Web vs mobile (P6.5)

| Journey | Web (`apps/web`) | Mobile (`apps/mobile`) |
|---|---|---|
| Room / pitch hire bookings, public hire form | **web-first** (the only place) | not in v1 |
| Pitch allocation, Full-Time links, teams/seasons admin | web | opens the web pages (admin section) |
| My teams, fixtures + availability | web (team page) | native |
| Subs: view + pay | web (`/my-subs`) | native list, Stripe web checkout |
| Messaging | web (`/messages`, realtime) | native, push via Expo |
| Safeguarding concerns, media, comms preferences | web | report-a-concern only in v1 |

Push notifications deep-link into the app: `aomclub://messages/<conversation_id>`
(handled in `apps/mobile/lib/deep-link.ts`); magic links use
`aomclub://auth/callback`. Bookings stay web-first by design (PLAN §10 P6.5).
