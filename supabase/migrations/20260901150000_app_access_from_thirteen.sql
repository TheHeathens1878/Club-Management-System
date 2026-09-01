-- =============================================================================
-- App access cannot be consented to before the birthday it starts on
-- =============================================================================
-- Adam, 2026-09-01: "when allow app access is clicked, it must only allow
-- access on the 13th birthday and must say this under grant access."
--
-- The DATE was already right. `is_at_least_age(dob, 13)` is
-- `dob <= current_date - 13 years`, which is true ON the birthday and not the
-- day before, and `profiles_account_eligibility_guard()` refuses an account for
-- anyone below it. What was wrong was the CONSENT: `guardian_consents_grant_guard()`
-- checked that the child is a minor, that the guardian is an adult with a known
-- date of birth, and that an active guardianship links them — but not the
-- child's age. So a guardian could tick "Allow app access" for a seven-year-old
-- and the club would record a permission that could do nothing for six years.
--
-- That is worse than useless. It reads on the screen as access granted; it
-- leaves a consent on file that nobody revisits; and the decision it records was
-- made about a seven-year-old and would be relied on for a thirteen-year-old,
-- which is precisely the staleness SG-10 exists to prevent. A guardian should be
-- asked when the question is live.
--
-- So the guard now refuses it, naming the limb that failed the way SG-10
-- requires, and naming the DATE — the guardian's next question is "when, then?"
-- and the refusal should not make them work it out.
--
-- This STRENGTHENS an invariant; nothing here relaxes one. `min_account_age`
-- remains the single setting (floored at 13, the UK age of digital consent,
-- by the site_settings guard), so a club that raises it moves this with it.
--
-- Rollback: restore the body from 20260822140000_consents_settings.sql. Consents
-- already recorded are untouched either way — this only governs new ones.
-- =============================================================================

create or replace function public.guardian_consents_grant_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_guardian_dob    date;
  v_child_dob       date;
  v_min_age         integer;
  v_actor_person_id uuid;
begin
  -- 1. The child must be a minor.
  if not public.is_minor(new.child_person_id) then
    raise exception
      'guardian_consents: consent may only be recorded for a minor (person % is an adult) [SAFEGUARDING.md SG-10]',
      new.child_person_id;
  end if;

  -- 1a. And, for an app account, old enough for one TODAY. A consent granted
  --     before the birthday it depends on cannot take effect, so recording it
  --     only tells the guardian something untrue.
  if new.consent_type = 'app_account'::public.consent_type then
    select p.dob into v_child_dob from public.people p where p.id = new.child_person_id;
    v_min_age := public.safeguarding_setting_int('safeguarding.min_account_age');

    if not public.is_at_least_age(v_child_dob, v_min_age) then
      raise exception
        'guardian_consents: % may not have an app account until % — their %th birthday — so consent cannot be recorded yet [SAFEGUARDING.md SG-10]',
        new.child_person_id,
        to_char(v_child_dob + make_interval(years => v_min_age), 'FMDD FMMonth YYYY'),
        v_min_age;
    end if;
  end if;

  -- 2. The guardian must be an adult with a known date of birth (SG-4's rule,
  --    re-checked at grant time).
  select p.dob
    into v_guardian_dob
    from public.people p
   where p.id = new.guardian_person_id;

  if not found then
    -- Unreachable while the foreign key stands; fail closed anyway.
    raise exception
      'guardian_consents: guardian person % does not exist [SAFEGUARDING.md SG-10]',
      new.guardian_person_id;
  end if;

  if v_guardian_dob is null then
    raise exception
      'guardian_consents: the guardian''s date of birth must be known (person % has none) [SAFEGUARDING.md SG-10, SG-4]',
      new.guardian_person_id;
  end if;

  if public.is_minor_dob(v_guardian_dob) then
    raise exception
      'guardian_consents: the guardian must be an adult (person % has dob %) [SAFEGUARDING.md SG-10, SG-4]',
      new.guardian_person_id, v_guardian_dob;
  end if;

  -- 3. An ACTIVE guardianship link. The link, never the `parent` role.
  if not exists (
    select 1
      from public.guardianships g
     where g.guardian_person_id = new.guardian_person_id
       and g.child_person_id    = new.child_person_id
       and g.ended_at is null
  ) then
    raise exception
      'guardian_consents: person % holds no active guardianship to child % — consent requires the link, never the parent role [SAFEGUARDING.md SG-10, §1.3]',
      new.guardian_person_id, new.child_person_id;
  end if;

  -- 4. granted_by, when supplied, must be the guardian or a club_admin.
  if new.granted_by is not null then
    select pr.person_id
      into v_actor_person_id
      from public.profiles pr
     where pr.id = new.granted_by;

    if v_actor_person_id is distinct from new.guardian_person_id
       and not coalesce(
             public.person_has_role(v_actor_person_id, 'club_admin'::public.app_role),
             false
           )
    then
      raise exception
        'guardian_consents: granted_by % is neither the guardian on this row nor a club_admin [SAFEGUARDING.md SG-10]',
        new.granted_by;
    end if;
  end if;

  return new;
end $function$;

comment on function public.guardian_consents_grant_guard() is
  'SG-10 at grant time: a minor, old enough for the consent being given, a known '
  'adult guardian with an active link, and granted_by who they say they are. An '
  'app_account consent is refused before the child reaches safeguarding.min_account_age.';
