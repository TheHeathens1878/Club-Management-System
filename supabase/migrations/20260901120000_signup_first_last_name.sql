-- =============================================================================
-- Sign-up asks for the two halves of a name, so stop guessing at them
-- =============================================================================
-- Adam, 2026-09-01: "phone and email should be mandatory. First name and last
-- name separate fields."
--
-- The form asked for a "Full name" and `handle_new_user()` ran it through
-- `split_person_name()`, which takes the last word as the surname. That is a
-- guess, and it is wrong for exactly the people it is worst to be wrong about:
-- "Maria de la Cruz" became Cruz, "Anne Marie Wilson" became a first name of
-- "Anne Marie" only by luck of the same rule, and a member whose surname the
-- club prints on a team sheet had no way to correct it at the point of entry.
--
-- So the sign-up now sends `first_name` and `last_name` and this trigger takes
-- them as given. `split_person_name(full_name)` remains the fallback and is
-- untouched: every other way a person arrives — the join wizard, an invite, an
-- import — still sends a full name, and this must keep working for them today
-- and for every row already created that way.
--
-- `profiles.full_name` is still written, because plenty of screens read it. It
-- prefers the `full_name` in the metadata (the forms send it as well, joined)
-- and falls back to the two halves.
--
-- NOT ENFORCED HERE: e-mail and phone being mandatory. That is a rule about
-- what the club asks a new member to type, not about what the table can hold —
-- imported members, invited children and every person created before today
-- legitimately have neither, and a NOT NULL would refuse them. The form is
-- where it belongs.
--
-- Rollback: restore the body from 20260824280000_join_flow.sql. Nothing else
-- here changes; no table, no policy, no grant.
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

  -- The join wizard sends the home address at sign-up. Only an object is
  -- accepted; anything else is treated as absent.
  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

  insert into public.people (first_name, last_name, email, dob, phone, address)
  values (v_first, v_last, v_email, v_dob, v_phone, v_address)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member',
          coalesce(new.raw_user_meta_data ->> 'full_name', btrim(v_first || ' ' || v_last)),
          v_person)
  on conflict (id) do nothing;
  return new;
end $function$;

comment on function public.handle_new_user() is
  'Creates the people row and member profile behind a new auth user. Prefers the '
  'first_name/last_name pair the sign-up form now sends; falls back to '
  'split_person_name(full_name) for the join wizard, invites and imports.';
