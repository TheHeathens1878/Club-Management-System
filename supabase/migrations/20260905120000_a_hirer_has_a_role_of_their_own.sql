-- =============================================================================
-- A hirer has a role of their own (20260905120000)
-- =============================================================================
-- Codex review, 2026-09-05, findings 7 and 10 (Medium):
--
--   7. "Booker account setup writes an invalid role. book/actions.ts writes
--      `booker`, which is absent from the database enum, and ignores the
--      result. The profile retains another role, breaking booker-specific
--      routing."
--  10. "Account lookup searches only the first 1,000 auth users."
--
-- Both true, and both P0.4 lift-and-shift debt that lib/supabase/legacy.ts
-- has carried a note about since 2026-08-22. Every function-room hirer who
-- has booked since the cutover holds a `member` profile: the upsert failed
-- (22P02, an invalid enum value), nothing checked, and `handle_new_user()`'s
-- default stood. So a hirer confirming their email lands in the club lobby,
-- not their portal, and the (app) layout's "bookers have no access to the
-- staff area" redirect has had nobody to redirect.
--
--
-- 1. THE VALUE
-- ---------------------------------------------------------------------------
-- `booker` joins `user_role`. It maps to the `hirer` app role that P1.4
-- created for exactly this person and has never granted to anybody
-- (20260822130000 §1: "the old app's hirers are not profiles rows at all" —
-- they are now). `map_user_role_to_app_role()` is restated over the text of
-- the enum so the new value can be named in the same transaction that adds
-- it; the strict wrapper and the sync trigger are unchanged and now have an
-- answer for the seventh value.
--
-- `is_club_person()` learns that a `booker` profile, and the `hirer` role
-- the sync trigger grants it, are not a club relationship — otherwise every
-- hirer would appear in the members list, which is the thing 20260825360000
-- and 20260825370000 were written to stop.
--
-- EXISTING HIRERS ARE NOT MOVED. A profile that is `member` today may be a
-- hirer who is also a member (the same address books a room and plays), and
-- this migration cannot tell. The next booking from an address the club
-- already knows does not downgrade it either — `ensureBookerAccount` only
-- writes `booker` on the account it has just created. Adam can re-role a
-- known hirer from the profile if it matters; it is recorded here as a known
-- residue rather than guessed at.
--
--
-- 2. THE LOOKUP
-- ---------------------------------------------------------------------------
-- `auth_user_id_for_email()` answers "which login has this address" from
-- `auth.users` directly. The admin API's listUsers is a page, and the page
-- was 1,000; the club has more people than that in its future. service_role
-- only — the web server calls it after createUser() says the address is
-- taken. It returns an id and nothing else.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy touched. One
-- enum value, three functions (a restated mapping, a restated club-person
-- test, one new SECURITY DEFINER lookup granted to service_role only). Data
-- touched: none. Rollback: §4.
-- =============================================================================

alter type public.user_role add value if not exists 'booker';

-- ---------------------------------------------------------------------------
-- 1. The mapping, with the seventh answer
-- ---------------------------------------------------------------------------
create or replace function public.map_user_role_to_app_role(p_role public.user_role)
  returns public.app_role
  language sql
  immutable
  set search_path to 'public'
as $function$
  select case p_role::text
    when 'super_user'  then 'club_admin'::public.app_role
    when 'committee'   then 'club_admin'::public.app_role
    when 'bar_manager' then 'staff'::public.app_role
    when 'bar'         then 'staff'::public.app_role
    when 'staff'       then 'staff'::public.app_role
    when 'member'      then 'member'::public.app_role
    when 'booker'      then 'hirer'::public.app_role
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A hirer is not a club person
-- ---------------------------------------------------------------------------
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
      -- `member` is what the import hands out and `hirer` is what a room
      -- booking hands out; neither is a decision about anybody. Any OTHER
      -- live role is.
      or exists (select 1 from public.person_roles pr
                  where pr.person_id = p_person_id and pr.revoked_at is null
                    and pr.role::text not in ('member', 'hirer'))
      or exists (select 1 from public.profiles p
                  where p.person_id = p_person_id and p.role::text not in ('member', 'booker'))
      or exists (select 1 from public.account_requests a where a.person_id = p_person_id);
$$;

comment on function public.is_club_person(uuid) is
  'Has the club any relationship with this person — a team, a registration, a guardianship, a membership, a role BEYOND member or hirer, a staff login or an account request? False for somebody who exists only because they hired the function room.';

-- ---------------------------------------------------------------------------
-- 3. Which login holds this address
-- ---------------------------------------------------------------------------
create or replace function public.auth_user_id_for_email(p_email text)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select u.id
    from auth.users u
   where u.deleted_at is null
     and lower(u.email) = lower(btrim(coalesce(p_email, '')))
   order by u.created_at
   limit 1;
$$;

comment on function public.auth_user_id_for_email(text) is
  'The auth user holding an email address, or null. service_role only: the web server asks after createUser() has said the address is taken, instead of paging the admin user list.';

revoke all privileges on function public.auth_user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_for_email(text) to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. ROLLBACK
-- ---------------------------------------------------------------------------
--   drop function public.auth_user_id_for_email(text);
--   restore is_club_person() from 20260825370000 and
--   map_user_role_to_app_role() from 20260822130000 §7.
-- An enum value cannot be dropped; `booker` stays, unmapped, and the strict
-- wrapper raises on any profile still holding it — which is the fail-closed
-- direction 20260822130000 §7 chose.
