-- =============================================================================
-- A team's staff can read their players' emergency contacts and see their photos
-- =============================================================================
-- Adam, 2026-08-25: "I want coaches to read emergency contacts, see photos."
--
-- Two readerships widen, both to the same people: the STAFF of a team — coach,
-- assistant coach, manager (`is_team_staff()`) — for the people who hold a LIVE
-- membership on that team. Not every coach for every member; the coach on the
-- touchline for the players in front of them.
--
--   · `emergency_contacts` (20260825150000) gains a third SELECT policy. The
--     migration that created the table left this as an open decision and said
--     "add a third SELECT policy — nothing else in this file has to change";
--     this is that policy, decided.
--   · `people` gains a staff SELECT policy so a coach can read a squad
--     member's row — which is what puts the photo path in their hands, and
--     which the roster screens need for the avatar beside the name (until now
--     a coach saw initials while a committee member saw faces).
--   · the `person-photos` bucket gains the matching storage SELECT policy, so
--     the signed URL the screen mints for a coach is honoured.
--
-- ONE HELPER, THREE POLICIES
--   `is_staff_for_person(p_person_id)` is the whole question: does the caller
--   hold a staff role on a team where this person is a live member? Written
--   once, SECURITY DEFINER (it reads team_memberships, which a coach may not
--   join freely), and used by all three policies so they cannot drift.
--
-- WHAT DOES NOT CHANGE
--   Writes. No coach may set a contact, edit a person or upload a photo for
--   someone else — the insert/update policies and `set_emergency_contacts()`
--   are untouched. The registration form, medical answers and identity
--   documents keep their narrower readership; a coach reads the two things
--   Adam named and nothing more.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (three new SELECT policies,
-- one helper); data touched: none; rollback: drop the three policies and the
-- function.
-- =============================================================================

create or replace function public.is_staff_for_person(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
      from public.team_memberships tm
     where tm.person_id = p_person_id
       and tm.left_at is null
       and public.is_team_staff(tm.team_id)
  );
$$;

comment on function public.is_staff_for_person(uuid) is
  'True when the caller is coach, assistant coach or manager of a team on which this person holds a live membership.';

revoke all privileges on function public.is_staff_for_person(uuid) from public, anon;
grant execute on function public.is_staff_for_person(uuid) to authenticated, service_role;

-- The touchline readership.
create policy "emergency_contacts_staff_read" on public.emergency_contacts
  for select to authenticated
  using (public.is_staff_for_person(person_id));

create policy "people_staff_read" on public.people
  for select to authenticated
  using (public.is_staff_for_person(people.id));

create policy "person_photos_staff_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'person-photos'
         and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
         and public.is_staff_for_person((storage.foldername(name))[1]::uuid));

notify pgrst, 'reload schema';

-- Rollback (documented, not executed):
--   drop policy "person_photos_staff_read" on storage.objects;
--   drop policy "people_staff_read" on public.people;
--   drop policy "emergency_contacts_staff_read" on public.emergency_contacts;
--   drop function public.is_staff_for_person(uuid);
