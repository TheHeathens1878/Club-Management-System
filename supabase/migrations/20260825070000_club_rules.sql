-- =============================================================================
-- Three club rules (Adam, 2026-08-25 evening)
-- =============================================================================
--   1. "Coaches should automatically be able to see the waiting list of their
--      age group and the age group below, nothing more." Access stops being
--      grant-only: a live coach/assistant_coach/manager of a U-age team sees
--      the entries (and notes) of that age group and the one below it,
--      automatically. Explicit `waiting_list_access` grants remain as the
--      admin's tool for anything wider (a recruitment lead, a secretary).
--   2. "At the end of season, the waiting list age group should also
--      increase." The rollover bumps every live entry one year (U10 → U11)
--      with the same bump_age_group() the teams use.
--   3. "Only admins can post to the club noticeboard." create_board_post()
--      refuses a CLUB-audience post from anyone but a club administrator;
--      team staff keep posting to their own teams' lobbies.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (waiting-list read policies
-- re-created, same names); data touched: waiting_list_entries.age_group at
-- rollover time only; rollback: restore the three function bodies from
-- 20260824000000 / 20260824390000 / 20260824400000+20260824460000 and the two
-- policies from 20260824000000.

-- 1a. The age band a label names, strictly: "U10"/"u08" → 10/8, anything else
--     (O45, Open age, blank) → null, so an Over-45s team can never match "U45".
create or replace function public.waiting_list_age_number(p_age_group text)
  returns integer
  language sql
  immutable
  set search_path = public
as $$
  select (regexp_match(upper(btrim(coalesce(p_age_group, ''))), '^U0*([0-9]{1,2})$'))[1]::integer;
$$;

-- 1b. The one question both policies ask. SECURITY DEFINER: the answer must
--     not depend on what team_memberships rows the asker can otherwise see.
create or replace function public.can_view_waiting_list_age_group(p_age_group text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.is_club_admin()
      or exists (select 1 from public.waiting_list_access a
                  where a.person_id = public.current_person_id()
                    and a.age_group = p_age_group)
      or exists (select 1
                 from public.team_memberships m
                 join public.teams t on t.id = m.team_id
                 where m.person_id = public.current_person_id()
                   and m.left_at is null
                   and m.role in ('coach', 'assistant_coach', 'manager')
                   and public.waiting_list_age_number(t.age_group) is not null
                   and public.waiting_list_age_number(p_age_group)
                       in (public.waiting_list_age_number(t.age_group),
                           public.waiting_list_age_number(t.age_group) - 1));
$$;

revoke all privileges on function public.waiting_list_age_number(text) from public, anon;
grant execute on function public.waiting_list_age_number(text) to authenticated, service_role;
revoke all privileges on function public.can_view_waiting_list_age_group(text) from public, anon;
grant execute on function public.can_view_waiting_list_age_group(text) to authenticated, service_role;

-- 1c. Same policy names, wider readership. (Entries stay read-only to coaches;
--     admin write policies untouched.)
drop policy if exists "wl_entries_coach_read" on public.waiting_list_entries;
create policy "wl_entries_coach_read" on public.waiting_list_entries for select to authenticated
  using (public.can_view_waiting_list_age_group(waiting_list_entries.age_group));

drop policy if exists "wl_notes_coach_read" on public.waiting_list_notes;
create policy "wl_notes_coach_read" on public.waiting_list_notes for select to authenticated
  using (exists (select 1 from public.waiting_list_entries e
                  where e.id = waiting_list_notes.entry_id
                    and public.can_view_waiting_list_age_group(e.age_group)));

drop policy if exists "wl_notes_coach_insert" on public.waiting_list_notes;
create policy "wl_notes_coach_insert" on public.waiting_list_notes for insert to authenticated
  with check (author_person_id = public.current_person_id()
              and exists (select 1 from public.waiting_list_entries e
                           where e.id = waiting_list_notes.entry_id
                             and public.can_view_waiting_list_age_group(e.age_group)));

-- 1d. The nav's capability follows the same truth.
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

-- 2. The list grows up with the teams. Live entries only — a decided entry
--    (accepted/rejected/withdrawn/uncontactable) is history and keeps the age
--    group it was decided at.
--    Patch = the current 20260824390000 body plus the waiting-list block and
--    its counter in the audit row and the summary.
create or replace function public.end_of_season_rollover(
  p_new_season_id    uuid,
  p_upgrade_team_ids uuid[] default null,
  p_retire_team_ids  uuid[] default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_cur     public.seasons%rowtype;
  v_new     public.seasons%rowtype;
  v_upgrade uuid[];
  v_retired integer := 0;
  v_bumped  integer := 0;
  v_players integer := 0;
  v_staff   integer := 0;
  v_wl      integer := 0;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'end_of_season_rollover: club_admin only' using errcode = '42501';
  end if;

  select * into v_cur from public.seasons where is_current;
  if not found then
    raise exception 'end_of_season_rollover: there is no current season to roll over from' using errcode = 'P0001';
  end if;
  select * into v_new from public.seasons where id = p_new_season_id;
  if not found then
    raise exception 'end_of_season_rollover: unknown season %', p_new_season_id using errcode = 'P0001';
  end if;
  if v_new.id = v_cur.id then
    raise exception 'end_of_season_rollover: % is already the current season — the rollover has been run', v_new.name
      using errcode = 'P0001';
  end if;
  if v_new.starts_on <= v_cur.starts_on then
    raise exception 'end_of_season_rollover: % starts before the current season % — pick the season that follows it',
      v_new.name, v_cur.name using errcode = 'P0001';
  end if;

  -- Which teams go up: the named ones, or every active team, minus retirees.
  select coalesce(p_upgrade_team_ids, array_agg(id)) into v_upgrade
  from public.teams where active;
  v_upgrade := coalesce(v_upgrade, '{}'::uuid[]);
  if p_retire_team_ids is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_upgrade
    from unnest(v_upgrade) as u(id) where id <> all (p_retire_team_ids);
  end if;

  -- Retire first: a folded team is not bumped and its roster is not carried.
  if p_retire_team_ids is not null then
    update public.teams set active = false
     where id = any (p_retire_team_ids) and active;
    get diagnostics v_retired = row_count;
  end if;

  -- One year older, in the age group and in the name (the club Full-Time
  -- widgets match by name, and next season's listings will say U15 too).
  update public.teams
     set age_group = public.bump_age_group(age_group),
         name      = public.bump_age_group(name)
   where id = any (v_upgrade) and active;
  get diagnostics v_bumped = row_count;

  -- The waiting list grows up too (Adam, 2026-08-25): every undecided entry
  -- moves to next season's band with the same bump the teams got.
  update public.waiting_list_entries
     set age_group = public.bump_age_group(age_group)
   where status in ('pending', 'contacted', 'trialling');
  get diagnostics v_wl = row_count;

  -- Carry every live membership into the new season. Players and staff both:
  -- the squad and its coaches arrive on day one; shirt numbers travel.
  with carried as (
    insert into public.team_memberships
      (person_id, team_id, season_id, role, shirt_number, created_by)
    select tm.person_id, tm.team_id, p_new_season_id, tm.role, tm.shirt_number, auth.uid()
    from public.team_memberships tm
    where tm.season_id = v_cur.id
      and tm.left_at is null
      and tm.team_id = any (v_upgrade)
      and not exists (
        select 1 from public.team_memberships e
        where e.person_id = tm.person_id and e.team_id = tm.team_id
          and e.season_id = p_new_season_id and e.role = tm.role and e.left_at is null)
    returning role
  )
  select count(*) filter (where role = 'player'),
         count(*) filter (where role <> 'player')
    into v_players, v_staff
  from carried;

  -- The switch everything else follows: Full-Time imports and /join both
  -- write into the current season.
  update public.seasons set is_current = false where id = v_cur.id;
  update public.seasons set is_current = true  where id = p_new_season_id;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'season.rollover', 'seasons', p_new_season_id::text,
          jsonb_build_object('from_season', v_cur.id, 'from_name', v_cur.name,
                             'to_name', v_new.name, 'teams_upgraded', v_bumped,
                             'teams_retired', v_retired, 'players_carried', v_players,
                             'staff_carried', v_staff, 'waiting_list_bumped', v_wl));

  return jsonb_build_object(
    'from_season', v_cur.name, 'to_season', v_new.name,
    'teams_upgraded', v_bumped, 'teams_retired', v_retired,
    'players_carried', v_players, 'staff_carried', v_staff,
    'waiting_list_bumped', v_wl);
end;
$$;

notify pgrst, 'reload schema';

-- 3. The club noticeboard is the administrators' voice (Adam, 2026-08-25:
--    "Only admins can post to the club noticeboard"). Team staff keep posting
--    to their own teams' lobbies; a post with NO team targets — the club-wide
--    audience — now requires club_admin. Body otherwise verbatim from
--    20260824400000.
create or replace function public.create_board_post(
  p_title text,
  p_body text,
  p_team_ids uuid[] default null,
  p_age_groups text[] default null,
  p_push_to_boards boolean default false,
  p_pinned boolean default false
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me       uuid := public.current_person_id();
  v_admin    boolean := public.is_club_admin();
  v_staff    boolean;
  v_teams    uuid[];
  v_audience public.board_audience;
  v_post     uuid;
  v_person   uuid;
  v_title    text := btrim(coalesce(p_title, ''));
begin
  if v_me is null then
    raise exception 'create_board_post: your sign-in is not linked to a member record' using errcode = 'P0001';
  end if;
  v_staff := exists (
    select 1 from public.team_memberships m
    where m.person_id = v_me and m.left_at is null
      and m.role in ('coach', 'assistant_coach', 'manager'));
  if not (v_admin or v_staff) then
    raise exception 'Only the club''s administrators and team staff can post to the board.' using errcode = 'P0001';
  end if;

  -- The target list: named teams plus every active team in the named age groups.
  select coalesce(array_agg(distinct t.id), '{}') into v_teams
  from public.teams t
  where t.id = any(coalesce(p_team_ids, '{}'))
     or (p_age_groups is not null and t.age_group = any(p_age_groups));

  v_audience := case when coalesce(array_length(v_teams, 1), 0) > 0 then 'teams' else 'club' end::public.board_audience;

  if v_audience = 'club' and not v_admin then
    raise exception 'Only a club administrator can post to the club noticeboard.' using errcode = 'P0001';
  end if;
  if v_audience = 'teams' and not v_admin then
    -- Staff post to their own teams — all of them, not just one of the list.
    perform 1 from unnest(v_teams) as target(team_id) where not public.is_team_staff(target.team_id);
    if found then
      raise exception 'You can only post to teams you are staff of — a club administrator can post anywhere.' using errcode = 'P0001';
    end if;
  end if;
  if p_pinned and not v_admin then
    raise exception 'Only a club administrator can pin a post.' using errcode = 'P0001';
  end if;

  insert into public.board_posts (author_person_id, title, body, audience, push_to_boards, pinned)
  values (v_me, v_title, p_body, v_audience, v_audience = 'club' and p_push_to_boards, p_pinned and v_admin)
  returning id into v_post;

  insert into public.board_post_teams (post_id, team_id)
  select v_post, team_id from unnest(v_teams) team_id;

  -- A targeted post tells its audience in-app; a club-wide one is met in the
  -- lobby (see header). Author excluded, guardians for minors.
  if v_audience = 'teams' then
    for v_person in
      select distinct coalesce(g.guardian_person_id, m.person_id)
      from unnest(v_teams) as target(team_id)
      join public.team_memberships m on m.team_id = target.team_id and m.left_at is null
      left join public.guardianships g
        on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
    loop
      if v_person is distinct from v_me then
        perform public.notify(
          v_person,
          'Board: ' || v_title,
          left(p_body, 180) || case when length(p_body) > 180 then '…' else '' end,
          '/lobby/' || v_post, 'board_posts', v_post::text);
      end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'board.post_created', 'board_posts', v_post::text,
          jsonb_build_object('audience', v_audience, 'teams', v_teams, 'push', p_push_to_boards));
  return v_post;
end;
$$;

notify pgrst, 'reload schema';


-- 5. The parent view tells the truth about a squad child (Adam, 2026-08-25:
--    "The registrations are not showing in my parent view even though my
--    children have been approved and attached to the team"). A household
--    player on a CURRENT-season squad with no live registration row — a child
--    an admin attached directly, or an import — now appears in
--    my_registrations() as pseudo-status ACTIVE, keyed by the membership id.
--    Body otherwise verbatim from 20260824470000.
create or replace function public.my_registrations()
  returns table (
    registration_id uuid, person_id uuid, person_name text, is_self boolean,
    team_name text, season_name text, status text,
    submitted_at timestamptz, decided_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as pid),
  mine as (
    select pid as person_id from me where pid is not null
    union
    select g.child_person_id from public.guardianships g, me
    where g.guardian_person_id = me.pid and g.ended_at is null
    union
    select p.id from public.people p, me
    where p.created_by = auth.uid() and p.deleted_at is null
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
  )
  select r.id, r.person_id, p.first_name || ' ' || p.last_name,
         r.person_id = (select pid from me),
         t.name, s.name, r.status::text,
         r.created_at, r.decided_at
  from public.registrations r
  join mine on mine.person_id = r.person_id
  join public.people p on p.id = r.person_id
  join public.seasons s on s.id = r.season_id
  left join public.teams t on t.id = r.team_id
  union all
  select m.id, m.person_id, p.first_name || ' ' || p.last_name,
         m.person_id = (select pid from me),
         t.name, s.name, 'active',
         m.created_at, m.created_at
  from public.team_memberships m
  join mine on mine.person_id = m.person_id
  join public.people p on p.id = m.person_id
  join public.seasons s on s.id = m.season_id and s.is_current
  join public.teams t on t.id = m.team_id
  where m.left_at is null and m.role = 'player'
    and not exists (select 1 from public.registrations r
                     where r.person_id = m.person_id and r.season_id = m.season_id
                       and r.status in ('pending', 'approved'))
  order by 8 desc;
$$;
