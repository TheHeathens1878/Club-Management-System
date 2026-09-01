-- =============================================================================
-- The family tree, drawn around somebody other than the caller
-- =============================================================================
-- Adam, 2026-08-26: "If you click into the contact, there should be another tab
-- saying Membership and payments. The family tree should appear in here."
--
-- `my_family_tree()` (20260825420000) is built entirely from `my_children()`
-- and `my_household()`, both of which read `auth.uid()`. Calling it from an
-- administrator's view of somebody else's record would draw the
-- ADMINISTRATOR'S own family under that person's name — the most confidently
-- wrong screen in the app. So the person-shaped question needs its own
-- function.
--
-- WHO MAY ASK
--   `club_admin` and `safeguarding_lead`, which is exactly the readership
--   `people_admin_read` already gives the /people list this tab hangs off.
--   Anybody else is refused rather than given a thinner tree: a member reading
--   their own family has `my_family_tree()`, and a half-answer here would be a
--   second, subtly different set of rules to keep in step.
--
-- WHAT IS DIFFERENT FROM my_family_tree(), AND WHY
--   The co-guardian branch does NOT lapse at 18. In `my_family_tree()` it
--   does, because there the caller is a GUARDIAN and SG-4 ends guardian access
--   to a young person's data on their eighteenth birthday — the co-guardian's
--   name is a disclosure the guardianship bought. Here the caller is a club
--   administrator who may already read every one of these rows directly, so
--   applying the lapse would not withhold anything from them; it would just
--   draw a tree with holes in it and invite somebody to "fix" it later.
--
--   The shape of the JSON is otherwise identical, so one renderer draws both.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered — one SECURITY DEFINER function that checks its own authority);
-- data touched: none; rollback: drop the function.
-- =============================================================================

create or replace function public.family_tree_for(p_person_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
as $fn$
declare
  v_user uuid;
  v_result jsonb;
begin
  if not (public.is_club_admin() or public.has_role('safeguarding_lead')) then
    raise exception 'family_tree_for: club_admin or safeguarding_lead only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people where id = p_person_id and deleted_at is null) then
    raise exception 'family_tree_for: no such person' using errcode = 'P0001';
  end if;

  -- The login this person holds, if any. It is what `household_links` is keyed
  -- on, and a person with no login simply has no linked-adult branch.
  select pr.id into v_user from public.profiles pr where pr.person_id = p_person_id limit 1;

  with root_person as (
    select p.id, p.first_name, p.last_name, p.preferred_name
      from public.people p
     where p.id = p_person_id and p.deleted_at is null
  ),
  -- Level 1: the children this person is a live guardian of.
  kids as (
    select c.id as person_id, c.first_name, c.last_name, c.preferred_name,
           g.relationship::text as relationship, c.dob
      from public.guardianships g
      join public.people c on c.id = g.child_person_id
     where g.guardian_person_id = p_person_id
       and g.ended_at is null
       and c.deleted_at is null
  ),
  -- Level 2: each child's OTHER live guardians. A leaf — nothing joins back
  -- out of it, which is what keeps one household out of the other's tree.
  co as (
    select g.child_person_id,
           p.id, p.first_name, p.last_name, p.preferred_name,
           g.relationship::text as relationship
      from public.guardianships g
      join public.people p on p.id = g.guardian_person_id
      join kids k on k.person_id = g.child_person_id
     where g.ended_at is null
       and g.guardian_person_id is distinct from p_person_id
       and p.deleted_at is null
  ),
  kid_guardians as (
    select c.child_person_id,
           jsonb_agg(
             jsonb_build_object(
               'person_id',      c.id,
               'first_name',     c.first_name,
               'last_name',      c.last_name,
               'preferred_name', c.preferred_name,
               'relationship',   c.relationship)
             order by c.first_name, c.last_name) as guardians
      from co c
     group by c.child_person_id
  ),
  -- Level 1, the other branch: the adults connected to this person. The same
  -- three sources my_household() unions, asked about a person rather than
  -- about auth.uid() — created by their login, linked to their login, on a
  -- membership of theirs, or holding a membership they are on.
  in_household as (
    select p.id
      from public.people p
     where p.deleted_at is null
       and not public.is_minor(p.id)
       and p.id is distinct from p_person_id
       and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
       and v_user is not null
       and (p.created_by = v_user
            or exists (select 1 from public.household_links hl
                        where hl.person_id = p.id and hl.owner_user_id = v_user))
  ),
  on_theirs as (
    select mp.person_id as id
      from public.memberships m
      join public.membership_people mp on mp.membership_id = m.id
     where m.primary_person_id = p_person_id
       and mp.person_id <> m.primary_person_id
       and not public.is_minor(mp.person_id)
  ),
  their_leads as (
    select m.primary_person_id as id
      from public.memberships m
      join public.membership_people mp on mp.membership_id = m.id
     where mp.person_id = p_person_id
       and m.primary_person_id <> mp.person_id
  ),
  adults as (
    select p.id as person_id, p.first_name, p.last_name,
           exists (select 1 from public.profiles pr where pr.person_id = p.id) as has_login,
           p.id in (select id from on_theirs) as on_my_membership,
           p.id in (select id from their_leads) as my_lead
      from public.people p
     where p.deleted_at is null
       and p.id in (select id from in_household
                    union select id from on_theirs
                    union select id from their_leads)
  )
  select jsonb_build_object(
    'self', (
      select jsonb_build_object(
               'person_id',      s.id,
               'first_name',     s.first_name,
               'last_name',      s.last_name,
               'preferred_name', s.preferred_name)
        from root_person s
    ),
    'children', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'person_id',      k.person_id,
                 'first_name',     k.first_name,
                 'last_name',      k.last_name,
                 'preferred_name', k.preferred_name,
                 'relationship',   k.relationship,
                 -- The age-group hint the family screens show instead of a
                 -- date of birth. Same arithmetic as my_family_tree().
                 'age_group',
                   case when k.dob is null then null else
                     'U' || lpad(
                       greatest(5, least(18,
                         (case when extract(month from current_date) >= 7
                               then extract(year from current_date)
                               else extract(year from current_date) - 1 end)
                         - (case when extract(month from k.dob) >= 9
                                 then extract(year from k.dob)
                                 else extract(year from k.dob) - 1 end)
                       ))::int::text, 2, '0')
                   end,
                 'guardians', coalesce(kg.guardians, '[]'::jsonb))
               order by k.first_name, k.last_name)
        from kids k
        left join kid_guardians kg on kg.child_person_id = k.person_id
    ), '[]'::jsonb),
    'adults', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'person_id',        a.person_id,
                 'first_name',       a.first_name,
                 'last_name',        a.last_name,
                 'has_login',        a.has_login,
                 'on_my_membership', a.on_my_membership,
                 'my_lead',          a.my_lead)
               order by a.first_name, a.last_name)
        from adults a
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

comment on function public.family_tree_for(uuid) is
  'The family tree around a given person, in the same JSON shape as my_family_tree() so one renderer draws both. club_admin or safeguarding_lead only. The co-guardian branch does not lapse at 18 here: SG-4 ends a GUARDIAN''s access on that birthday, and this caller is an administrator who may read those rows directly.';

revoke all privileges on function public.family_tree_for(uuid) from public, anon;
grant execute on function public.family_tree_for(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: drop function if exists public.family_tree_for(uuid);
-- =============================================================================
