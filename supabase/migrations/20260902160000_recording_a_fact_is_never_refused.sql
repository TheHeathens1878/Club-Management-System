-- =============================================================================
-- Writing down a true fact is never refused
-- =============================================================================
-- Adam, 2026-09-02, blocked for the third time in an afternoon:
--
--   "Please can you remove all these safeguarding rules leaving a player alone
--    in an adult conversation. They are stopping us from actually using the app
--    properly. I couldn't update Dave Taylor's DOB because it said people: dob
--    1980-01-21 would leave person b9d88520… alone with an adult in open
--    conversation(s) 50d5b28b… [SG-1.2]. I can't add a guardianship as Dave
--    doesn't have a DOB."
--
--
-- 1. THE DEADLOCK, AGAIN, FROM THE OTHER SIDE
-- ---------------------------------------------------------------------------
-- U11 Venus 2026/27 holds Noah Taylor, ten, and Dave Taylor, his coach and by
-- every appearance his father. The room is one adult and one child with no
-- guardianship on record, which is precisely what SG-1 is for, and the club's
-- own remedy for it is to record the guardianship.
--
-- It cannot. `guardianships_guard` will not make somebody a guardian until the
-- club knows they are an adult, and `people_dob_guard` will not record that
-- Dave is an adult until the room is compliant, and the room will not be
-- compliant until the guardianship exists. Three rules, each right on its own,
-- arranged in a circle with the club inside it.
--
-- 20260902120000 broke the first version of this circle — two coaches, neither
-- with a date of birth — by narrowing what SG-1 counts as a child. That was the
-- right fix for that case and it stands. It does nothing for this one, because
-- here the child is a real, known ten-year-old.
--
--
-- 2. WHAT ACTUALLY CHANGES, AND WHY IT IS THE SMALL DOOR
-- ---------------------------------------------------------------------------
-- SG-1.2 and SG-1.8 stop refusing. Nothing else moves.
--
-- Those two are not the invariant; they are two of the eight places that
-- enforce it, and they are the only two that enforce it against the RECORDING
-- OF A FACT rather than against an act. Look at what each actually prevents:
--
--   · SG-1.2 refuses a date of birth. But the child's age is not changed by
--     typing it — Noah has been ten all along, and Dave has been forty-six all
--     along. The pairing the rule objects to already exists in the world; the
--     only thing the refusal achieves is that the club's register stays wrong
--     about it.
--   · SG-1.8 refuses the ending of a guardianship. Same shape: a foster
--     placement that has ended has ended.
--
-- Refusing a write of that kind does not protect a child. It protects the
-- appearance of compliance, at the cost of the register — and a safeguarding
-- system whose register is wrong is worth very little.
--
-- SO THE ENFORCEMENT MOVES TO THE ACT, WHERE IT BELONGS, AND STAYS THERE:
--
--   · SG-1.1 — a participant change that would create an unaccompanied 1:1 is
--     still refused. You cannot put a child alone in a room with an adult.
--   · SG-1.7 — no message may be sent in a room that is one adult and one
--     child with no guardian. This is the one that matters: the harm SG-1
--     exists to prevent is the unsupervised CONVERSATION, and it is still
--     impossible.
--   · SG-1.4, SG-1.9, SG-1.10 — the guardian limb and the supervision-exempt
--     limbs are untouched.
--   · SG-9's oversight, SG-2's retention, SG-3, SG-4, SG-6, SG-10 — untouched.
--
-- What Adam does next, and why this is enough: record Dave's date of birth (now
-- allowed); the room is briefly non-compliant and nobody can post in it; record
-- the guardianship (now allowed, because Dave is a known adult); the room is
-- compliant again and the room reopens. Two writes, and the club's record is
-- true at the end of them.
--
-- WHAT THIS IS NOT. Adam asked for SG-1 to be removed. It is not removed, and
-- the sentence "no child may be alone in a conversation with an adult" is still
-- enforced by the database at the moment anybody tries to do it or say
-- anything in it. This migration removes the two guards that were refusing the
-- CURE rather than the disease. If he wants the rest of SG-1 gone as well, that
-- is a separate, larger decision and it is his to make — but it is not what was
-- blocking him, and this is.
--
-- A REFUSAL BECOMES A WARNING, NOT A SILENCE. Both writes now go through and
-- write an audit row naming the conversations they left non-compliant, so a
-- safeguarding lead can find every one of them; and `sg1_open_breaches()` lists
-- them on demand.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered. Data touched: none. Safeguarding: THIS PR NARROWS SG-1's
-- ENFORCEMENT (§2.4) — two of its eight triggers stop refusing and start
-- auditing. SG-1.1 and SG-1.7, which are what make the conversation itself
-- impossible, are untouched. Adam asked for this twice, blocked both times, and
-- the §6.1 entry records it. Rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. WHERE A PERSON IS STILL LEFT ALONE
-- =============================================================================
-- One accessor, so the two guards below and any screen that wants to show the
-- backlog all ask the same question the same way.

create or replace function public.sg1_open_breaches(
  p_person_id uuid default null,
  p_dob       date default null,
  p_ignore_guardian uuid default null,
  p_ignore_child    uuid default null
)
  returns table (conversation_id uuid, title text, type public.conversation_type)
  language sql
  stable
  security definer
  set search_path = public
as $function$
  select c.id, c.title, c.type
    from public.conversations c
   where c.closed_at is null
     and (p_person_id is null
          or exists (select 1 from public.conversation_participants p
                      where p.conversation_id = c.id
                        and p.person_id = p_person_id
                        and p.left_at is null))
     and not public.conversation_is_compliant(
           c.id, p_ignore_guardian, p_ignore_child, null, null, p_person_id, p_dob);
$function$;

comment on function public.sg1_open_breaches(uuid, date, uuid, uuid) is
  'Open conversations that are one adult and one known minor with no guardian — optionally evaluated as if one person had a different date of birth, or one guardianship were already ended. The backlog SG-1.2 and SG-1.8 used to refuse rather than record.';

revoke all privileges on function public.sg1_open_breaches(uuid, date, uuid, uuid) from public, anon;
grant execute on function public.sg1_open_breaches(uuid, date, uuid, uuid) to authenticated, service_role;


-- =============================================================================
-- 2. SG-1.2 — the dob guard records instead of refusing
-- =============================================================================
-- 20260825040000's body, with the SG-1.2 block replaced. SG-10 (an account
-- holder must not be turned into an ineligible minor) and SG-6 tier 1(c) (a
-- team's child-facing staff must be compliant before it gains a minor) both
-- stay exactly as they were: those two refuse an ACT with consequences beyond
-- the record, not the record itself.

create or replace function public.people_dob_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_min_age integer;
  v_team    record;
  v_names   text;
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

  -- SG-1.2 (rewritten 2026-09-02): the date of birth is written, and the
  -- conversations it leaves non-compliant are AUDITED. See this file's header
  -- for why refusing it protected nobody: the age is a fact about the person,
  -- not an act, and the pairing it reveals already existed. SG-1.7 stops
  -- anything being said in those rooms until they are put right.
  if tg_op = 'UPDATE' and new.dob is distinct from old.dob then
    select string_agg(b.conversation_id::text, ', ')
      into v_affected
      from public.sg1_open_breaches(new.id, new.dob) b;
    if v_affected is not null then
      perform public.write_audit(
        'safeguarding.sg1_exposed_by_dob', 'people', new.id::text,
        jsonb_build_object(
          'dob', new.dob,
          'conversations', v_affected,
          'note', 'Recording this date of birth left the named open conversation(s) as one adult and one minor with no guardian. Nothing can be posted in them (SG-1.7) until a guardian is recorded, a third person joins, or the child leaves.'));
    end if;
  end if;

  return new;
end $function$;


-- =============================================================================
-- 3. SG-1.8 — ending a guardianship records instead of refusing
-- =============================================================================

create or replace function public.guardianships_conversation_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_guardian uuid := old.guardian_person_id;
  v_child    uuid := old.child_person_id;
  v_affected text;
begin
  -- Only a change that removes the old pair matters: delete, retarget, or end.
  if tg_op = 'UPDATE'
     and new.guardian_person_id = old.guardian_person_id
     and new.child_person_id = old.child_person_id
     and (new.ended_at is null or old.ended_at is not null) then
    return new;
  end if;

  -- SG-1.8 (rewritten 2026-09-02): the link is ended, and the conversations it
  -- was holding up are AUDITED. A guardianship that has ended has ended, and
  -- refusing to record that left the club with a register saying a child was
  -- accompanied by somebody who is no longer their guardian — worse than
  -- knowing they are not. SG-1.7 stops anything being said in those rooms.
  -- The query is the one this guard has always used: rooms where BOTH of them
  -- are still active participants, evaluated as if the link were already gone.
  select string_agg(c.id::text, ', ') into v_affected
  from public.conversations c
  where c.closed_at is null
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = v_child and p.left_at is null)
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = v_guardian and p.left_at is null)
    and not public.conversation_is_compliant(c.id, v_guardian, v_child);

  if v_affected is not null then
    perform public.write_audit(
      'safeguarding.sg1_exposed_by_guardianship', 'guardianships', v_child::text,
      jsonb_build_object(
        'guardian_person_id', v_guardian,
        'child_person_id', v_child,
        'conversations', v_affected,
        'note', 'Ending this guardianship left the named open conversation(s) as one adult and one minor with no guardian. Nothing can be posted in them (SG-1.7) until another guardian is recorded, a third person joins, or the child leaves.'));
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $function$;


-- =============================================================================
-- 4. THE BACKLOG, NAMED ONCE MORE
-- =============================================================================
-- Whatever is non-compliant as this runs gets a row, so the list a lead reads
-- is complete rather than starting from the next edit.

do $sweep$
declare
  r record;
  n integer := 0;
begin
  for r in select * from public.sg1_open_breaches() loop
    perform public.write_audit(
      'safeguarding.sg1_open', 'conversations', r.conversation_id::text,
      jsonb_build_object('title', r.title, 'type', r.type));
    n := n + 1;
  end loop;
  if n > 0 then
    raise warning 'SG-1: % open conversation(s) are one adult and one minor with no guardian; SG-1.7 blocks messages in them', n;
  end if;
end
$sweep$;


-- =============================================================================
-- 5. ROLLBACK
-- =============================================================================
-- Restore `people_dob_guard()` from 20260825040000 and
-- `guardianships_conversation_guard()` from its definition in
-- 20260823210000, then
--   drop function if exists public.sg1_open_breaches(uuid, date, uuid, uuid);
-- Nothing was written that needs undoing.
-- =============================================================================
