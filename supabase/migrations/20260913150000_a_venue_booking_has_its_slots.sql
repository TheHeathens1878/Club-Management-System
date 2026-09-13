-- =============================================================================
-- A venue booking has its slots (2026-09-13)
-- =============================================================================
-- Adam, 2026-09-13, on the venue bookings that 20260913130000 added: "the
-- bookings need to have a section showing slots by days (and hours) instead
-- of When".
--
-- A booking at a hired venue is a set of weekly slots — Tuesdays 19:00 to
-- 20:00 and Thursdays 18:00 to 19:30 — between a first and a last date. The
-- free-text `when_text` said that in whatever words were typed; a row per
-- slot says it so the venues list can show "Tue, Thu" and a planner can one
-- day compare the block's slots with what the club has actually booked.
--
-- `when_text` goes: it shipped this morning and holds nothing on prod.
--
-- Rollback: drop table public.venue_booking_slots;
--           alter table public.venue_bookings add column when_text text;
-- =============================================================================

create table if not exists public.venue_booking_slots (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.venue_bookings (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  constraint venue_booking_slots_ends_after_start check (end_time > start_time)
);
create index if not exists venue_booking_slots_booking_idx on public.venue_booking_slots (booking_id, weekday, start_time);

comment on table public.venue_booking_slots is
  'The weekly slots a venue booking covers: weekday (0 = Sunday), start and end. Several per booking.';

alter table public.venue_booking_slots enable row level security;
drop policy if exists "venue_booking_slots_read" on public.venue_booking_slots;
create policy "venue_booking_slots_read" on public.venue_booking_slots
  for select to authenticated using (true);
drop policy if exists "venue_booking_slots_admin_write" on public.venue_booking_slots;
create policy "venue_booking_slots_admin_write" on public.venue_booking_slots
  for all to authenticated using (public.can_plan_training()) with check (public.can_plan_training());
revoke all privileges on public.venue_booking_slots from anon, authenticated, service_role;
grant select, insert, update, delete on public.venue_booking_slots to authenticated, service_role;

alter table public.venue_bookings drop column if exists when_text;

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'venue_bookings',
        jsonb_build_object('migration', '20260913150000_a_venue_booking_has_its_slots',
                           'changes', array['venue_booking_slots: weekday, start_time, end_time per booking',
                                            'venue_bookings.when_text dropped']));

notify pgrst, 'reload schema';
