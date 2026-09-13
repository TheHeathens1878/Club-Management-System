-- =============================================================================
-- A booker accepts a quote (2026-09-13)
-- =============================================================================
-- Leanne Minto signed in five times today to "confirm the booking" and found
-- nothing to press: a quoted booking in the portal was an amber chip and no
-- more, and the quote email said "reply or contact the club". Now the portal
-- offers "Accept this quote": the booking is confirmed subject to the
-- deposit, exactly as when the desk presses Confirm, and the moment is kept
-- here so the desk can see it was the booker who went ahead.
--
-- Rollback: alter table public.bookings drop column quote_accepted_at;
-- =============================================================================

alter table public.bookings
  add column if not exists quote_accepted_at timestamptz;

comment on column public.bookings.quote_accepted_at is
  'When the booker accepted the quote in their portal, confirming the booking themselves (subject to the deposit).';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260913190000_a_booker_accepts_a_quote',
                           'changes', array['bookings.quote_accepted_at']));

notify pgrst, 'reload schema';
