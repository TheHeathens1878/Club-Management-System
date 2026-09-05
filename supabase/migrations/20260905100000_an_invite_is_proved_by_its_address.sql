-- =============================================================================
-- An invite is proved by its address (20260905100000)
-- =============================================================================
-- Codex review, 2026-09-05, finding 1 (High): "Signup can claim another
-- person's identity. handle_new_user() trusts a caller-supplied person_id.
-- For an eligible child with account consent and no login, it can attach the
-- caller's account without matching their email."
--
--
-- 1. WHAT WAS TRUE
-- ---------------------------------------------------------------------------
-- The invite branch (§1a of 20260902100000) adopted the person named in the
-- sign-up metadata when they had no login and EITHER
--   (i)  an active `app_account` consent, or
--   (ii) were not a known minor AND their recorded email matched the sign-up.
--
-- Limb (ii) was bound to the address. Limb (i) was not: a consented child was
-- adopted by whoever put their `people.id` in the metadata, whatever address
-- the sign-up used. The metadata is user-editable — GoTrue stores whatever the
-- sign-up request sends — and a person's id is not a secret: every parent,
-- coach and administrator who can see the child can see it. So anybody
-- holding a consented child's id could create an account, confirm it at their
-- OWN address, and sign in as that child.
--
-- The invariant that was meant to hold is the one §2 of 20260902100000 wrote
-- down for the email branch: "the account created here cannot be used until
-- the confirmation link sent to that address is opened, which is the same
-- proof of possession an invite link gives". An invite link that any reader
-- can forge gives no such proof. The address does.
--
--
-- 2. THE RULE NOW
-- ---------------------------------------------------------------------------
-- A sign-up naming a person is joined to that person only when ALL hold:
--   (a) the person exists and is not deleted;
--   (b) the person has no login;
--   (c) THE PERSON'S RECORDED EMAIL IS THE SIGN-UP'S EMAIL. A record with no
--       address cannot be claimed by id at all — the club puts the address on
--       the record first, which is what "inviting" somebody means;
--   (d) and then, exactly as before: an active `app_account` consent, or not
--       a known minor.
--
-- With (c) in place the id proves nothing the address did not already prove,
-- and the branch is kept only because it is the documented invite shape
-- (SAFEGUARDING.md SG-10) and because it skips §1b's guardianship limb for a
-- child whose guardian has consented — the case §1b also admits. Who may hold
-- the account is still decided by `profiles_account_eligibility_guard()`.
--
-- Nothing is weakened: every sign-up the old branch admitted with a matching
-- address is admitted now; only the ones with a DIFFERENT address are turned
-- away, and those fall through to §1b (which also requires the address) and
-- then §1c (a person of their own). The tests in consents_settings and
-- referee_bands that invited a child with no email on record now put the
-- address on the record first, which is the step the club takes.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered. One trigger function restated; §1b and §1c are the 20260902100000
-- text unchanged. Data touched: none by the migration; hereafter a sign-up
-- may adopt a person by id only at that person's recorded address. Rollback:
-- restore handle_new_user() from 20260902100000 §1.
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
  v_match       public.people%rowtype;
  v_dob         date;
  v_phone       text;
  v_sex         text;
  v_address     jsonb;
begin
  -- ---------------------------------------------------------------------
  -- The sign-up's own account of itself, parsed once.
  -- ---------------------------------------------------------------------
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

  v_sex := lower(nullif(btrim(new.raw_user_meta_data ->> 'sex'), ''));
  if v_sex not in ('male', 'female') then
    v_sex := null;
  end if;

  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

  v_email := nullif(btrim(new.email), '');

  -- ---------------------------------------------------------------------
  -- 1a. AN INVITE NAMED THE PERSON — and the address proves it (2026-09-05)
  -- ---------------------------------------------------------------------
  -- See §2 of this file's header. The id is user-editable metadata and is
  -- visible to everybody who can see the person; the address is the thing
  -- the confirmation link goes to. Without (c) a consented child could be
  -- claimed by anybody who had seen their record.
  v_meta_person := new.raw_user_meta_data ->> 'person_id';
  if v_meta_person is not null
     and v_email is not null
     and v_meta_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_invited := v_meta_person::uuid;
    select * into v_invited_row from public.people p where p.id = v_invited and p.deleted_at is null;
    if found
       and not exists (select 1 from public.profiles pr where pr.person_id = v_invited)
       -- (c) the record's address is the sign-up's address. No address on
       -- record, no adoption by id.
       and v_invited_row.email is not null
       and lower(v_invited_row.email) = lower(v_email)
       -- (d) a consented child, or not a known minor.
       and (
            public.has_active_consent(v_invited, 'app_account'::public.consent_type)
            or not (v_invited_row.dob is not null and public.is_minor_dob(v_invited_row.dob))
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
  -- 1b. THE CLUB ALREADY HOLDS THIS EMAIL ADDRESS  (20260902100000, unchanged)
  -- ---------------------------------------------------------------------
  if v_email is not null then
    select * into v_match
      from public.people p
     where p.deleted_at is null
       and p.email is not null
       and lower(p.email) = lower(v_email)
       and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
       and (
         not exists (select 1 from public.guardianships g
                      where g.child_person_id = p.id and g.ended_at is null)
         or public.has_active_consent(p.id, 'app_account'::public.consent_type)
       )
     limit 1;

    if found then
      if v_match.dob is not null and v_dob is not null and v_match.dob <> v_dob then
        raise exception
          'SG-4: the club already holds a record for that email address with a different date of birth. Ask a club administrator to connect them.'
          using errcode = 'P0001';
      end if;

      update public.people p
         set dob     = coalesce(p.dob, v_dob),
             phone   = coalesce(p.phone, v_phone),
             address = coalesce(p.address, v_address),
             sex     = coalesce(p.sex, v_sex)
       where p.id = v_match.id;

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
  -- 1c. NOBODY THE CLUB KNOWS: a new person  (unchanged)
  -- ---------------------------------------------------------------------
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
  'Turns a new auth.users row into a person and a profile. Three roads: an invite naming the person AND arriving at that person''s recorded address, an email the club already holds against somebody with no login (linked, blanks filled, nothing overwritten), or a person created from scratch.';
