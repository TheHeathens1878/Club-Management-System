-- =============================================================================
-- The balance is chased three times, each send stamped once (20260915130000)
-- =============================================================================
--   A  the two new stamps exist and are nullable, beside the existing one
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(5);

select has_column('public', 'bookings', 'balance_reminder_sent_at', 'the two-week stamp is the existing column');
select has_column('public', 'bookings', 'balance_reminder_1w_sent_at', 'balance_reminder_1w_sent_at exists');
select has_column('public', 'bookings', 'balance_final_warning_sent_at', 'balance_final_warning_sent_at exists');
select col_is_null('public', 'bookings', 'balance_reminder_1w_sent_at', 'the one-week stamp is nullable');
select col_is_null('public', 'bookings', 'balance_final_warning_sent_at', 'the final-warning stamp is nullable');

select * from finish();
rollback;
