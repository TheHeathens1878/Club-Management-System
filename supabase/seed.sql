-- Local-development seed. Populated from P1 onwards. Never run against production.

-- pgTAP, for `supabase test db` (P1.1 onwards). Deliberately seeded rather than
-- migrated: the test framework has no business existing on the hosted project,
-- and seed.sql is the only file that runs locally and in CI but never in a
-- `db push`. Installed into `extensions` (not `public`) so that
-- `supabase db lint --local` — which lints schema `public` — does not try to
-- plpgsql_check ~1000 pgTAP functions.
create extension if not exists pgtap with schema extensions;
