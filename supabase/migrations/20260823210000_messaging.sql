-- =============================================================================
-- P5.2 — conversations, participants, messages, attachments; SG-1 in full,
--        SG-1.9, SG-9 accessors, SG-2
-- =============================================================================
-- PLAN.md task P5.2 ("conversations, conversation_participants (with
-- last_read_message_id, joined/left), messages (reply_to, soft-delete),
-- attachments in Supabase Storage; implements SG-1.9 and SG-9"; acceptance:
-- "RLS: participants only; DB-level enforcement of §2.4 invariants with tests
-- that attempt violations and fail"). Spec: docs/specs/P5.1-messaging-spec.md.
--
-- THE SG-1 RULE, IN ONE FUNCTION
--   `conversation_is_compliant(conversation_id)` evaluates SG-1's precise form
--   over the active participant set (left_at is null; basis <> 'oversight' —
--   oversight rows are never created, but the exclusion is explicit):
--     non-compliant ⇔ type <> 'announcement'
--                   and count(A) = 2
--                   and exactly one of A is a minor (SG-0)
--                   and no adult in A holds an ACTIVE guardianship to that minor
--                   and not (that minor is supervision-exempt (SG-0.2)
--                            and conversations.supervised_by_lead)
--   It is called by:
--     (1) conversation_participants INSERT / UPDATE OF left_at       (SG-1, SG-1.1)
--     (2) messages INSERT                                            (SG-1.7)
--     (3) people_dob_guard() — the single dob trigger, extended        (SG-1.2)
--     (4) guardianships_conversation_guard() — P1.3's scaffold, body
--         replaced: DELETE / UPDATE OF guardian_person_id,
--         child_person_id, ended_at → reject unless every affected
--         conversation is closed                                     (SG-1.8)
--     (5) guardian_consents UPDATE OF revoked_at (unsupervised_messaging)
--         → reject unless every dependent conversation is closed   (SG-1.9)
--     (6) site_settings UPDATE raising unsupervised_messaging_min_age
--         → reject unless every dependent conversation is closed   (SG-1.9)
--     (7) `sg1_nightly_check()` for the report (P5.6 schedules it)
--   "Affected"/"dependent" is computed the honest way: evaluate the
--   conversation AS IF the change had happened (the helper takes the
--   hypothetical into account via parameters), never by guessing.
--
-- SG-1.9: the admitting trigger (1) sets `supervised_by_lead = true` itself
--   when the only reason the set is compliant is the exemption; a BEFORE UPDATE
--   guard refuses clearing it while a minor participant is active.
--
-- SG-9: `read_conversation_as_lead()` / `export_conversation_as_lead()` —
--   SECURITY DEFINER, lead or club_admin, mandatory reason, minor-involved
--   only, audit BEFORE returning (even when empty), never a participant row.
--   No admin read policy exists on messages/conversations.
--
-- SG-2: deny_hard_delete + deny_truncate on messages,
--   conversation_participants, message_attachments; DELETE/TRUNCATE revoked
--   from anon/authenticated/service_role.
--
-- PR METADATA: migrations y; RLS y (four new tables); data touched: none;
-- rollback: §12.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS AND TABLES
-- =============================================================================

create type public.conversation_type as enum ('dm', 'group', 'team', 'announcement');
create type public.participant_basis as enum ('member', 'guardian', 'staff', 'creator', 'oversight');

create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  type                public.conversation_type not null,
  title               text,
  team_id             uuid references public.teams (id) on delete set null,
  created_by_person_id uuid references public.people (id) on delete set null,
  supervised_by_lead  boolean not null default false,
  legal_hold          boolean not null default false,
  closed_at           timestamptz,
  closed_by           uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint conversations_team_has_team check (type <> 'team' or team_id is not null)
);

create index conversations_team_idx on public.conversations (team_id) where team_id is not null;

create trigger trg_conversations_updated
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_participants (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.conversations (id) on delete restrict,
  person_id             uuid not null references public.people (id) on delete restrict,
  basis                 public.participant_basis not null default 'member',
  joined_at             timestamptz not null default now(),
  left_at               timestamptz,
  last_read_message_id  uuid,
  muted_until           timestamptz,
  added_by              uuid references auth.users (id) on delete set null,
  constraint conversation_participants_no_oversight_rows check (basis <> 'oversight')
);

create unique index conversation_participants_live_idx on public.conversation_participants (conversation_id, person_id) where left_at is null;
create index conversation_participants_person_idx on public.conversation_participants (person_id) where left_at is null;

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations (id) on delete restrict,
  sender_person_id    uuid not null references public.people (id) on delete restrict,
  body                text not null,
  reply_to_id         uuid references public.messages (id) on delete set null,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          uuid references auth.users (id) on delete set null,
  redacted_at         timestamptz,
  redaction_reason    text,
  constraint messages_body_not_blank check (btrim(body) <> '')
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.conversation_participants
  add constraint conversation_participants_last_read_fkey foreign key (last_read_message_id) references public.messages (id) on delete set null;

create table public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages (id) on delete restrict,
  storage_bucket text not null default 'attachments',
  storage_path  text not null,
  content_type  text,
  byte_size     integer check (byte_size is null or byte_size >= 0),
  created_at    timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

-- SG-2
create trigger trg_messages_deny_hard_delete before delete on public.messages for each row execute function public.deny_hard_delete();
create trigger trg_messages_deny_truncate before truncate on public.messages for each statement execute function public.deny_truncate();
create trigger trg_conversation_participants_deny_hard_delete before delete on public.conversation_participants for each row execute function public.deny_hard_delete();
create trigger trg_conversation_participants_deny_truncate before truncate on public.conversation_participants for each statement execute function public.deny_truncate();
create trigger trg_message_attachments_deny_hard_delete before delete on public.message_attachments for each row execute function public.deny_hard_delete();
create trigger trg_message_attachments_deny_truncate before truncate on public.message_attachments for each statement execute function public.deny_truncate();

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400) on conflict (id) do nothing;


-- =============================================================================
-- 2. THE SG-1 EVALUATION
-- =============================================================================
-- Parameters let the callers evaluate a HYPOTHETICAL: a guardianship pair to
-- treat as absent (SG-1.8), a consent to treat as revoked (SG-1.9), a raised
-- age (SG-1.9), a dob override (SG-1.2).

create or replace function public.conversation_is_compliant(
  p_conversation_id   uuid,
  p_ignore_guardian   uuid default null,   -- treat this guardian→child pair as absent
  p_ignore_child      uuid default null,
  p_revoked_consent_child uuid default null, -- treat this child's unsupervised consent as revoked
  p_min_unsup_age     integer default null, -- evaluate against this threshold instead of the setting
  p_dob_person        uuid default null,    -- treat this person as having p_dob
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

  -- SG-1.9: supervision-exempt minor in a supervised conversation
  if c.supervised_by_lead and v_minor <> coalesce(p_revoked_consent_child, '00000000-0000-0000-0000-000000000000'::uuid) then
    v_age := coalesce(p_min_unsup_age, public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age'));
    if exists (select 1 from public.people pp where pp.id = v_minor
               and coalesce(case when pp.id = p_dob_person then p_dob else pp.dob end, null) is not null
               and public.is_at_least_age(case when pp.id = p_dob_person then p_dob else pp.dob end, v_age))
       and public.has_active_consent(v_minor, 'unsupervised_messaging')
    then
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- Would this conversation be compliant if supervised_by_lead were true? Used
-- by the admitting trigger to decide whether to set the flag (SG-1.9).
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
  return public.is_supervision_exempt(v_minors[1]);
end;
$$;

create or replace function public.conversation_has_minor(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.conversation_participants p
                 where p.conversation_id = p_conversation_id and public.is_minor(p.person_id));
$$;


-- =============================================================================
-- 3. TRIGGERS (1) participants, (2) messages
-- =============================================================================

create or replace function public.conversation_participants_sg1_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if c.closed_at is not null and new.left_at is null and (tg_op = 'INSERT' or old.left_at is not null) then
    raise exception 'conversation_participants: conversation is closed' using errcode = 'P0001';
  end if;
  -- Evaluate AFTER the change: the row is visible to the function only after
  -- insert, so for INSERT we test the hypothetical by a deferred check via a
  -- constraint trigger below. Here we handle UPDATE OF left_at (SG-1.1).
  return new;
end;
$$;

-- AFTER trigger (constraint trigger, fires per row after the change is visible)
create or replace function public.conversation_participants_sg1_check()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_conv uuid := coalesce(new.conversation_id, old.conversation_id);
  v_type public.conversation_type;
begin
  if public.conversation_is_compliant(v_conv) then
    return null;
  end if;
  -- SG-1.9: admit by flagging, when exemptable
  if public.conversation_exemptable(v_conv) then
    update public.conversations set supervised_by_lead = true where id = v_conv and not supervised_by_lead;
    if public.conversation_is_compliant(v_conv) then
      return null;
    end if;
  end if;
  select type into v_type from public.conversations where id = v_conv;
  raise exception 'conversation %: this change would leave exactly one adult and one minor with no guardian present (% conversation) [SAFEGUARDING.md SG-1]',
    v_conv, v_type using errcode = 'P0001';
end;
$$;

create trigger trg_conversation_participants_sg1_guard
  before insert or update of left_at on public.conversation_participants
  for each row execute function public.conversation_participants_sg1_guard();

create constraint trigger trg_conversation_participants_sg1_check
  after insert or update of left_at on public.conversation_participants
  for each row execute function public.conversation_participants_sg1_check();

-- (2) messages: sender must be an active participant; conversation open;
-- announcements: staff only; SG-1.7 re-evaluation.
create or replace function public.messages_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c public.conversations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.body <> old.body or new.sender_person_id <> old.sender_person_id or new.conversation_id <> old.conversation_id
       or new.created_at <> old.created_at then
      raise exception 'messages: body, sender and conversation are immutable — delete and re-send [SAFEGUARDING.md SG-2]' using errcode = 'P0001';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'messages: a deletion cannot be undone' using errcode = 'P0001';
    end if;
    if new.redacted_at is not null and old.redacted_at is null then
      new.body := '[redacted]';
    end if;
    return new;
  end if;

  select * into c from public.conversations where id = new.conversation_id;
  if c.closed_at is not null then
    raise exception 'messages: conversation is closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.conversation_participants p
                 where p.conversation_id = new.conversation_id and p.person_id = new.sender_person_id and p.left_at is null) then
    raise exception 'messages: sender is not an active participant' using errcode = 'P0001';
  end if;
  if c.type = 'announcement' and not exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = new.conversation_id and p.person_id = new.sender_person_id and p.left_at is null
        and p.basis in ('staff', 'creator')) then
    raise exception 'messages: only staff may post to an announcement' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and new.sender_person_id is distinct from public.current_person_id() then
    raise exception 'messages: sender must be the caller' using errcode = 'P0001';
  end if;
  -- SG-1.7
  if not public.conversation_is_compliant(new.conversation_id) then
    raise exception 'messages: conversation % is not compliant (exactly one adult and one minor with no guardian present) [SAFEGUARDING.md SG-1.7]',
      new.conversation_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_messages_guard
  before insert or update on public.messages
  for each row execute function public.messages_guard();

-- supervised_by_lead: cannot be cleared while a minor is active (SG-1.9);
-- closing stamps closed_by; legal_hold lead-only.
create or replace function public.conversations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if old.supervised_by_lead and not new.supervised_by_lead
     and exists (select 1 from public.conversation_participants p
                 where p.conversation_id = new.id and p.left_at is null and public.is_minor(p.person_id)) then
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
$$;

create trigger trg_conversations_guard
  before update on public.conversations
  for each row execute function public.conversations_guard();


-- =============================================================================
-- 4. (4) SG-1.8 — P1.3's scaffold, body replaced
-- =============================================================================

create or replace function public.guardianships_conversation_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
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

  select string_agg(c.id::text, ', ') into v_affected
  from public.conversations c
  where c.closed_at is null
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = v_child and p.left_at is null)
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = v_guardian and p.left_at is null)
    and not public.conversation_is_compliant(c.id, v_guardian, v_child);

  if v_affected is not null then
    raise exception 'guardianships: removing this link would leave an adult alone with a minor in open conversation(s) % — close them first [SAFEGUARDING.md SG-1.8]',
      v_affected using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $function$;


-- =============================================================================
-- 5. (5) SG-1.9 consent revocation, (6) raised age
-- =============================================================================

create or replace function public.guardian_consents_sg19_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_affected text;
begin
  if new.consent_type <> 'unsupervised_messaging' or new.revoked_at is null or old.revoked_at is not null then
    return new;
  end if;
  select string_agg(c.id::text, ', ') into v_affected
  from public.conversations c
  where c.closed_at is null and c.supervised_by_lead
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.person_id = new.child_person_id and p.left_at is null)
    and not public.conversation_is_compliant(c.id, null, null, new.child_person_id);
  if v_affected is not null then
    raise exception 'guardian_consents: revoking this consent would leave an adult alone with a minor in open conversation(s) % — close them first [SAFEGUARDING.md SG-1.9]',
      v_affected using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_guardian_consents_sg19_guard
  before update of revoked_at on public.guardian_consents
  for each row execute function public.guardian_consents_sg19_guard();

create or replace function public.site_settings_sg19_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_old integer;
  v_new integer;
  v_affected text;
begin
  if new.key <> 'safeguarding.unsupervised_messaging_min_age' then
    return new;
  end if;
  -- Not an integer: leave it to P1.7's validation trigger to refuse with its own message.
  if new.value !~ '^[0-9]+$' or old.value !~ '^[0-9]+$' then
    return new;
  end if;
  v_old := old.value::integer; v_new := new.value::integer;
  if v_new <= v_old then
    return new;  -- lowering only widens what is permissible
  end if;
  select string_agg(c.id::text, ', ') into v_affected
  from public.conversations c
  where c.closed_at is null and c.supervised_by_lead
    and not public.conversation_is_compliant(c.id, null, null, null, v_new);
  if v_affected is not null then
    raise exception 'site_settings: raising the unsupervised messaging age to % would leave an adult alone with a minor in open conversation(s) % — close them first [SAFEGUARDING.md SG-1.9]',
      v_new, v_affected using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Named to sort AFTER P1.7's validation trigger (trg_site_settings_safeguarding_guard).
create trigger trg_site_settings_sg19_guard
  before update on public.site_settings
  for each row execute function public.site_settings_sg19_guard();


-- =============================================================================
-- 6. (3) SG-1.2 — the single people_dob_guard(), extended
-- =============================================================================
-- P2.1's body verbatim, with the SG-1.2 block at the marker it left.

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
  -- ineligible minor.
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and new.dob is not null
     and public.is_minor_dob(new.dob)
     and exists (select 1 from public.profiles pr where pr.person_id = new.id)
     and not public.is_account_eligible(new.id)
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


-- =============================================================================
-- 7. SG-9 ACCESSORS
-- =============================================================================

create or replace function public.read_conversation_as_lead(p_conversation_id uuid, p_reason text)
  returns table (id uuid, sender_person_id uuid, sender_name text, body text, reply_to_id uuid,
                 created_at timestamptz, deleted_at timestamptz, redacted_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and not public.has_any_role(array['safeguarding_lead', 'club_admin']::public.app_role[]) then
    raise exception 'read_conversation_as_lead: safeguarding_lead or club_admin only [SAFEGUARDING.md SG-9]' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'read_conversation_as_lead: a reason is required [SAFEGUARDING.md SG-9]' using errcode = '22023';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    raise exception 'read_conversation_as_lead: unknown conversation' using errcode = 'P0001';
  end if;
  if not public.conversation_has_minor(p_conversation_id) then
    raise exception 'read_conversation_as_lead: this conversation has never involved a minor [SAFEGUARDING.md SG-9]' using errcode = '42501';
  end if;
  select count(*) into v_count from public.messages m where m.conversation_id = p_conversation_id;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'messaging.conversation.admin_read', 'conversations', p_conversation_id::text,
          jsonb_build_object('reason', p_reason, 'message_count', v_count, 'includes_minor', true));
  return query
    select m.id, m.sender_person_id, (select pp.first_name || ' ' || pp.last_name from public.people pp where pp.id = m.sender_person_id),
           m.body, m.reply_to_id, m.created_at, m.deleted_at, m.redacted_at
    from public.messages m where m.conversation_id = p_conversation_id order by m.created_at;
end;
$$;

create or replace function public.export_conversation_as_lead(p_conversation_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_count integer;
  v_out jsonb;
begin
  if auth.uid() is not null and not public.has_any_role(array['safeguarding_lead', 'club_admin']::public.app_role[]) then
    raise exception 'export_conversation_as_lead: safeguarding_lead or club_admin only [SAFEGUARDING.md SG-9]' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'export_conversation_as_lead: a reason is required [SAFEGUARDING.md SG-9]' using errcode = '22023';
  end if;
  if not public.conversation_has_minor(p_conversation_id) then
    raise exception 'export_conversation_as_lead: this conversation has never involved a minor [SAFEGUARDING.md SG-9]' using errcode = '42501';
  end if;
  select count(*) into v_count from public.messages m where m.conversation_id = p_conversation_id;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'messaging.conversation.export', 'conversations', p_conversation_id::text,
          jsonb_build_object('reason', p_reason, 'message_count', v_count, 'includes_deleted', true, 'includes_minor', true));
  select jsonb_build_object(
    'conversation', (select to_jsonb(c) - 'legal_hold' from public.conversations c where c.id = p_conversation_id),
    'participants', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.person_id, 'basis', p.basis, 'joined_at', p.joined_at, 'left_at', p.left_at)), '[]'::jsonb)
                     from public.conversation_participants p where p.conversation_id = p_conversation_id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender_person_id', m.sender_person_id, 'body', m.body, 'created_at', m.created_at,
                                    'deleted_at', m.deleted_at, 'redacted_at', m.redacted_at,
                                    'attachments', (select coalesce(jsonb_agg(jsonb_build_object('path', a.storage_path, 'content_type', a.content_type)), '[]'::jsonb)
                                                    from public.message_attachments a where a.message_id = m.id))
                                    order by m.created_at), '[]'::jsonb)
                 from public.messages m where m.conversation_id = p_conversation_id),
    'exported_at', now(), 'message_count', v_count)
  into v_out;
  return v_out;
end;
$$;

-- Lead redaction (SG-8), audited, minor-involved only.
create or replace function public.redact_message_as_lead(p_message_id uuid, p_reason text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_conv uuid;
begin
  if auth.uid() is not null and not public.is_safeguarding_lead() then
    raise exception 'redact_message_as_lead: safeguarding_lead only' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'redact_message_as_lead: a reason is required' using errcode = '22023';
  end if;
  select conversation_id into v_conv from public.messages where id = p_message_id;
  if v_conv is null or not public.conversation_has_minor(v_conv) then
    raise exception 'redact_message_as_lead: not a conversation involving a minor' using errcode = '42501';
  end if;
  update public.messages set redacted_at = now(), redaction_reason = p_reason where id = p_message_id and redacted_at is null;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'messaging.message.redact', 'messages', p_message_id::text, jsonb_build_object('conversation_id', v_conv, 'reason', p_reason));
end;
$$;

-- The nightly checker (P5.6 schedules it): open non-compliant conversations.
create or replace function public.sg1_nightly_check()
  returns table (conversation_id uuid, type public.conversation_type)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select c.id, c.type from public.conversations c
  where c.closed_at is null and not public.conversation_is_compliant(c.id);
$$;


-- =============================================================================
-- 8. RLS — participants only
-- =============================================================================

create or replace function public.is_active_participant(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.conversation_participants p
                 where p.conversation_id = p_conversation_id and p.left_at is null
                   and p.person_id = public.current_person_id());
$$;

create or replace function public.is_participant_ever(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.conversation_participants p
                 where p.conversation_id = p_conversation_id and p.person_id = public.current_person_id());
$$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

create policy "conversations_participant_read" on public.conversations for select to authenticated
  using (public.is_participant_ever(id));
create policy "conversations_create" on public.conversations for insert to authenticated
  with check (created_by_person_id = public.current_person_id() and type in ('dm', 'group')
              or (type in ('team', 'announcement') and (public.is_club_admin() or (team_id is not null and public.is_team_staff(team_id)))));
create policy "conversations_update" on public.conversations for update to authenticated
  using (created_by_person_id = public.current_person_id() or public.is_club_admin()
         or (team_id is not null and public.is_team_staff(team_id)) or public.is_safeguarding_lead())
  with check (true);

create policy "participants_read" on public.conversation_participants for select to authenticated
  using (public.is_participant_ever(conversation_id));
create policy "participants_insert" on public.conversation_participants for insert to authenticated
  with check (
    exists (select 1 from public.conversations c where c.id = conversation_id
            and (c.created_by_person_id = public.current_person_id() or public.is_club_admin()
                 or (c.team_id is not null and public.is_team_staff(c.team_id))))
    or (person_id = public.current_person_id() and basis = 'creator'));
create policy "participants_update" on public.conversation_participants for update to authenticated
  using (person_id = public.current_person_id()
         or exists (select 1 from public.conversations c where c.id = conversation_id
                    and (c.created_by_person_id = public.current_person_id() or public.is_club_admin()
                         or (c.team_id is not null and public.is_team_staff(c.team_id)))))
  with check (true);

create policy "messages_participant_read" on public.messages for select to authenticated
  using (public.is_participant_ever(conversation_id));
create policy "messages_participant_insert" on public.messages for insert to authenticated
  with check (sender_person_id = public.current_person_id() and public.is_active_participant(conversation_id));
create policy "messages_soft_delete" on public.messages for update to authenticated
  using (sender_person_id = public.current_person_id()
         or public.is_club_admin()
         or exists (select 1 from public.conversations c where c.id = conversation_id and c.team_id is not null and public.is_team_staff(c.team_id)))
  with check (true);

create policy "attachments_participant_read" on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_participant_ever(m.conversation_id)));
create policy "attachments_sender_insert" on public.message_attachments for insert to authenticated
  with check (exists (select 1 from public.messages m where m.id = message_id and m.sender_person_id = public.current_person_id()));

create policy "attachments_participant_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.current_person_id() is not null);


-- =============================================================================
-- 9. GRANTS
-- =============================================================================

revoke all privileges on public.conversations, public.conversation_participants, public.messages, public.message_attachments
  from anon, authenticated, service_role;
grant select, insert, update on public.conversations to authenticated, service_role;
grant select, insert, update on public.conversation_participants to authenticated, service_role;
grant select, insert, update on public.messages to authenticated, service_role;
grant select, insert, update on public.message_attachments to authenticated, service_role;
revoke delete, truncate on public.conversation_participants, public.messages, public.message_attachments
  from anon, authenticated, service_role;

revoke all privileges on function public.conversation_is_compliant(uuid, uuid, uuid, uuid, integer, uuid, date) from public, anon;
revoke all privileges on function public.conversation_exemptable(uuid) from public, anon;
revoke all privileges on function public.conversation_has_minor(uuid) from public, anon;
revoke all privileges on function public.is_active_participant(uuid) from public, anon;
revoke all privileges on function public.is_participant_ever(uuid) from public, anon;
grant execute on function public.conversation_is_compliant(uuid, uuid, uuid, uuid, integer, uuid, date), public.conversation_exemptable(uuid),
  public.conversation_has_minor(uuid), public.is_active_participant(uuid), public.is_participant_ever(uuid) to authenticated, service_role;
revoke all privileges on function public.read_conversation_as_lead(uuid, text) from public, anon;
revoke all privileges on function public.export_conversation_as_lead(uuid, text) from public, anon;
revoke all privileges on function public.redact_message_as_lead(uuid, text) from public, anon;
grant execute on function public.read_conversation_as_lead(uuid, text), public.export_conversation_as_lead(uuid, text),
  public.redact_message_as_lead(uuid, text) to authenticated, service_role;
revoke all privileges on function public.sg1_nightly_check() from public, anon, authenticated;
grant execute on function public.sg1_nightly_check() to service_role;
revoke all privileges on function public.conversation_participants_sg1_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.conversation_participants_sg1_check() from public, anon, authenticated, service_role;
revoke all privileges on function public.messages_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.conversations_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.guardian_consents_sg19_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.site_settings_sg19_guard() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 12. ROLLBACK (documented, not executed)
-- =============================================================================
-- Restore people_dob_guard() to its P2.1 body and guardianships_conversation_guard()
-- to its P1.3 scaffold; drop the triggers on guardian_consents and site_settings;
-- drop the accessors, sg1_nightly_check, the helpers; drop policy
-- attachments_participant_upload on storage.objects; drop tables
-- message_attachments, messages, conversation_participants, conversations
-- (destroying messages — the only circumstance in which that may happen);
-- drop the two enums; delete the attachments bucket after emptying it.
