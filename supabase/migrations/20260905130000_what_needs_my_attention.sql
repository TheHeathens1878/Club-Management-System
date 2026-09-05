-- =============================================================================
-- What needs my attention (20260905130000)
-- =============================================================================
-- P7.2, the five-destination navigation (2026-09-05): the Home screen leads
-- with a short list of things waiting on the person — a match with no reply,
-- a charge outstanding, messages unread, a queue for an administrator. The
-- first three are already the database's own answers (`my_events()`, the
-- household's `charges` under RLS, the admin counts). Unread MESSAGES were
-- not: the web computed them per conversation in the messages shell, and the
-- phone reduced a page of recent messages on the device. Neither is a number
-- a tab bar can wear on every screen.
--
-- `my_unread_message_count()` is that number: how many messages the caller
-- has not read, across every conversation they are a live participant of.
-- "Read" is what the participant row already records — `last_read_message_id`
-- — so this counts exactly what the web shell counted, in one query.
--
-- SECURITY DEFINER because the messages policies answer per conversation and
-- this is a sum across them; every clause is pinned to the caller's own
-- `current_person_id()`, so the answer is about them and nobody else. It
-- returns a count and nothing else — no ids, no bodies.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy touched. One
-- new STABLE SECURITY DEFINER function returning an integer, granted to
-- authenticated. Data touched: none. Rollback: drop the function.
-- =============================================================================

create or replace function public.my_unread_message_count()
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(count(*), 0)::integer
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    join public.messages m on m.conversation_id = cp.conversation_id
    left join public.messages r on r.id = cp.last_read_message_id
   where cp.person_id = public.current_person_id()
     and cp.left_at is null
     and (cp.muted_until is null or cp.muted_until < now())
     and m.sender_person_id <> cp.person_id
     and m.deleted_at is null
     and (r.id is null or m.created_at > r.created_at);
$$;

comment on function public.my_unread_message_count() is
  'How many messages the caller has not read across the conversations they are a live, unmuted participant of — the Messages tab''s number. A count only.';

revoke all privileges on function public.my_unread_message_count() from public, anon;
grant execute on function public.my_unread_message_count() to authenticated, service_role;

notify pgrst, 'reload schema';
