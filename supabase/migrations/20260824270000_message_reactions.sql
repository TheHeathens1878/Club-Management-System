-- =============================================================================
-- Emoji reactions on messages (WhatsApp-style thread, part 1)
-- =============================================================================
-- A reaction is an ephemeral expression, not a message: it carries no words,
-- opens no conversation state, and SAFEGUARDING.md SG-2 does not name it among
-- the evidence tables — so un-reacting is a genuine hard DELETE of one's own
-- row (recorded in DECISIONS.md). Everything else follows the P5.2 model:
-- participant-scoped RLS keyed off the user's own client, no admin path, and
-- the safeguarding-lead export reads messages, which reactions never alter.
--
-- Spec guardrails honoured here:
--   * P5.1 §9.4: announcement conversations take NO reactions (parked with
--     Adam) — refused in the INSERT policy.
--   * A closed conversation is read-only, reactions included.
--   * A deleted or redacted message takes no new reactions (nothing may draw
--     attention back to a removed body).
--
-- Realtime: `message_reactions` and `message_attachments` join the
-- publication so threads update live; RLS scopes the events exactly as it
-- scopes reads.
--
-- Rollback: drop table public.message_reactions (publication membership goes
-- with it); alter publication supabase_realtime drop table
-- public.message_attachments.
-- =============================================================================

create table public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete restrict,
  person_id   uuid not null references public.people (id) on delete restrict,
  emoji       text not null,
  created_at  timestamptz not null default now(),

  constraint message_reactions_emoji_sane
    check (btrim(emoji) <> '' and char_length(emoji) <= 16),
  constraint message_reactions_one_per_emoji
    unique (message_id, person_id, emoji)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Read: whoever can read the message can see its reactions.
create policy message_reactions_read on public.message_reactions
  for select
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_participant_ever(m.conversation_id)
  ));

-- React: yourself, as an active participant, in an open non-announcement
-- conversation, on a message that still has a body.
create policy message_reactions_insert on public.message_reactions
  for insert
  with check (
    person_id = public.current_person_id()
    and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id
        and public.is_active_participant(m.conversation_id)
        and c.type <> 'announcement'
        and c.closed_at is null
        and m.deleted_at is null
        and m.redacted_at is null
    )
  );

-- Un-react: your own reaction only. A hard delete, deliberately — see header.
create policy message_reactions_delete on public.message_reactions
  for delete
  using (person_id = public.current_person_id());

grant select, insert, delete on public.message_reactions to authenticated, service_role;
revoke all privileges on public.message_reactions from anon;
revoke update on public.message_reactions from authenticated, service_role;

-- Live updates for reactions and (already-shipped) attachments.
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.message_attachments;

notify pgrst, 'reload schema';
