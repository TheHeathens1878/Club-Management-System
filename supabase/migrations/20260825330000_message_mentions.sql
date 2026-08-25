-- =============================================================================
-- @mentions in a conversation — `message_mentions` and `mention_people()`
-- =============================================================================
-- Adam, 2026-08-25: "in messaging, I want you to facilitate using @ to notify
-- another member of the group."
--
-- WHY A TABLE AND NOT A PARSE
--   The composer writes `@First Last` into the body, because the body is what
--   the member typed and what the safeguarding lead's SG-9 export prints — a
--   uuid smuggled into it would be read by a human being. But a display name
--   is not an identity: people are renamed, two members share a first name,
--   and a body can be redacted (SG-8) after the fact. So the RESOLVED people
--   are stored here, once, at send time. Anything that later asks "who was
--   mentioned in this message" reads rows, never text.
--
-- WHO WRITES THEM: `mention_people()` and nothing else. There is deliberately
-- NO insert, update or delete policy on this table, so an authenticated client
-- holding the anon key cannot mint a mention row for a message it did not send
-- or for someone who is not in the room. The RPC is the one door, and it says
-- why it refused in words (P0001 / 42501) instead of the bare "new row
-- violates row-level security policy" a policy would have given.
--
-- WHAT THE RPC CHECKS (both, every time):
--   1. the caller is the SENDER of `p_message_id`;
--   2. every person named is a LIVE participant of that message's
--      conversation (`left_at is null`).
--   Someone who has left the room is not notified and gets no row: SG-2 keeps
--   what was said, it does not keep pulling a departed member back in.
--   A self-mention is skipped in silence — you cannot notify yourself.
--
-- READ: exactly the `message_reactions_read` rule — whoever may read the
-- message may see who it named. No wider, no narrower.
--
-- NOTIFICATION lives in the web send path, not in a trigger: `notify()` is
-- service-role-only and the sender's name and the conversation title are
-- already in hand there (apps/web/src/app/(app)/messages/actions.ts). In-app
-- only, no email — Adam's standing rule.
--
-- SAFEGUARDING: nothing here can add a participant, reveal a body, or change
-- who may read a conversation. A mention row is a pointer at a message the
-- reader can already open, and it is created only by the person who wrote it.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table, SELECT-only
-- for authenticated); data touched: none (new table, starts empty);
-- rollback: `drop function if exists public.mention_people(uuid, uuid[]);
--            drop table if exists public.message_mentions;`
-- =============================================================================

create table public.message_mentions (
  id          uuid primary key default gen_random_uuid(),
  -- Messages are never hard-deleted (SG-2 soft-deletes them), so this cascade
  -- is a belt on a table that already wears braces; it is here so a mention
  -- can never outlive the message it points at.
  message_id  uuid not null references public.messages (id) on delete cascade,
  -- `restrict`, like message_reactions: a person row is not something the
  -- database quietly loses on someone else's behalf.
  person_id   uuid not null references public.people (id) on delete restrict,
  created_at  timestamptz not null default now(),

  constraint message_mentions_once unique (message_id, person_id)
);

create index message_mentions_message_idx on public.message_mentions (message_id);
create index message_mentions_person_idx on public.message_mentions (person_id, created_at desc);

comment on table public.message_mentions is
  'Who a message named with @. Written only by mention_people(); read by whoever may read the message.';

alter table public.message_mentions enable row level security;

-- Read: whoever can read the message can see whom it named.
-- (The same predicate as `message_reactions_read`, deliberately identical.)
create policy message_mentions_read on public.message_mentions
  for select
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_participant_ever(m.conversation_id)
  ));

-- No INSERT / UPDATE / DELETE policy, and none by omission either: the grants
-- below take the privileges away so a client cannot even attempt one.
grant select on public.message_mentions to authenticated, service_role;
revoke all privileges on public.message_mentions from anon;
revoke insert, update, delete on public.message_mentions from authenticated;


-- The one door ---------------------------------------------------------------
-- SECURITY DEFINER: it writes rows no policy admits, so every check it needs
-- is written out here. It returns the number of rows it created, so the send
-- path can tell a fresh mention from a repeat (an edit-and-resend, a retry).

create or replace function public.mention_people(p_message_id uuid, p_person_ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m        public.messages%rowtype;
  v_me     uuid := public.current_person_id();
  v_person uuid;
  v_added  integer := 0;
begin
  if p_message_id is null then
    raise exception 'mention_people: no message given' using errcode = '22023';
  end if;
  if p_person_ids is null or array_length(p_person_ids, 1) is null then
    return 0;
  end if;

  select * into m from public.messages where id = p_message_id;
  if not found then
    raise exception 'mention_people: unknown message' using errcode = 'P0001';
  end if;

  if v_me is null or m.sender_person_id is distinct from v_me then
    raise exception 'mention_people: only the person who sent a message may record whom it mentioned'
      using errcode = '42501';
  end if;

  foreach v_person in array p_person_ids loop
    -- You cannot notify yourself, and a null in the array is not a person.
    continue when v_person is null or v_person = v_me;

    if not exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = m.conversation_id
        and p.person_id = v_person
        and p.left_at is null
    ) then
      raise exception 'mention_people: % is not in this conversation, so they cannot be mentioned in it', v_person
        using errcode = 'P0001';
    end if;

    insert into public.message_mentions (message_id, person_id)
    values (p_message_id, v_person)
    on conflict (message_id, person_id) do nothing;
    -- ON CONFLICT DO NOTHING leaves FOUND false, so a repeat is not counted.
    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  return v_added;
end;
$$;

comment on function public.mention_people(uuid, uuid[]) is
  'Record whom a message mentioned. Caller must be the message sender; every person must be a live participant of its conversation. Returns the number of new rows.';

revoke all privileges on function public.mention_people(uuid, uuid[]) from public, anon;
grant execute on function public.mention_people(uuid, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
