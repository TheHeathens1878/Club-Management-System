# Phase 3 — what Claude needs from Adam to start

Phase 3 (Neon pitch-booking migration) was blocked on two inputs as of
2026-08-23. **Input 1 is done** (repo cloned to `C:/Projects/aom-fc-pitch-booking`
later that day; git's stored credential could reach it). **Input 2 is still
outstanding.** Nothing in Phases 4–6 depends on it, so work continued there.

1. **The Neon app's source code.** `CLAUDE.md` expects it at
   `C:/Projects/aom-fc-pitch-booking` (and `.claude/settings.json` already
   lists that path), but the folder does not exist on this machine and the
   GitHub token sees only `Club-Management-System`. Either clone it there, or
   grant the fine-grained PAT read access to the repo and tell Claude its
   name.
2. **A read-only Neon connection string.** Put it in
   `C:/Projects/Club-Management-System/.env.neon` as
   `NEON_DATABASE_URL=postgresql://…` (the file is git-ignored — check
   `.gitignore` has `.env*`). A read-only role is strongly preferred
   (`CREATE ROLE claude_ro LOGIN PASSWORD '…'; GRANT CONNECT …; GRANT USAGE ON
   SCHEMA public …; GRANT SELECT ON ALL TABLES IN SCHEMA public …`). Claude
   never writes to Neon (CLAUDE.md).

With both in place, P3.1 produces `MIGRATION_MAP.md` (every table, row
counts, the auth mechanism with evidence, and the mapping onto `people`,
`auth.users`, `resources` (pitches), `bookings`, `payments`) for Adam's
approval before P3.2.
