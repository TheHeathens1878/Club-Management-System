-- =============================================================================
-- Registration team rules — age band, and the sex a team admits
-- =============================================================================
-- Adam, 2026-08-26:
--   "When registering a player, limit the teams they can choose to their own
--    age group (be careful not to fall foul of UTC issues) and the age group
--    above."
--   "Males cannot join female teams but females can join males."
--
-- What this migration adds:
--   1. `people.sex` — nullable text, 'male' or 'female'. The registration form
--      already asked for a biological sex and threw it away everywhere except
--      a waiting-list entry; it is a fact about the person, so it lives on the
--      person. NULL means unknown (legacy imports), and unknown is never read
--      as 'male'.
--   2. `public.fa_age_band(dob, on_date)` — the FA U-band as a number. Both
--      arguments are `date`, which in Postgres is a CALENDAR DATE with no time
--      and no zone, so the UTC trap that bites JavaScript cannot arise here:
--      `extract(month from ...)` is asking about the printed date itself. The
--      "today" wrapper takes the current date in EUROPE/LONDON, because the
--      season boundary is a local statement about a club in Cheshire and the
--      database runs in UTC.
--   3. `public.team_admits_sex(sex, gender)` — the one-line league rule.
--   4. `public.may_register_for_team(person, team)` — both rules together,
--      SECURITY DEFINER so the answer does not depend on which `people` rows
--      the asker can otherwise see. The screens ask it nothing; it is what the
--      guard uses, and what a test can call.
--   5. `registrations_guard()` gains one paragraph. The body below is
--      20260825260000's version — the CURRENT one — with the new paragraph
--      marked; copying an older body would silently revert the withdrawal
--      rules.
--   6. `public.set_person_sex()` and `public.registration_subjects()` — the
--      two calls the registration screens make.
--
-- WHICH HALF IS ENFORCED WHERE (stated plainly, because the two rules differ):
--   · SEX. Enforced in the database for EVERY caller, admin included: it is a
--     league eligibility rule, not a club preference. Refused only when both
--     facts are known — an unknown `people.sex` or an unrecorded `teams.gender`
--     cannot prove a violation, so it does not manufacture one.
--   · AGE BAND. Enforced in the database for non-admins only, which is exactly
--     what the screen offers: a club administrator keeps the "show all teams"
--     escape and can place a player wherever the club decides. Refused only
--     when the team NAMES a U-band and it is not one of the two; a team whose
--     age group the club has never recorded is not something the database can
--     judge. The SCREEN is stricter in that one case — it does not offer a
--     youth player a team with no age group at all.
--
-- Rollback:
--   drop trigger/function additions in reverse; `registrations_guard()` is
--   restored by re-running 20260825260000's body verbatim. The precise
--   statements are at the foot of this file.
--
-- RLS: no new tables. `people.sex` is covered by the existing `people`
-- policies; it is written only through `set_person_sex()`, which checks
-- authority itself, and read only through `registration_subjects()`, which
-- does the same.
-- =============================================================================

-- 1. people.sex ---------------------------------------------------------------
alter table public.people
  add column if not exists sex text
    check (sex is null or sex in ('male', 'female'));

comment on column public.people.sex is
  'Biological sex as recorded at registration, for league eligibility (a girls'' team admits female players only). NULL means the club has never been told; unknown is never read as male.';


-- 2. The age band, from calendar dates ----------------------------------------
-- THE RULE, stated once:
--   season year = the year the season STARTS. The club season runs 1 July to
--                 30 June (Adam, 2026-08-25), so July–December is the season of
--                 its own year and January–June the season of the year before.
--   cohort year = the year the player's FA birth cohort starts. The cut-off is
--                 31 August: a birthday on or after 1 September belongs to the
--                 cohort of its own year, one on or before 31 August to the
--                 cohort of the year before.
--   band        = season year − cohort year. Born 2014-09-01 → cohort 2014 →
--                 U12 in 2026/27. Born 2014-08-31 → cohort 2013 → U13.
-- The band is NOT clamped: 24 means an adult, and the callers below rely on it.
create or replace function public.fa_age_band(p_dob date, p_on date)
  returns integer
  language sql
  immutable
  set search_path = public
as $$
  select case
           when p_dob is null or p_on is null then null
           else (case when extract(month from p_on)::int >= 7
                      then extract(year from p_on)::int
                      else extract(year from p_on)::int - 1 end)
              - (case when extract(month from p_dob)::int >= 9
                      then extract(year from p_dob)::int
                      else extract(year from p_dob)::int - 1 end)
         end;
$$;

comment on function public.fa_age_band(date, date) is
  'FA age band as a number (12 = U12), from the season start year (1 July) minus the birth cohort year (1 September). Dates only: a Postgres date carries no zone, so there is no UTC edge to fall off.';

-- "Today" is a local date. The database runs in UTC and the club does not.
create or replace function public.fa_age_band_today(p_dob date)
  returns integer
  language sql
  stable
  set search_path = public
as $$
  select public.fa_age_band(p_dob, (now() at time zone 'Europe/London')::date);
$$;

revoke all privileges on function public.fa_age_band(date, date) from public, anon;
revoke all privileges on function public.fa_age_band_today(date) from public, anon;
grant execute on function public.fa_age_band(date, date) to authenticated, service_role;
grant execute on function public.fa_age_band_today(date) to authenticated, service_role;


-- 3. The sex a team admits ----------------------------------------------------
-- Adam, 2026-08-26: "Males cannot join female teams but females can join
-- males." A girls' team admits a female player only; a boys' team and a mixed
-- team admit anyone. `teams.gender` is null | 'mixed' | 'boys' | 'girls'
-- (20260824170000); null means the club has not said, which is not a refusal.
create or replace function public.team_admits_sex(p_sex text, p_team_gender text)
  returns boolean
  language sql
  immutable
  set search_path = public
as $$
  select not (lower(coalesce(p_sex, '')) = 'male'
              and lower(coalesce(p_team_gender, '')) in ('girls', 'female'));
$$;

comment on function public.team_admits_sex(text, text) is
  'A girls'' team admits female players only; every other make-up admits anyone. An unknown sex or an unrecorded make-up cannot prove a violation and is allowed.';

revoke all privileges on function public.team_admits_sex(text, text) from public, anon;
grant execute on function public.team_admits_sex(text, text) to authenticated, service_role;


-- 4. Both rules, for one person and one team ----------------------------------
-- SECURITY DEFINER: the answer must not depend on which `people` or `teams`
-- rows the asker happens to be able to read.
create or replace function public.may_register_for_team(p_person_id uuid, p_team_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_dob    date;
  v_sex    text;
  v_gender text;
  v_group  text;
  v_band   integer;
  v_team   integer;
begin
  if p_team_id is null then
    return true;   -- a team-less registration: the club places them by hand
  end if;

  select p.dob, p.sex into v_dob, v_sex from public.people p where p.id = p_person_id;
  select t.gender, t.age_group into v_gender, v_group from public.teams t where t.id = p_team_id;

  if not public.team_admits_sex(v_sex, v_gender) then
    return false;
  end if;

  v_team := public.waiting_list_age_number(v_group);
  if v_team is null then
    -- The club has not recorded an age group for this team, so there is no
    -- band to be outside of.
    return true;
  end if;

  -- SG-0: an unknown date of birth is a minor, and a minor the club cannot
  -- place. Fail closed.
  if v_dob is null then
    return false;
  end if;

  v_band := greatest(public.fa_age_band_today(v_dob), 5);
  if v_band > 18 then
    return false;   -- an adult does not belong in a U-band team
  end if;
  return v_team in (v_band, v_band + 1);
end;
$$;

comment on function public.may_register_for_team(uuid, uuid) is
  'Own age band or the one above, and the sex the team admits. Null team = true.';

revoke all privileges on function public.may_register_for_team(uuid, uuid) from public, anon;
grant execute on function public.may_register_for_team(uuid, uuid) to authenticated, service_role;


-- 5. The guard ----------------------------------------------------------------
-- 20260825260000's body, with the marked paragraph added.
create or replace function public.registrations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_caller uuid := public.current_person_id();
  v_admin  boolean := public.is_club_admin();
  v_sex    text;
  v_gender text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and not v_admin and auth.uid() is not null then
      raise exception 'registrations: a new registration starts as pending' using errcode = 'P0001';
    end if;
    if new.submitted_by is null then
      new.submitted_by := auth.uid();
    end if;
    -- Who may submit.
    if auth.uid() is not null and not v_admin then
      if public.is_minor(new.person_id) then
        if not exists (
          select 1 from public.guardianships g
          where g.child_person_id = new.person_id
            and g.guardian_person_id = v_caller
            and g.ended_at is null)
        then
          raise exception
            'registrations: a minor may be registered only by an active guardian or a club_admin [SAFEGUARDING.md SG-4]'
            using errcode = 'P0001';
        end if;
      elsif new.person_id is distinct from v_caller then
        -- 20260824280000: an adult HOUSEHOLD member — created by this login
        -- and holding no login of their own — may be registered by whoever
        -- created them (the join wizard's spouse case). Anyone else: refused.
        if not public.is_household_member_of(new.person_id) then
          raise exception 'registrations: an adult registers themself (or a club_admin does it for them)'
            using errcode = 'P0001';
        end if;
      end if;
    end if;

    -- NEW (Adam, 2026-08-26): which team this player may be put in.
    if new.team_id is not null then
      -- (a) The league's rule, and it binds everybody — a club administrator
      --     cannot put a boy in a girls' team either. Refused only where both
      --     facts are on record: an unknown sex or an unrecorded team make-up
      --     is not evidence of a breach.
      select p.sex into v_sex from public.people p where p.id = new.person_id;
      select t.gender into v_gender from public.teams t where t.id = new.team_id;
      if not public.team_admits_sex(v_sex, v_gender) then
        raise exception
          'registrations: that is a girls'' team, and this player is recorded as male — a female player may join a boys'' or mixed team, but not the other way round'
          using errcode = 'P0001';
      end if;
      -- (b) The club's rule, and it binds a parent or a coach, not a club
      --     administrator: the screen offers the two bands and offers "show
      --     all teams" only to an administrator, so the database says the
      --     same thing.
      if auth.uid() is not null and not v_admin
         and not public.may_register_for_team(new.person_id, new.team_id)
      then
        raise exception
          'registrations: a player may be registered only for their own age group or the one above it — ask a club administrator if this team is right for them'
          using errcode = 'P0001';
      end if;
    end if;

    return new;
  end if;

  -- UPDATE
  if new.person_id <> old.person_id or new.season_id <> old.season_id
     or new.submitted_by is distinct from old.submitted_by or new.submitted_at <> old.submitted_at then
    raise exception 'registrations: person, season and submission are immutable' using errcode = 'P0001';
  end if;

  -- NEW (Adam, 2026-08-26): moving a registration onto a team is the same
  -- decision as making one there, so the league's rule is re-asked. The age
  -- band is not re-asked on UPDATE: moving a player between age groups is
  -- exactly what a club administrator does at the admin queue, and the INSERT
  -- branch has already refused everyone else a team of their own choosing.
  if new.team_id is distinct from old.team_id and new.team_id is not null then
    select p.sex into v_sex from public.people p where p.id = new.person_id;
    select t.gender into v_gender from public.teams t where t.id = new.team_id;
    if not public.team_admits_sex(v_sex, v_gender) then
      raise exception
        'registrations: that is a girls'' team, and this player is recorded as male — a female player may join a boys'' or mixed team, but not the other way round'
        using errcode = 'P0001';
    end if;
  end if;

  if new.status <> old.status then
    if old.status in ('rejected', 'withdrawn') then
      raise exception 'registrations: a % registration is final; submit a new one', old.status using errcode = 'P0001';
    end if;
    if new.status = 'pending' then
      raise exception 'registrations: cannot return to pending' using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'rejected') and not v_admin and auth.uid() is not null then
      raise exception 'registrations: only a club_admin may approve or reject' using errcode = 'P0001';
    end if;
    if new.status = 'withdrawn' and not v_admin and auth.uid() is not null then
      -- the subject (adult) or an active guardian (minor) may withdraw
      if not (new.person_id = v_caller
              or exists (select 1 from public.guardianships g
                         where g.child_person_id = new.person_id
                           and g.guardian_person_id = v_caller and g.ended_at is null))
      then
        raise exception 'registrations: only the subject, an active guardian or a club_admin may withdraw'
          using errcode = 'P0001';
      end if;
      -- 20260825260000 (Adam, 2026-08-25): and only while it is still waiting.
      if old.status <> 'pending' then
        raise exception 'registrations: this registration has been approved — ask a club administrator to withdraw it'
          using errcode = 'P0001';
      end if;
    end if;
    new.decided_at := now();
    new.decided_by := auth.uid();

    -- Approval with a team: create the live player membership for the season.
    -- P2.1's SG-6 guard runs here and may refuse, which fails the approval.
    if new.status = 'approved' and new.team_id is not null
       and not exists (select 1 from public.team_memberships m
                       where m.person_id = new.person_id and m.team_id = new.team_id
                         and m.season_id = new.season_id and m.role = 'player' and m.left_at is null)
    then
      insert into public.team_memberships (person_id, team_id, season_id, role, created_by)
      values (new.person_id, new.team_id, new.season_id, 'player', auth.uid());
    end if;
  elsif (new.decided_at is distinct from old.decided_at or new.decided_by is distinct from old.decided_by) then
    raise exception 'registrations: decided_at/decided_by are set by the status change' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.registrations_guard() is
  'Who may register whom, into which team, and what may become what. A girls'' team admits female players only (everyone, admins included); a parent or coach may pick only the player''s own age band or the one above. A guardian or the subject may withdraw a PENDING registration; an approved one is a club administrator''s to withdraw.';

revoke all privileges on function public.registrations_guard() from public, anon, authenticated, service_role;


-- 6. What the registration screens call ---------------------------------------
-- The sex the family gives on the form, kept on the person rather than buried
-- in one registration's JSON. `can_act_for()` is self or a guarded minor;
-- `is_household_member_of()` is the login-less adult this account created.
create or replace function public.set_person_sex(p_person_id uuid, p_sex text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sex text := lower(btrim(coalesce(p_sex, '')));
begin
  if v_sex not in ('male', 'female') then
    raise exception 'people: sex must be recorded as male or female' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin()
          or public.can_act_for(p_person_id)
          or public.is_household_member_of(p_person_id)) then
    raise exception 'people: the club''s records do not show you as able to record this for that person'
      using errcode = 'P0001';
  end if;
  update public.people set sex = v_sex where id = p_person_id;
end;
$$;

comment on function public.set_person_sex(uuid, text) is
  'Record a player''s sex from the registration form. Self, a guarded minor, a login-less household adult, or a club administrator.';

revoke all privileges on function public.set_person_sex(uuid, text) from public, anon;
grant execute on function public.set_person_sex(uuid, text) to authenticated, service_role;

-- The two facts a registration screen needs about each person it can register:
-- the date of birth the age band comes from, and the sex already on record so
-- the form does not ask a question it has already been answered.
create or replace function public.registration_subjects(p_person_ids uuid[])
  returns table (person_id uuid, dob date, sex text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id, p.dob, p.sex
    from public.people p
   where p.id = any (coalesce(p_person_ids, '{}'::uuid[]))
     and p.deleted_at is null
     and (public.is_club_admin()
          or public.can_act_for(p.id)
          -- `can_act_for()` stops at 18; a guardianship on record does not, and
          -- a child who has just turned 18 still appears on their parent's
          -- screen. Reading a date of birth the screen already shows is not a
          -- widening of anything.
          or public.is_active_guardian_of(p.id)
          or public.is_household_member_of(p.id));
$$;

comment on function public.registration_subjects(uuid[]) is
  'Date of birth and recorded sex for the people the caller may register. Anyone else is simply absent from the result.';

revoke all privileges on function public.registration_subjects(uuid[]) from public, anon;
grant execute on function public.registration_subjects(uuid[]) to authenticated, service_role;


-- =============================================================================
-- ROLLBACK
-- =============================================================================
--   create or replace function public.registrations_guard() ... -- the body in
--     supabase/migrations/20260825260000_registration_followups.sql §4, verbatim
--   drop function if exists public.registration_subjects(uuid[]);
--   drop function if exists public.set_person_sex(uuid, text);
--   drop function if exists public.may_register_for_team(uuid, uuid);
--   drop function if exists public.team_admits_sex(text, text);
--   drop function if exists public.fa_age_band_today(date);
--   drop function if exists public.fa_age_band(date, date);
--   alter table public.people drop column if exists sex;
-- =============================================================================
