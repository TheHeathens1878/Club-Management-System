-- =============================================================================
-- The FA Clubs Portal export (Adam, 2026-09-06)
-- =============================================================================
-- "On the teams table page, admins should be able to export Clubs Portal
--  data. It should include: player's name, DOB, sex, email (even if blank),
--  confirmation of whether age has been proved, address; emergency contact
--  name, DOB, sex, email, address (postcode is required), mobile. The above
--  information needs to be collected for emergency contacts even if they
--  aren't the lead booker. We should be able to select multiple teams and
--  export this information, but it should also be available to admins in the
--  squad section of the team page."
--
-- TWO HALVES
--   1. `emergency_contacts` learns what the Portal asks of a contact. Until
--      now a contact was a name, a number and "Mum": enough to ring, not
--      enough to register. Five columns are added — `dob`, `sex`, `email`,
--      `address` (the same jsonb shape `people.address` uses) and
--      `contact_person_id`. The last is the lead-booker case: when the parent
--      ticks "I am the first emergency contact", the row now POINTS at their
--      own person record instead of only copying the name and number, so the
--      export reads their date of birth, sex, email and address from the one
--      place the club already holds them. A contact who is not a member —
--      Grandad, a neighbour — has the fields typed, and the postcode is
--      required as soon as any of the address is.
--   2. `clubs_portal_export(team_ids)` — one row per live player per team,
--      with the player's fields and both contacts RESOLVED: a linked person's
--      live record first; failing that, an active guardian of the player
--      whose name matches the contact (the rows written before today, which
--      carry no link); failing that, what was typed. Club administrators
--      only, and every call is one audit row counting teams and players —
--      never names. A spreadsheet of children's dates of birth and addresses
--      leaving the building is the most sensitive read this app makes, and
--      it is gated and logged accordingly.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy changes (the
-- five columns inherit the table's three SELECT policies and its no-write
-- stance; the export function gates itself on is_club_admin()); data
-- touched: none on push; rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. What the Portal asks of a contact
-- =============================================================================

alter table public.emergency_contacts
  add column if not exists contact_person_id uuid references public.people (id) on delete set null,
  add column if not exists dob     date,
  add column if not exists sex     text check (sex is null or sex in ('male', 'female')),
  add column if not exists email   text check (email is null or btrim(email) <> ''),
  add column if not exists address jsonb check (address is null or jsonb_typeof(address) = 'object');

create index if not exists emergency_contacts_contact_person_idx
  on public.emergency_contacts (contact_person_id) where contact_person_id is not null;

comment on column public.emergency_contacts.contact_person_id is
  'Set when the contact IS a member — the parent who ticked "I am the first emergency contact". Their live people row is then the source of their date of birth, sex, email and address; the name and phone here are a snapshot.';
comment on column public.emergency_contacts.dob is
  'The contact''s date of birth, as the FA Clubs Portal requires of a parent or carer. Typed for a contact who is not a member; read from people for one who is.';
comment on column public.emergency_contacts.sex is
  'male or female, as the Portal records it. NULL means not told.';
comment on column public.emergency_contacts.address is
  'The same jsonb shape as people.address (line1, line2, town, county, postcode). A postcode is required whenever any of it is given.';


-- =============================================================================
-- 2. set_emergency_contacts() — the same door, wider
-- =============================================================================
-- 20260902200000's body, plus the five fields. Each item may carry
-- contact_person_id, dob, sex, email and address; each is validated before
-- anything is deleted, as before.

create or replace function public.set_emergency_contacts(p_person_id uuid, p_contacts jsonb)
  returns void
  language plpgsql security definer
  set search_path = public
as $function$
declare
  v_me           uuid := public.current_person_id();
  v_admin        boolean := public.is_club_admin();
  v_count        integer;
  v_item         jsonb;
  v_pos          smallint := 0;
  v_first        text;
  v_last         text;
  v_phone        text;
  v_relationship text;
  v_link         uuid;
  v_dob          date;
  v_sex          text;
  v_email        text;
  v_address      jsonb;
begin
  if p_person_id is null then
    raise exception 'set_emergency_contacts: person is required' using errcode = '22023';
  end if;

  -- An unlinked login: signed in, but not yet joined to a person. It cannot be
  -- acting for itself because there is no "itself" yet. An administrator is
  -- exempt — an admin acts for the club, not for a person.
  if v_me is null and not v_admin then
    raise exception 'set_emergency_contacts: no person is linked to this login'
      using errcode = '42501';
  end if;

  if not (public.can_act_for(p_person_id)
          or public.is_household_member_of(p_person_id)
          or v_admin) then
    raise exception 'set_emergency_contacts: you may only set emergency contacts for yourself, a child you are the guardian of, or someone in your household who has no login of their own'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.people p
     where p.id = p_person_id and p.deleted_at is null)
  then
    raise exception 'set_emergency_contacts: no such person' using errcode = 'P0001';
  end if;

  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'set_emergency_contacts: give a list of emergency contacts'
      using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_contacts);
  if v_count > 2 then
    raise exception 'set_emergency_contacts: at most two emergency contacts can be recorded'
      using errcode = 'P0001';
  end if;

  -- Validate the whole list BEFORE deleting anything. A half-applied replace
  -- would leave a person with fewer contacts than they started with because the
  -- second one had a typo in it.
  for v_item in select * from jsonb_array_elements(p_contacts) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'set_emergency_contacts: each emergency contact must be a first name, a last name, a phone number and an optional relationship'
        using errcode = 'P0001';
    end if;
    select n.first_name, n.last_name into v_first, v_last
      from public.contact_name_parts(v_item) n;
    if v_first is null or v_last is null
       or nullif(btrim(coalesce(v_item ->> 'phone', '')), '') is null then
      raise exception 'set_emergency_contacts: a contact needs a first name, a last name and a phone number'
        using errcode = 'P0001';
    end if;

    v_sex := nullif(lower(btrim(coalesce(v_item ->> 'sex', ''))), '');
    if v_sex is not null and v_sex not in ('male', 'female') then
      raise exception 'set_emergency_contacts: a contact''s sex is male or female, or left blank'
        using errcode = 'P0001';
    end if;

    if nullif(btrim(coalesce(v_item ->> 'dob', '')), '') is not null then
      begin
        v_dob := (v_item ->> 'dob')::date;
      exception when others then
        raise exception 'set_emergency_contacts: a contact''s date of birth could not be read'
          using errcode = 'P0001';
      end;
      if v_dob > current_date then
        raise exception 'set_emergency_contacts: a contact''s date of birth cannot be in the future'
          using errcode = 'P0001';
      end if;
    end if;

    v_address := v_item -> 'address';
    if v_address is not null and jsonb_typeof(v_address) <> 'null' then
      if jsonb_typeof(v_address) <> 'object' then
        raise exception 'set_emergency_contacts: a contact''s address must be an object'
          using errcode = 'P0001';
      end if;
      if exists (select 1 from jsonb_each_text(v_address) kv where btrim(coalesce(kv.value, '')) <> '')
         and nullif(btrim(coalesce(v_address ->> 'postcode', '')), '') is null then
        raise exception 'set_emergency_contacts: a contact''s address needs a postcode'
          using errcode = 'P0001';
      end if;
    end if;

    v_link := nullif(btrim(coalesce(v_item ->> 'contact_person_id', '')), '')::uuid;
    if v_link is not null then
      -- The link says "this contact is that member". Only the member
      -- themselves, an administrator, or a guardian of the person may say it.
      if not (v_link = v_me
              or v_admin
              or exists (select 1 from public.guardianships g
                          where g.guardian_person_id = v_link
                            and g.child_person_id = p_person_id
                            and g.ended_at is null)) then
        raise exception 'set_emergency_contacts: a contact can only be linked to your own record, or to a guardian of the person'
          using errcode = '42501';
      end if;
      if not exists (select 1 from public.people p where p.id = v_link and p.deleted_at is null) then
        raise exception 'set_emergency_contacts: the linked contact is not a live person'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  delete from public.emergency_contacts where person_id = p_person_id;

  for v_item in select * from jsonb_array_elements(p_contacts) loop
    v_pos := v_pos + 1;
    select n.first_name, n.last_name into v_first, v_last
      from public.contact_name_parts(v_item) n;
    v_phone        := btrim(v_item ->> 'phone');
    v_relationship := nullif(btrim(coalesce(v_item ->> 'relationship', '')), '');
    v_link         := nullif(btrim(coalesce(v_item ->> 'contact_person_id', '')), '')::uuid;
    v_dob          := nullif(btrim(coalesce(v_item ->> 'dob', '')), '')::date;
    v_sex          := nullif(lower(btrim(coalesce(v_item ->> 'sex', ''))), '');
    v_email        := nullif(btrim(coalesce(v_item ->> 'email', '')), '');
    -- Only the filled-in keys, and NULL when there are none — as people.address.
    select nullif(jsonb_object_agg(kv.key, btrim(kv.value)), '{}'::jsonb) into v_address
      from jsonb_each_text(coalesce(
             case when jsonb_typeof(v_item -> 'address') = 'object' then v_item -> 'address' end,
             '{}'::jsonb)) kv
     where kv.key in ('line1', 'line2', 'town', 'county', 'postcode', 'country')
       and btrim(coalesce(kv.value, '')) <> '';

    insert into public.emergency_contacts
      (person_id, "position", first_name, last_name, phone, relationship,
       contact_person_id, dob, sex, email, address, updated_by)
    values
      (p_person_id, v_pos, v_first, v_last, v_phone, v_relationship,
       v_link, v_dob, v_sex, v_email, v_address, auth.uid());
  end loop;

  -- The count and the actor, never the names and never the numbers.
  perform public.write_audit(
    'people.emergency_contacts.updated', 'people', p_person_id::text,
    jsonb_build_object('count', v_count, 'by_person_id', v_me));
end;
$function$;

comment on function public.set_emergency_contacts(uuid, jsonb) is
  'Replace a person''s emergency contacts with the given list of at most two {first_name, last_name, phone, relationship, contact_person_id, dob, sex, email, address} objects, numbered 1..n. The subject, an active guardian of a minor subject, a household member without a login of their own, or a club administrator. A linked contact must be the caller, a guardian of the person, or set by an administrator. Audits the count and the actor, never the contacts themselves.';


-- =============================================================================
-- 3. A contact, resolved
-- =============================================================================
-- The Portal's view of one emergency contact: the linked member's live
-- record; else an active guardian whose name matches (the rows written
-- before the link existed); else what was typed. `source` says which.
-- SECURITY DEFINER because it reads people rows the caller may not hold a
-- policy for (a guardian who is not otherwise visible to them); it is only
-- ever called from clubs_portal_export(), which gates on club_admin, and
-- EXECUTE is granted to nobody else.

create or replace function public.emergency_contact_resolved(p_person_id uuid, p_position integer)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'first_name',   coalesce(lp.first_name, ec.first_name),
    'last_name',    coalesce(lp.last_name, ec.last_name),
    'dob',          coalesce(lp.dob, ec.dob),
    'sex',          coalesce(lp.sex, ec.sex),
    'email',        coalesce(lp.email, ec.email),
    'address',      coalesce(lp.address, ec.address),
    'phone',        coalesce(nullif(btrim(coalesce(lp.phone, '')), ''), ec.phone),
    'relationship', ec.relationship,
    'source',       case when cp.id is not null then 'linked'
                         when gp.id is not null then 'guardian'
                         else 'typed' end)
  from public.emergency_contacts ec
  left join public.people cp on cp.id = ec.contact_person_id and cp.deleted_at is null
  left join lateral (
    select g.guardian_person_id
      from public.guardianships g
      join public.people p on p.id = g.guardian_person_id and p.deleted_at is null
     where ec.contact_person_id is null
       and g.child_person_id = ec.person_id
       and g.ended_at is null
       and lower(btrim(p.first_name)) = lower(btrim(ec.first_name))
       and lower(btrim(p.last_name))  = lower(btrim(ec.last_name))
     order by g.created_at
     limit 1) gm on true
  left join public.people gp on gp.id = gm.guardian_person_id
  left join public.people lp on lp.id = coalesce(cp.id, gp.id)
  where ec.person_id = p_person_id and ec."position" = p_position;
$$;

revoke all privileges on function public.emergency_contact_resolved(uuid, integer) from public, anon, authenticated;
grant execute on function public.emergency_contact_resolved(uuid, integer) to service_role;


-- =============================================================================
-- 4. clubs_portal_export(team_ids)
-- =============================================================================

create or replace function public.clubs_portal_export(p_team_ids uuid[])
  returns table (
    team_id     uuid,
    team_name   text,
    person_id   uuid,
    first_name  text,
    last_name   text,
    dob         date,
    sex         text,
    email       text,
    phone       text,
    age_proved  boolean,
    address     jsonb,
    contact1    jsonb,
    contact2    jsonb
  )
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_players integer;
begin
  if not public.is_club_admin() then
    raise exception 'clubs_portal_export: club administrators only' using errcode = '42501';
  end if;
  if p_team_ids is null or coalesce(array_length(p_team_ids, 1), 0) = 0 then
    raise exception 'clubs_portal_export: choose at least one team' using errcode = 'P0001';
  end if;

  select count(distinct m.person_id) into v_players
    from public.team_memberships m
    join public.people p on p.id = m.person_id and p.deleted_at is null
   where m.team_id = any (p_team_ids) and m.role = 'player' and m.left_at is null;

  -- One row per team the export covers, counting only — never a name.
  perform public.write_audit(
    'teams.clubs_portal.exported', 'teams', array_to_string(p_team_ids, ','),
    jsonb_build_object('teams', array_length(p_team_ids, 1), 'players', v_players));

  return query
    select distinct on (t.id, p.id)
           t.id, t.name, p.id, p.first_name, p.last_name, p.dob, p.sex, p.email, p.phone,
           p.id_verified, p.address,
           public.emergency_contact_resolved(p.id, 1),
           public.emergency_contact_resolved(p.id, 2)
      from public.team_memberships m
      join public.teams t on t.id = m.team_id
      join public.people p on p.id = m.person_id and p.deleted_at is null
     where m.team_id = any (p_team_ids)
       and m.role = 'player'
       and m.left_at is null
     order by t.id, p.id;
end;
$$;

comment on function public.clubs_portal_export(uuid[]) is
  'Every live player of the given teams with the fields the FA Clubs Portal asks for, and both emergency contacts resolved (linked member, matching guardian, or typed). Club administrators only; each call writes one audit row counting teams and players.';

revoke all privileges on function public.clubs_portal_export(uuid[]) from public, anon;
grant execute on function public.clubs_portal_export(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 5. ROLLBACK
-- =============================================================================
-- drop function public.clubs_portal_export(uuid[]);
-- drop function public.emergency_contact_resolved(uuid, integer);
-- restore set_emergency_contacts from 20260902200000;
-- alter table public.emergency_contacts drop column address, drop column email,
--   drop column sex, drop column dob, drop column contact_person_id;
