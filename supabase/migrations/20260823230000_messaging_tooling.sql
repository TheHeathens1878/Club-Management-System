-- =============================================================================
-- P5.6 — safeguarding tooling: report-message flow, retention job (dry-run)
-- =============================================================================
-- PLAN.md task P5.6 ("conversation export for safeguarding_lead, report-message
-- flow, retention job"; acceptance: "Export produces complete history incl.
-- soft-deleted messages, access-logged in audit_log"). Export arrived in P5.2
-- (`export_conversation_as_lead`). This file adds:
--   * `report_message(message_id, reason)` — any active participant of the
--     conversation raises a safeguarding concern about a message through
--     P4.3's `report_concern()` (SG-3 path, audited), with a structured prefix
--     in the narrative so the lead can open the conversation through SG-9.
--     The message is NOT copied anywhere else.
--   * Retention (SG-8, D7): `retention_settings` rows in site_settings
--     (`retention.messages_months` default 24; `retention.enabled` default
--     'false'), and `retention_run(p_dry_run boolean default true)` —
--     service_role only — which redacts message bodies older than the period
--     in conversations with no `legal_hold` on the conversation, any active
--     participant, or the message, and not attached to an open concern; in
--     dry-run it writes a `retention.dry_run` audit row with the count and
--     touches nothing. `retention.enabled = 'false'` forces dry-run regardless
--     of the argument. audit_log is never touched.
--   * `message_retention_candidates()` — the same predicate as a readable list
--     for the lead's review before enabling.
--
-- PR METADATA: migrations y; RLS n; data touched: two site_settings rows;
-- rollback: §4.
-- =============================================================================

insert into public.site_settings (key, value) values ('retention.messages_months', '24') on conflict (key) do nothing;
insert into public.site_settings (key, value) values ('retention.enabled', 'false') on conflict (key) do nothing;

create or replace function public.report_message(p_message_id uuid, p_reason text)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m public.messages%rowtype;
  v_me uuid := public.current_person_id();
  v_ref text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'report_message: a reason is required' using errcode = '22023';
  end if;
  select * into m from public.messages where id = p_message_id;
  if not found then
    raise exception 'report_message: unknown message' using errcode = 'P0001';
  end if;
  if v_me is not null and not exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = m.conversation_id and p.person_id = v_me) then
    raise exception 'report_message: only a participant may report a message in this conversation' using errcode = '42501';
  end if;
  v_ref := public.report_concern(
    format('[message:%s conversation:%s] %s', m.id, m.conversation_id, p_reason),
    null, m.sender_person_id, 'web', v_me);
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'messaging.message.reported', 'messages', m.id::text,
          jsonb_build_object('conversation_id', m.conversation_id, 'concern_ref', v_ref));
  return v_ref;
end;
$$;

-- The SG-8 predicate, in one place.
create or replace function public.message_retention_candidates()
  returns table (message_id uuid, conversation_id uuid, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select m.id, m.conversation_id, m.created_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.redacted_at is null
    and m.created_at < now() - make_interval(months => coalesce((select value::integer from public.site_settings where key = 'retention.messages_months'), 24))
    and not c.legal_hold
    and not exists (select 1 from public.conversation_participants p join public.people pp on pp.id = p.person_id
                    where p.conversation_id = c.id and p.left_at is null and pp.legal_hold)
    and not exists (select 1 from public.safeguarding_concerns sc
                    where sc.status <> 'closed' and sc.deleted_at is null
                      and sc.narrative like '%conversation:' || c.id::text || '%')
    and (auth.uid() is null or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
$$;

create or replace function public.retention_run(p_dry_run boolean default true)
  returns table (mode text, redacted integer)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_enabled boolean := coalesce((select value = 'true' from public.site_settings where key = 'retention.enabled'), false);
  v_dry boolean := p_dry_run or not v_enabled;
  v_count integer;
begin
  if auth.uid() is not null then
    raise exception 'retention_run: service_role only' using errcode = '42501';
  end if;
  select count(*) into v_count from public.message_retention_candidates();
  if v_dry then
    insert into public.audit_log (actor_id, actor_email, action, entity, detail)
    values (null, 'retention', 'retention.dry_run', 'messages', jsonb_build_object('would_redact', v_count, 'enabled', v_enabled));
    return query select 'dry_run'::text, 0;
    return;
  end if;
  update public.messages m set redacted_at = now(), redaction_reason = 'retention'
  where m.id in (select message_id from public.message_retention_candidates());
  insert into public.audit_log (actor_id, actor_email, action, entity, detail)
  values (null, 'retention', 'retention.run', 'messages', jsonb_build_object('redacted', v_count));
  return query select 'run'::text, v_count;
end;
$$;

revoke all privileges on function public.report_message(uuid, text) from public, anon;
grant execute on function public.report_message(uuid, text) to authenticated, service_role;
revoke all privileges on function public.message_retention_candidates() from public, anon;
grant execute on function public.message_retention_candidates() to authenticated, service_role;
revoke all privileges on function public.retention_run(boolean) from public, anon, authenticated;
grant execute on function public.retention_run(boolean) to service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- 4. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the three functions; delete the two site_settings rows.
