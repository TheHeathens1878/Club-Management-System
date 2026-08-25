-- =============================================================================
-- A deleted message takes its photo with it (20260824370000)
-- =============================================================================
-- Adam, 2026-08-25: "When a message is deleted, it still stays there. I posted
-- an image and it remains there with a note saying message deleted."
--
-- Two layers were wrong, and the second is the one that matters:
--
--   1. The thread rendered a message's attachments regardless of its state, so
--      a deleted photo message showed the photo above the "Message deleted"
--      tombstone. (Fixed in the thread component alongside this migration.)
--   2. Neither the `message_attachments` read policy nor the storage read
--      policy looked at `messages.deleted_at`, so the FILE ITSELF stayed
--      fetchable: any participant could still mint a signed URL for it. Hiding
--      it in the UI alone would have left a deleted photo one request away.
--
-- Both policies now refuse an attachment whose message has been deleted or
-- redacted. Storage paths are `<conversation_id>/<message_id>/<file>`, so the
-- second folder segment is the message — matched as text so a path that is not
-- shaped like that simply fails to match rather than raising a cast error.
--
-- SG-2 is untouched: nothing is hard-deleted, the rows and objects remain for
-- the safeguarding lead's export (`export_conversation_as_lead` reads
-- `messages`, and the service role does not go through these policies).
-- Purging the storage OBJECT for a deleted attachment — the equivalent of the
-- media module's quarantine sweep — remains the open follow-up it already was;
-- this closes the reachable path.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (two policies REPLACED, both
-- narrowed); data touched: none; rollback: end.
-- =============================================================================

drop policy if exists "attachments_participant_read" on public.message_attachments;
create policy "attachments_participant_read" on public.message_attachments for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_participant_ever(m.conversation_id)
      and m.deleted_at is null
      and m.redacted_at is null));

drop policy if exists "attachments_participant_read" on storage.objects;
create policy "attachments_participant_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_participant_ever((storage.foldername(name))[1]::uuid)
    and not exists (
      select 1 from public.messages m
      where m.id::text = (storage.foldername(name))[2]
        and (m.deleted_at is not null or m.redacted_at is not null))
  );

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- Restore both policies from 20260823210000_messaging.sql (message_attachments)
-- and 20260823260000_messaging_followups.sql (storage.objects) — i.e. drop the
-- deleted_at / redacted_at clauses. Note that doing so makes deleted photos
-- fetchable again.
