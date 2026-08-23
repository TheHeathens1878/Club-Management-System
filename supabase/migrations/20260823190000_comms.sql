-- =============================================================================
-- P4.4 — comms preferences, suppression list, the one outbound API
-- =============================================================================
-- PLAN.md task P4.4 ("Comms preferences & audit: per-person channel preferences
-- (email/SMS/push/in-app), suppression list"; acceptance: "Every outbound
-- message routed through one internal API that checks preferences"). Linear
-- TH1-31. Also the delivery substrate for P4.2 (arrears reminders) and P5.5
-- (push fan-out).
--
-- SHAPE
--   * `comms_channel` enum: email, sms, push, in_app.
--   * `comms_category` enum: transactional (cannot be opted out — booking
--     confirmations, safeguarding notices, account security), reminder
--     (arrears, certification nudges), marketing (everything else).
--   * `comms_preferences(person_id, channel, enabled)` — absence = enabled,
--     except `sms`, which is opt-IN (absence = disabled): Twilio costs money
--     and nobody asked for texts. Self-managed; admins read.
--   * `comms_suppressions(channel, address, reason)` — a hard block on an
--     address (bounce, complaint, legal request) that beats every preference
--     and every category. club_admin + service_role write; lower-cased.
--   * `outbound_messages` — THE log. Every message the platform sends, from
--     any feature, is a row here first: status queued → sent | failed, or
--     stopped at the gate as suppressed | skipped_preference | dry_run.
--   * `enqueue_message(...)` — the one internal API. Resolves the address
--     from `people` when not supplied (email/phone; push/in_app need no
--     address), applies suppression then preference (transactional skips the
--     preference check, never the suppression), and inserts the row with the
--     decision recorded. service_role and club_admin may call it; app code
--     calls it through the service client. Returns the row id; callers that
--     deliver synchronously (the web app's Resend path) then call
--     `mark_message_sent()` / `mark_message_failed()`; the `comms-dispatch`
--     Edge Function drains `queued` rows for the rest.
--   * `comms_dry_run` site setting (default 'false'): when 'true' every
--     enqueue lands as `dry_run` and nothing is delivered — P4.2's "dry-run
--     mode", platform-wide.
--
-- RLS: preferences self + admin; suppressions admin read; outbound_messages
-- self read (own person) + admin read; all writes through the functions or
-- service_role. No anon anywhere.
--
-- PR METADATA: migrations y; RLS y (three new tables); data touched: one
-- site_settings row seeded; rollback: §7.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.comms_channel as enum ('email', 'sms', 'push', 'in_app');
create type public.comms_category as enum ('transactional', 'reminder', 'marketing');
create type public.outbound_status as enum ('queued', 'sent', 'failed', 'suppressed', 'skipped_preference', 'dry_run');


-- =============================================================================
-- 2. TABLES
-- =============================================================================

create table public.comms_preferences (
  person_id   uuid not null references public.people (id) on delete cascade,
  channel     public.comms_channel not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (person_id, channel)
);

create trigger trg_comms_preferences_updated
  before update on public.comms_preferences
  for each row execute function public.set_updated_at();

create table public.comms_suppressions (
  id          uuid primary key default gen_random_uuid(),
  channel     public.comms_channel not null,
  address     text not null,
  reason      text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint comms_suppressions_reason_not_blank check (btrim(reason) <> ''),
  constraint comms_suppressions_address_lower check (address = lower(btrim(address))),
  unique (channel, address)
);

create table public.outbound_messages (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid references public.people (id) on delete set null,
  channel       public.comms_channel not null,
  category      public.comms_category not null,
  to_address    text,
  subject       text,
  body          text,
  template      text,
  entity        text,
  entity_id     text,
  status        public.outbound_status not null default 'queued',
  decision      text,
  provider      text,
  provider_ref  text,
  error         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  constraint outbound_messages_address_for_external check (channel in ('push', 'in_app') or to_address is not null or status = 'failed')
);

create index outbound_messages_queued_idx on public.outbound_messages (created_at) where status = 'queued';
create index outbound_messages_person_idx on public.outbound_messages (person_id, created_at desc);
create index outbound_messages_entity_idx on public.outbound_messages (entity, entity_id);

comment on table public.outbound_messages is 'Every message the platform sends, from any feature. enqueue_message() is the only way in.';


-- =============================================================================
-- 3. SETTINGS
-- =============================================================================

insert into public.site_settings (key, value) values ('comms.dry_run', 'false') on conflict (key) do nothing;


-- =============================================================================
-- 4. THE API
-- =============================================================================

create or replace function public.comms_channel_enabled(p_person_id uuid, p_channel public.comms_channel)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select enabled from public.comms_preferences where person_id = p_person_id and channel = p_channel),
    p_channel <> 'sms');
$$;

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
  if auth.uid() is not null and not public.is_club_admin() then
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

create or replace function public.mark_message_sent(p_message_id uuid, p_provider text, p_provider_ref text default null)
  returns integer
  language sql
  security definer
  set search_path = public
as $$
  update public.outbound_messages
     set status = 'sent', provider = p_provider, provider_ref = p_provider_ref, sent_at = now(), error = null
   where id = p_message_id and status = 'queued'
  returning 1;
$$;

create or replace function public.mark_message_failed(p_message_id uuid, p_error text)
  returns integer
  language sql
  security definer
  set search_path = public
as $$
  update public.outbound_messages
     set status = 'failed', error = left(p_error, 1000)
   where id = p_message_id and status = 'queued'
  returning 1;
$$;

-- What the dispatcher drains.
create or replace function public.queued_messages(p_channel public.comms_channel default null, p_limit integer default 100)
  returns setof public.outbound_messages
  language sql
  stable
  security definer
  set search_path = public
as $$
  select * from public.outbound_messages
  where status = 'queued' and (p_channel is null or channel = p_channel)
  order by created_at
  limit greatest(1, least(p_limit, 500));
$$;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

alter table public.comms_preferences enable row level security;
alter table public.comms_suppressions enable row level security;
alter table public.outbound_messages enable row level security;

create policy "comms_preferences_self_all" on public.comms_preferences for all to authenticated
  using (public.can_act_for(person_id)) with check (public.can_act_for(person_id));
create policy "comms_preferences_admin_read" on public.comms_preferences for select to authenticated
  using (public.is_club_admin());

create policy "comms_suppressions_admin_all" on public.comms_suppressions for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "outbound_messages_self_read" on public.outbound_messages for select to authenticated
  using (person_id is not null and public.can_act_for(person_id));
create policy "outbound_messages_admin_read" on public.outbound_messages for select to authenticated
  using (public.is_club_admin());


-- =============================================================================
-- 6. GRANTS
-- =============================================================================

revoke all privileges on public.comms_preferences, public.comms_suppressions, public.outbound_messages
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.comms_preferences to authenticated, service_role;
grant select, insert, update, delete on public.comms_suppressions to authenticated, service_role;
grant select on public.outbound_messages to authenticated;
grant select, insert, update on public.outbound_messages to service_role;

revoke all privileges on function public.comms_channel_enabled(uuid, public.comms_channel) from public, anon;
grant execute on function public.comms_channel_enabled(uuid, public.comms_channel) to authenticated, service_role;
revoke all privileges on function public.enqueue_message(public.comms_channel, public.comms_category, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.enqueue_message(public.comms_channel, public.comms_category, uuid, text, text, text, text, text, text) to authenticated, service_role;
revoke all privileges on function public.mark_message_sent(uuid, text, text) from public, anon, authenticated;
revoke all privileges on function public.mark_message_failed(uuid, text) from public, anon, authenticated;
revoke all privileges on function public.queued_messages(public.comms_channel, integer) from public, anon, authenticated;
grant execute on function public.mark_message_sent(uuid, text, text) to service_role;
grant execute on function public.mark_message_failed(uuid, text) to service_role;
grant execute on function public.queued_messages(public.comms_channel, integer) to service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 7. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the five functions; drop tables outbound_messages, comms_suppressions,
-- comms_preferences; delete site_settings 'comms.dry_run'; drop the three enums.
