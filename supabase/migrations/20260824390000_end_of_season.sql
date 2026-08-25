-- =============================================================================
-- End of season: age-group upgrade and season rollover (Adam, 2026-08-25)
-- =============================================================================
-- "Create a fully functioning end of season process to upgrade age groups etc."
--
--   1. bump_age_group(text): "U14" → "U15", "U08" → "U09" (padding kept below
--      ten, dropped at "U10"), "Under 12s" → "Under 13s". First occurrence
--      only, so "AoM FC U14 Mavericks" → "AoM FC U15 Mavericks". Anything
--      without an age number — "Open age", null — comes back unchanged.
--   2. end_of_season_preview(): what the rollover WOULD do, team by team —
--      proposed name and age group plus the live headcount that would carry.
--      The screen shows this so the administrator ticks with open eyes.
--   3. end_of_season_rollover(new_season, upgrade_ids?, retire_ids?):
--        - retires the named teams (active = false; their rosters stay in the
--          old season untouched);
--        - bumps age_group AND name on the upgraded teams — the name matters
--          because the club-wide Full-Time widgets match teams BY NAME, and
--          next season's Full-Time listings will call them U15 too;
--        - copies every live team_membership (players and staff alike, with
--          shirt numbers) from the closing season into the new one;
--        - makes the new season current, which is the switch everything else
--          already follows: the nightly Full-Time import writes new fixtures
--          into the current season, and /join registers people into it.
--      One transaction, one audit_log row, a jsonb summary back.
--
-- What it deliberately does NOT do: registrations and memberships are per
-- (person, season) by design — health questions and consents must be answered
-- afresh — so nobody is auto-registered into the new season. The rosters
-- carry so the teams keep working day one; the join flow re-registers people
-- over the season as they come.
--
-- Double-run safety: the rollover reads the CURRENT season as its source and
-- refuses a target that is already current — so running it twice with the
-- same target is refused rather than bumping every team a second year.
--
-- Rollback: drop function end_of_season_rollover, end_of_season_preview,
-- bump_age_group.
-- =============================================================================


-- 1. bump_age_group -----------------------------------------------------------
create or replace function public.bump_age_group(p_text text)
  returns text
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  m text[];
  n integer;
begin
  if p_text is null then
    return null;
  end if;

  -- "Under 12s" / "under 12" style.
  m := regexp_match(p_text, '(?i)(under\s+)(\d{1,2})');
  if m is not null then
    n := m[2]::integer + 1;
    return regexp_replace(p_text, '(?i)(under\s+)' || m[2], m[1] || n::text);
  end if;

  -- "U14" / "U08" style, as its own word (so "AoM FC U14 Mavericks" bumps the
  -- U14 and nothing else). Zero padding survives while it still fits: U08 →
  -- U09 → U10.
  m := regexp_match(p_text, '\m[Uu](0?)(\d{1,2})\M');
  if m is not null then
    n := m[2]::integer + 1;
    return regexp_replace(
      p_text,
      '\m([Uu])0?' || m[2] || '\M',
      '\1' || case when m[1] = '0' and n <= 9 then '0' else '' end || n::text);
  end if;

  return p_text;
end $$;
comment on function public.bump_age_group(text) is
  'One year older: U14→U15, U08→U09, "Under 12s"→"Under 13s"; first age number only; no number, no change.';


-- 2. Preview ------------------------------------------------------------------
create or replace function public.end_of_season_preview()
  returns table (
    team_id            uuid,
    name               text,
    age_group          text,
    proposed_name      text,
    proposed_age_group text,
    live_players       bigint,
    live_staff         bigint
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select t.id, t.name, t.age_group,
         public.bump_age_group(t.name), public.bump_age_group(t.age_group),
         count(tm.id) filter (where tm.role = 'player'),
         count(tm.id) filter (where tm.role <> 'player')
  from public.teams t
  left join public.seasons s on s.is_current
  left join public.team_memberships tm
         on tm.team_id = t.id and tm.season_id = s.id and tm.left_at is null
  where t.active
    and (auth.uid() is null or public.is_club_admin())
  group by t.id, t.name, t.age_group, t.sort_order
  order by t.sort_order, t.name;
$$;


-- 3. Rollover -----------------------------------------------------------------
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
                             'staff_carried', v_staff));

  return jsonb_build_object(
    'from_season', v_cur.name, 'to_season', v_new.name,
    'teams_upgraded', v_bumped, 'teams_retired', v_retired,
    'players_carried', v_players, 'staff_carried', v_staff);
end;
$$;


-- 4. Grants -------------------------------------------------------------------
revoke all privileges on function public.bump_age_group(text) from public, anon;
grant execute on function public.bump_age_group(text) to authenticated, service_role;
revoke all privileges on function public.end_of_season_preview() from public, anon;
grant execute on function public.end_of_season_preview() to authenticated, service_role;
revoke all privileges on function public.end_of_season_rollover(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.end_of_season_rollover(uuid, uuid[], uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
