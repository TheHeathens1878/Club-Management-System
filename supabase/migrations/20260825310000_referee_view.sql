-- =============================================================================
-- The referee's own view, and a nudge when a game is posted
-- =============================================================================
-- Adam, 2026-08-25: "As a referee, I should get a notification if someone
-- posts in the referees group. I should also be able to switch role to see
-- referee and associated data (primarily the referees group)."
--
-- TWO SMALL THINGS
--   1. `my_capabilities()` gains `has_referee_role`. The referee hat is a
--      `person_roles` row like the coach's, and the role switcher can only
--      offer a view it can see; nothing else in the capabilities payload
--      changes, so every existing reader is untouched. The body below is the
--      20260825070000 one — the club-rules waiting-list clause included — plus
--      the new key; replacing it with an older copy would quietly revoke a
--      coach's automatic waiting-list access.
--   2. `referees_group_notify()` — an AFTER INSERT statement trigger on
--      `messages`, scoped to the seeded Referees group, telling every live
--      participant except the sender that something has been posted. The
--      pattern is `pitch_request_notify()` from 20260825170000: a transition
--      table, one pass, `public.notify()` for delivery, never an email.
--
-- WHY ONLY THIS GROUP
--   A notification for every message in every group would be a different
--   feature, and a noisy one — team rooms carry chatter all evening. The
--   referees group is a NOTICEBOARD: a coach posts a game and waits for
--   somebody to claim it, which is exactly the case where silence costs a
--   referee on a Saturday morning. So the trigger names that conversation and
--   no other.
--
--   The body is the message's own first line, truncated. That is the card's
--   plain-text fallback (`postMatchGame` writes "Referee needed — <fixture>"),
--   so the bell says which game without reaching into the card table. SG-2:
--   nothing here copies a message into anywhere with a wider readership than
--   the conversation itself — a notification goes only to people who are
--   already participants.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table, no policy change);
-- data touched: none; rollback: drop the trigger and the function, and restore
-- the 20260824380000 body of my_capabilities().
-- =============================================================================

-- 1. the referee hat, so the switcher can offer the view ----------------------

create or replace function public.my_capabilities()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as person_id)
  select jsonb_build_object(
    'person_id', me.person_id,
    'is_club_admin', public.is_club_admin(),
    'is_safeguarding_lead', public.is_safeguarding_lead(),
    -- The 20260825070000 rule: a coach of a U-band team holds it without a
    -- grant. Carried forward verbatim — replacing this function with an older
    -- body would quietly revoke that, which is what CI caught.
    'has_waiting_list_access', exists (
      select 1 from public.waiting_list_access w where w.person_id = me.person_id)
      or exists (
      select 1 from public.team_memberships m
      join public.teams t on t.id = m.team_id
      where m.person_id = me.person_id and m.left_at is null
        and m.role in ('coach', 'assistant_coach', 'manager')
        and public.waiting_list_age_number(t.age_group) is not null),
    'has_coach_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'coach'),
    'has_parent_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'parent'),
    'has_referee_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'referee'),
    'is_team_staff', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null
        and m.role in ('coach', 'assistant_coach', 'manager')),
    'has_player_membership', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null and m.role = 'player'),
    'is_guardian', exists (
      select 1 from public.guardianships g
      where g.guardian_person_id = me.person_id and g.ended_at is null),
    'staff_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null
              and m.role in ('coach', 'assistant_coach', 'manager')) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'player_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null and m.role = 'player') s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'parent_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'children', s.children) order by t.name)
      from (select m.team_id,
                   jsonb_agg(distinct p.first_name || ' ' || p.last_name) as children
            from public.guardianships g
            join public.team_memberships m on m.person_id = g.child_person_id and m.left_at is null
            join public.people p on p.id = g.child_person_id and p.deleted_at is null
            where g.guardian_person_id = me.person_id and g.ended_at is null
            group by m.team_id) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb)
  )
  from me;
$$;


-- 2. a post in the Referees group reaches the referees ------------------------

create or replace function public.referees_group_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_group uuid := public.referees_group_id();
  v_row   record;
begin
  if v_group is null then
    return null;
  end if;

  for v_row in
    select n.conversation_id,
           min(n.sender_person_id::text)::uuid as sender_person_id,
           -- The first line of the earliest message in this statement: the
           -- card's own headline ("Referee needed — U9 v Sale Sharks").
           (array_agg(split_part(n.body, E'\n', 1) order by n.created_at))[1] as headline,
           count(*) as posts
      from new_messages n
     where n.conversation_id = v_group
       and n.deleted_at is null
     group by n.conversation_id
  loop
    perform public.notify(
      p.person_id,
      case when v_row.posts > 1
           then 'New posts in the Referees group'
           else 'Posted in the Referees group' end,
      left(coalesce(nullif(btrim(v_row.headline), ''), 'A new post'), 200),
      '/messages/' || v_row.conversation_id::text,
      'conversations',
      v_row.conversation_id::text)
    from public.conversation_participants p
    where p.conversation_id = v_row.conversation_id
      and p.left_at is null
      and p.person_id is distinct from v_row.sender_person_id;
  end loop;

  return null;
end;
$$;

comment on function public.referees_group_notify() is
  'Tells every live member of the Referees group, except the sender, that something has been posted there. In-app only; no email.';

revoke all privileges on function public.referees_group_notify() from public, anon, authenticated, service_role;

drop trigger if exists trg_referees_group_notify on public.messages;
create trigger trg_referees_group_notify
  after insert on public.messages
  referencing new table as new_messages
  for each statement execute function public.referees_group_notify();

notify pgrst, 'reload schema';

-- Rollback (documented, not executed):
--   drop trigger trg_referees_group_notify on public.messages;
--   drop function public.referees_group_notify();
--   restore my_capabilities() from 20260824380000_my_capabilities_teams.sql.
