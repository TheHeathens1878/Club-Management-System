-- =============================================================================
-- A referee is fourteen, and the side door closes
-- =============================================================================
-- Adam, 2026-09-01: "remove the existing register as a referee function. Allow
-- referees to register from the day of their 14th birthday." And, on who may
-- confirm one: "referees need to be approved like an account request but admins
-- should be able to tick a box in a user record confirming they are a referee.
-- That will add them to the referee group."
--
-- THE AGE, ONCE. Three paths end in person_roles.referee: an approved account
-- request, an administrator granting the role, and the tick this branch adds to
-- a person's record. An age check written three times is an age check that will
-- disagree with itself, so it goes on the ROLE — one BEFORE INSERT guard on
-- person_roles, which every path runs through. The request guard beside it is
-- not the enforcement; it is the courtesy of refusing at the moment somebody
-- asks, naming the date they can ask on, rather than at the moment an
-- administrator tries to approve.
--
-- WHY FOURTEEN. The FA registers referees from 14 and the club follows it. This
-- is not a safeguarding invariant in the SG sense — nobody is protected by a
-- 13-year-old being refused a form — but it is a rule about a minor taking a
-- role in adult company, so it lives where the other age rules live: a
-- documented setting read through safeguarding_setting_int().
--
-- An unknown date of birth is refused. SG-0 treats unknown as a minor
-- everywhere else in this schema and the referee list is not the exception.
--
-- THE GROUP comes free: referee_role_sync_group() has fired on a person_roles
-- insert since 20260825320000, so a tick that grants the role puts them in the
-- Referees conversation without this migration saying so.
--
-- THE SIDE DOOR. /register?as=referee was added this afternoon (20260901130000)
-- and the sign-up trigger opened the request. The joining workflow's referee
-- tick replaces it, so the trigger stops doing that. What is NOT removed:
-- referee as a role somebody may ask for, the team-less CHECK that lets it
-- through, and the approval that grants the hat.
--
-- Rollback: drop the two guards and their triggers, delete the site_settings
-- row, and restore handle_new_user from 20260901140000. Roles already granted
-- are untouched.
-- =============================================================================

-- 1. The setting, with its documented default ---------------------------------
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
    when 'safeguarding.min_referee_age'                then 14
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

  return coalesce(nullif(btrim(coalesce(v_value, '')), '')::integer, v_default);
exception when others then
  return v_default;
end $function$;

insert into public.site_settings (key, value)
values ('safeguarding.min_referee_age', '14')
on conflict (key) do nothing;

-- 2. The role itself, whichever path reaches it -------------------------------
create or replace function public.person_roles_referee_age_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_dob     date;
  v_min_age integer;
begin
  if new.role <> 'referee'::public.app_role then
    return new;
  end if;

  v_min_age := public.safeguarding_setting_int('safeguarding.min_referee_age');
  select p.dob into v_dob from public.people p where p.id = new.person_id;

  if v_dob is null then
    raise exception
      'person_roles: a date of birth is needed before somebody can be made a referee — the club registers referees from %',
      v_min_age
      using errcode = 'P0001';
  end if;

  if not public.is_at_least_age(v_dob, v_min_age) then
    raise exception
      'person_roles: the club registers referees from age % — this person can be one from % (their %th birthday)',
      v_min_age,
      to_char(v_dob + make_interval(years => v_min_age), 'FMDD FMMonth YYYY'),
      v_min_age
      using errcode = 'P0001';
  end if;

  return new;
end $function$;

drop trigger if exists trg_person_roles_referee_age on public.person_roles;
create trigger trg_person_roles_referee_age
  before insert on public.person_roles
  for each row execute function public.person_roles_referee_age_guard();

comment on function public.person_roles_referee_age_guard() is
  'The FA registers referees from 14 and the club follows it. Guards the ROLE, so every path meets the same rule: an approved request, an admin grant, the tick on a person record. Unknown dob is refused, as SG-0 does everywhere else.';

-- 3. And a courtesy where somebody asks ---------------------------------------
create or replace function public.account_requests_referee_age_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_dob     date;
  v_min_age integer;
begin
  if new.requested_role <> 'referee' then
    return new;
  end if;

  v_min_age := public.safeguarding_setting_int('safeguarding.min_referee_age');
  select p.dob into v_dob from public.people p where p.id = new.person_id;

  if v_dob is null then
    raise exception
      'account_requests: a date of birth is needed before asking to referee — the club registers referees from %',
      v_min_age
      using errcode = 'P0001';
  end if;

  if not public.is_at_least_age(v_dob, v_min_age) then
    raise exception
      'account_requests: the club registers referees from age % — you can ask from % (your %th birthday)',
      v_min_age,
      to_char(v_dob + make_interval(years => v_min_age), 'FMDD FMMonth YYYY'),
      v_min_age
      using errcode = 'P0001';
  end if;

  return new;
end $function$;

drop trigger if exists trg_account_requests_referee_age on public.account_requests;
create trigger trg_account_requests_referee_age
  before insert on public.account_requests
  for each row execute function public.account_requests_referee_age_guard();

-- 4. The sign-up no longer opens a referee request ----------------------------

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
  v_dob         date;
  v_phone       text;
  v_sex         text;
  v_address     jsonb;
begin
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

  v_email := nullif(btrim(new.email), '');
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

  begin
    v_dob := nullif(btrim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null and v_dob > current_date then
    v_dob := null;
  end if;
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  -- Biological sex at birth (Adam, 2026-09-01). The column and its CHECK have
  -- been here since 20260825500000 — 'male', 'female' or nothing — and the join
  -- wizard and the waiting list already ask for it. Sign-up now asks too, so a
  -- player arrives with the one fact the FA's age-group registration cannot be
  -- done without, instead of being chased for it later.
  --
  -- Anything that is not one of the two words is stored as nothing rather than
  -- refused: this is a trigger inside somebody's sign-up, and failing the whole
  -- account over a field the form should have constrained would lose the member
  -- entirely. The form is where the asking happens; the CHECK is what makes the
  -- column honest.
  v_sex := lower(nullif(btrim(new.raw_user_meta_data ->> 'sex'), ''));
  if v_sex not in ('male', 'female') then
    v_sex := null;
  end if;

  -- The join wizard sends the home address at sign-up. Only an object is
  -- accepted; anything else is treated as absent.
  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

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
