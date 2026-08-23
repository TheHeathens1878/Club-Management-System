-- =============================================================================
-- Group conversations attach to a venue — or anything (Adam, 2026-08-23)
-- =============================================================================
-- "WhatsApp-style groups … attached to venues initially, but the ability to
--  set up against anything." `conversations` already carries team_id (team
-- chats). This adds:
--   * resource_id — the venue/pitch/room a group is about;
--   * scope_label — free text for "anything else" (an event, a committee, a
--     minibus). Display-only.
-- A group may carry at most one structured attachment (team or resource).
-- Membership, messaging, supervision and RLS are unchanged — a group is still
-- created by its creator and joined through conversation_participants.
--
-- Rollback: alter table conversations drop column resource_id, drop column
-- scope_label (drop the check first).
-- =============================================================================

alter table public.conversations
  add column if not exists resource_id uuid references public.resources (id) on delete set null,
  add column if not exists scope_label text check (scope_label is null or btrim(scope_label) <> ''),
  add constraint conversations_one_attachment check (team_id is null or resource_id is null);

comment on column public.conversations.resource_id is
  'The venue/pitch/room this group is about (groups attach to venues first; scope_label covers anything else).';
comment on column public.conversations.scope_label is
  'Free-text scope for a group attached to something that is not a team or resource.';

create index if not exists conversations_resource_idx on public.conversations (resource_id) where resource_id is not null;
