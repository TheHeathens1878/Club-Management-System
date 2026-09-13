-- =============================================================================
-- A booked slot has a price (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13: "I want the ability to put price alongside the bookings
-- slot and create a report in Money for it."
--
-- The price is PER SESSION — what one Monday 6–7 on Pitch 1 costs the club.
-- A booking runs from a first date to a last date, so the cost of a slot is
-- its price times the number of that weekday between them, and the report
-- under Finance adds those up by venue and by season. Nothing is invoiced
-- from here; it is what the club has agreed to pay, for the treasurer.
--
-- Rollback: alter table public.venue_booking_slots drop column price_pence;
-- =============================================================================

alter table public.venue_booking_slots
  add column if not exists price_pence integer check (price_pence is null or price_pence >= 0);

comment on column public.venue_booking_slots.price_pence is
  'What one session of this slot costs the club, in pence; null = not priced yet.';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'venue_booking_slots',
        jsonb_build_object('migration', '20260913170000_a_booked_slot_has_a_price',
                           'changes', array['venue_booking_slots.price_pence — per session']));

notify pgrst, 'reload schema';
