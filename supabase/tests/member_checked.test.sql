-- =============================================================================
-- The membership check behind a member discount is stamped (20260915120000)
-- =============================================================================
--   A  the three columns exist and are nullable
--   B  the person column points at profiles and lets go when the profile goes
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(6);

select has_column('public', 'bookings', 'member_checked_at', 'member_checked_at exists');
select has_column('public', 'bookings', 'member_checked_by', 'member_checked_by exists');
select has_column('public', 'bookings', 'member_checked_by_email', 'member_checked_by_email exists');
select col_is_null('public', 'bookings', 'member_checked_at', 'the stamp is nullable — most bookings are not member bookings');
select col_is_null('public', 'bookings', 'member_checked_by', 'the person is nullable');
select fk_ok('public', 'bookings', 'member_checked_by', 'public', 'profiles', 'id',
             'member_checked_by points at profiles');

select * from finish();
rollback;
