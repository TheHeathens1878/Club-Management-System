-- =============================================================================
-- A notification is the club's, not the caller's (2026-09-13)
-- =============================================================================
-- Kate Conlin, coach of U09 Vulcamos, asked for a pitch and was told "the
-- database refused that". Her request row was fine: `request_team_pitch_booking`
-- inserted it, and then `pitch_request_notify()` told the club administrators
-- through `notify()`. Since 20260904110000 `notify()` also queues a PUSH twin
-- through `enqueue_message()`, and that function's gate — "service_role or
-- club_admin only" — is answered from the CALLER's claims, which inside a
-- trigger fired by a coach are the coach's. 42501, the whole request rolled
-- back, and the app's mapping of 42501 said it was about her role.
--
-- The same wall stands in front of every non-admin action that notifies
-- somebody with a registered device: a parent's reply, a leave request, a
-- referee claiming a game, a board post, a registration. Nothing was wrong
-- with any of them; the push twin was.
--
-- The gate on `enqueue_message()` is right for a direct call — a member must
-- not be able to queue email or SMS to anyone. It is wrong for the one caller
-- that is the club itself speaking: `notify()`, SECURITY DEFINER, whose every
-- caller is a trigger or a club function that already decided who is told.
-- So `notify()` announces itself for the duration of its own call
-- (`club.notify_internal`, transaction-local, reset straight after), and the
-- gate lets that one voice through. A direct call from a member still fails
-- exactly as before — the test below proves both halves.
--
-- Rollback: re-run the two `create or replace function` bodies from
-- 20260823190000 (enqueue_message) and 20260904110000 (notify).
-- =============================================================================


-- 1. The gate hears the club's own voice ---------------------------------------

create or replace function public.enqueue_message(
  p_channel     public.comms_channel,
  p_category    public.comms_category,
  p_person_id   uuid default null,
  p_to_address  text default null,
  p_subject     text default null,
  p_body        text default null,
  p_template    text default null,
  p_entity      text default null,
  p_entity_id   text default null
)
  returns table (message_id uuid, status public.outbound_status, decision text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_addr    text := nullif(lower(btrim(p_to_address)), '');
  v_status  public.outbound_status := 'queued';
  v_decision text := 'ok';
  v_dry     text;
  v_id      uuid;
begin
  -- A signed-in caller must be a club administrator — unless this is
  -- notify() speaking for the club (see the header). The flag is set by
  -- notify() alone, transaction-locally, for the length of its own call.
  if auth.uid() is not null
     and not public.is_club_admin()
     and coalesce(current_setting('club.notify_internal', true), '') <> 'on' then
    raise exception 'enqueue_message: service_role or club_admin only' using errcode = '42501';
  end if;
  if p_person_id is null and v_addr is null and p_channel in ('email', 'sms') then
    raise exception 'enqueue_message: a person or an address is required for %', p_channel using errcode = '22023';
  end if;

  if v_addr is null and p_person_id is not null then
    select case p_channel when 'email' then lower(email) when 'sms' then regexp_replace(phone, '\s', '', 'g') end
      into v_addr from public.people where id = p_person_id;
    if v_addr is null and p_channel in ('email', 'sms') then
      v_status := 'failed'; v_decision := 'no_address';
    end if;
  end if;

  if v_status = 'queued' and v_addr is not null
     and exists (select 1 from public.comms_suppressions s where s.channel = p_channel and s.address = v_addr) then
    v_status := 'suppressed'; v_decision := 'suppressed';
  end if;

  if v_status = 'queued' and p_category <> 'transactional' and p_person_id is not null
     and not public.comms_channel_enabled(p_person_id, p_channel) then
    v_status := 'skipped_preference'; v_decision := 'preference_off';
  end if;

  if v_status = 'queued' then
    select value into v_dry from public.site_settings where key = 'comms.dry_run';
    if v_dry = 'true' then
      v_status := 'dry_run'; v_decision := 'dry_run';
    end if;
  end if;

  insert into public.outbound_messages (person_id, channel, category, to_address, subject, body, template, entity, entity_id, status, decision, created_by)
  values (p_person_id, p_channel, p_category, v_addr, p_subject, p_body, p_template, p_entity, p_entity_id, v_status, v_decision, auth.uid())
  returning id into v_id;

  return query select v_id, v_status, v_decision;
end;
$$;


-- 2. notify() speaks as the club, for exactly as long as it speaks ------------

create or replace function public.notify(
  p_person_id uuid, p_subject text, p_body text, p_link text default null,
  p_entity text default null, p_entity_id text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_push_id uuid;
  v_status public.outbound_status := 'queued';
begin
  if p_person_id is null then return null; end if;
  if (select value from public.site_settings where key = 'comms.dry_run') = 'true' then
    v_status := 'dry_run';
  end if;
  insert into public.outbound_messages
    (person_id, channel, category, subject, body, entity, entity_id, status, decision, link, created_by)
  values
    (p_person_id, 'in_app', 'transactional', p_subject, p_body, p_entity, p_entity_id, v_status, 'ok', p_link, auth.uid())
  returning id into v_id;

  -- The push twin: same headline on the lock screen, only for someone with a
  -- registered device who has not turned the push channel off. Queued as the
  -- club, whoever set this notification off — a coach's pitch request or a
  -- parent's reply is not a member trying to send email.
  if exists (select 1 from public.push_tokens pt where pt.person_id = p_person_id)
     and public.comms_channel_enabled(p_person_id, 'push') then
    perform set_config('club.notify_internal', 'on', true);
    select message_id into v_push_id
      from public.enqueue_message(
        'push', 'transactional', p_person_id, null,
        p_subject,
        left(coalesce(nullif(btrim(p_body), ''), p_subject), 180),
        null, p_entity, p_entity_id);
    perform set_config('club.notify_internal', '', true);
    if v_push_id is not null and p_link is not null then
      update public.outbound_messages set link = p_link where id = v_push_id;
    end if;
  end if;

  return v_id;
end;
$function$;


-- 3. Audit the schema change itself -------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'outbound_messages',
        jsonb_build_object('migration', '20260913100000_a_notification_is_the_clubs_not_the_callers',
                           'changes', array['enqueue_message admits notify() through club.notify_internal',
                                            'notify() sets the flag around its push twin and clears it after']));

notify pgrst, 'reload schema';
