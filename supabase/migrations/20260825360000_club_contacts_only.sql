-- =============================================================================
-- The people list is the club's people, not the function room's customers
-- =============================================================================
-- Adam, 2026-08-25: "There are a lot of contacts who have come from the room
-- booking system (Louise Cordrey for example) who aren't club contacts
-- (parents / coaches)."
--
-- WHAT WAS ACTUALLY WRONG
--   /people already tried to hide them. It read `profiles` for `role =
--   'booker'` and excluded those person ids — the marker P0.4 said would
--   identify a function-room customer. That marker does not exist in this
--   database: `user_role` is (committee, bar, bar_manager, member, super_user,
--   staff) and every one of these logins is `member`. The filter has been
--   matching nothing since the day it was written, and 27 room customers have
--   been sitting in the club's contact list.
--
-- WHAT THIS DOES INSTEAD
--   Asks the question the screen actually means: has the club any relationship
--   with this person? `club_person_ids()` returns everybody who holds a team
--   membership, a registration, a guardianship (either end), a club membership
--   row, a person_role, or a linked login that is more than a plain member —
--   plus anybody the club created who has never hired the room at all. What is
--   left over is somebody who exists in `people` only because they booked the
--   function room, and they are the ones the list drops.
--
--   It does NOT re-role anybody. Changing a room customer's login to a hirer
--   role would take the club app away from them at a stroke, and one of these
--   27 joining a team next week would then be a support call rather than an
--   ordinary registration. Nothing about who they are changes here — only
--   which list they appear in. Their hire records, their bookings and the
--   room's own contacts book (`booking_contacts`, 20260825010000) are all
--   untouched.
--
-- WHY A FUNCTION AND NOT A VIEW
--   The screen pages, searches and counts against `people` through PostgREST.
--   A function returning the ids it should skip drops into the query it
--   already builds (the same shape the dead booker filter used), which keeps
--   one source of truth for "is this the club's person" without rewriting the
--   screen around a view.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table, no policy change —
-- the function returns ids and the caller's own policies still decide what
-- they may read of those people); data touched: none, nothing is written;
-- rollback: drop the two functions.
-- =============================================================================

create or replace function public.is_club_person(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.team_memberships m where m.person_id = p_person_id)
      or exists (select 1 from public.registrations r where r.person_id = p_person_id)
      or exists (select 1 from public.guardianships g
                  where g.guardian_person_id = p_person_id or g.child_person_id = p_person_id)
      or exists (select 1 from public.membership_people mp where mp.person_id = p_person_id)
      or exists (select 1 from public.person_roles pr
                  where pr.person_id = p_person_id and pr.revoked_at is null)
      or exists (select 1 from public.profiles p
                  where p.person_id = p_person_id and p.role::text <> 'member')
      or exists (select 1 from public.account_requests a where a.person_id = p_person_id);
$$;

comment on function public.is_club_person(uuid) is
  'Has the club any relationship with this person — a team, a registration, a guardianship, a membership, a role, a staff login or an account request? False for somebody who exists only because they hired the function room.';

revoke all privileges on function public.is_club_person(uuid) from public, anon;
grant execute on function public.is_club_person(uuid) to authenticated, service_role;


create or replace function public.hire_only_person_ids()
  returns uuid[]
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
    from public.people p
   where p.deleted_at is null
     and not public.is_club_person(p.id)
     and (
       exists (select 1 from public.booking_contacts c
                where c.email is not null and p.email is not null
                  and lower(c.email) = lower(p.email))
       or exists (select 1 from public.bookings b
                   where b.booker_email is not null and p.email is not null
                     and lower(b.booker_email) = lower(p.email))
     );
$$;

comment on function public.hire_only_person_ids() is
  'People who are in `people` only because they hired the function room: no club relationship of any kind, and a matching hire contact or booking. The people list skips them (Adam, 2026-08-25).';

revoke all privileges on function public.hire_only_person_ids() from public, anon;
grant execute on function public.hire_only_person_ids() to authenticated, service_role;

notify pgrst, 'reload schema';

-- Rollback (documented, not executed):
--   drop function public.hire_only_person_ids();
--   drop function public.is_club_person(uuid);
