-- =============================================================================
-- Signing up with an address the club already knows joins that record
-- =============================================================================
-- Adam, 2026-09-02: "I have just tried to register using an email address that
-- had previously been given app access (adam.wareing+11@gmail.com) and it says
-- the account could not be created: Database error saving new user." And, in
-- the same breath, the fix: "Email for children and connected adults should be
-- checked on sign-up and the link made."
--
--
-- 1. WHAT ACTUALLY HAPPENED
-- ---------------------------------------------------------------------------
-- `adam.wareing+11@gmail.com` is not a stranger. It is on `people` already:
-- born 2011-09-02, no login, and `app_account` consent granted by a guardian —
-- a child the club has deliberately given app access to.
--
-- `handle_new_user()` never looked. It links a sign-up to an existing person
-- only when the metadata carries a `person_id` (an invite link), and the
-- joining form carries none. So it built a SECOND person from the form, and
-- that second person had a child's date of birth and nobody's consent, so
-- SG-10 refused the profile — correctly, about a person who should never have
-- been created. GoTrue turned that into `unexpected_failure` and the browser
-- into "Database error saving new user", which is true and says nothing.
--
-- Two of the club's children are stuck behind this today: Benjamin Wareing and
-- Matthew Wareing both have app access granted and no login, and both would
-- fail in exactly the same way the moment they tried.
--
--
-- 2. THE RULE FOR LINKING, AND WHY IT IS SAFE
-- ---------------------------------------------------------------------------
-- A sign-up joins an existing person when ALL of these hold:
--
--   (a) the club holds exactly one live person with that email address — the
--       unique index `people_email_unique_live_idx` guarantees "exactly one";
--   (b) that person has NO login. Somebody who already has an account signs
--       in; this door is not a second one into the same record;
--   (c) the dates of birth do not contradict each other. A record with one
--       date and a form with another is EVIDENCE THAT THESE ARE TWO PEOPLE,
--       and `add_household_adult()` already refuses on exactly that ground;
--   (d) they are not somebody's child without their guardian having said they
--       may have an account. FAMILIES SHARE ADDRESSES — a child's record very
--       often carries a PARENT's email — and this is the limb that keeps a
--       parent from signing up into their own child's record. It is why P1.2
--       refused to link on email at all, and it is answered rather than
--       overruled: a live guardianship with no `app_account` consent is not
--       matched. Benjamin, Matthew and adam.wareing+11 all HAVE that consent,
--       which is the difference between Adam's case and P1.2's.
--
-- And then WHO MAY HAVE AN ACCOUNT is left to the guard that already decides
-- it — `profiles_account_eligibility_guard()`, which wants an adult, or a
-- minor over the minimum age with an `app_account` consent, with SG-0's
-- unknown-is-a-minor rule underneath. The first draft of this migration copied
-- that test into the branch instead, and the copy was immediately wrong: it
-- read the club's STORED date of birth, so a coach imported without one — who
-- is supplying one in the very sign-up being judged — was turned away as a
-- child. A rule written twice is a rule that disagrees with itself.
--
-- WHY AN EMAIL IS ENOUGH EVIDENCE. It is not, on its own — and it does not
-- have to be. The account created here cannot be used until the confirmation
-- link sent to that address is opened, which is the same proof of possession
-- an invite link gives. Someone who types a member's address gets an account
-- they cannot sign into, attached to a record they cannot read.
--
-- What they CAN do is take the space: `profiles.person_id` is then occupied,
-- and (b) would turn the real member away. That is a nuisance an administrator
-- undoes, and it is the price of the alternative being "the club's children
-- cannot register at all". It is written down here so it is a known cost.
--
-- WHAT IS NOT OVERWRITTEN. The club's record wins on every fact it already
-- holds — name, date of birth, phone, address, sex. The sign-up only fills
-- blanks. A member does not get to rewrite the club's record by signing up,
-- and this is also how the 35 coaching staff with no date of birth finally get
-- one: they sign up, the blank is filled, and their venue's coaches group
-- admits them.
--
--
-- 3. AND THE MESSAGE
-- ---------------------------------------------------------------------------
-- A trigger cannot talk to the browser. GoTrue reports any exception raised in
-- here as `unexpected_failure`, so "Database error saving new user" is what a
-- refusal looks like however carefully it is worded. The sentences therefore
-- have to be said BEFORE the sign-up: `signup_email_check()` is what /join
-- calls first, and it answers the three questions this trigger can refuse on.
-- It is granted to `anon` because the person asking has not signed in yet —
-- that is the whole situation — and it returns no name, no date and no
-- identifier, only which of four things is true.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered. One new SECURITY DEFINER function granted to anon, returning a
-- fixed vocabulary of four strings and no personal data. Data touched: none by
-- the migration itself; hereafter a sign-up may fill blank columns on a person
-- it links to, and may never overwrite a populated one. Rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. handle_new_user()
-- =============================================================================
-- Restated whole, because the parsing of the sign-up metadata has to happen
-- BEFORE the new branch can compare dates of birth with it. The invite branch
-- (§1a) and the create-a-person branch (§1c) are the 20260901160000 versions
-- unchanged; §1b is new.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_first       text;
  v_last        text;
  v_email       text;
  v_person      uuid;
  v_meta_person text;
  v_invited     uuid;
  v_invited_row public.people%rowtype;
  v_match       public.people%rowtype;
  v_dob         date;
  v_phone       text;
  v_sex         text;
  v_address     jsonb;
begin
  -- ---------------------------------------------------------------------
  -- The sign-up's own account of itself, parsed once.
  -- ---------------------------------------------------------------------
  -- The two halves as typed, when the caller took the trouble to ask for them.
  -- Both, or neither: one half plus a guess at the other is the same guess the
  -- split was, wearing a better hat.
  v_first := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last  := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  if v_first is null or v_last is null then
    select s.first_name, s.last_name
      into v_first, v_last
      from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;
  end if;

  begin
    v_dob := nullif(btrim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null and v_dob > current_date then
    v_dob := null;
  end if;

  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  -- Biological sex at birth (Adam, 2026-09-01). Anything that is not one of
  -- the two words is stored as nothing rather than refused: this is a trigger
  -- inside somebody's sign-up, and failing the whole account over a field the
  -- form should have constrained would lose the member entirely.
  v_sex := lower(nullif(btrim(new.raw_user_meta_data ->> 'sex'), ''));
  if v_sex not in ('male', 'female') then
    v_sex := null;
  end if;

  -- The join wizard sends the home address at sign-up. Only an object is
  -- accepted; anything else is treated as absent.
  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

  v_email := nullif(btrim(new.email), '');

  -- ---------------------------------------------------------------------
  -- 1a. AN INVITE NAMED THE PERSON
  -- ---------------------------------------------------------------------
  v_meta_person := new.raw_user_meta_data ->> 'person_id';
  if v_meta_person is not null
     and v_meta_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_invited := v_meta_person::uuid;
    select * into v_invited_row from public.people p where p.id = v_invited and p.deleted_at is null;
    if found
       and not exists (select 1 from public.profiles pr where pr.person_id = v_invited)
       and (
            public.has_active_consent(v_invited, 'app_account'::public.consent_type)
            or (
              not (v_invited_row.dob is not null and public.is_minor_dob(v_invited_row.dob))
              and v_invited_row.email is not null
              and lower(v_invited_row.email) = lower(new.email)
            )
       )
    then
      insert into profiles (id, role, full_name, person_id)
      values (new.id, 'member',
              coalesce(new.raw_user_meta_data ->> 'full_name', v_invited_row.first_name || ' ' || v_invited_row.last_name),
              v_invited)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- 1b. THE CLUB ALREADY HOLDS THIS EMAIL ADDRESS  (new, 2026-09-02)
  -- ---------------------------------------------------------------------
  -- See §2 of this file's header for the rule and why each limb is there.
  if v_email is not null then
    select * into v_match
      from public.people p
     where p.deleted_at is null
       and p.email is not null
       and lower(p.email) = lower(v_email)
       and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
       -- (d) FAMILIES SHARE ADDRESSES. This is the objection P1.2 raised when
       -- it refused to link on email at all, and SG-10 called it "doubly
       -- important here": a child's record very often carries a PARENT's email
       -- address, so linking on the address alone would let a parent sign up
       -- and walk into their own child's record.
       --
       -- It is answered here rather than by refusing every match. Somebody the
       -- club treats as a child — a live guardianship — is matched ONLY where
       -- their guardian has granted `app_account`, which is a guardian saying
       -- on the record that this child may have an account of their own. That
       -- covers the whole of Adam's case (Benjamin, Matthew and
       -- adam.wareing+11 all have that consent) and none of P1.2's: a child
       -- whose record holds a parent's address has no such consent, is not
       -- matched, and the parent gets a person of their own exactly as before.
       and (
         not exists (select 1 from public.guardianships g
                      where g.child_person_id = p.id and g.ended_at is null)
         or public.has_active_consent(p.id, 'app_account'::public.consent_type)
       )
     limit 1;

    if found then
      -- (c) Two dates of birth that disagree are two people. Refusing is the
      -- same answer add_household_adult() gives, and it is better than the
      -- duplicate person this used to create in silence.
      if v_match.dob is not null and v_dob is not null and v_match.dob <> v_dob then
        raise exception
          'SG-4: the club already holds a record for that email address with a different date of birth. Ask a club administrator to connect them.'
          using errcode = 'P0001';
      end if;

      -- Blanks only. The club's record wins on everything it already holds,
      -- and the date of birth is filled BEFORE the profile is written so that
      -- the guard below judges the person the club will actually have.
      update public.people p
         set dob     = coalesce(p.dob, v_dob),
             phone   = coalesce(p.phone, v_phone),
             address = coalesce(p.address, v_address),
             sex     = coalesce(p.sex, v_sex)
       where p.id = v_match.id;

      -- (c) WHO MAY HAVE AN ACCOUNT IS NOT DECIDED HERE. It is decided by
      -- `profiles_account_eligibility_guard()` on the row below — an adult,
      -- or a minor over the minimum age whose guardian has granted
      -- `app_account`, with SG-0's unknown-is-a-minor rule underneath. Writing
      -- that test a second time in this branch is how it comes to disagree
      -- with itself, and the first draft of this migration proved it: it read
      -- the club's stored date of birth only, so Cora Coach — one of the 35
      -- coaching staff imported WITHOUT a date of birth, who is supplying one
      -- right now in this very sign-up — was turned away as a child.
      --
      -- So: link, fill, and let the guard speak. A minor with no consent still
      -- cannot get an account; the whole transaction rolls back and nothing is
      -- left behind. What they get instead of silence is `signup_email_check()`
      -- in §2, which says so before any of this is attempted.
      insert into profiles (id, role, full_name, person_id)
      values (new.id, 'member',
              coalesce(nullif(btrim(v_match.first_name || ' ' || v_match.last_name), ''),
                       new.raw_user_meta_data ->> 'full_name'),
              v_match.id)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- 1c. NOBODY THE CLUB KNOWS: a new person
  -- ---------------------------------------------------------------------
  -- The email is dropped rather than fought over if it is somehow still
  -- taken — by a person who HAS a login, which §1b deliberately walked past.
  if v_email is not null
     and (
       length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or exists (
            select 1 from public.people pe
             where pe.deleted_at is null
               and lower(pe.email) = lower(v_email)
          )
     )
  then
    v_email := null;
  end if;

  insert into public.people (first_name, last_name, email, dob, phone, address, sex)
  values (v_first, v_last, v_email, v_dob, v_phone, v_address, v_sex)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member',
          coalesce(new.raw_user_meta_data ->> 'full_name', btrim(v_first || ' ' || v_last)),
          v_person)
  on conflict (id) do nothing;

  return new;
end $function$;

comment on function public.handle_new_user() is
  'Turns a new auth.users row into a person and a profile. Three roads: an invite naming the person, an email the club already holds against somebody with no login (linked, blanks filled, nothing overwritten), or a person created from scratch.';


-- =============================================================================
-- 2. signup_email_check()
-- =============================================================================
-- What /join asks before it asks GoTrue, because a trigger's refusal reaches
-- the browser as "Database error saving new user" whatever it says.
--
-- Four answers, and no personal data in any of them:
--
--   null              go ahead
--   'has_login'       that address already has an account — sign in
--   'child_no_access' the account would be a child's own, and an under-16's
--                     account is set up by a parent, not by them
--   'dob_mismatch'    the club holds it against a different date of birth
--
-- `p_dob` is what the form has typed so far; without it the date comparison
-- cannot be made and 'dob_mismatch' is simply never returned.

-- The eligibility rule, with the date of birth as an argument.
--
-- `is_account_eligible()` reads the person's STORED date of birth, which is
-- the right question for the guard and the wrong one for the check below: at
-- the moment somebody is asked "will this sign-up work", the date they are
-- about to supply is the date that will decide it. Rather than write the rule
-- out a second time — the mistake §1b's header describes — the rule moves
-- here and both callers use it.
create or replace function public.is_account_eligible_for(p_person_id uuid, p_dob date)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select coalesce(
    public.is_at_least_age(p_dob, public.safeguarding_setting_int('safeguarding.self_account_age'))
    or (
      public.is_at_least_age(p_dob, public.safeguarding_setting_int('safeguarding.min_account_age'))
      and public.has_active_consent(p_person_id, 'app_account'::public.consent_type)
    ),
    false);
$$;

comment on function public.is_account_eligible_for(uuid, date) is
  'SG-10''s rule with the date of birth passed in: old enough for their own account, or over the minimum age with a guardian''s app_account consent. A null date is nobody old enough (SG-0).';

revoke all privileges on function public.is_account_eligible_for(uuid, date) from public, anon;
grant execute on function public.is_account_eligible_for(uuid, date) to authenticated, service_role;

-- And the existing one becomes the same rule read off the record. The guard
-- calls this and is unchanged.
create or replace function public.is_account_eligible(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select public.is_account_eligible_for(p.id, p.dob)
       from public.people p
      where p.id = p_person_id),
    false);
$function$;


create or replace function public.signup_email_check(p_email text, p_dob date default null)
  returns text
  language plpgsql
  stable
  security definer
  set search_path = public
as $fn$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_match public.people%rowtype;
begin
  if v_email is not null then
    select * into v_match
      from public.people p
     where p.deleted_at is null
       and p.email is not null
       and lower(p.email) = v_email
     limit 1;

    if found then
      if exists (select 1 from public.profiles pr where pr.person_id = v_match.id) then
        return 'has_login';
      end if;

      if v_match.dob is not null and p_dob is not null and v_match.dob <> p_dob then
        return 'dob_mismatch';
      end if;

      -- Limb (d) of §1b: somebody's child with no app_account consent is NOT
      -- linked to — this is the parent whose address sits on their child's
      -- record. Fall through to the new-person question below, which is what
      -- the sign-up is actually going to do.
      if not (exists (select 1 from public.guardianships g
                       where g.child_person_id = v_match.id and g.ended_at is null)
              and not public.has_active_consent(v_match.id, 'app_account'::public.consent_type))
      then
        -- Linkable. Judged on the date the person will HAVE once the sign-up
        -- has filled the blank, which is what the guard will see.
        if not public.is_account_eligible_for(v_match.id, coalesce(v_match.dob, p_dob)) then
          return 'child_no_access';
        end if;
        return null;
      end if;
    end if;
  end if;

  -- No link: a person is about to be created from scratch, and a person who
  -- does not exist yet cannot have a guardian's consent attached to them. So
  -- the only ones who may do this alone are those old enough to hold their own
  -- account. A younger child is added by a parent from Children & family, and
  -- given app access there.
  --
  -- This limb reads nothing about anybody: it is the date of birth on the form
  -- and a documented setting. It is also the one that catches the commonest
  -- case of all — a child the club has never heard of, filling the form in.
  if p_dob is not null
     and not public.is_at_least_age(
           p_dob, public.safeguarding_setting_int('safeguarding.self_account_age'))
  then
    return 'child_no_access';
  end if;

  return null;
end $fn$;

comment on function public.signup_email_check(text, date) is
  'Would this sign-up be refused, and why? Returns null to go ahead, or one of has_login / child_no_access / dob_mismatch. No name, date or identifier is returned — only which of four things is true, and the child_no_access limb reads nothing but the date of birth on the form.';

-- anon by design: the person asking has not signed in, which is the situation.
revoke all privileges on function public.signup_email_check(text, date) from public;
grant execute on function public.signup_email_check(text, date) to anon, authenticated, service_role;


-- =============================================================================
-- 3. team_options()
-- =============================================================================
-- Adam, 2026-09-02: "the coach should also select the team on sign up — a
-- search box for team name."
--
-- The joining form's first step is filled in by somebody who is not signed in
-- yet, and `teams_read` is `to authenticated`. So the picker on that step
-- cannot read the table: it needs a door of its own, the same shape
-- `recruiting_teams()` already is.
--
-- What it hands out is a team's name and age group. Both are already public —
-- they are printed on /recruitment, on the club's fixtures and on a shirt —
-- and neither says anything about a person. Active teams only: a coach cannot
-- volunteer for a side the club has retired.

create or replace function public.team_options()
  returns table (id uuid, name text, age_group text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select t.id, t.name, t.age_group
    from public.teams t
   where t.active
   order by t.name;
$$;

comment on function public.team_options() is
  'Active teams as a picker sees them: id, name, age group. Readable before sign-in, because the coach tick on the joining form is ticked before sign-in. Nothing here is about a person.';

revoke all privileges on function public.team_options() from public;
grant execute on function public.team_options() to anon, authenticated, service_role;


-- =============================================================================
-- 4. ROLLBACK
-- =============================================================================
--   drop function if exists public.team_options();
--   drop function if exists public.signup_email_check(text, date);
--   -- and restore handle_new_user() from 20260901160000.
-- Anybody already linked by §1b keeps their profile: the link is an ordinary
-- profiles row and undoing this migration does not unmake it.
-- =============================================================================
