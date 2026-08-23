-- =============================================================================
-- P5.3 — team conversations: auto-membership from team_memberships + guardians
-- =============================================================================
-- PLAN.md task P5.3 ("triggers sync participants from team_memberships +
-- guardians of minor players"; acceptance: "Adding a player adds their
-- guardians; leaving team marks participant left (history retained)").
--
-- RULES
--   * One `team` conversation per team per season, created on demand by the
--     first live membership (`ensure_team_conversation(team_id, season_id)`).
--   * A live membership adds the person (basis member/staff by role). If the
--     person is a minor, every ACTIVE guardian is added too (basis guardian) —
--     this is what keeps team conversations compliant by construction (SG-1.3
--     / D2) and what SG-1.1 protects afterwards.
--   * Ending a membership marks the participant left (history retained, SG-2)
--     and marks their guardians left IF no other live minor child of theirs
--     remains on the team.
--   * A NEW guardianship for a minor who is on a team adds the guardian to the
--     team conversation; ending one removes them on the same terms.
--   * An `announcement` conversation per team too (staff post, everyone else
--     reads), with the same membership sync.
--   Sync runs with the SG-1 triggers live: if a sync would ever produce a
--   non-compliant state the sync fails — loudly — rather than the invariant
--   being bypassed. (A team room with ≥ 3 people or with guardians present
--   never hits it; a team of one coach and one minor with no guardian would,
--   and should.)
--
-- PR METADATA: migrations y; RLS n (no new tables); data touched: none;
-- rollback: §5.
-- =============================================================================


create or replace function public.ensure_team_conversation(p_team_id uuid, p_season_id uuid, p_type public.conversation_type default 'team')
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_season text;
begin
  if p_type not in ('team', 'announcement') then
    raise exception 'ensure_team_conversation: type must be team or announcement' using errcode = '22023';
  end if;
  select c.id into v_id from public.conversations c
   where c.team_id = p_team_id and c.type = p_type and c.closed_at is null
     and coalesce(c.title, '') like '%' || (select name from public.seasons where id = p_season_id) || '%'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select t.name, s.name into v_name, v_season from public.teams t, public.seasons s where t.id = p_team_id and s.id = p_season_id;
  insert into public.conversations (type, title, team_id)
  values (p_type, v_name || case when p_type = 'announcement' then ' announcements ' else ' ' end || v_season, p_team_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Add a person (and, for a minor, their active guardians) to both team rooms.
create or replace function public.team_conversation_add(p_team_id uuid, p_season_id uuid, p_person_id uuid, p_role public.team_role)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_conv uuid;
  v_ann  uuid;
  v_basis public.participant_basis := case when public.is_child_facing_role(p_role) then 'staff' else 'member' end;
  g record;
begin
  v_conv := public.ensure_team_conversation(p_team_id, p_season_id, 'team');
  v_ann  := public.ensure_team_conversation(p_team_id, p_season_id, 'announcement');
  -- Guardians FIRST: the SG-1 check runs per row, so a minor must never be the
  -- second person in a room before their guardian is in it.
  if public.is_minor(p_person_id) then
    for g in select guardian_person_id from public.guardianships where child_person_id = p_person_id and ended_at is null loop
      insert into public.conversation_participants (conversation_id, person_id, basis)
      select c, g.guardian_person_id, 'guardian' from unnest(array[v_conv, v_ann]) c
      where not exists (select 1 from public.conversation_participants x where x.conversation_id = c and x.person_id = g.guardian_person_id and x.left_at is null);
    end loop;
  end if;
  insert into public.conversation_participants (conversation_id, person_id, basis)
  select c, p_person_id, v_basis from unnest(array[v_conv, v_ann]) c
  where not exists (select 1 from public.conversation_participants x where x.conversation_id = c and x.person_id = p_person_id and x.left_at is null);
end;
$$;

-- Remove a person from the team rooms; drop their guardians when no other live
-- minor child of theirs remains on the team.
create or replace function public.team_conversation_remove(p_team_id uuid, p_season_id uuid, p_person_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  g record;
begin
  update public.conversation_participants p set left_at = now()
  from public.conversations c
  where p.conversation_id = c.id and c.team_id = p_team_id and c.type in ('team', 'announcement') and c.closed_at is null
    and p.person_id = p_person_id and p.left_at is null
    -- keep the row if the person is still a live guardian of another minor on the team
    and not exists (
      select 1 from public.guardianships gg
      join public.team_memberships m on m.person_id = gg.child_person_id and m.team_id = p_team_id and m.season_id = p_season_id and m.left_at is null
      where gg.guardian_person_id = p_person_id and gg.ended_at is null and public.is_minor(gg.child_person_id));
  for g in select guardian_person_id from public.guardianships where child_person_id = p_person_id and ended_at is null loop
    if not exists (
      select 1 from public.guardianships gg
      join public.team_memberships m on m.person_id = gg.child_person_id and m.team_id = p_team_id and m.season_id = p_season_id and m.left_at is null
      where gg.guardian_person_id = g.guardian_person_id and gg.ended_at is null and public.is_minor(gg.child_person_id))
      and not exists (select 1 from public.team_memberships m where m.person_id = g.guardian_person_id and m.team_id = p_team_id and m.season_id = p_season_id and m.left_at is null)
    then
      update public.conversation_participants p set left_at = now()
      from public.conversations c
      where p.conversation_id = c.id and c.team_id = p_team_id and c.type in ('team', 'announcement') and c.closed_at is null
        and p.person_id = g.guardian_person_id and p.left_at is null and p.basis = 'guardian';
    end if;
  end loop;
end;
$$;

-- Trigger on team_memberships (AFTER, so the SG-6 guard has already passed).
create or replace function public.team_memberships_sync_conversations()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.left_at is null then
      perform public.team_conversation_add(new.team_id, new.season_id, new.person_id, new.role);
    end if;
    return new;
  end if;
  -- UPDATE
  if old.left_at is null and new.left_at is not null then
    perform public.team_conversation_remove(old.team_id, old.season_id, old.person_id);
  elsif old.left_at is not null and new.left_at is null then
    perform public.team_conversation_add(new.team_id, new.season_id, new.person_id, new.role);
  elsif new.team_id <> old.team_id or new.season_id <> old.season_id then
    perform public.team_conversation_remove(old.team_id, old.season_id, old.person_id);
    perform public.team_conversation_add(new.team_id, new.season_id, new.person_id, new.role);
  end if;
  return new;
end;
$$;

create trigger trg_team_memberships_sync_conversations
  after insert or update of left_at, team_id, season_id on public.team_memberships
  for each row execute function public.team_memberships_sync_conversations();

-- Trigger on guardianships: a new/ended link for a minor on a team.
create or replace function public.guardianships_sync_conversations()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m record;
begin
  if tg_op = 'INSERT' and new.ended_at is null then
    for m in select team_id, season_id from public.team_memberships where person_id = new.child_person_id and left_at is null loop
      if public.is_minor(new.child_person_id) then
        insert into public.conversation_participants (conversation_id, person_id, basis)
        select c.id, new.guardian_person_id, 'guardian'
        from public.conversations c
        where c.team_id = m.team_id and c.type in ('team', 'announcement') and c.closed_at is null
          and not exists (select 1 from public.conversation_participants x where x.conversation_id = c.id and x.person_id = new.guardian_person_id and x.left_at is null);
      end if;
    end loop;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.ended_at is null and new.ended_at is not null then
    -- AFTER the SG-1.8 guard has allowed it: drop the guardian where no other child keeps them
    for m in select team_id, season_id from public.team_memberships where person_id = old.child_person_id and left_at is null loop
      if not exists (
        select 1 from public.guardianships gg
        join public.team_memberships tm on tm.person_id = gg.child_person_id and tm.team_id = m.team_id and tm.season_id = m.season_id and tm.left_at is null
        where gg.guardian_person_id = old.guardian_person_id and gg.ended_at is null and gg.id <> old.id and public.is_minor(gg.child_person_id))
      then
        update public.conversation_participants p set left_at = now()
        from public.conversations c
        where p.conversation_id = c.id and c.team_id = m.team_id and c.type in ('team', 'announcement') and c.closed_at is null
          and p.person_id = old.guardian_person_id and p.left_at is null and p.basis = 'guardian';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger trg_guardianships_sync_conversations
  after insert or update of ended_at on public.guardianships
  for each row execute function public.guardianships_sync_conversations();

revoke all privileges on function public.ensure_team_conversation(uuid, uuid, public.conversation_type) from public, anon, authenticated;
revoke all privileges on function public.team_conversation_add(uuid, uuid, uuid, public.team_role) from public, anon, authenticated;
revoke all privileges on function public.team_conversation_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_team_conversation(uuid, uuid, public.conversation_type), public.team_conversation_add(uuid, uuid, uuid, public.team_role),
  public.team_conversation_remove(uuid, uuid, uuid) to service_role;
revoke all privileges on function public.team_memberships_sync_conversations() from public, anon, authenticated, service_role;
revoke all privileges on function public.guardianships_sync_conversations() from public, anon, authenticated, service_role;

-- Backfill: every live membership today.
do $$
declare m record;
begin
  for m in select person_id, team_id, season_id, role from public.team_memberships where left_at is null order by role desc loop
    perform public.team_conversation_add(m.team_id, m.season_id, m.person_id, m.role);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- =============================================================================
-- 5. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the two triggers and five functions. Team conversations already created
-- stay (they are conversations like any other).
