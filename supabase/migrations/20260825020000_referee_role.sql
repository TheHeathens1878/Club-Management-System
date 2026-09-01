-- =============================================================================
-- The referee hat (2026-08-25)
-- =============================================================================
-- Adam: adults may message players aged 14+ "if they are classed as a referee
-- (so we need that role adding)". The value lands alone, in its own migration,
-- because a new enum value cannot be used in the same transaction that adds it
-- — the recipe 20260822130000_roles.sql set down for exactly this moment.
-- Everything that USES the role (the Referees group, the messaging age rule,
-- the granting UI) follows in the next migration.
--
-- ROLLBACK: enum values cannot be dropped; revoke any grants instead:
--   update public.person_roles set revoked_at = now() where role = 'referee';
-- =============================================================================

alter type public.app_role add value if not exists 'referee';
