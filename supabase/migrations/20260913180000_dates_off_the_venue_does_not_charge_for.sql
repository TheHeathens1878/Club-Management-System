-- =============================================================================
-- Dates off the venue does not charge for (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13: "If we put dates off, we should have the ability to say
-- we're not getting charged, as often we don't."
--
-- A block's dates off (training_blackouts — Christmas, half-term) stop
-- sessions being created. Whether the venue still charges for those weeks
-- is a separate fact, and it is the venue's, so it sits on the dates off:
-- `charged` is true unless the planner says the venue is not charging. The
-- Finance venue-hire report and a venue's booking totals leave the sessions
-- that fall in an uncharged break out of what the club pays, for every venue
-- the block lists.
--
-- Rollback: alter table public.training_blackouts drop column charged;
-- =============================================================================

alter table public.training_blackouts
  add column if not exists charged boolean not null default true;

comment on column public.training_blackouts.charged is
  'Whether the venue still charges for these dates; false = the club is not billed for sessions that fall in them.';

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'training_blackouts',
        jsonb_build_object('migration', '20260913180000_dates_off_the_venue_does_not_charge_for',
                           'changes', array['training_blackouts.charged (default true)']));

notify pgrst, 'reload schema';
