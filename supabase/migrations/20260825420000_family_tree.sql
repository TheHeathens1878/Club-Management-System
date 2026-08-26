-- =============================================================================
-- Family linking — my_family_tree() (Adam, 2026-08-26)
-- =============================================================================
-- "Family linking should show you the family group you are connected to in a
--  hierarchical family tree. If an ex-spouse is also registered as a guardian
--  for the children, they shouldn't see any other connected adults or children
--  who aren't their own."
--
-- THE FAMILY AS THE CLUB HOLDS IT, FROM ONE PERSON'S SEAT
--   The tree has exactly three levels and no fourth:
--
--     you
--      ├── a child you are a LIVE guardian of          (my_children())
--      │    └── the other people the club records as   (guardianships, live)
--      │        THAT CHILD's guardians
--      └── an adult connected to YOU                   (my_household())
--
--   The co-guardian branch is the point of the screen. A separated parent has
--   to know who else the club will ring about their child, and the other
--   parent has the same right in the other direction — so both see each other,
--   THROUGH the child they share.
--
-- THE EX-SPOUSE RULE, AND WHY THE SHAPE ENFORCES IT
--   The rule is: a second guardian of the same children must not see the first
--   guardian's other connected adults, or any child who is not theirs.
--
--   Nothing here recurses. A co-guardian is a LEAF: the query never asks what
--   else that person is a guardian of, and never asks who is in their
--   household. So for two separated parents A and B sharing children X and Y,
--   where A has a new partner P and P has a child Z:
--
--     * B's children are X and Y — Z is nobody's row in B's guardianships, so
--       Z is not in B's tree and cannot become one by any join below.
--     * B's connected adults come from my_household(), whose three branches
--       are all keyed to B (created by B's login, on a membership B leads, or
--       the lead of a membership B sits on). P is on A's membership and was
--       created by A's login, so P is in A's household and not in B's.
--     * B reaches A only as a guardian of X and of Y, as a leaf.
--
--   That is the whole enforcement, and it is structural rather than a filter
--   somebody has to remember to write: the only way into the tree is a live
--   guardianship of the CALLER's own, or the caller's own household.
--
-- WHAT THIS WIDENS — ONE THING, DELIBERATELY
--   Before this migration a guardian could read:
--     * their own person row                 (people_self_read)
--     * their live-guarded MINOR children's  (people_guardian_read)
--     * their own guardianship rows          (guardianships_guardian_read —
--       `guardian_person_id = current_person_id()`, so the OTHER guardians of
--       their child are not among them)
--     * their connected adults' names, email and phone (my_household(), which
--       is already SECURITY DEFINER for exactly this reason)
--     * display_name(p) for anyone they can act for, or whose team they staff
--       — which excludes a co-guardian.
--
--   So the co-guardian's NAME is new, and it is the only new thing. This
--   function returns:
--     * no date of birth for anybody — the family screens show an age-group
--       hint instead, and a screen that prints children's dates of birth is a
--       screen that leaks them over a shoulder. The hint is computed HERE so
--       the dob never crosses the wire;
--     * no email, phone, address or photo path — not for the co-guardian
--       (whose contact details the caller has no read on) and not for the
--       household adult either, even though my_household() would give them.
--       The screen is a map of the family, not a contact list;
--     * no guardianship id, notes or history — `notes` on a guardianship can
--       carry the shape of a court order (P1.3), and nothing on this screen
--       needs it.
--
-- WHY SECURITY DEFINER AT ALL
--   Only for the co-guardian branch: `guardianships_guardian_read` is scoped
--   to rows the caller holds, so the caller genuinely cannot see that anyone
--   else is a guardian of their child. The other two branches call the
--   existing SECURITY DEFINER reads unchanged — my_children() and
--   my_household() — rather than re-deriving their predicates, so this
--   function cannot drift wider than the pages that already show them.
--
--   No policy is added, changed or dropped by this migration. Nothing a
--   guardian can SELECT changes.
--
-- ONLY LIVE LINKS. `ended_at is null` on both sides: my_children() already
-- applies it, and the co-guardian query applies it again. An ended
-- arrangement drops out of both trees, which is the same rule
-- people_guardian_read enforces for the child's record itself (SG-4: the link
-- survives, its effects lapse).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no tables, no policies, no
-- grants on any table — one new SECURITY DEFINER function, execute granted to
-- `authenticated` only); data touched: none (read-only, no writes, no audit
-- row — this is a screen, not an action); rollback: drop function
-- public.my_family_tree().
-- =============================================================================

create or replace function public.my_family_tree()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $function$
  with me as (
    select public.current_person_id() as pid
  ),
  -- The caller. `people_self_read` already returns this row, so nothing here
  -- is a disclosure; it is the root the tree hangs from.
  root_person as (
    select p.id, p.first_name, p.last_name, p.preferred_name
      from public.people p, me
     where p.id = me.pid
       and p.deleted_at is null
  ),
  -- Level 1. Exactly what /family (Connect Children) already lists: live
  -- guardianships held BY the caller. dob is read only to derive the age
  -- group and is not returned.
  kids as (
    select c.person_id, c.first_name, c.last_name, c.preferred_name,
           c.relationship, c.dob
      from public.my_children() c
  ),
  -- Level 2, and the only new read. The other live guardians of a child the
  -- caller is themselves a live guardian of. A LEAF: nothing joins back out
  -- of this, which is what keeps one guardian's household out of the other's
  -- tree.
  co as (
    select g.child_person_id,
           p.id, p.first_name, p.last_name, p.preferred_name,
           g.relationship::text as relationship
      from public.guardianships g
      join public.people p on p.id = g.guardian_person_id
      join kids k on k.person_id = g.child_person_id
      cross join me
     where g.ended_at is null
       and g.guardian_person_id is distinct from me.pid
       and p.deleted_at is null
       -- The same lapse `people_guardian_read` applies (SG-4: "guardian access
       -- to the young person's data ends at 18 … enforced in the reading
       -- policies"). my_children() keeps listing a child who has turned 18 —
       -- the link survives — but the co-guardian name is a NEW disclosure, so
       -- it lapses on the same birthday as everything else the link buys.
       and public.is_minor(k.person_id)
  ),
  -- The same set, pre-aggregated one row per child, so the children query
  -- below is a plain left join rather than a subquery inside an aggregate.
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
  -- Level 1, the other branch. Exactly what /connected-adults already lists,
  -- minus the contact details.
  adults as (
    select h.person_id, h.first_name, h.last_name,
           h.has_login, h.on_my_membership, h.my_lead
      from public.my_household() h
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
                 -- The age-group hint the family screens show in place of a
                 -- date of birth. Mirrors lib/waiting-list.ts
                 -- `ageGroupFromDob`: the season turns over in July, the
                 -- cohort year turns over in September, and the result is
                 -- clamped to U05..U18. NULL dob gives NULL, and the screen
                 -- says "Age group unknown".
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
  );
$function$;

comment on function public.my_family_tree() is
  'The caller''s family as a three-level tree: the caller, the children they '
  'are a LIVE guardian of, the OTHER live guardians of each of those children '
  '(a leaf — nothing recurses out of it), and the adults connected to the '
  'caller themselves via my_household(). '
  'THE RULE: a second guardian of the same children must not see the first '
  'guardian''s other connected adults, or any child who is not theirs. Two '
  'separated parents share the children and therefore see each other through '
  'them; neither sees the other''s new partner, that partner''s children or '
  'household. The shape is the enforcement — the only ways in are a live '
  'guardianship the CALLER holds and the caller''s own household. '
  'SECURITY DEFINER solely for the co-guardian names: '
  'guardianships_guardian_read scopes that table to rows the caller holds, so '
  'the co-guardian is otherwise invisible, and display_name() refuses them '
  'too. Returns no dob (an age-group hint instead), no contact details, no '
  'photo path and no guardianship notes. Read-only; adds no policy and '
  'widens none. SAFEGUARDING.md SG-4, SG-1.';

revoke all privileges on function public.my_family_tree() from public, anon;
grant execute on function public.my_family_tree() to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function public.my_family_tree();
