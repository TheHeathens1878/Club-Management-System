-- =============================================================================
-- P5.4/P6.3 follow-ups found while building the clients
-- =============================================================================
-- 1. Participants could upload to the private `attachments` bucket but not
--    read from it: no SELECT policy on storage.objects, so
--    createSignedUrl() from the user client failed. Reads are now allowed for
--    objects under `<conversation_id>/…` when the caller is (or was) a
--    participant of that conversation — the same visibility as the messages.
--    Uploads are likewise constrained to the caller's own conversations.
-- 2. `messages` and `conversation_participants` join the supabase_realtime
--    publication so the clients' Realtime subscriptions fire (RLS still
--    filters what each subscriber receives).
-- 3. `push_tokens` gains a service_role DELETE grant so comms-dispatch can
--    prune tokens Expo reports as DeviceNotRegistered.

drop policy if exists "attachments_participant_upload" on storage.objects;
create policy "attachments_participant_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_active_participant((storage.foldername(name))[1]::uuid)
  );

create policy "attachments_participant_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_participant_ever((storage.foldername(name))[1]::uuid)
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_participants') then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end $$;

grant delete on public.push_tokens to service_role;

-- Rollback: drop the two storage policies (recreate the P5.2 upload policy),
-- alter publication supabase_realtime drop table messages, conversation_participants;
-- revoke delete on push_tokens from service_role.
