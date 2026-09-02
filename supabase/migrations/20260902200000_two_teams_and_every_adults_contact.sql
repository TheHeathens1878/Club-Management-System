-- Two teams, and every adult's contact (2026-09-02).
--
-- Adam: "players should be able to register for 2 teams" — then, trying it:
-- "I tried to register stephanie jones for 2 teams and it said There is
-- already a registration waiting or approved for this season" — then:
-- "They should be able to join unlimited teams."
-- And: "Users should be able to set emergency contacts for adult players who
-- don't have their own login (usually themself)."
--
-- 1. REGISTRATIONS: `registrations_live_idx` was unique on (person, season)
--    while pending/approved — one live registration a season, full stop. The
--    key gains the team: one live registration PER TEAM, as many teams as
--    the age-band and sex rules in `registrations_guard()` allow (those are
--    untouched — every extra team is still individually checked). A
--    team-less registration — the "club follows up by hand" kind — still
--    allows only one at a time, via the coalesce below: two open blank
--    requests for the same person would be the same request twice.
--
-- 2. EMERGENCY CONTACTS: `set_emergency_contacts()` admitted the person
--    themself, a guardian of a minor, or an administrator — so a login-less
--    household adult's contact could be set by NOBODY in the family, and the
--    read policy hid the rows the same way. The accessor and the policy now
--    also admit `is_household_member_of()` — the SAME predicate that already
--    lets that account register the person (20260824280000): in my
--    household, no login of their own. The moment they claim their own
--    account, the predicate answers false and only they can edit their
--    contacts again.
--
-- `set_emergency_contacts` restated from the LIVE definition
-- (pg_get_functiondef, 2026-09-02); only the permission check and its
-- refusal sentence change.

-- ---------------------------------------------------------------------------
-- 1. One live registration per team, not per season.

drop index if exists public.registrations_live_idx;
create unique index registrations_live_idx
  on public.registrations (
    person_id,
    season_id,
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('pending', 'approved');

comment on index public.registrations_live_idx is
  'One live (pending/approved) registration per person per TEAM per season — '
  'unlimited teams (Adam, 2026-09-02). The coalesce keeps team-less '
  'registrations to one open request at a time.';

-- ---------------------------------------------------------------------------
-- 2. The household may keep a login-less adult''s emergency contacts.

alter policy emergency_contacts_self_read on public.emergency_contacts
  using (can_act_for(person_id) or is_household_member_of(person_id));

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
  end loop;

  delete from public.emergency_contacts where person_id = p_person_id;

  for v_item in select * from jsonb_array_elements(p_contacts) loop
    v_pos := v_pos + 1;
    select n.first_name, n.last_name into v_first, v_last
      from public.contact_name_parts(v_item) n;
    v_phone        := btrim(v_item ->> 'phone');
    v_relationship := nullif(btrim(coalesce(v_item ->> 'relationship', '')), '');

    insert into public.emergency_contacts
      (person_id, "position", first_name, last_name, phone, relationship, updated_by)
    values
      (p_person_id, v_pos, v_first, v_last, v_phone, v_relationship, auth.uid());
  end loop;

  -- The count and the actor, never the names and never the numbers.
  perform public.write_audit(
    'people.emergency_contacts.updated', 'people', p_person_id::text,
    jsonb_build_object('count', v_count, 'by_person_id', v_me));
end;
$function$;
