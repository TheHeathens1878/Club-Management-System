-- =============================================================================
-- A payment says what it was for (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13, on room hire: a non-refundable deposit — half the room
-- hire, at most £100 — is paid first and secures the room; the balance plus
-- the refundable security deposit is paid at least two weeks before the
-- booking.
--
-- The ledger could not tell those apart. `payments` held one column of
-- money per booking, and the security deposit — held, not earned, and
-- returned after the party — was never payable online at all because it
-- would have counted as the hire being paid. Now a row carries its
-- `purpose`: 'deposit', 'balance' or 'security_deposit'. NULL is an older
-- row, or a manual one the desk did not label, and is hire money as before.
--
-- Nothing else changes here: the deposit rule (half the hire, capped) lives
-- in site_settings and the app; the due dates are the columns 20260823100000
-- already gave bookings.
--
-- Rollback: alter table public.payments drop column purpose;
-- =============================================================================

alter table public.payments
  add column if not exists purpose text;

alter table public.payments
  drop constraint if exists payments_purpose_known,
  add constraint payments_purpose_known
    check (purpose is null or purpose in ('deposit', 'balance', 'security_deposit'));

comment on column public.payments.purpose is
  'What a room-hire payment was for: deposit (non-refundable, secures the room), balance, or security_deposit (held, returned after the event). NULL = hire money from before 20260913140000 or an unlabelled manual row.';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'payments',
        jsonb_build_object('migration', '20260913140000_a_payment_says_what_it_was_for',
                           'changes', array['payments.purpose: deposit | balance | security_deposit | null']));

notify pgrst, 'reload schema';
