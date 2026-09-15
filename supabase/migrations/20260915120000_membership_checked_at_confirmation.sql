-- =============================================================================
-- The membership behind a member discount is checked, and the check is stamped
-- (2026-09-15)
-- =============================================================================
-- Adam, 2026-09-15: when confirming a booking the member discount should
-- default to £50 where the booker said they are a member, "with a date and
-- person stamped confirmation they've checked it". The desk ticks that it has
-- checked the membership before a discount goes on; the moment and the person
-- are kept here, and the booking page says who checked and when.
--
-- Rollback: alter table public.bookings
--             drop column member_checked_at,
--             drop column member_checked_by,
--             drop column member_checked_by_email;
-- =============================================================================

alter table public.bookings
  add column if not exists member_checked_at timestamptz,
  add column if not exists member_checked_by uuid references public.profiles (id) on delete set null,
  add column if not exists member_checked_by_email text;

comment on column public.bookings.member_checked_at is
  'When a member of staff confirmed they had checked the booker''s claimed membership before applying a member discount.';
comment on column public.bookings.member_checked_by is
  'Who checked the membership (profile), kept as null if that account is later removed.';
comment on column public.bookings.member_checked_by_email is
  'Who checked the membership, as written at the time — survives the account going.';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260915120000_membership_checked_at_confirmation',
                           'changes', array['bookings.member_checked_at', 'bookings.member_checked_by', 'bookings.member_checked_by_email']));

notify pgrst, 'reload schema';
