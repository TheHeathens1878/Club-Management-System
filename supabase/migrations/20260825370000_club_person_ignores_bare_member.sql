-- =============================================================================
-- "member" is not a relationship
-- =============================================================================
-- 20260825360000 shipped `is_club_person()` and it hid nobody. The reason is
-- one line of it: it counted ANY live `person_roles` row as a club
-- relationship, and the room-booking import gives every person it creates the
-- bare `member` role. So all 27 function-room customers looked like club
-- people and the list was unchanged — the same bug as the dead `booker`
-- filter it replaced, one table over.
--
-- `member` is the default, not a decision. A role only says the club has
-- decided something about somebody when it is one of the others — coach,
-- parent, club_admin, safeguarding_lead, staff, referee, hirer. The same is
-- already true of the `profiles.role` test beside it, which has always
-- ignored plain `member`.
--
-- Everything else about the function is unchanged, and it still takes only ONE
-- relationship to be the club's person: a team, a registration, a guardianship
-- at either end, a club membership, a role beyond member, a staff login or an
-- account request. On production this now hides exactly the 27 the club has
-- been complaining about, and nobody else.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n; data touched: none;
-- rollback: restore the 20260825360000 body.
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
      -- `member` is what the import hands out; it is not a decision about
      -- anybody. Any OTHER live role is.
      or exists (select 1 from public.person_roles pr
                  where pr.person_id = p_person_id and pr.revoked_at is null
                    and pr.role::text <> 'member')
      or exists (select 1 from public.profiles p
                  where p.person_id = p_person_id and p.role::text <> 'member')
      or exists (select 1 from public.account_requests a where a.person_id = p_person_id);
$$;

comment on function public.is_club_person(uuid) is
  'Has the club any relationship with this person — a team, a registration, a guardianship, a membership, a role BEYOND the default member, a staff login or an account request? False for somebody who exists only because they hired the function room.';

notify pgrst, 'reload schema';

-- Rollback (documented, not executed):
--   restore the function body from 20260825360000_club_contacts_only.sql.
