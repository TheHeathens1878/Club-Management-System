-- =============================================================================
-- Group inventory for administrators (follow-up to 20260824250000)
-- =============================================================================
-- /groups lets a club_admin run the club's WhatsApp-style groups, but
-- `conversations` had exactly one SELECT policy (participants only), so an
-- admin could not even see that a group they are not in exists. Two narrow
-- additions:
--
--   1. conversations_admin_read_groups — club_admin may read GROUP-type
--      conversation rows (title, attachment, supervised flag). Metadata only:
--      `messages` and `conversation_participants` policies are untouched, so
--      reading content stays with the audited SG-9 lead accessor, and this is
--      deliberately NOT extended to 'dm' — an admin enumerating direct
--      messages is a different and worse proposition.
--   2. group_member_counts() — SECURITY DEFINER aggregate: live member count
--      per group for club_admin. A count is an inventory fact; who is in a
--      conversation with whom stays behind the participants policy.
--
-- Rollback: drop policy conversations_admin_read_groups on conversations;
-- drop function group_member_counts().
-- =============================================================================

create policy "conversations_admin_read_groups" on public.conversations
  for select to authenticated
  using (type = 'group' and public.is_club_admin());

create or replace function public.group_member_counts()
  returns table (conversation_id uuid, members integer)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select c.id, count(p.person_id) filter (where p.left_at is null)::integer
  from public.conversations c
  left join public.conversation_participants p on p.conversation_id = c.id
  where c.type = 'group' and public.is_club_admin()
  group by c.id;
$$;
revoke all privileges on function public.group_member_counts() from public, anon;
grant execute on function public.group_member_counts() to authenticated;
