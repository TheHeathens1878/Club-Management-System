-- =============================================================================
-- Gaps 8 + 10 (post-P3.4) — booking availability/attendance; team recruiting
-- =============================================================================
-- 8. The fixture model already has `availability` (per fixture, per person)
--    and `selections`. Training sessions and other team bookings had nothing:
--    the Neon BookingAvailability/TrainingAvailability and *Attendance models
--    were not migrated. This adds the same two ideas keyed on `bookings`:
--      * booking_availability — "can you make it" per (booking, person),
--        written by the person or their guardian (can_act_for), team staff
--        or club_admin; read by those plus the team's staff.
--      * booking_attendance — the sheet ticked by team staff after the
--        session: present/absent/late + note. Staff and admin only; the
--        subject (or their guardian) may read their own row.
--    Both use team scope = bookings.team_id ∪ booking_teams.
--
-- 10. Teams gain the recruiting fields the Neon /recruitment page showed:
--     gender, recruiting flag, join_type, join_instructions, session_details,
--     contact fields, show_coach_contact. Backfilled from neon_legacy."Team"
--     where present. `recruiting_teams()` is the public (anon) accessor that
--     exposes only what the team chose to show.
--
-- Rollback: drop table booking_attendance, booking_availability (+ the
-- helper functions); drop function recruiting_teams; alter table teams drop
-- the eight columns.
-- =============================================================================


-- Helpers ---------------------------------------------------------------------------
create or replace function public.booking_team_ids(p_booking_id uuid)
  returns uuid[]
  language sql
  stable
  security definer
  set search_path = public
as $$
  select array_remove(array_agg(t), null) from (
    select b.team_id as t from public.bookings b where b.id = p_booking_id
    union
    select bt.team_id from public.booking_teams bt where bt.booking_id = p_booking_id
  ) x;
$$;

create or replace function public.is_staff_of_booking(p_booking_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from unnest(public.booking_team_ids(p_booking_id)) t
    where public.is_team_staff(t)
  );
$$;

create or replace function public.is_member_of_booking(p_person_id uuid, p_booking_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.person_id = p_person_id and m.left_at is null
      and m.team_id = any (public.booking_team_ids(p_booking_id))
  );
$$;

revoke all privileges on function public.booking_team_ids(uuid) from public, anon;
revoke all privileges on function public.is_staff_of_booking(uuid) from public, anon;
revoke all privileges on function public.is_member_of_booking(uuid, uuid) from public, anon;
grant execute on function public.booking_team_ids(uuid) to authenticated, service_role;
grant execute on function public.is_staff_of_booking(uuid) to authenticated, service_role;
grant execute on function public.is_member_of_booking(uuid, uuid) to authenticated, service_role;


-- 8a. booking_availability ------------------------------------------------------------
create table public.booking_availability (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  status      public.availability_status not null,
  note        text,
  set_by      uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (booking_id, person_id)
);
create index booking_availability_person_idx on public.booking_availability (person_id);
create trigger trg_booking_availability_updated
  before update on public.booking_availability
  for each row execute function public.set_updated_at();
comment on table public.booking_availability is
  'Can-you-make-it per (team booking, person): training and other team bookings. Fixtures use public.availability.';

alter table public.booking_availability enable row level security;
create policy "booking_availability_read" on public.booking_availability for select to authenticated
  using (public.can_act_for(person_id)
         or public.is_staff_of_booking(booking_id)
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "booking_availability_insert" on public.booking_availability for insert to authenticated
  with check (public.is_member_of_booking(person_id, booking_id)
              and (public.can_act_for(person_id) or public.is_club_admin() or public.is_staff_of_booking(booking_id)));
create policy "booking_availability_update" on public.booking_availability for update to authenticated
  using (public.can_act_for(person_id) or public.is_club_admin() or public.is_staff_of_booking(booking_id))
  with check (public.can_act_for(person_id) or public.is_club_admin() or public.is_staff_of_booking(booking_id));
create policy "booking_availability_delete" on public.booking_availability for delete to authenticated
  using (public.can_act_for(person_id) or public.is_club_admin());
revoke all privileges on public.booking_availability from anon, authenticated, service_role;
grant select, insert, update, delete on public.booking_availability to authenticated, service_role;


-- 8b. booking_attendance -----------------------------------------------------------------
create type public.attendance_status as enum ('present', 'absent', 'late');

create table public.booking_attendance (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  status      public.attendance_status not null,
  note        text,
  marked_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (booking_id, person_id)
);
create index booking_attendance_person_idx on public.booking_attendance (person_id);
create trigger trg_booking_attendance_updated
  before update on public.booking_attendance
  for each row execute function public.set_updated_at();
comment on table public.booking_attendance is
  'Attendance sheet per team booking (training, fixtures via bookings.fixture_id, other): marked by team staff.';

alter table public.booking_attendance enable row level security;
create policy "booking_attendance_read" on public.booking_attendance for select to authenticated
  using (public.can_act_for(person_id)
         or public.is_staff_of_booking(booking_id)
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "booking_attendance_staff_write" on public.booking_attendance for all to authenticated
  using (public.is_club_admin() or public.is_staff_of_booking(booking_id))
  with check (public.is_member_of_booking(person_id, booking_id)
              and (public.is_club_admin() or public.is_staff_of_booking(booking_id)));
revoke all privileges on public.booking_attendance from anon, authenticated, service_role;
grant select, insert, update, delete on public.booking_attendance to authenticated, service_role;


-- 10. Team recruiting fields -----------------------------------------------------------------
alter table public.teams
  add column if not exists gender            text check (gender is null or gender in ('mixed', 'boys', 'girls')),
  add column if not exists recruiting        boolean not null default false,
  add column if not exists join_type         text check (join_type is null or join_type in ('open', 'waiting_list', 'trial', 'closed')),
  add column if not exists join_instructions text,
  add column if not exists session_details   text,
  add column if not exists contact_name      text,
  add column if not exists contact_email     text,
  add column if not exists contact_phone     text,
  add column if not exists show_coach_contact boolean not null default false;

comment on column public.teams.recruiting is 'Shown on the public /recruitment page when true.';
comment on column public.teams.show_coach_contact is 'Whether contact_* are exposed on the public recruitment page.';

-- Backfill from the Neon import where the legacy schema holds rows.
update public.teams t
   set gender = case upper(coalesce(nt."teamGender"::text, '')) when 'MIXED' then 'mixed' when 'BOYS' then 'boys' when 'MALE' then 'boys'
                     when 'GIRLS' then 'girls' when 'FEMALE' then 'girls' else t.gender end,
       recruiting      = coalesce(nt."isRecruiting", t.recruiting),
       session_details = coalesce(nullif(btrim(nt."sessionDetails"), ''), t.session_details),
       contact_name    = coalesce(nullif(btrim(nt."contactName"), ''), t.contact_name),
       contact_email   = coalesce(nullif(btrim(nt."contactEmail"), ''), t.contact_email),
       contact_phone   = coalesce(nullif(btrim(nt."contactPhone"), ''), t.contact_phone)
  from neon_legacy."Team" nt
 where t.legacy_neon_team_id = nt.id;

-- Public accessor: anon sees only recruiting teams and only what they chose to show.
create or replace function public.recruiting_teams()
  returns table (
    id uuid, name text, age_group text, gender text, join_type text, join_instructions text,
    session_details text, contact_name text, contact_email text, contact_phone text
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select t.id, t.name, t.age_group, t.gender, t.join_type, t.join_instructions, t.session_details,
         case when t.show_coach_contact then t.contact_name  end,
         case when t.show_coach_contact then t.contact_email end,
         case when t.show_coach_contact then t.contact_phone end
  from public.teams t
  where t.active and t.recruiting
  order by t.sort_order, t.name;
$$;
revoke all privileges on function public.recruiting_teams() from public;
grant execute on function public.recruiting_teams() to anon, authenticated, service_role;

-- Team staff may edit their own team's recruiting block (not name/age group).
create or replace function public.teams_staff_update_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  if current_user <> 'authenticated' or auth.uid() is null or public.is_club_admin() then
    return new;
  end if;
  if new.name <> old.name or new.age_group is distinct from old.age_group
     or new.active <> old.active or new.sort_order <> old.sort_order
     or new.notes is distinct from old.notes
     or new.legacy_neon_team_id is distinct from old.legacy_neon_team_id then
    raise exception 'teams: only a club administrator can change a team''s name, age group or status' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all privileges on function public.teams_staff_update_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_teams_staff_update_guard on public.teams;
create trigger trg_teams_staff_update_guard
  before update on public.teams
  for each row execute function public.teams_staff_update_guard();

create policy "teams_staff_update" on public.teams for update to authenticated
  using (public.is_team_staff(id)) with check (public.is_team_staff(id));
