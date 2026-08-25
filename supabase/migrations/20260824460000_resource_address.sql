-- =============================================================================
-- Venue addresses (Adam, 2026-08-24)
-- =============================================================================
-- "For home matches, it should use the address from manage venues for the
--  google maps link, and include this address in the Event Details."
--
-- One nullable column on `resources`, maintained on /pitches/manage (and open
-- to /room-bookings/rooms later if the function room wants it). No RLS change:
-- `resources_public_read` already returns active rows to any signed-in user,
-- which is right — a parent needs the address to follow the maps link.
--
-- Rollback: alter table public.resources drop column address;
-- =============================================================================

alter table public.resources
  add column if not exists address text
    check (address is null or char_length(address) between 1 and 300);

comment on column public.resources.address is
  'The venue''s postal address (street + postcode). Maps links for home fixtures and events use it in place of the pitch name; blank means null.';
