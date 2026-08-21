# AoM Sports Club Platform

Monorepo for the consolidated club platform (bookings, CRM, messaging, staff ops).
See [PLAN.md](PLAN.md) for phases and hard rules.

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js web app (Vercel) |
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
