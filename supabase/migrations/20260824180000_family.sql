-- =============================================================================
-- Gap 9 (post-P3.4) — family self-service
-- =============================================================================
-- A parent could not add their own child: `people` inserts are club_admin
-- only, and a guardianship needs the child's row first. This adds one
-- SECURITY DEFINER entry point that does both as a unit under the existing
-- safeguarding rules:
--
--   add_child(first, last, dob, preferred_name) → child person id
--     * the caller must be a known adult (SG-4 guard on guardianships checks
--       the guardian's DOB — an unknown DOB refuses);
--     * the child must be a minor today (SG-4: "child must be a minor at
--       creation" — an adult 'child' is refused by the same guard);
--     * creates the person, then the guardianship (relationship 'parent');
--     * audited as `family.child_added`.
--
--   my_children() — the caller's live guardianships with the child's name,
--   DOB-derived age group hint (is_minor), and current team memberships.
--   Read-only convenience so the Children page needs no joins the caller may
--   not be allowed to make.
--
-- Team registration for a child already exists: `registrations` with the
-- guardian insert policy (registrations_guardian_insert). Inviting a second
-- adult by email is deferred (no outbound email to members for now).
--
-- Rollback: drop function add_child, my_children.
-- =============================================================================

create or replace function public.add_child(
  p_first_name text, p_last_name text, p_dob date, p_preferred_name text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me    uuid := public.current_person_id();
  v_child uuid;
begin
  if v_me is null then
    raise exception 'add_child: no person is linked to this login' using errcode = '42501';
  end if;
  if p_dob is null then
    raise exception 'add_child: the child''s date of birth is required' using errcode = 'P0001';
  end if;
  if p_dob > current_date then
    raise exception 'add_child: the date of birth cannot be in the future' using errcode = 'P0001';
  end if;
  if not public.is_minor_dob(p_dob) then
    raise exception 'add_child: % is an adult — adults create their own account [SAFEGUARDING.md SG-4]',
      btrim(p_first_name) using errcode = 'P0001';
  end if;

  insert into public.people (first_name, last_name, preferred_name, dob, created_by)
  values (btrim(p_first_name), btrim(p_last_name), nullif(btrim(p_preferred_name), ''), p_dob, auth.uid())
  returning id into v_child;

  -- SG-4 guard runs here: guardian must be a known adult, child a minor.
  insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (v_me, v_child, 'parent');

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'family.child_added', 'people', v_child::text,
          jsonb_build_object('guardian_person_id', v_me));
  return v_child;
end $$;
revoke all privileges on function public.add_child(text, text, date, text) from public, anon;
grant execute on function public.add_child(text, text, date, text) to authenticated;

create or replace function public.my_children()
  returns table (
    person_id uuid, first_name text, last_name text, preferred_name text, dob date,
    is_minor boolean, relationship text,
    teams jsonb
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id, p.first_name, p.last_name, p.preferred_name, p.dob,
         public.is_minor(p.id), g.relationship::text,
         coalesce((
           select jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', t.name, 'role', m.role::text) order by t.name)
           from public.team_memberships m join public.teams t on t.id = m.team_id
           where m.person_id = p.id and m.left_at is null
         ), '[]'::jsonb)
  from public.guardianships g
  join public.people p on p.id = g.child_person_id
  where g.guardian_person_id = public.current_person_id()
    and g.ended_at is null
    and p.deleted_at is null
  order by p.first_name, p.last_name;
$$;
revoke all privileges on function public.my_children() from public, anon;
grant execute on function public.my_children() to authenticated;
