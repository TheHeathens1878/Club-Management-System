-- =============================================================================
-- Archiving a conversation (2026-08-25)
-- =============================================================================
-- Adam: "In messages, we should be able to delete them and archive them."
--
-- WhatsApp semantics, per PARTICIPANT: archiving shelves the conversation for
-- you alone — it leaves everyone else's list untouched, keeps every message
-- (SG-2 forbids anything else), and the app un-shelves it the moment something
-- newer than the shelving arrives. "Delete" is the same shelf plus leaving the
-- conversation (left_at, the existing mechanic) — history stays readable, the
-- row stays out of sight.
--
-- No new policy: `participants_update` already lets a person update their own
-- participation row (it is how last_read_message_id moves), and the SG-1
-- triggers only watch left_at.
--
-- ROLLBACK: alter table public.conversation_participants drop column archived_at;
-- =============================================================================

alter table public.conversation_participants
  add column if not exists archived_at timestamptz;

comment on column public.conversation_participants.archived_at is
  'This participant shelved the conversation at this instant. Display-only and per-person: the rail hides it until a message newer than this arrives. Never affects other participants or the history.';

notify pgrst, 'reload schema';
