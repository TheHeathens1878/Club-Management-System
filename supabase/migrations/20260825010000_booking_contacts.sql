-- =============================================================================
-- booking_contacts — the function room's own contacts book (2026-08-25)
-- =============================================================================
-- Adam: "create a separate contacts table for room booking contacts, these
-- should not be included in the main (members) contacts database."
--
-- A hire contact is not a member record. The bookings row has always carried a
-- snapshot (booker_name/email/phone) precisely so a hire never depends on
-- `people` — this table is the desk's view over those snapshots: one row per
-- contact, deduplicated by email, so staff can find "the woman who booked the
-- christening" without her ever entering the members database. The People
-- screen stops listing hirers in the same change, app-side.
--
-- What this deliberately does NOT do:
--   * No link to `people`. Ever. Matching a hirer to a member by email is the
--     rule P1.2 set and P1.6 kept ("a hire contact snapshot is not a member
--     record"); it holds here too.
--   * No change to the portal login flow. A hirer's auth account (and the
--     person row the profile triggers mint for it) is P0.4 lift-and-shift
--     debt, out of scope — the members database simply stops SHOWING them.
--   * The snapshot columns stay the source of truth on each booking (emails,
--     SumUp, exports all read them); `contact_id` is the grouping, not a
--     replacement.
--
-- RLS: the function-room desk's table — staff + club_admin read/write, nobody
-- deletes through the API (service_role only). Mirrors `bookings` itself.
--
-- ROLLBACK: alter table public.bookings drop column contact_id;
--           drop table public.booking_contacts;
-- =============================================================================

create table public.booking_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint booking_contacts_name_not_blank check (btrim(name) <> ''),
  constraint booking_contacts_email_shape
    check (email is null or position('@' in email) > 1)
);

comment on table public.booking_contacts is
  'Function-room hire contacts — the room''s own address book, deliberately separate from the members database (public.people). One row per contact, deduplicated by email.';

-- One contact per email address; email-less contacts may repeat by name.
create unique index booking_contacts_email_idx
  on public.booking_contacts (lower(email)) where email is not null;

create trigger trg_booking_contacts_updated
  before update on public.booking_contacts
  for each row execute function public.set_updated_at();

alter table public.bookings
  add column contact_id uuid references public.booking_contacts (id) on delete set null;
create index bookings_contact_idx on public.bookings (contact_id) where contact_id is not null;
comment on column public.bookings.contact_id is
  'The hire contact this booking belongs to. Grouping only — the booker_* snapshot stays the record of who booked, exactly as before.';

-- ---------------------------------------------------------------------------
-- RLS + grants (the booking_teams pattern: staff desk table)
-- ---------------------------------------------------------------------------
alter table public.booking_contacts enable row level security;

create policy "booking_contacts_staff_all" on public.booking_contacts
  for all to authenticated
  using (public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  with check (public.has_any_role(array['staff', 'club_admin']::public.app_role[]));

revoke all privileges on public.booking_contacts from anon, authenticated, service_role;
grant select, insert, update on public.booking_contacts to authenticated;
grant select, insert, update, delete on public.booking_contacts to service_role;

-- ---------------------------------------------------------------------------
-- Backfill: one contact per email across every function-room booking, the
-- newest booking's details winning; then point the bookings at them. Rows
-- with no usable email (staff-entered "—", block bookings' "Club") stay
-- snapshot-only, exactly as P1.6 left the 10 login-less legacy hirers.
-- ---------------------------------------------------------------------------
insert into public.booking_contacts (name, first_name, last_name, email, phone)
select distinct on (lower(b.booker_email))
       b.booker_name, b.booker_first_name, b.booker_last_name, b.booker_email, b.booker_phone
from public.bookings b
join public.resources r on r.id = b.resource_id and r.type = 'function_room'
where b.booker_email is not null
  and position('@' in b.booker_email) > 1
  and btrim(b.booker_name) <> ''
  and b.booker_name <> '(unknown)'
order by lower(b.booker_email), b.created_at desc;

update public.bookings b
   set contact_id = c.id
  from public.booking_contacts c
 where b.contact_id is null
   and b.booker_email is not null
   and lower(b.booker_email) = lower(c.email)
   and exists (select 1 from public.resources r
               where r.id = b.resource_id and r.type = 'function_room');

do $$
declare
  v_contacts bigint;
  v_linked bigint;
begin
  select count(*) into v_contacts from public.booking_contacts;
  select count(*) into v_linked from public.bookings where contact_id is not null;
  perform public.write_audit(
    'booking_contacts.backfill', 'booking_contacts', null::text,
    jsonb_build_object('contacts', v_contacts, 'bookings_linked', v_linked));
end $$;

notify pgrst, 'reload schema';
