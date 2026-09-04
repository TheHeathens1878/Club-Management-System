-- =============================================================================
-- Important information for groups (Adam, 2026-09-04: "for groups, they need
-- a message board for important information but the chat should still be
-- prominent. Perhaps have a chat tab (default) and Important Information tab
-- (message board). If a post is added to the message board, it should create
-- a chat message notifying people as well as a notification in the app").
--
-- THE MODEL — a post that cannot scroll away:
--   * `conversation_posts` — title + body, pinned or not, soft-deleted like a
--     message. It belongs to a CONVERSATION (groups and team rooms), and its
--     visibility is the conversation's own: `is_participant_ever()` to read,
--     exactly the messages policy. There is deliberately NO direct INSERT or
--     UPDATE policy — every write goes through the functions below, because a
--     post that arrives silently is exactly what Adam asked this feature not
--     to be.
--   * `create_conversation_post()` writes the post, then RINGS THE ROOM both
--     ways Adam named:
--       - a chat message from the author ("📌 …title…" with a preview), which
--         the messages doorbell (20260904110000) already turns into pushes
--         with push-fanout's minor-safety rules intact;
--       - one in_app notification per other active participant, linking to
--         the tab. Written directly (the notify() shape, minus its push twin)
--         so nobody's phone buzzes twice for one post.
--   * Pin and delete belong to the author, the club's administrators, and —
--     in a team room — the team's staff: the same hands that may delete a
--     message there.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table); data
-- touched: none; rollback: drop table conversation_posts + the 3 functions.
-- =============================================================================

create table public.conversation_posts (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  author_person_id  uuid not null references public.people (id) on delete restrict,
  title             text not null,
  body              text not null,
  pinned            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,
  constraint conversation_posts_title_not_blank check (btrim(title) <> ''),
  constraint conversation_posts_body_not_blank  check (btrim(body) <> '')
);

create index conversation_posts_board_idx
  on public.conversation_posts (conversation_id, pinned desc, created_at desc)
  where deleted_at is null;

create trigger trg_conversation_posts_updated
  before update on public.conversation_posts
  for each row execute function public.set_updated_at();

alter table public.conversation_posts enable row level security;

-- Reading is the conversation's own rule; writing is the functions' job.
create policy conversation_posts_participant_read on public.conversation_posts
  for select to authenticated
  using (public.is_participant_ever(conversation_id));

grant select on public.conversation_posts to authenticated;
grant all on public.conversation_posts to service_role;

-- -----------------------------------------------------------------------------
-- Post, and ring the room.
-- -----------------------------------------------------------------------------
create or replace function public.create_conversation_post(
  p_conversation_id uuid, p_title text, p_body text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_person uuid := public.current_person_id();
  v_conv   public.conversations%rowtype;
  v_post   uuid;
  v_status public.outbound_status := 'queued';
  v_preview text;
begin
  if v_person is null then
    raise exception 'create_conversation_post: no member record' using errcode = '42501';
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'create_conversation_post: unknown conversation' using errcode = 'P0001';
  end if;
  if v_conv.type not in ('group', 'team') then
    raise exception 'create_conversation_post: only groups and team rooms keep a board' using errcode = 'P0001';
  end if;
  if v_conv.closed_at is not null then
    raise exception 'create_conversation_post: this conversation is closed' using errcode = 'P0001';
  end if;
  if not public.is_active_participant(p_conversation_id) then
    raise exception 'create_conversation_post: participants only' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception 'create_conversation_post: a post needs a title and a body' using errcode = '22023';
  end if;

  insert into public.conversation_posts (conversation_id, author_person_id, title, body)
  values (p_conversation_id, v_person, btrim(p_title), p_body)
  returning id into v_post;

  -- The chat stays prominent: the post announces itself in the room, from
  -- its author, and the messages doorbell takes it from there.
  v_preview := left(regexp_replace(p_body, '\s+', ' ', 'g'), 200)
             || case when length(p_body) > 200 then '…' else '' end;
  insert into public.messages (conversation_id, sender_person_id, body)
  values (p_conversation_id, v_person,
          '📌 Important information: ' || btrim(p_title) || e'\n' || v_preview);

  -- And the bell: one in_app row per other active participant — the
  -- notify() shape WITHOUT its push twin, because the chat message above is
  -- already on its way to their lock screens.
  if (select value from public.site_settings where key = 'comms.dry_run') = 'true' then
    v_status := 'dry_run';
  end if;
  insert into public.outbound_messages
    (person_id, channel, category, subject, body, entity, entity_id, status, decision, link, created_by)
  select cp.person_id, 'in_app', 'transactional',
         coalesce(v_conv.title, 'Your group') || ': ' || btrim(p_title),
         v_preview, 'conversation_posts', v_post::text, v_status, 'ok',
         '/messages/' || p_conversation_id || '?tab=info', auth.uid()
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id
     and cp.left_at is null
     and cp.person_id <> v_person;

  return v_post;
end $$;

-- -----------------------------------------------------------------------------
-- Pin and delete: the author, an administrator, or the team room's staff.
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_conversation_post(p_post_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
      from public.conversation_posts p
      join public.conversations c on c.id = p.conversation_id
     where p.id = p_post_id
       and (p.author_person_id = public.current_person_id()
            or public.is_club_admin()
            or (c.team_id is not null and public.is_team_staff(c.team_id)))
  );
$$;

create or replace function public.set_conversation_post_pinned(p_post_id uuid, p_pinned boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not public.can_manage_conversation_post(p_post_id) then
    raise exception 'set_conversation_post_pinned: the author, staff or an administrator only' using errcode = '42501';
  end if;
  update public.conversation_posts
     set pinned = coalesce(p_pinned, false)
   where id = p_post_id and deleted_at is null;
end $$;

create or replace function public.delete_conversation_post(p_post_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not public.can_manage_conversation_post(p_post_id) then
    raise exception 'delete_conversation_post: the author, staff or an administrator only' using errcode = '42501';
  end if;
  update public.conversation_posts
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_post_id and deleted_at is null;
end $$;

revoke all on function public.create_conversation_post(uuid, text, text) from public, anon;
revoke all on function public.can_manage_conversation_post(uuid) from public, anon;
revoke all on function public.set_conversation_post_pinned(uuid, boolean) from public, anon;
revoke all on function public.delete_conversation_post(uuid) from public, anon;
grant execute on function public.create_conversation_post(uuid, text, text) to authenticated, service_role;
grant execute on function public.can_manage_conversation_post(uuid) to authenticated, service_role;
grant execute on function public.set_conversation_post_pinned(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_conversation_post(uuid) to authenticated, service_role;
