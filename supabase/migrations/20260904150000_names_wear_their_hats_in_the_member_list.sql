-- =============================================================================
-- Names wear their hats in the member list (Adam, 2026-09-04: "I want the
-- ability for members of a group to show role and their team name(s) in the
-- member list. So Adam Wareing — Admin, Coach U14 Mavericks, Coach U18
-- Cobras" … "Referee should only show in the referee's group").
--
-- An ordinary member cannot read another person's `person_roles` or
-- `team_memberships` — RLS is deliberate about that — so the labels come
-- from a SECURITY DEFINER function with the same gate as
-- `conversation_referees()` (20260825320000): a club administrator, or an
-- ACTIVE participant of the conversation being asked about. What it says is
-- club-directory fact, not member data: which hats a fellow member of your
-- own room wears.
--
--   · 'Admin' — a live club_admin role, or a super_user profile;
--   · 'Committee' — a committee profile (only when not already Admin);
--   · 'Referee' — ONLY when the conversation is the Referees group, exactly
--     the room where that hat is the point; nowhere else, per Adam;
--   · 'Coach / Assistant coach / Manager <team>' — live staff memberships of
--     active teams, one label per team.
--
-- A parent, a player or a social member simply shows no labels — nothing
-- about their children, their teams or their memberships is exposed here.
-- =============================================================================

create or replace function public.conversation_member_labels(p_conversation_id uuid)
  returns table(person_id uuid, labels text[])
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_me uuid := public.current_person_id();
  v_referees boolean;
begin
  if not (
    public.is_club_admin()
    or (v_me is not null and exists (
          select 1 from public.conversation_participants cp
           where cp.conversation_id = p_conversation_id
             and cp.person_id = v_me
             and cp.left_at is null))
  ) then
    return;
  end if;

  select (c.type = 'group' and c.title = 'Referees') into v_referees
    from public.conversations c where c.id = p_conversation_id;

  return query
    select cp.person_id,
           (
             (case
                when exists (select 1 from public.person_roles pr
                              where pr.person_id = cp.person_id
                                and pr.role = 'club_admin' and pr.revoked_at is null)
                  or exists (select 1 from public.profiles p
                              where p.person_id = cp.person_id and p.role = 'super_user')
                  then array['Admin']
                when exists (select 1 from public.profiles p
                              where p.person_id = cp.person_id and p.role = 'committee')
                  then array['Committee']
                else '{}'::text[]
              end)
             || (case
                   when coalesce(v_referees, false)
                    and exists (select 1 from public.person_roles pr
                                 where pr.person_id = cp.person_id
                                   and pr.role = 'referee' and pr.revoked_at is null)
                     then array['Referee']
                   else '{}'::text[]
                 end)
             || coalesce(
                  (select array_agg(
                            (case m.role
                               when 'coach' then 'Coach'
                               when 'assistant_coach' then 'Assistant coach'
                               when 'manager' then 'Manager'
                             end) || ' ' || t.name
                            order by t.name, m.role)
                     from public.team_memberships m
                     join public.teams t on t.id = m.team_id and t.active
                    where m.person_id = cp.person_id
                      and m.left_at is null
                      and m.role in ('coach', 'assistant_coach', 'manager')),
                  '{}'::text[])
           ) as labels
      from public.conversation_participants cp
     where cp.conversation_id = p_conversation_id
       and cp.left_at is null;
end $$;

revoke all on function public.conversation_member_labels(uuid) from public, anon;
grant execute on function public.conversation_member_labels(uuid) to authenticated, service_role;
