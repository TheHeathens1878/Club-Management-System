-- =============================================================================
-- Gap 5 (post-P3.4) — in-app notifications
-- =============================================================================
-- The Neon app had a notifications feed. Here `outbound_messages` with
-- channel = 'in_app' is already the store (P4.4: the row *is* the message and
-- comms-dispatch marks it sent). What was missing: a read marker, a link, a
-- reader that can mark its own rows read, and anything that actually writes
-- them. This migration adds:
--
--   1. `read_at` and `link` on outbound_messages; `mark_notification_read(id)`
--      and `mark_all_notifications_read()` for the recipient (can_act_for);
--      `unread_notification_count()`.
--   2. `notify(person, subject, body, link, entity, entity_id)` — a thin
--      SECURITY DEFINER wrapper over enqueue_message('in_app', …) for triggers.
--   3. Writers: account request decided; pitch booking confirmed / declined by
--      someone other than the booker; team membership added; waiting-list
--      access granted. In-app only — no email is sent by any of these.
--
-- Rollback: drop the four triggers + functions, drop function notify,
-- mark_notification_read, mark_all_notifications_read,
-- unread_notification_count; alter table outbound_messages drop column
-- read_at, drop column link.
-- =============================================================================

alter table public.outbound_messages
  add column if not exists read_at timestamptz,
  add column if not exists link text;
create index if not exists outbound_messages_inbox_idx
  on public.outbound_messages (person_id, created_at desc)
  where channel = 'in_app';


-- 1. Reader functions ------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update public.outbound_messages m
     set read_at = coalesce(m.read_at, now())
   where m.id = p_id and m.channel = 'in_app'
     and m.person_id is not null and public.can_act_for(m.person_id);
$$;

create or replace function public.mark_all_notifications_read()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare n integer;
begin
  update public.outbound_messages m
     set read_at = now()
   where m.channel = 'in_app' and m.read_at is null
     and m.person_id = public.current_person_id();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.unread_notification_count()
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select count(*)::integer from public.outbound_messages m
   where m.channel = 'in_app' and m.read_at is null
     and m.person_id = public.current_person_id();
$$;

revoke all privileges on function public.mark_notification_read(uuid) from public, anon;
revoke all privileges on function public.mark_all_notifications_read() from public, anon;
revoke all privileges on function public.unread_notification_count() from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.unread_notification_count() to authenticated;


-- 2. notify() ------------------------------------------------------------------------
create or replace function public.notify(
  p_person_id uuid, p_subject text, p_body text, p_link text default null,
  p_entity text default null, p_entity_id text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_id uuid;
begin
  if p_person_id is null then return null; end if;
  select message_id into v_id
    from public.enqueue_message('in_app', 'transactional', p_person_id, null, p_subject, p_body, null, p_entity, p_entity_id);
  if v_id is not null and p_link is not null then
    update public.outbound_messages set link = p_link where id = v_id;
  end if;
  return v_id;
end $$;
revoke all privileges on function public.notify(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;


-- 3. Writers --------------------------------------------------------------------------
create or replace function public.account_requests_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_team text;
begin
  if new.status = old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  select name into v_team from public.teams where id = new.team_id;
  perform public.notify(
    new.person_id,
    case when new.status = 'approved' then 'Your request was approved' else 'Your request was not approved' end,
    case when new.status = 'approved'
         then 'You are now set up as ' || replace(new.requested_role, '_', ' ') || coalesce(' for ' || v_team, '') || '.'
         else 'Your request to be ' || replace(new.requested_role, '_', ' ') || coalesce(' for ' || v_team, '') || ' was declined.'
              || coalesce(' ' || new.decision_note, '') end,
    '/welcome', 'account_requests', new.id::text);
  return new;
end $$;
drop trigger if exists trg_account_requests_notify on public.account_requests;
create trigger trg_account_requests_notify
  after update of status on public.account_requests
  for each row execute function public.account_requests_notify();

create or replace function public.bookings_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := public.current_person_id();
  v_when  text;
  v_pitch text;
begin
  if new.status = old.status then return new; end if;
  if new.booker_person_id is null or new.booker_person_id = v_actor then return new; end if;
  if not exists (select 1 from public.resources r where r.id = new.resource_id and r.type = 'pitch') then return new; end if;
  if new.status not in ('confirmed', 'cancelled') then return new; end if;
  select name into v_pitch from public.resources where id = new.resource_id;
  v_when := to_char(new.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI');
  perform public.notify(
    new.booker_person_id,
    case when new.status = 'confirmed' then 'Pitch booking confirmed' else 'Pitch booking cancelled' end,
    coalesce(new.occasion, 'Your booking') || ' on ' || v_pitch || ', ' || v_when
      || case when new.status = 'confirmed' then ' is confirmed.' else ' has been cancelled.' end
      || coalesce(' ' || new.internal_notes, ''),
    '/pitches/mine', 'bookings', new.id::text);
  return new;
end $$;
drop trigger if exists trg_bookings_notify on public.bookings;
create trigger trg_bookings_notify
  after update of status on public.bookings
  for each row execute function public.bookings_notify();

create or replace function public.team_memberships_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_team text;
begin
  if new.left_at is not null then return new; end if;
  if new.person_id = public.current_person_id() then return new; end if;
  select name into v_team from public.teams where id = new.team_id;
  perform public.notify(
    new.person_id,
    'Added to ' || coalesce(v_team, 'a team'),
    'You have been added to ' || coalesce(v_team, 'a team') || ' as ' || replace(new.role::text, '_', ' ') || '.',
    '/teams/' || new.team_id, 'team_memberships', new.id::text);
  return new;
end $$;
drop trigger if exists trg_team_memberships_notify on public.team_memberships;
create trigger trg_team_memberships_notify
  after insert on public.team_memberships
  for each row execute function public.team_memberships_notify();

create or replace function public.waiting_list_access_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.person_id = public.current_person_id() then return new; end if;
  perform public.notify(
    new.person_id,
    'Waiting list access granted',
    'You can now see the ' || new.age_group || ' waiting list.',
    '/waiting-list/manage', 'waiting_list_access', new.person_id::text || ':' || new.age_group);
  return new;
end $$;
drop trigger if exists trg_waiting_list_access_notify on public.waiting_list_access;
create trigger trg_waiting_list_access_notify
  after insert on public.waiting_list_access
  for each row execute function public.waiting_list_access_notify();
