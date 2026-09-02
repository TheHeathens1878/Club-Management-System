-- =============================================================================
-- Being in the referees group is not the same as being a referee
-- =============================================================================
-- Adam, 2026-09-02: "Being a member of the referees group doesn't automatically
-- make you a referee — all coaches should be in there also. I want the referees
-- in the members list to be clear. Member just means member of the group, I
-- want the referees to be obvious and highlighted."
--
-- He is describing a screen that cannot tell the difference, and it cannot
-- because nothing has ever told it. `sync_referees_group_member()`
-- (20260825320000) puts every referee in the group and every coach with them —
-- deliberately, because a coach is who posts the game that needs an official.
-- So the group's membership list is a mixture, and the only label it has for
-- anybody is the participation basis: "Member". Worse, `referees_group_bands()`
-- returns a band for EVERY participant, so a coach who has never refereed a
-- game in their life is shown an age group they may take.
--
-- WHAT IS MISSING IS THE QUESTION, not the answer. `person_roles` holds the
-- referee hat and always has; a member simply cannot read anybody's row but
-- their own, and rightly. This adds the one accessor that asks the question in
-- the only form a conversation screen ever needs it: OF THIS ROOM, WHO IS A
-- REFEREE?
--
-- WHY PER CONVERSATION AND NOT PER PERSON. A general "does this person hold the
-- referee hat" accessor would answer about anybody in the club to anybody who
-- asked. Scoped to a conversation, the reader has to be in the room already —
-- they can see the names, and this adds one word beside some of them. The
-- gate is the same one `referees_group_bands()` uses: a live participant, or a
-- club administrator.
--
-- PEOPLE WHO HAVE LEFT ARE INCLUDED. Their messages are still in the room and
-- SG-2 means they always will be; a badge beside a two-month-old post should
-- say what the poster was, not whether they are still here. The caller's own
-- gate is unaffected — they still have to be in the room to ask at all.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered, and no new grant on `person_roles`: the function is SECURITY DEFINER
-- and returns nothing but person ids the caller can already see in the room.
-- Data touched: none. Safeguarding: none — no invariant reads or writes this.
-- Rollback: drop function public.conversation_referees(uuid);
-- =============================================================================

create or replace function public.conversation_referees(p_conversation_id uuid)
  returns setof uuid
  language plpgsql
  stable
  security definer
  set search_path = public
as $function$
declare
  v_me uuid := public.current_person_id();
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

  return query
    select distinct cp.person_id
      from public.conversation_participants cp
      join public.person_roles pr
        on pr.person_id = cp.person_id
       and pr.role = 'referee'::public.app_role
       and pr.revoked_at is null
     where cp.conversation_id = p_conversation_id;
end $function$;

comment on function public.conversation_referees(uuid) is
  'Which people in this conversation hold the referee hat. Answers only for a live participant of it or a club administrator. Members who have left are included, because their messages remain and a badge beside an old post should say what the poster was.';

revoke all privileges on function public.conversation_referees(uuid) from public, anon;
grant execute on function public.conversation_referees(uuid) to authenticated, service_role;
