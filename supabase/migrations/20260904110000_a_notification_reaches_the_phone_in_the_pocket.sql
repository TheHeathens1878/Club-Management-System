-- =============================================================================
-- A notification reaches the phone in the pocket (Adam, 2026-09-04: "I am
-- also logged in on my phone and didn't get a notification").
--
-- Two gaps, one story:
--
-- 1. `notify()` — the funnel every in-app notification passes through — wrote
--    the in_app row and stopped. Nothing ever became a push, however many
--    devices the person had registered. It now enqueues a push twin through
--    `enqueue_message('push', …)` — but ONLY when the person actually has a
--    row in `push_tokens` (no wasted queue rows for the hundred people who
--    never enabled push) AND `comms_channel_enabled(person, 'push')` says
--    yes (transactional category skips the preference check inside
--    enqueue_message, so the check lives here — the same rule push-fanout
--    applies for chat). Suppression and the dry-run switch still apply
--    inside enqueue_message; `comms-dispatch` (already on a 5-minute
--    pg_cron) delivers via Expo or Web Push exactly as it does today.
--
-- 2. Chat messages were supposed to reach `push-fanout` through a Database
--    Webhook that was never configured (launch punch list). The webhook is
--    replaced with what it would have been under the hood anyway: an AFTER
--    INSERT trigger on `messages` posting the webhook-shaped payload through
--    `invoke_edge_function()` — pg_net, Vault-held service-role key, which
--    push-fanout accepts in place of its webhook secret. Everything
--    push-fanout already enforces (participants only, mutes, the no-body
--    rule for conversations with a minor, channel preference) is untouched;
--    this only makes the doorbell ring.
--
-- `notify()` is restated from the LIVE definition (pg_get_functiondef, prod,
-- 2026-09-04); CREATE OR REPLACE keeps its service_role-only ACL.
-- =============================================================================

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
  -- registered device who has not turned the push channel off.
  if exists (select 1 from public.push_tokens pt where pt.person_id = p_person_id)
     and public.comms_channel_enabled(p_person_id, 'push') then
    select message_id into v_push_id
      from public.enqueue_message(
        'push', 'transactional', p_person_id, null,
        p_subject,
        left(coalesce(nullif(btrim(p_body), ''), p_subject), 180),
        null, p_entity, p_entity_id);
    if v_push_id is not null and p_link is not null then
      update public.outbound_messages set link = p_link where id = v_push_id;
    end if;
  end if;

  return v_id;
end;
$function$;

-- The chat doorbell: the Database Webhook that was never configured, as the
-- trigger it always was underneath. pg_net is asynchronous, so the insert
-- itself never waits on the edge function.
create or replace function public.messages_push_fanout()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  perform public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object('type', 'INSERT', 'table', 'messages', 'record', to_jsonb(new)));
  return new;
end;
$function$;

revoke all on function public.messages_push_fanout() from public, anon, authenticated;

drop trigger if exists trg_messages_push_fanout on public.messages;
create trigger trg_messages_push_fanout
  after insert on public.messages
  for each row execute function public.messages_push_fanout();
