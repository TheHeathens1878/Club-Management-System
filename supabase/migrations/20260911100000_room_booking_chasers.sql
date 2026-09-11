-- =============================================================================
-- Two chasers for a room that was asked about and never taken (Adam, 2026-09-11)
-- =============================================================================
-- "Create a chaser email for quoted and enquiries, asking if they still want
--  the room. Also create a final chaser email where we will deduct 50% off
--  the room. The final chaser email needs to amend the quote and include
--  these details in the email. It should be initiated by staff members."
--
-- Both are desk buttons on the booking page, not cron jobs: the first can go
-- as often as the desk likes and only asks; the second halves the room hire,
-- rewrites total_pence to the new price, moves the row to `quoted`, and goes
-- once. Three columns record that they went, so the page can say so and the
-- second cannot go twice.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — three columns on a table
-- whose policies are unchanged; data touched: none on push; rollback: drop
-- the three columns.
-- =============================================================================

alter table public.bookings
  add column if not exists chaser_sent_at timestamptz,
  add column if not exists final_chaser_sent_at timestamptz,
  add column if not exists final_chaser_discount_pence integer
    check (final_chaser_discount_pence is null or final_chaser_discount_pence >= 0);

comment on column public.bookings.chaser_sent_at is
  'When the desk last asked an enquirer or a quoted booker whether they still want the room. Re-sendable; the latest send wins.';
comment on column public.bookings.final_chaser_sent_at is
  'When the desk sent the last-chance offer: half off the room hire, the quote amended to match. Goes once per booking.';
comment on column public.bookings.final_chaser_discount_pence is
  'The pence taken off total_pence by the final chaser, so the page and the confirmation can say what the offer was.';
