-- =============================================================================
-- The balance is chased three times: two weeks before it is due, one week
-- before, and a final warning on the day (2026-09-15)
-- =============================================================================
-- Adam, 2026-09-15: "remind the booker 2 weeks before if not paid, 1 week
-- before if not paid, and a final warning on the due date saying that the
-- booking will be cancelled if not paid today." Until now one reminder went,
-- on the due date itself, and nothing followed it.
--
-- bookings.balance_reminder_sent_at (already there) becomes the two-week
-- stamp; these two carry the one-week reminder and the final warning. The
-- 09:00 cron sends each once, and cancels the booking the day after the due
-- date if the hire balance is still owed — the warning is not a bluff.
--
-- Rollback: alter table public.bookings
--             drop column balance_reminder_1w_sent_at,
--             drop column balance_final_warning_sent_at;
-- =============================================================================

alter table public.bookings
  add column if not exists balance_reminder_1w_sent_at timestamptz,
  add column if not exists balance_final_warning_sent_at timestamptz;

comment on column public.bookings.balance_reminder_sent_at is
  'When the two-weeks-before balance reminder went (20260915130000: was the only balance reminder, sent on the due date).';
comment on column public.bookings.balance_reminder_1w_sent_at is
  'When the one-week-before balance reminder went.';
comment on column public.bookings.balance_final_warning_sent_at is
  'When the due-date final warning went — the booking is cancelled the next morning if the hire balance is still unpaid.';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260915130000_balance_reminders_two_weeks_one_week_final',
                           'changes', array['bookings.balance_reminder_1w_sent_at', 'bookings.balance_final_warning_sent_at']));

notify pgrst, 'reload schema';
