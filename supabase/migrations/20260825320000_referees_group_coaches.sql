-- =============================================================================
-- Every coach is in the Referees group, and only the club changes a group
-- =============================================================================
-- Adam, 2026-08-25: "all coaches should be auto enrolled into the referees
-- group" and "make sure that coaches cannot edit the group settings or close
-- the group."
--
-- 1. THE REFEREES GROUP IS WHERE A COACH ASKS FOR A REFEREE
--    20260825030000 put the referee HAT in the group and left coaches to be
--    added by hand — which meant the coach who needs a referee on Saturday was
--    the one person who might not be in the room. Membership is now derived
--    from two facts, in one helper, and kept in step by triggers on both:
--      · `person_roles.coach` (the club's own coaching role), and
--      · a live `team_memberships` row as coach, assistant coach or manager.
--    Losing both takes them back out, exactly as revoking the referee hat
--    already did. Existing coaches are backfilled at the end.
--
--    `referee_group_sync()` is deliberately tolerant: a join that SG-1 refuses
--    is audited (`referee_group.join_refused`) rather than raised, because a
--    role grant must not fail on a messaging rule — that is how
--    `referee_role_sync_group()` was written and this keeps the behaviour.
--
-- 2. A GROUP'S SETTINGS ARE THE CLUB'S
--    `conversations_update` admitted the creator, a club admin, the team's
--    staff (for a team room) and the safeguarding lead. So a coach could
--    rename or close a group they had started — including, once they are all
--    in it, arguing with the Referees group itself. It now admits the club
--    admin and the safeguarding lead only:
--      · the ADMIN because settings and closing are club business;
--      · the LEAD because closing a conversation is a safeguarding act (SG-3),
--        and taking that away would remove an oversight power the platform is
--        supposed to have.
--    A creator who is neither keeps everything else: they still read it, still
--    post in it, and still add or remove members through the participant
--    policies, which this migration does not touch.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one UPDATE policy narrowed
-- on public.conversations); data touched: inserts conversation_participants
-- rows for existing coaches (membership only — no message is written, nothing
-- is deleted); rollback: §4.
-- =============================================================================


-- =============================================================================
-- 1. WHO BELONGS IN THE GROUP
-- =============================================================================

create or replace function public.belongs_in_referees_group(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
           select 1 from public.person_roles r
            where r.person_id = p_person_id
              and r.revoked_at is null
              and r.role in ('referee'::public.app_role, 'coach'::public.app_role))
      or exists (
           select 1 from public.team_memberships m
            where m.person_id = p_person_id
              and m.left_at is null
              and m.role in ('coach', 'assistant_coach', 'manager'));
$$;

comment on function public.belongs_in_referees_group(uuid) is
  'True for an approved referee and for anyone the club recognises as a coach — the two sides of the conversation about who is refereeing on Saturday.';

revoke all privileges on function public.belongs_in_referees_group(uuid) from public, anon;
grant execute on function public.belongs_in_referees_group(uuid) to authenticated, service_role;


create or replace function public.sync_referees_group_member(p_person_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_group uuid := public.referees_group_id();
begin
  if v_group is null or p_person_id is null then
    return;
  end if;

  if public.belongs_in_referees_group(p_person_id) then
    if not exists (
      select 1 from public.conversation_participants
       where conversation_id = v_group and person_id = p_person_id and left_at is null)
    then
      begin
        insert into public.conversation_participants (conversation_id, person_id, basis)
        values (v_group, p_person_id, 'member');
      exception when others then
        -- A messaging rule (SG-1) may refuse the join. Audit it; never fail
        -- the role grant or the team sheet that triggered this.
        perform public.write_audit(
          'referee_group.join_refused', 'conversations', v_group::text,
          jsonb_build_object('person_id', p_person_id, 'error', sqlerrm));
      end;
    end if;
  else
    update public.conversation_participants
       set left_at = now()
     where conversation_id = v_group and person_id = p_person_id and left_at is null;
  end if;
end;
$$;

revoke all privileges on function public.sync_referees_group_member(uuid) from public, anon, authenticated;
grant execute on function public.sync_referees_group_member(uuid) to service_role;


-- The role trigger, widened from "referee" to "referee or coach".
create or replace function public.referee_role_sync_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.role not in ('referee'::public.app_role, 'coach'::public.app_role) then
    return null;
  end if;
  perform public.sync_referees_group_member(new.person_id);
  return null;
end;
$$;

comment on function public.referee_role_sync_group() is
  'Keeps the Referees group in step with the referee and coach roles (20260825320000): granted puts them in, revoked takes them out.';


-- And the team sheet: a coach recorded on a team is a coach.
create or replace function public.team_staff_sync_referees_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform public.sync_referees_group_member(coalesce(new.person_id, old.person_id));
  return null;
end;
$$;

comment on function public.team_staff_sync_referees_group() is
  'A coach, assistant coach or manager joining or leaving a team joins or leaves the Referees group with it.';

revoke all privileges on function public.team_staff_sync_referees_group()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_team_memberships_referees_group on public.team_memberships;
create trigger trg_team_memberships_referees_group
  after insert or update of role, left_at on public.team_memberships
  for each row execute function public.team_staff_sync_referees_group();


-- =============================================================================
-- 2. THE GROUP'S SETTINGS ARE THE CLUB'S
-- =============================================================================

drop policy if exists "conversations_update" on public.conversations;
create policy "conversations_update" on public.conversations for update to authenticated
  using (public.is_club_admin() or public.is_safeguarding_lead())
  with check (public.is_club_admin() or public.is_safeguarding_lead());


-- =============================================================================
-- 3. BACKFILL — the coaches the club already has
-- =============================================================================

do $$
declare
  v_person uuid;
begin
  if public.referees_group_id() is null then
    return;
  end if;
  for v_person in
    select distinct r.person_id from public.person_roles r
      where r.revoked_at is null and r.role = 'coach'::public.app_role
    union
    select distinct m.person_id from public.team_memberships m
      where m.left_at is null and m.role in ('coach', 'assistant_coach', 'manager')
  loop
    perform public.sync_referees_group_member(v_person);
  end loop;
end $$;

notify pgrst, 'reload schema';


-- =============================================================================
-- 4. ROLLBACK (documented, not executed)
-- =============================================================================
--   drop trigger trg_team_memberships_referees_group on public.team_memberships;
--   drop function public.team_staff_sync_referees_group();
--   restore referee_role_sync_group() from 20260825030000 (referee only);
--   drop function public.sync_referees_group_member(uuid);
--   drop function public.belongs_in_referees_group(uuid);
--   drop policy "conversations_update" on public.conversations;
--   create policy "conversations_update" on public.conversations for update to authenticated
--     using (created_by_person_id = public.current_person_id() or public.is_club_admin()
--            or (team_id is not null and public.is_team_staff(team_id)) or public.is_safeguarding_lead())
--     with check (true);
--   Coaches added to the group by the backfill keep their rows; setting
--   left_at on them is a separate, deliberate act.
