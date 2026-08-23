-- =============================================================================
-- Gap 3 (post-P3.4) — `training` as a booking kind
-- =============================================================================
-- The Neon app had training sessions as a first-class thing; the import
-- flattened them to kind = 'block'. Coaches need to book training explicitly,
-- and the calendar needs to tell training from a closure. A new enum value
-- cannot be used in the transaction that adds it, so this migration only adds
-- it; 20260824120000_pitch_bookings.sql uses it.
-- Rollback: enum values cannot be dropped; leave it unused.
-- =============================================================================

alter type public.booking_kind add value if not exists 'training';
