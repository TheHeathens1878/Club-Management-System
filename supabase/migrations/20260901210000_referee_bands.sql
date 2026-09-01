-- =============================================================================
-- One band below, until sixteen
-- =============================================================================
-- Adam, 2026-09-01: referees should show their age group in the group list,
-- "one band below until 16".
--
-- The rule is the FA's and the club follows it, the same way 20260901160000
-- followed the FA on registering referees from 14: a young referee officiates
-- players YOUNGER than they are, and the youth restriction lifts at 16. So a
-- referee in the U15 band takes U14 and below; at 16 they take anything the
-- club posts.
--
--   own band 15, under 16  ->  ceiling U14
--   own band 16, over 16   ->  no ceiling
--   date of birth unknown  ->  no games at all (SG-0)
--
-- THE THIRD LINE IS NOT A ROUNDING ERROR. One of the three referees on
-- production today has no date of birth: the hat was granted before the age
-- guard existed, and the guard only speaks at INSERT. SG-0 says unknown is a
-- minor everywhere in this schema, and a rule about how young a referee may be
-- cannot make an exception for the case where we do not know. The cost is
-- visible rather than silent — the group list says the club needs their date
-- of birth — and it heals the moment they give it, because
-- `needs_dob_completion()` already stops them at sign-in until they do.
--
--
-- 1. WHERE THE RULE LIVES
-- ---------------------------------------------------------------------------
-- On the person, in one function, for the same reason 20260901160000 put the
-- age check on the role: a rule written twice is a rule that will disagree
-- with itself. `referee_may_take_band()` is the predicate; the claim guard
-- calls it and the group list calls the reporting function beside it. Neither
-- computes a band of its own.
--
-- The two ages are settings, not literals: `safeguarding.min_referee_age`
-- (14, already here) and `safeguarding.referee_open_age` (16, new), both read
-- through `safeguarding_setting_int()`.
--
--
-- 2. AND A BUG IN THE FUNCTION THAT READS THEM
-- ---------------------------------------------------------------------------
-- `safeguarding_setting_int()` was redefined in 20260901160000 and its digit
-- test arrived as `'^d+$'` — the backslash lost somewhere between writing and
-- the file. `'12'` does not match `^d+$`, so EVERY stored value failed the
-- test and every read silently returned the documented default instead.
--
-- Nothing was wrong on production, by luck: all four stored values equal their
-- defaults. But an administrator lowering an age in site_settings would have
-- been ignored, and the audit trail would have said they had not been. It is
-- rewritten here as `'^[0-9]+$'` — the character class the ORIGINAL
-- 20260822140000 definition used, chosen again deliberately, because a
-- backslash in a regex in a string in a migration is a thing that has now gone
-- wrong once.
--
--
-- 3. WHAT IS ENFORCED, AND WHERE THE CLUB CANNOT KNOW
-- ---------------------------------------------------------------------------
-- Claiming a game is an UPDATE on referee_match_posts, and its guard already
-- refuses a claim by somebody who is not a referee. It now also refuses one
-- above the claimer's ceiling — but only where the club actually knows what
-- age group the game is. A card carries `fixture_id` when it was posted from a
-- fixture, and that fixture's team carries an age group; `age_group_band_range()`
-- and `age_group_is_adult()` read it, exactly as `may_register_for_team()`
-- does. A hand-typed card with no fixture names its age group only in prose,
-- and nothing here parses prose.
--
-- So the refusal is evidence-based, which is the rule 20260825530000 set for
-- this schema: a team whose age group the club has never recorded is not
-- something the database can judge. A card the database cannot judge is left
-- to the person posting it and the administrator watching the group. This is
-- stated rather than hidden, because a half-enforced rule that reads as a
-- whole one is worse than an honest one.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered; the two new functions are SECURITY DEFINER with EXECUTE revoked
-- from anon, and the reporting one answers only for a caller who can already
-- see the Referees group. Data touched: one site_settings row inserted
-- (`safeguarding.referee_open_age` = 16); no role granted or revoked, no claim
-- changed. Rollback: §7.
-- =============================================================================


-- =============================================================================
-- 1. The settings, and the function that reads them
-- =============================================================================

create or replace function public.safeguarding_setting_int(p_key text)
  returns integer
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $function$
declare
  v_default integer;
  v_value   text;
begin
  v_default := case p_key
    when 'safeguarding.min_account_age'                then 13
    when 'safeguarding.unsupervised_messaging_min_age' then 14
    when 'safeguarding.self_account_age'               then 16
    when 'safeguarding.min_referee_age'                then 14
    when 'safeguarding.referee_open_age'               then 16
    else null
  end;

  if v_default is null then
    raise exception
      'safeguarding_setting_int: no documented default for key % — add one here before reading it [SAFEGUARDING.md SG-10]',
      p_key;
  end if;

  select s.value into v_value
    from public.site_settings s
   where s.key = p_key;

  -- A character class, not \d: see §2 of this file's header. A stored value
  -- that is not a plain integer is ignored in favour of the documented
  -- default, which is the behaviour 20260822140000 intended all along.
  if v_value is null or v_value !~ '^[0-9]+$' then
    return v_default;
  end if;
  return v_value::integer;
end $function$;

insert into public.site_settings (key, value)
values ('safeguarding.referee_open_age', '16')
on conflict (key) do nothing;


-- =============================================================================
-- 2. The band a referee may take
-- =============================================================================
-- One row per person asked about, so a list costs one call. Every column says
-- one thing:
--
--   dob_known  the club has a date of birth. False means no games at all.
--   own_band   their own FA band today (15 = U15). Null when dob is unknown.
--   unlimited  they are at or past the open age, so no youth ceiling applies.
--   max_band   the highest band they may take. Null when unlimited (no
--              ceiling) and null when the date of birth is unknown (no games).
--              `unlimited` is what tells those two apart.

create or replace function public.referee_bands(p_person_ids uuid[])
  returns table (
    person_id  uuid,
    dob_known  boolean,
    own_band   integer,
    unlimited  boolean,
    max_band   integer
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  with settings as (
    select public.safeguarding_setting_int('safeguarding.referee_open_age') as open_age
  ),
  asked as (
    select p.id, p.dob
      from public.people p
     where p.id = any (p_person_ids)
       and p.deleted_at is null
  )
  select a.id,
         a.dob is not null,
         case when a.dob is not null then public.fa_age_band_today(a.dob) end,
         coalesce(a.dob is not null and public.is_at_least_age(a.dob, s.open_age), false),
         case
           when a.dob is null then null
           when public.is_at_least_age(a.dob, s.open_age) then null
           -- One band below their own, and everything under it.
           else public.fa_age_band_today(a.dob) - 1
         end
    from asked a
   cross join settings s;
$$;

comment on function public.referee_bands(uuid[]) is
  'The age groups each of these people may referee: one band below their own until the open age (16), no ceiling from it, and nothing at all while the club has no date of birth (SG-0). Reports; it does not enforce — referee_may_take_band() is the predicate.';

-- NOT granted to `authenticated`. It takes any person id, and an FA band is
-- age information about a minor — coarse, but not something every signed-in
-- member should be able to ask about every other person. The two functions
-- below are the doors, and both are SECURITY DEFINER, so they may call this
-- one without the caller holding EXECUTE on it.
revoke all privileges on function public.referee_bands(uuid[]) from public, anon, authenticated;
grant execute on function public.referee_bands(uuid[]) to service_role;


-- The predicate. `p_band` is an FA band number: 14 for a U14 game, and the
-- club's adult sides are handled by the caller, which knows an adult label
-- when it sees one and asks with `null`.
create or replace function public.referee_may_take_band(p_person_id uuid, p_band integer)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    -- Not a referee: this question is not about a ceiling.
    when not public.person_has_role(p_person_id, 'referee'::public.app_role) then false
    -- An adult game (the caller passes null for one) needs the open age.
    when p_band is null then coalesce((select b.unlimited from public.referee_bands(array[p_person_id]) b), false)
    else coalesce((
      select b.unlimited or (b.max_band is not null and p_band <= b.max_band)
        from public.referee_bands(array[p_person_id]) b
    ), false)
  end;
$$;

comment on function public.referee_may_take_band(uuid, integer) is
  'May this referee take a game in this FA band? Null band means an adult side, which needs the open age. False for anybody without the referee hat, and false while the club has no date of birth.';

revoke all privileges on function public.referee_may_take_band(uuid, integer) from public, anon;
grant execute on function public.referee_may_take_band(uuid, integer) to authenticated, service_role;


-- =============================================================================
-- 3. The Referees group's list, with the bands on it
-- =============================================================================
-- Scoped to the one group it is for, and to the people who can already see
-- that group. An age band is coarse, but it is still age information about a
-- minor, and it is not something any signed-in member should be able to ask
-- about any other person. A participant of the Referees group and a club
-- administrator are exactly the readers the group list has.

create or replace function public.referees_group_bands()
  returns table (
    person_id  uuid,
    dob_known  boolean,
    own_band   integer,
    unlimited  boolean,
    max_band   integer
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_group uuid := public.referees_group_id();
  v_me    uuid := public.current_person_id();
begin
  if v_group is null then
    return;
  end if;
  if not (
    public.is_club_admin()
    or (v_me is not null and exists (
          select 1 from public.conversation_participants cp
           where cp.conversation_id = v_group
             and cp.person_id = v_me
             and cp.left_at is null))
  ) then
    return;
  end if;

  return query
    select b.person_id, b.dob_known, b.own_band, b.unlimited, b.max_band
      from public.referee_bands(
             array(select cp.person_id
                     from public.conversation_participants cp
                    where cp.conversation_id = v_group
                      and cp.left_at is null)
           ) b;
end $$;

comment on function public.referees_group_bands() is
  'Every current member of the Referees group with the age groups they may take. Answers only for a participant of that group or a club administrator; anybody else gets no rows.';

revoke all privileges on function public.referees_group_bands() from public, anon;
grant execute on function public.referees_group_bands() to authenticated, service_role;


-- =============================================================================
-- 4. Claiming a game
-- =============================================================================
-- The 20260825180000 guard (claim, release, and the refusal to hand a live
-- claim straight to somebody else), with one paragraph added: a claim is also
-- refused when the club knows the game's age group and it is above the
-- claimer's ceiling. Every other line is that function verbatim.

create or replace function public.referee_match_posts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me        uuid := public.current_person_id();
  v_age_group text;
  v_range     int4range;
  v_band      integer;
  v_adult     boolean := false;
  v_known     boolean := false;
  v_label     text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.message_id, new.conversation_id, new.posted_by_person_id,
      coalesce(new.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      new.fixture_text, coalesce(new.duration_text, ''), coalesce(new.format_text, ''),
      coalesce(new.location_text, ''), coalesce(new.surface, ''),
      coalesce(new.kickoff_at, 'epoch'::timestamptz), coalesce(new.fee_text, ''))
     is distinct from
     (old.message_id, old.conversation_id, old.posted_by_person_id,
      coalesce(old.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      old.fixture_text, coalesce(old.duration_text, ''), coalesce(old.format_text, ''),
      coalesce(old.location_text, ''), coalesce(old.surface, ''),
      coalesce(old.kickoff_at, 'epoch'::timestamptz), coalesce(old.fee_text, ''))
  then
    raise exception 'referee_match_posts: a posted card''s details cannot be edited' using errcode = 'P0001';
  end if;

  -- Claim: unclaimed → claimed, by the caller, who must hold the referee hat
  -- and, now, be old enough for the game.
  if old.claimed_by_person_id is null and new.claimed_by_person_id is not null then
    if new.claimed_by_person_id <> v_me then
      raise exception 'referee_match_posts: a game is claimed for yourself, not somebody else' using errcode = 'P0001';
    end if;
    if not public.person_has_role(new.claimed_by_person_id, 'referee'::public.app_role) then
      raise exception 'referee_match_posts: only an approved referee may claim a game' using errcode = 'P0001';
    end if;

    -- What age group is this game? Only a card posted from a fixture can say,
    -- and only when the club has recorded that team's age group. Anything
    -- else is left alone: see §3 of this file's header.
    if new.fixture_id is not null then
      select t.age_group into v_age_group
        from public.fixtures f
        join public.teams t on t.id = f.team_id
       where f.id = new.fixture_id;

      if v_age_group is not null then
        v_adult := public.age_group_is_adult(v_age_group);
        v_range := public.age_group_band_range(v_age_group);
        if v_adult then
          v_known := true;
          v_band  := null;  -- an adult side: the open age, or nothing
          v_label := v_age_group;
        elsif v_range is not null then
          v_known := true;
          -- The TOP of the range is the oldest players on the pitch, and they
          -- are who the rule is about. Postgres normalises a discrete range to
          -- a half-open one, so int4range(5,8,'[]') is [5,9) and `upper()` is
          -- 9 — the inclusive top is one less.
          v_band  := upper(v_range) - 1;
          v_label := 'U' || v_band::text;
        end if;
      end if;
    end if;

    if v_known and not public.referee_may_take_band(new.claimed_by_person_id, v_band) then
      raise exception
        'referee_match_posts: this is a % game, and the club''s rule is that a referee under % takes one age group below their own. A club administrator can post it to somebody else.',
        v_label,
        public.safeguarding_setting_int('safeguarding.referee_open_age')
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  -- Release: claimed → unclaimed, by the referee holding it, the poster, or a
  -- club administrator. The pair constraint keeps claimed_at in step.
  if old.claimed_by_person_id is not null and new.claimed_by_person_id is null then
    if v_me is distinct from old.claimed_by_person_id
       and v_me is distinct from old.posted_by_person_id
       and not public.is_club_admin()
    then
      raise exception 'referee_match_posts: only the referee who claimed this game, the person who posted it or a club administrator can release it'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Anything else that moves a live claim (to another referee in one step) is refused.
  if old.claimed_by_person_id is not null
     and new.claimed_by_person_id is distinct from old.claimed_by_person_id
  then
    raise exception 'referee_match_posts: this game is already claimed — release it first and it reopens for the next referee'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;


-- =============================================================================
-- 5. ROLLBACK
-- =============================================================================
--   drop function if exists public.referees_group_bands();
--   drop function if exists public.referee_may_take_band(uuid, integer);
--   drop function if exists public.referee_bands(uuid[]);
--   delete from public.site_settings where key = 'safeguarding.referee_open_age';
--   -- and restore referee_match_posts_guard() from 20260825180000 and
--   -- safeguarding_setting_int() from 20260901160000 (bug and all) or,
--   -- better, from 20260822140000.
-- No claim already made is touched by any of this.
-- =============================================================================
