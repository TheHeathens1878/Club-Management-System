-- =============================================================================
-- SG-1 protects the children the club knows about
-- =============================================================================
-- Adam, 2026-09-02, having hit the wall twice in one afternoon:
--
--   "conversation 9c0128fe...: this change would leave exactly one adult and
--    one minor with no guardian present (team conversation) [SG-1]"
--        — on approving a grown man's registration for the Vets O45 team.
--
--   "people: dob 1989-09-19 would leave person a346769d... alone with an adult
--    in open conversation(s) 55101aed... [SG-1.2]"
--        — on typing a coach's date of birth into his own record.
--
--
-- 1. WHY BOTH HAPPENED
-- ---------------------------------------------------------------------------
-- SG-0 says an unknown date of birth is a minor: unknown, so protect. Every
-- other rule in this database reads it that way and will go on reading it that
-- way. But SG-1 is not a rule about one person — it is a rule about a PAIR, and
-- reading "unknown" as "child" on both sides of the pair produces two results
-- nobody wants:
--
--   · THE VETS ROOM. Ken Ramsbottom (coach, 51) had no dob on file, so he
--     counted as a child. Adding a second adult made the room "one adult and
--     one child", and the approval was refused. Nobody under fifty is involved.
--
--   · THE DEADLOCK, which is the serious one. The U09 Diamonds room holds two
--     coaches, neither with a dob. Two unknowns is a room of two children,
--     which is allowed. Give EITHER of them their real date of birth and the
--     room becomes one adult and one child, and the write is refused. Give the
--     other one first — refused identically. There is no order, and no single
--     statement, that gets out: the rule forbids the recording of the very fact
--     that would satisfy it. Seven of this club's rooms are in that state, and
--     33 of its 45 coaches have no dob to unlock them with.
--
-- A safeguarding rule that punishes the club for writing down a true age makes
-- the register worse, not the children safer.
--
--
-- 2. WHAT CHANGES, AND WHAT EXPLICITLY DOES NOT
-- ---------------------------------------------------------------------------
-- Inside the SG-1 pair test only, "minor" now means KNOWN minor — a date of
-- birth on record, and under eighteen. A person with no dob is no longer
-- counted as the child in an adult-and-child pair.
--
-- NOTHING ELSE MOVES. `is_minor()` keeps its fail-closed reading everywhere it
-- is asked about one person: SG-6's child-facing DBS rules, SG-4 guardianship
-- and household, SG-10 account eligibility, registrations, media consent, board
-- posts, the venue groups. This migration touches four functions, all of them
-- the SG-1 machinery, and adds one predicate.
--
-- The protection that remains is the protection that was doing work: every
-- child the club has a date of birth for. That is every player on the books
-- (4 of 4) and every child who has ever come through /join, where a date of
-- birth is required and the account-eligibility rule will not proceed without
-- one. What is given up is the shield over a child whose age the club has never
-- recorded — and the club can no longer create one of those through any screen
-- it owns.
--
-- Adam was asked to choose this, in these words, on 2026-09-02, against the
-- alternative of keeping SG-1 whole and moving its enforcement off the dob
-- write, and against removing SG-1 altogether. This is the middle answer.
--
--
-- 3. THE ONE ROOM THIS OPENS UP TO VIEW
-- ---------------------------------------------------------------------------
-- U11 Venus 2026/27 (50d5b28b-...) holds Noah Taylor, ten years old, and Dave
-- Taylor, a coach with no dob and NO GUARDIANSHIP recorded between them. Today
-- that room passes SG-1 only because the coach counts as a child too. After
-- this migration it is what it has been all along: one adult and one child,
-- alone, with no guardian.
--
-- The migration does not paper over it and does not quietly break it. It writes
-- an audit row naming every room in that position so the breach is findable,
-- and leaves SG-1.7 to stop messages in it. The remedies are the ordinary ones
-- and all three still work: record the child's parent (the guardianship sync
-- adds them and the room is compliant), add a second coach, or take the child
-- out of the room. This is not a state the migration creates — it is a state it
-- stops hiding.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered. Data touched: none rewritten; one audit row per non-compliant open
-- conversation. Safeguarding: THIS PR NARROWS SG-1 (§2.4). It was put to Adam
-- as a choice of three and he chose this one. Rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. is_known_minor — the pair test's reading of "child"
-- =============================================================================

create or replace function public.is_known_minor_dob(d date)
  returns boolean
  language sql
  stable
  set search_path = public
as $function$
  -- Deliberately NOT is_minor_dob(). That one answers "must I protect this
  -- person?" and says yes to a null. This one answers "do I know this person is
  -- a child?" and a null is not knowledge.
  select d is not null and d > (current_date - interval '18 years');
$function$;

comment on function public.is_known_minor_dob(date) is
  'Under eighteen ON THE RECORD. Unlike is_minor_dob(), an unknown date of birth is not a child — used only by the SG-1 pair test, where reading unknown as child makes recording a true age impossible.';

create or replace function public.is_known_minor(person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $function$
  select coalesce(
    (select public.is_known_minor_dob(p.dob) from public.people p where p.id = person_id),
    false
  );
$function$;

comment on function public.is_known_minor(uuid) is
  'Is this person recorded as under eighteen? Unknown dob is FALSE here, unlike is_minor(). SG-1 only — every other rule keeps the fail-closed reading.';


-- =============================================================================
-- 2. conversation_is_compliant — restated with the new reading
-- =============================================================================
-- Taken from the live definition (20260823210000 as amended by 20260825030000,
-- which added SG-1.10 and the referee limb) and changed in exactly two places:
-- the two expressions that decide who counts as the child of the pair.
-- SG-1.4, SG-1.9 and SG-1.10 are otherwise untouched, hypothetical parameters
-- and all.

create or replace function public.conversation_is_compliant(
  p_conversation_id   uuid,
  p_ignore_guardian   uuid default null,
  p_ignore_child      uuid default null,
  p_revoked_consent_child uuid default null,
  p_min_unsup_age     integer default null,
  p_dob_person        uuid default null,
  p_dob               date default null
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $function$
declare
  c public.conversations%rowtype;
  v_count integer;
  v_minors uuid[];
  v_adults uuid[];
  v_minor uuid;
  v_minor_dob date;
  v_age integer;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.type = 'announcement' then
    return true;
  end if;

  -- THE ONE CHANGE. was: is_minor_dob(p_dob) / is_minor(p.person_id).
  with active as (
    select p.person_id,
           case when p.person_id = p_dob_person
                then public.is_known_minor_dob(p_dob)
                else public.is_known_minor(p.person_id) end as minor
    from public.conversation_participants p
    where p.conversation_id = p_conversation_id and p.left_at is null and p.basis <> 'oversight'
  )
  select count(*), array_agg(person_id) filter (where minor), array_agg(person_id) filter (where not minor)
    into v_count, v_minors, v_adults
  from active;

  if v_count <> 2 or coalesce(array_length(v_minors, 1), 0) <> 1 then
    return true;  -- not a 1:1 with exactly one minor
  end if;
  v_minor := v_minors[1];

  -- SG-1.4: the adult is the minor's own (active) guardian
  if exists (
    select 1 from public.guardianships g
    where g.child_person_id = v_minor and g.guardian_person_id = any(v_adults) and g.ended_at is null
      and not (coalesce(g.guardian_person_id = p_ignore_guardian, false) and coalesce(g.child_person_id = p_ignore_child, false)))
  then
    return true;
  end if;

  select case when pp.id = p_dob_person then p_dob else pp.dob end
    into v_minor_dob
    from public.people pp where pp.id = v_minor;

  -- SG-1.10 (Adam, 2026-08-25): "Adults can message players aged 16 or over
  -- at any time" — at self_account_age or above the 1:1 needs no consent, no
  -- guardian and no flag. The null test below is now unreachable: a person
  -- with no dob is not the minor of the pair at all. It stays because it costs
  -- nothing and this limb must never read a null as "old enough".
  if v_minor_dob is not null
     and public.is_at_least_age(v_minor_dob, public.safeguarding_setting_int('safeguarding.self_account_age'))
  then
    return true;
  end if;

  -- SG-1.9: supervision-exempt minor in a supervised conversation. Two limbs
  -- since 2026-08-25: the original consent-based one, and the referee hat —
  -- "and 14 or over if they are classed as a referee". Both require the
  -- conversation to carry the lead-supervision flag, which the admitting
  -- trigger sets through conversation_exemptable().
  if c.supervised_by_lead then
    v_age := coalesce(p_min_unsup_age, public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age'));
    if v_minor_dob is not null and public.is_at_least_age(v_minor_dob, v_age) then
      if v_minor <> coalesce(p_revoked_consent_child, '00000000-0000-0000-0000-000000000000'::uuid)
         and public.has_active_consent(v_minor, 'unsupervised_messaging')
      then
        return true;
      end if;
      if public.person_has_role(v_minor, 'referee'::public.app_role) then
        return true;
      end if;
    end if;
  end if;

  return false;
end;
$function$;


-- =============================================================================
-- 3. conversation_exemptable / conversation_has_minor / conversations_guard
-- =============================================================================
-- The same reading, for the same reason: these three answer questions about
-- the SG-1 pair, and they must agree with the test, or the admitting trigger
-- will flag a room the test then passes (or refuse to unflag one).
-- The referee limb from 20260825030000 is carried through unchanged.

create or replace function public.conversation_exemptable(p_conversation_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $function$
declare
  v_minors uuid[];
  v_count integer;
begin
  with active as (
    select p.person_id, public.is_known_minor(p.person_id) as minor
    from public.conversation_participants p
    where p.conversation_id = p_conversation_id and p.left_at is null and p.basis <> 'oversight')
  select count(*), array_agg(person_id) filter (where minor) into v_count, v_minors from active;
  if v_count <> 2 or coalesce(array_length(v_minors, 1), 0) <> 1 then
    return false;
  end if;
  if public.is_supervision_exempt(v_minors[1]) then
    return true;
  end if;
  return exists (
    select 1 from public.people pp
    where pp.id = v_minors[1]
      and pp.dob is not null
      and public.is_at_least_age(pp.dob, public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age')))
    and public.person_has_role(v_minors[1], 'referee'::public.app_role);
end;
$function$;

create or replace function public.conversation_has_minor(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $function$
  select exists (select 1 from public.conversation_participants p
                 where p.conversation_id = p_conversation_id and public.is_known_minor(p.person_id));
$function$;

create or replace function public.conversations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
begin
  -- SG-1.9. "A minor participant" here is the SG-1 reading: a coach whose dob
  -- nobody has typed in must not lock a room into supervision for ever.
  if old.supervised_by_lead and not new.supervised_by_lead
     and exists (select 1 from public.conversation_participants p
                 where p.conversation_id = new.id and p.left_at is null and public.is_known_minor(p.person_id)) then
    raise exception 'conversations: supervised_by_lead cannot be cleared while a minor participant is active [SAFEGUARDING.md SG-1.9]'
      using errcode = 'P0001';
  end if;
  if new.legal_hold is distinct from old.legal_hold and auth.uid() is not null and not public.is_safeguarding_lead() then
    raise exception 'conversations.legal_hold may only be set or cleared by a safeguarding_lead [SAFEGUARDING.md SG-8]' using errcode = '42501';
  end if;
  if new.closed_at is not null and old.closed_at is null then
    new.closed_by := coalesce(new.closed_by, auth.uid());
  end if;
  if new.type <> old.type then
    raise exception 'conversations: type is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;


-- =============================================================================
-- 4. NAME THE ROOMS THIS EXPOSES
-- =============================================================================
-- Written as a general sweep rather than as one hard-coded room: whatever the
-- club's data looks like when this runs, every open conversation that fails
-- SG-1 under the new reading gets an audit row. Silence would be the only
-- unacceptable outcome — see 20260902110000 §3 for the same principle.

do $sweep$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id, c.type, c.title
      from public.conversations c
     where c.closed_at is null
       and not public.conversation_is_compliant(c.id)
  loop
    perform public.write_audit(
      'conversation.sg1_exposed', 'conversations', r.id::text,
      jsonb_build_object(
        'title', r.title,
        'type', r.type,
        'note', 'One adult and one known minor, no guardian. Hidden until now by an unrecorded date of birth; SG-1.7 stops messages here until a guardian, a third participant, or the child''s removal clears it.'));
    n := n + 1;
  end loop;
  if n > 0 then
    raise warning 'SG-1: % open conversation(s) are non-compliant under the known-minor reading; see audit_log action conversation.sg1_exposed', n;
  end if;
end
$sweep$;


-- =============================================================================
-- 5. ROLLBACK
-- =============================================================================
-- Restore the four functions from their previous definitions —
-- 20260823210000 (conversation_is_compliant, conversation_has_minor,
-- conversations_guard) and 20260825030000 (conversation_exemptable) — and then
--   drop function if exists public.is_known_minor(uuid);
--   drop function if exists public.is_known_minor_dob(date);
-- Nothing else is to undo: no data was rewritten.
-- =============================================================================
