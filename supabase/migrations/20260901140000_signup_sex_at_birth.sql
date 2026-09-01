-- =============================================================================
-- Sign-up asks for biological sex at birth
-- =============================================================================
-- Adam, 2026-09-01: "need biological sex at birth on sign up page also."
--
-- Nothing new to store: `people.sex` and its CHECK ('male', 'female' or NULL)
-- have been here since 20260825500000, the join wizard collects it, the waiting
-- list calls it "Biological sex" on its export, and `set_person_sex()` is the
-- guarded way to change it afterwards. What was missing was the earliest moment
-- to ask — so a player reached a team without the one fact the FA's age-group
-- registration cannot be done without, and somebody had to go and get it.
--
-- This migration only teaches `handle_new_user()` to read the field the form
-- now sends. It writes it on the way past, alongside dob and phone.
--
-- A value that is not one of the two words is stored as nothing rather than
-- refused. This runs inside somebody's sign-up: failing the whole account over
-- a field the form should have constrained would lose the member entirely, and
-- an absent sex is a state the column, the join wizard and every screen already
-- handle. The form does the asking; the CHECK keeps the column honest.
--
-- Rollback: restore the body from 20260901130000. No table, column, type,
-- policy or grant changes here.
-- =============================================================================

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

  -- The sign-in page's referee door (/register?as=referee): the account and the
  -- request are made in the same breath, so it survives an email confirmation
  -- that has not been clicked yet — there is no session at this point in which
  -- the app could write it, and asking people to remember to ask again after
  -- confirming would lose most of them.
  --
  -- Only 'referee' is honoured. The metadata is browser-supplied, and while an
  -- account request grants NOTHING on its own — a club administrator approves
  -- it in /approvals, and `approve_account_request()` checks is_club_admin()
  -- itself — a self-declared coach appearing in the queue with no team behind
  -- it is noise nobody asked for.
  if lower(nullif(btrim(new.raw_user_meta_data ->> 'requested_role'), '')) = 'referee' then
    insert into public.account_requests (person_id, requested_role, message)
    values (v_person, 'referee', 'Asked to referee when creating their account');
  end if;

  return new;
end $function$;
