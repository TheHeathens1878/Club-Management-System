-- =============================================================================
-- The club gains a treasurer (Adam, 2026-09-04: "We will need a dedicated
-- finance user")
--
-- A new `finance` value on `public.app_role`. The finance section being built
-- in the migrations that follow is gated on club_admin OR finance, so the
-- treasurer can run subs, charges, reports and Xero exports without holding
-- the keys to everything else (roles, safeguarding, messaging stay closed).
--
-- The enum values land ALONE in this migration on purpose: Postgres refuses
-- "unsafe use of new value" when an enum value added inside a transaction is
-- used by the same transaction, and the Supabase CLI wraps each migration in
-- one. `is_finance()` and every policy that names the values follow in
-- 20260904170000 onwards.
--
-- `payment_kind` gains 'charge' at the same time: the finance build gives the
-- payments ledger a third link (charges — membership fees, subs instalments,
-- fines) alongside bookings and the Stripe-shaped subscriptions, and the
-- derive-the-kind trigger needs the value to exist before 20260904180000
-- teaches it the new branch.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy here — the role
-- grants nothing until later migrations attach policies to it); data touched:
-- none; rollback: enum values cannot be dropped — revoke any grants instead:
--   update public.person_roles set revoked_at = now() where role = 'finance';
-- =============================================================================

alter type public.app_role add value if not exists 'finance';
alter type public.payment_kind add value if not exists 'charge';
