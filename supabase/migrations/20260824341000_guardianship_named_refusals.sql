-- =============================================================================
-- SG-4 refusals name the people, not their ids (Adam, 2026-08-25)
-- =============================================================================
-- "I keep getting this error: guardianships: the guardian must be an adult
--  (person f57c4359-… has dob 2013-06-08). Same error if I put guardian of or
--  child of. Make that explanation clearer. It should say (e.g.) Adam Wareing
--  is the … Guardian of Matthew Wareing."
--
-- The guard was refusing correctly — a child had been put on the guardian side
-- of the link — but its sentence named a UUID, so it never revealed WHICH way
-- round the link had been read. Each refusal now names both people and states
-- the direction ("X cannot be recorded as the guardian of Y"), so a
-- wrong-way-round submission explains itself.
--
-- The tests assert the messages by substring ("guardian must be an adult",
-- "child must be a minor at creation", "date of birth must be known", "cannot
-- be their own guardian") — every phrase is preserved inside the new
-- sentences, so the SG-4 message contract holds. Logic is unchanged from
-- 20260822120000: same checks, same order, same P0001, same trigger.
--
-- Rollback: restore guardianships_guard() from 20260822120000.
-- =============================================================================

create or replace function public.guardianships_guard()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_guardian_dob  date;
  v_guardian_name text;
  v_child_name    text;
begin
  -- Only evaluate on creation, or on a retarget that genuinely changes a
  -- party. The age rules are creation-time rules (see 20260822120000).
  if tg_op = 'UPDATE'
     and new.guardian_person_id is not distinct from old.guardian_person_id
     and new.child_person_id    is not distinct from old.child_person_id
  then
    return new;
  end if;

  -- The names the refusals speak in. A person with no usable name falls back
  -- to their id, so a refusal is never blank.
  select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.id::text)
    into v_guardian_name from public.people p where p.id = new.guardian_person_id;
  select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.id::text)
    into v_child_name from public.people p where p.id = new.child_person_id;

  -- 1. No self-guardianship (also the guardianships_not_self CHECK, which is
  --    the layer that still holds if this trigger is ever dropped).
  if new.guardian_person_id = new.child_person_id then
    raise exception
      'guardianships: % cannot be their own guardian [SAFEGUARDING.md SG-4]',
      coalesce(v_guardian_name, new.guardian_person_id::text);
  end if;

  -- 2. The guardian must be an adult with a KNOWN date of birth.
  select p.dob
    into v_guardian_dob
    from public.people p
   where p.id = new.guardian_person_id;

  if not found then
    -- Unreachable while the foreign key stands; fail closed anyway rather than
    -- letting a NULL flow into the age test as "not a minor".
    raise exception
      'guardianships: guardian person % does not exist [SAFEGUARDING.md SG-4]',
      new.guardian_person_id;
  end if;

  if v_guardian_dob is null then
    raise exception
      'guardianships: % cannot be recorded as the guardian of % — their date of birth must be known first [SAFEGUARDING.md SG-4]',
      v_guardian_name, coalesce(v_child_name, new.child_person_id::text);
  end if;

  if public.is_minor_dob(v_guardian_dob) then
    raise exception
      'guardianships: % (born %) cannot be recorded as the guardian of % — the guardian must be an adult. If it is the other way round, choose "child of" instead [SAFEGUARDING.md SG-4]',
      v_guardian_name, to_char(v_guardian_dob, 'DD/MM/YYYY'), coalesce(v_child_name, new.child_person_id::text);
  end if;

  -- 3. The child must be a minor at creation. `is_minor()` returns TRUE for a
  --    NULL dob and an unknown id (SG-0, fail closed), so an unknown-dob child
  --    is accepted — refusing would leave the child the club knows least about
  --    with no recorded guardian at all.
  if not public.is_minor(new.child_person_id) then
    raise exception
      'guardianships: % cannot be recorded as the child of % — the child must be a minor at creation, and % is an adult [SAFEGUARDING.md SG-4]',
      coalesce(v_child_name, new.child_person_id::text), v_guardian_name, coalesce(v_child_name, new.child_person_id::text);
  end if;

  return new;
end $function$;
