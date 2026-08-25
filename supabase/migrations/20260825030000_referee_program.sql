-- =============================================================================
-- The referee programme (2026-08-25)
-- =============================================================================
-- Adam's rulings, in his words:
--   * "Players over 16 can sign up and use the app without parental approval."
--   * "Adults can message players aged 16 or over at any time, and 14 or over
--      if they are classed as a referee."
--   * "Seed a referees group" whose structured posts a referee can claim.
--
-- Four pieces, in dependency order:
--   1. safeguarding.self_account_age (default 16) — a third SG-10 setting.
--      is_account_eligible() gains the self limb: at or above it, no guardian
--      consent is needed for an account. SG-10's trigger and the dob re-check
--      call is_account_eligible(), so both learn the rule for free.
--   2. SG-1 learns two new escapes in conversation_is_compliant():
--      a 1:1 with a minor at or above self_account_age is compliant outright;
--      one with a minor at or above unsupervised_messaging_min_age who holds
--      the referee hat is compliant WHEN the conversation is flagged for lead
--      supervision — conversation_exemptable() gains the matching limb so the
--      admitting trigger sets the flag itself. Consent-based paths and every
--      refusal string stay exactly as they were.
--   3. The Referees group: a seeded club-wide group conversation; granting
--      the referee hat joins you, revoking it walks you out. A join the SG-1
--      trigger refuses is audited, never allowed to break the role grant.
--   4. referee_match_posts — the structured "game needs a referee" card,
--      a side table keyed by message_id exactly as message_reactions is.
--      Claiming is a one-way update only a referee may make.
--
-- The 20260825020000 migration added the enum value; this one may use it.
--
-- ROLLBACK: drop table public.referee_match_posts;
--           drop trigger trg_person_roles_referee_group on public.person_roles;
--           drop function public.referee_role_sync_group();
--           drop function public.referees_group_id();
--           delete from public.site_settings where key = 'safeguarding.self_account_age';
--           re-run the 20260822140000 / 20260823210000 definitions of
--           safeguarding_setting_int, site_settings_safeguarding_guard,
--           is_account_eligible, conversation_is_compliant,
--           conversation_exemptable.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. safeguarding.self_account_age
-- ---------------------------------------------------------------------------

-- The reader learns the key's documented default (16) — an unknown key raises,
-- by its own design, so the default lands here first.
create or replace function public.safeguarding_setting_int(p_key text)
  returns integer
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $function$
declare
  v_default integer;
  v_value   text;
begin
  v_default := case p_key
    when 'safeguarding.min_account_age'                then 13
    when 'safeguarding.unsupervised_messaging_min_age' then 14
    when 'safeguarding.self_account_age'               then 16
    else null
  end;

  if v_default is null then
    raise exception
      'safeguarding_setting_int: no documented default for key % — add one here before reading it [SAFEGUARDING.md SG-10]',
      p_key;
  end if;

  select s.value into v_value
    from public.site_settings s
   where s.key = p_key;

  if v_value is null or v_value !~ '^\d+$' then
    return v_default;
  end if;
  return v_value::integer;
end $function$;

insert into public.site_settings (key, value)
values ('safeguarding.self_account_age', '16')
on conflict (key) do nothing;

-- The validation trigger learns the ordering: 13 ≤ min_account_age ≤
-- unsupervised_messaging_min_age ≤ self_account_age ≤ 18. self at 18 is legal
-- and means "nobody signs themselves up as a minor" — the pre-2026-08-25 rule.
create or replace function public.site_settings_safeguarding_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_value       integer;
  v_min_account integer;
  v_min_unsup   integer;
  v_self        integer;
begin
  if new.key not like 'safeguarding.%' then
    return new;
  end if;

  if new.value is null or new.value !~ '^\d+$' then
    raise exception
      'site_settings: % must be a plain integer (got %) [SAFEGUARDING.md SG-10]',
      new.key, coalesce(new.value, 'null');
  end if;
  v_value := new.value::integer;

  if new.key = 'safeguarding.min_account_age' then
    v_min_account := v_value;
    v_min_unsup   := public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age');
    v_self        := public.safeguarding_setting_int('safeguarding.self_account_age');
  elsif new.key = 'safeguarding.unsupervised_messaging_min_age' then
    v_min_account := public.safeguarding_setting_int('safeguarding.min_account_age');
    v_min_unsup   := v_value;
    v_self        := public.safeguarding_setting_int('safeguarding.self_account_age');
  elsif new.key = 'safeguarding.self_account_age' then
    v_min_account := public.safeguarding_setting_int('safeguarding.min_account_age');
    v_min_unsup   := public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age');
    v_self        := v_value;
  else
    -- Some other safeguarding.* integer. It passed the integer test, which is
    -- all SG-10 specifies for keys it does not name.
    return new;
  end if;

  -- The floor (D11, C9: the UK age of digital consent).
  if v_min_account < 13 then
    raise exception
      'site_settings: safeguarding.min_account_age may not be below 13, the UK age of digital consent (got %) [SAFEGUARDING.md SG-10, D11]',
      v_min_account;
  end if;

  -- The ceiling. At 18 a person is not a minor at all (SG-0), so a threshold of
  -- 18 or more describes nobody and would quietly disable the rule.
  if v_min_unsup >= 18 then
    raise exception
      'site_settings: safeguarding.unsupervised_messaging_min_age must be below 18 (got %) — at 18 a person is not a minor [SAFEGUARDING.md SG-10]',
      v_min_unsup;
  end if;

  -- §1.5: "Supervision-exemption presupposes account-eligibility... a minor
  -- with no app account has no conversation to be exempt in."
  if v_min_account > v_min_unsup then
    raise exception
      'site_settings: safeguarding.min_account_age (%) may not exceed safeguarding.unsupervised_messaging_min_age (%) [SAFEGUARDING.md SG-10, §1.5]',
      v_min_account, v_min_unsup;
  end if;

  -- 2026-08-25: the self-account age sits between the unsupervised-messaging
  -- age and 18 — below the former it would out-rank guardian consent for
  -- children the messaging rule still protects; above 18 it describes nobody.
  if v_self < v_min_unsup or v_self > 18 then
    raise exception
      'site_settings: safeguarding.self_account_age (%) must be between safeguarding.unsupervised_messaging_min_age (%) and 18 [SAFEGUARDING.md SG-10]',
      v_self, v_min_unsup;
  end if;

  -- P5.2 (SG-1.9) EXTENDS THIS FUNCTION HERE: when
  -- safeguarding.unsupervised_messaging_min_age is RAISED, reject the change
  -- unless every conversation the raise would leave non-compliant is already
  -- closed. Lowering it can only make conversations permissible and needs no
  -- check. Do not add a second trigger to this table.

  return new;
end $function$;

-- SG-0.1 gains the self limb: at self_account_age or above, the person signs
-- themselves up — no guardian consent required. Below it the 2026-08-22 rule
-- stands unchanged.
create or replace function public.is_account_eligible(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (
      select public.is_at_least_age(
               p.dob,
               public.safeguarding_setting_int('safeguarding.self_account_age')
             )
          or (
               public.is_at_least_age(
                 p.dob,
                 public.safeguarding_setting_int('safeguarding.min_account_age')
               )
           and public.has_active_consent(p.id, 'app_account'::public.consent_type)
             )
        from public.people p
       where p.id = p_person_id
    ),
    false
  );
$function$;


-- ---------------------------------------------------------------------------
-- 2. SG-1 learns the two new escapes
-- ---------------------------------------------------------------------------

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
as $$
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

  with active as (
    select p.person_id,
           case when p.person_id = p_dob_person then public.is_minor_dob(p_dob) else public.is_minor(p.person_id) end as minor
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
  -- guardian and no flag. An unknown dob is still "unknown, so protect".
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
$$;

-- The admitting trigger's question, extended the same way: would flagging the
-- conversation make it compliant? Yes for a supervision-exempt minor (the
-- consent path), and yes for a referee at or above the messaging age.
create or replace function public.conversation_exemptable(p_conversation_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_minors uuid[];
  v_count integer;
begin
  with active as (
    select p.person_id, public.is_minor(p.person_id) as minor
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
$$;


-- ---------------------------------------------------------------------------
-- 3. The Referees group, and the hat that joins it
-- ---------------------------------------------------------------------------

insert into public.conversations (type, title, scope_label)
select 'group', 'Referees', 'Referees'
where not exists (
  select 1 from public.conversations where type = 'group' and title = 'Referees');

create or replace function public.referees_group_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select id from public.conversations
  where type = 'group' and title = 'Referees'
  order by created_at
  limit 1;
$$;

revoke all privileges on function public.referees_group_id() from public, anon;
grant execute on function public.referees_group_id() to authenticated, service_role;

-- Granting the referee hat joins the group; revoking it walks you out. A join
-- SG-1 refuses (a lone under-14 referee facing a lone adult, say) is audited
-- and skipped rather than allowed to break the role grant itself.
create or replace function public.referee_role_sync_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_group uuid;
begin
  if new.role <> 'referee'::public.app_role then
    return null;
  end if;
  v_group := public.referees_group_id();
  if v_group is null then
    return null;
  end if;

  if new.revoked_at is null then
    if not exists (
      select 1 from public.conversation_participants
      where conversation_id = v_group and person_id = new.person_id and left_at is null)
    then
      begin
        insert into public.conversation_participants (conversation_id, person_id, basis)
        values (v_group, new.person_id, 'member');
      exception when others then
        perform public.write_audit(
          'referee_group.join_refused', 'conversations', v_group::text,
          jsonb_build_object('person_id', new.person_id, 'error', sqlerrm));
      end;
    end if;
  else
    update public.conversation_participants
       set left_at = now()
     where conversation_id = v_group and person_id = new.person_id and left_at is null;
  end if;
  return null;
end;
$$;

create trigger trg_person_roles_referee_group
  after insert or update of revoked_at on public.person_roles
  for each row execute function public.referee_role_sync_group();


-- ---------------------------------------------------------------------------
-- 4. referee_match_posts — the claimable game card
-- ---------------------------------------------------------------------------

create table public.referee_match_posts (
  id                    uuid primary key default gen_random_uuid(),
  message_id            uuid not null unique references public.messages (id) on delete restrict,
  conversation_id       uuid not null references public.conversations (id) on delete restrict,
  posted_by_person_id   uuid not null references public.people (id) on delete restrict,
  fixture_id            uuid references public.fixtures (id) on delete set null,
  -- The card's rows, exactly as posted (the fixture line carries the age group).
  fixture_text          text not null,
  duration_text         text,
  format_text           text,
  location_text         text,
  surface               text,
  kickoff_at            timestamptz,
  fee_text              text,
  claimed_by_person_id  uuid references public.people (id) on delete set null,
  claimed_at            timestamptz,
  created_at            timestamptz not null default now(),
  constraint referee_match_posts_fixture_not_blank check (btrim(fixture_text) <> ''),
  constraint referee_match_posts_surface check (surface is null or surface in ('3G', 'Grass')),
  constraint referee_match_posts_claim_pair check ((claimed_by_person_id is null) = (claimed_at is null))
);

comment on table public.referee_match_posts is
  'A "game needs a referee" card in the Referees group — a side table keyed by message_id, the message_reactions pattern. Claiming is one-way and referee-only; the guard trigger is the arbiter.';

create index referee_match_posts_conversation_idx on public.referee_match_posts (conversation_id);

-- The claim rules, enforced where RLS cannot express them: after insert the
-- card's details are frozen; the only ordinary change is an unclaimed card
-- being claimed BY the caller, who must hold the referee hat. A club admin may
-- clear a claim (referee dropped out). Service-role paths pass untouched.
create or replace function public.referee_match_posts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.message_id, new.conversation_id, new.posted_by_person_id,
      coalesce(new.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      new.fixture_text, coalesce(new.duration_text, ''), coalesce(new.format_text, ''),
      coalesce(new.location_text, ''), coalesce(new.surface, ''),
      coalesce(new.kickoff_at, 'epoch'::timestamptz), coalesce(new.fee_text, ''))
     is distinct from
     (old.message_id, old.conversation_id, old.posted_by_person_id,
      coalesce(old.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      old.fixture_text, coalesce(old.duration_text, ''), coalesce(old.format_text, ''),
      coalesce(old.location_text, ''), coalesce(old.surface, ''),
      coalesce(old.kickoff_at, 'epoch'::timestamptz), coalesce(old.fee_text, ''))
  then
    raise exception 'referee_match_posts: a posted card''s details cannot be edited' using errcode = 'P0001';
  end if;

  if old.claimed_by_person_id is null and new.claimed_by_person_id is not null then
    if new.claimed_by_person_id <> public.current_person_id() then
      raise exception 'referee_match_posts: a game is claimed for yourself, not somebody else' using errcode = 'P0001';
    end if;
    if not public.person_has_role(new.claimed_by_person_id, 'referee'::public.app_role) then
      raise exception 'referee_match_posts: only an approved referee may claim a game' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if old.claimed_by_person_id is not null
     and new.claimed_by_person_id is distinct from old.claimed_by_person_id
  then
    if not public.is_club_admin() then
      raise exception 'referee_match_posts: this game is already claimed — a club administrator can release it' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_referee_match_posts_guard
  before update on public.referee_match_posts
  for each row execute function public.referee_match_posts_guard();

alter table public.referee_match_posts enable row level security;

-- Read: whoever may read the message (the message_reactions rule).
create policy "referee_match_posts_read" on public.referee_match_posts
  for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_participant_ever(m.conversation_id)));

-- Post: an active participant, about their own message.
create policy "referee_match_posts_insert" on public.referee_match_posts
  for insert to authenticated
  with check (
    posted_by_person_id = public.current_person_id()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and m.conversation_id = referee_match_posts.conversation_id
        and m.sender_person_id = public.current_person_id())
    and public.is_active_participant(conversation_id));

-- Claim: any active participant may attempt the update; the guard trigger is
-- what decides whether the transition stands.
create policy "referee_match_posts_update" on public.referee_match_posts
  for update to authenticated
  using (public.is_active_participant(conversation_id))
  with check (public.is_active_participant(conversation_id));

revoke all privileges on public.referee_match_posts from anon, authenticated, service_role;
grant select, insert, update on public.referee_match_posts to authenticated;
grant select, insert, update, delete on public.referee_match_posts to service_role;

notify pgrst, 'reload schema';
