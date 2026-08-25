-- =============================================================================
-- people_dob_guard: judge SG-10 eligibility on the CORRECTED dob (2026-08-25)
-- =============================================================================
-- The SG-10 re-check ran `is_account_eligible(new.id)` from a BEFORE trigger,
-- where the table still holds the OLD dob — so it was really asking "were they
-- eligible before the correction?". That happened to work while no adult was
-- self-eligible (an adult without consent counted ineligible, which switched
-- the check on), but 20260825030000's self-account limb makes every adult
-- eligible on their OLD dob and the re-check went quiet: an account-holding
-- adult could be corrected down to 11. Evaluate both limbs against NEW.dob,
-- as the SG-1.2 block below it already does. Everything else is unchanged
-- from the 20260823210000 definition.
--
-- ROLLBACK: re-run the 20260823210000 definition of people_dob_guard().
-- =============================================================================

create or replace function public.people_dob_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_min_age integer;
  v_team record;
  v_names text;
  v_affected text;
begin
  if new.dob is not null and new.dob > current_date then
    raise exception
      'people.dob may not be in the future (got %, today is %)',
      new.dob, current_date;
  end if;

  -- SG-10: a dob correction must not turn an existing account holder into an
  -- ineligible minor. Eligibility is judged on the dob being WRITTEN — the
  -- self-account limb and the consent limb both against new.dob.
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and new.dob is not null
     and public.is_minor_dob(new.dob)
     and exists (select 1 from public.profiles pr where pr.person_id = new.id)
     and not (
       public.is_at_least_age(new.dob, public.safeguarding_setting_int('safeguarding.self_account_age'))
       or (
         public.is_at_least_age(new.dob, public.safeguarding_setting_int('safeguarding.min_account_age'))
         and public.has_active_consent(new.id, 'app_account'::public.consent_type)
       )
     )
  then
    v_min_age := public.safeguarding_setting_int('safeguarding.min_account_age');

    if not public.is_at_least_age(new.dob, v_min_age) then
      raise exception
        'people: dob % would make person % a minor of %, below the minimum account age of %, and they already hold an app account [SAFEGUARDING.md SG-10]',
        new.dob,
        new.id,
        date_part('year', age(current_date, new.dob))::integer,
        v_min_age;
    end if;

    raise exception
      'people: dob % would make person % a minor with no active app_account consent, and they already hold an app account [SAFEGUARDING.md SG-10]',
      new.dob, new.id;
  end if;

  -- SG-6 tier 1 (c): a dob correction that makes an existing team member a
  -- minor revalidates every team they are live on, on the same terms as (b).
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and public.is_minor_dob(new.dob)
     and not public.is_minor_dob(old.dob)
  then
    for v_team in
      select distinct m.team_id, t.name
      from public.team_memberships m join public.teams t on t.id = m.team_id
      where m.person_id = new.id and m.left_at is null
    loop
      select string_agg(full_name || ' (' || role || ')', ', ' order by full_name)
        into v_names
      from public.team_noncompliant_child_facing(v_team.team_id) n
      where n.person_id <> new.id;
      if v_names is not null then
        raise exception
          'people: dob % would make person % a minor on team "%", whose child-facing members lack an in-date DBS check and safeguarding qualification: % [SAFEGUARDING.md SG-6]',
          new.dob, new.id, v_team.name, v_names
          using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- SG-1.2: a dob correction must not turn an open conversation into an
  -- unaccompanied adult↔minor 1:1. Evaluated with the NEW dob for this person.
  if tg_op = 'UPDATE' and new.dob is distinct from old.dob then
    select string_agg(c.id::text, ', ') into v_affected
    from public.conversations c
    where c.closed_at is null
      and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = new.id and p.left_at is null)
      and not public.conversation_is_compliant(c.id, null, null, null, null, new.id, new.dob);
    if v_affected is not null then
      raise exception
        'people: dob % would leave person % alone with an adult in open conversation(s) % [SAFEGUARDING.md SG-1.2]',
        new.dob, new.id, v_affected using errcode = 'P0001';
    end if;
  end if;

  return new;
end $function$;
