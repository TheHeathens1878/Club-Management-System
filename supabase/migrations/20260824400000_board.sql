-- =============================================================================
-- The board: Club Lobby posts and team bulletin boards
-- =============================================================================
-- Adam, 2026-08-25 (the Club CRM design build): "Club Lobby needs to be added,
-- but I need the ability to 'push' it to each team's bulletin board but if
-- they reply, they reply on the main club lobby post. I also need the ability
-- to create a post and only post it to certain age groups and teams."
--
-- THE MODEL — one post, many boards, one thread:
--   * `board_posts` — the post itself. `audience` is 'club' (the lobby;
--     everyone reads) or 'teams' (targeted). A club post with
--     `push_to_boards` appears on EVERY team's bulletin board wearing a
--     "Club-wide" chip; a targeted post appears on its teams' boards and, for
--     its audience only, in the lobby. Age groups are expanded to team rows at
--     posting time by `create_board_post()` — the audience of a post is fixed
--     when it is made.
--   * Replies live on the POST (`board_replies.post_id`), never on a board:
--     wherever someone met the post, their reply joins the one thread. This is
--     Adam's requirement made structural — there is nothing else a reply
--     could attach to.
--   * `board_reads` — who has opened it, for the design's "41 of 46 read".
--     A club post shows a plain count ("487 read"); a targeted post shows
--     "N of M" where M is the distinct people its teams reach (players and
--     staff, plus guardians standing in for minors).
--
-- WHO MAY POST — the design's own words: "Everyone can read · admins and
-- coaches can post". A club administrator or committee member posts anywhere;
-- team staff post club-wide or to teams they staff (every targeted team, not
-- just one of them). Anyone who can read a post may reply. Pin and soft-delete
-- belong to the author and the administrators.
--
-- NOTIFICATIONS: a TARGETED post notifies its audience in-app (guardians for
-- minors, author excluded). A club-wide post does not fan out — the lobby is
-- its surface, and a 500-row write per routine notice would drown the bell.
-- Deliberate, revisitable.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (four new tables); data
-- touched: none; rollback: end.
-- =============================================================================


-- =============================================================================
-- 1. TABLES
-- =============================================================================

create type public.board_audience as enum ('club', 'teams');

create table public.board_posts (
  id                uuid primary key default gen_random_uuid(),
  author_person_id  uuid not null references public.people (id) on delete restrict,
  title             text not null,
  body              text not null,
  audience          public.board_audience not null default 'club',
  -- Club posts only: show on every team's bulletin board too.
  push_to_boards    boolean not null default false,
  pinned            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,
  constraint board_posts_title_not_blank check (btrim(title) <> ''),
  constraint board_posts_body_not_blank  check (btrim(body) <> ''),
  constraint board_posts_push_is_club    check (not push_to_boards or audience = 'club')
);

create index board_posts_feed_idx on public.board_posts (created_at desc) where deleted_at is null;

create table public.board_post_teams (
  post_id  uuid not null references public.board_posts (id) on delete cascade,
  team_id  uuid not null references public.teams (id) on delete cascade,
  primary key (post_id, team_id)
);

create index board_post_teams_team_idx on public.board_post_teams (team_id);

create table public.board_replies (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.board_posts (id) on delete cascade,
  author_person_id  uuid not null references public.people (id) on delete restrict,
  body              text not null,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,
  constraint board_replies_body_not_blank check (btrim(body) <> '')
);

create index board_replies_post_idx on public.board_replies (post_id, created_at);

create table public.board_reads (
  post_id    uuid not null references public.board_posts (id) on delete cascade,
  person_id  uuid not null references public.people (id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (post_id, person_id)
);

create trigger trg_board_posts_updated
  before update on public.board_posts
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. VISIBILITY
-- =============================================================================

-- May the caller read this post? Club posts are club-public; targeted posts
-- belong to their teams' members, those members' guardians, the teams' staff,
-- the author, and the club's administrators.
create or replace function public.can_read_board_post(p_post_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.board_posts p
    where p.id = p_post_id and p.deleted_at is null
      and (p.audience = 'club'
           or p.author_person_id = public.current_person_id()
           or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
           or exists (
                select 1 from public.board_post_teams bt
                where bt.post_id = p.id
                  and (public.is_team_member(bt.team_id)
                       or public.is_team_guardian(bt.team_id)
                       or public.is_team_staff(bt.team_id)))));
$$;

-- The people a targeted post reaches: distinct over its teams — adult members
-- for themselves, guardians standing in for minors, staff as themselves.
create or replace function public.board_post_audience_count(p_post_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select count(distinct coalesce(g.guardian_person_id, m.person_id))::integer
  from public.board_post_teams bt
  join public.team_memberships m on m.team_id = bt.team_id and m.left_at is null
  left join public.guardianships g
    on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
  where bt.post_id = p_post_id;
$$;


-- =============================================================================
-- 3. WRITING
-- =============================================================================

/**
 * Create a post: to the lobby (audience 'club', optionally pushed onto every
 * team board), or targeted at teams and/or whole age groups ('teams').
 *
 * Age groups expand to their active teams HERE, at posting time — a post's
 * audience is what the club looked like when it was made. Team staff may
 * target only teams they staff; administrators anywhere.
 */
create or replace function public.create_board_post(
  p_title text,
  p_body text,
  p_team_ids uuid[] default null,
  p_age_groups text[] default null,
  p_push_to_boards boolean default false,
  p_pinned boolean default false
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me       uuid := public.current_person_id();
  v_admin    boolean := public.is_club_admin();
  v_staff    boolean;
  v_teams    uuid[];
  v_audience public.board_audience;
  v_post     uuid;
  v_person   uuid;
  v_title    text := btrim(coalesce(p_title, ''));
begin
  if v_me is null then
    raise exception 'create_board_post: your sign-in is not linked to a member record' using errcode = 'P0001';
  end if;
  v_staff := exists (
    select 1 from public.team_memberships m
    where m.person_id = v_me and m.left_at is null
      and m.role in ('coach', 'assistant_coach', 'manager'));
  if not (v_admin or v_staff) then
    raise exception 'Only the club''s administrators and team staff can post to the board.' using errcode = 'P0001';
  end if;

  -- The target list: named teams plus every active team in the named age groups.
  select coalesce(array_agg(distinct t.id), '{}') into v_teams
  from public.teams t
  where t.id = any(coalesce(p_team_ids, '{}'))
     or (p_age_groups is not null and t.age_group = any(p_age_groups));

  v_audience := case when coalesce(array_length(v_teams, 1), 0) > 0 then 'teams' else 'club' end::public.board_audience;

  if v_audience = 'teams' and not v_admin then
    -- Staff post to their own teams — all of them, not just one of the list.
    perform 1 from unnest(v_teams) as target(team_id) where not public.is_team_staff(target.team_id);
    if found then
      raise exception 'You can only post to teams you are staff of — a club administrator can post anywhere.' using errcode = 'P0001';
    end if;
  end if;
  if p_pinned and not v_admin then
    raise exception 'Only a club administrator can pin a post.' using errcode = 'P0001';
  end if;

  insert into public.board_posts (author_person_id, title, body, audience, push_to_boards, pinned)
  values (v_me, v_title, p_body, v_audience, v_audience = 'club' and p_push_to_boards, p_pinned and v_admin)
  returning id into v_post;

  insert into public.board_post_teams (post_id, team_id)
  select v_post, team_id from unnest(v_teams) team_id;

  -- A targeted post tells its audience in-app; a club-wide one is met in the
  -- lobby (see header). Author excluded, guardians for minors.
  if v_audience = 'teams' then
    for v_person in
      select distinct coalesce(g.guardian_person_id, m.person_id)
      from unnest(v_teams) as target(team_id)
      join public.team_memberships m on m.team_id = target.team_id and m.left_at is null
      left join public.guardianships g
        on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
    loop
      if v_person is distinct from v_me then
        perform public.notify(
          v_person,
          'Board: ' || v_title,
          left(p_body, 180) || case when length(p_body) > 180 then '…' else '' end,
          '/lobby/' || v_post, 'board_posts', v_post::text);
      end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'board.post_created', 'board_posts', v_post::text,
          jsonb_build_object('audience', v_audience, 'teams', v_teams, 'push', p_push_to_boards));
  return v_post;
end;
$$;

/** Reply — wherever the post was met, the reply joins the one thread. */
create or replace function public.reply_board_post(p_post_id uuid, p_body text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me uuid := public.current_person_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'reply_board_post: your sign-in is not linked to a member record' using errcode = 'P0001';
  end if;
  if not public.can_read_board_post(p_post_id) then
    raise exception 'This post is not for a team or age group you belong to.' using errcode = 'P0001';
  end if;
  insert into public.board_replies (post_id, author_person_id, body)
  values (p_post_id, v_me, p_body)
  returning id into v_id;
  return v_id;
end;
$$;

/** Open receipts: idempotent, self-only, silently skips what you cannot read. */
create or replace function public.mark_board_posts_read(p_post_ids uuid[])
  returns void
  language sql
  security definer
  set search_path = public
as $$
  insert into public.board_reads (post_id, person_id)
  select post_id, public.current_person_id()
  from unnest(p_post_ids) post_id
  where public.current_person_id() is not null
    and public.can_read_board_post(post_id)
  on conflict (post_id, person_id) do nothing;
$$;

/** Pin/unpin: author or administrator. */
create or replace function public.set_board_post_pinned(p_post_id uuid, p_pinned boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.board_posts p
     set pinned = p_pinned
   where p.id = p_post_id and p.deleted_at is null
     and (p.author_person_id = public.current_person_id() or public.is_club_admin());
  if not found then
    raise exception 'Only the post''s author or a club administrator can pin or unpin it.' using errcode = 'P0001';
  end if;
end;
$$;

/** Soft delete: author or administrator. The thread goes with it (reads keep). */
create or replace function public.delete_board_post(p_post_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.board_posts p
     set deleted_at = now(), deleted_by = auth.uid()
   where p.id = p_post_id and p.deleted_at is null
     and (p.author_person_id = public.current_person_id() or public.is_club_admin());
  if not found then
    raise exception 'Only the post''s author or a club administrator can remove it.' using errcode = 'P0001';
  end if;
end;
$$;


-- =============================================================================
-- 4. READING — the two feeds and the thread
-- =============================================================================

/**
 * The lobby: every club post, plus targeted posts the CALLER is in the
 * audience of. Pinned first, newest first. `read_of` is null for a club post
 * (the design shows a plain count there) and the audience size for a targeted
 * one.
 */
create or replace function public.club_lobby_posts(p_limit integer default 30)
  returns table (
    post_id uuid, title text, body text, audience text, pinned boolean,
    author_name text, created_at timestamptz,
    read_count integer, read_of integer, reply_count integer,
    my_read boolean, can_manage boolean,
    team_names text[]
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id, p.title, p.body, p.audience::text, p.pinned,
         a.first_name || ' ' || a.last_name, p.created_at,
         (select count(*) from public.board_reads r where r.post_id = p.id)::integer,
         case when p.audience = 'teams' then public.board_post_audience_count(p.id) end,
         (select count(*) from public.board_replies br where br.post_id = p.id and br.deleted_at is null)::integer,
         exists (select 1 from public.board_reads r
                  where r.post_id = p.id and r.person_id = public.current_person_id()),
         p.author_person_id = public.current_person_id() or public.is_club_admin(),
         (select array_agg(t.name order by t.name) from public.board_post_teams bt
           join public.teams t on t.id = bt.team_id where bt.post_id = p.id)
  from public.board_posts p
  join public.people a on a.id = p.author_person_id
  where p.deleted_at is null
    and public.can_read_board_post(p.id)
  order by p.pinned desc, p.created_at desc
  limit greatest(least(p_limit, 100), 1);
$$;

/**
 * One team's bulletin board: its targeted posts, plus club posts pushed to
 * every board (the "Club-wide" chip is `audience = 'club'`).
 */
create or replace function public.team_board_posts(p_team_id uuid, p_limit integer default 30)
  returns table (
    post_id uuid, title text, body text, audience text, pinned boolean,
    author_name text, created_at timestamptz,
    read_count integer, read_of integer, reply_count integer,
    my_read boolean, can_manage boolean
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  if not (public.is_team_member(p_team_id) or public.is_team_guardian(p_team_id)
          or public.is_team_staff(p_team_id)
          or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])) then
    raise exception 'This board belongs to the team''s members, their guardians and staff.' using errcode = 'P0001';
  end if;
  return query
  select p.id, p.title, p.body, p.audience::text, p.pinned,
         a.first_name || ' ' || a.last_name, p.created_at,
         (select count(*) from public.board_reads r where r.post_id = p.id)::integer,
         case when p.audience = 'teams' then public.board_post_audience_count(p.id) end,
         (select count(*) from public.board_replies br where br.post_id = p.id and br.deleted_at is null)::integer,
         exists (select 1 from public.board_reads r
                  where r.post_id = p.id and r.person_id = public.current_person_id()),
         p.author_person_id = public.current_person_id() or public.is_club_admin()
  from public.board_posts p
  join public.people a on a.id = p.author_person_id
  where p.deleted_at is null
    and (exists (select 1 from public.board_post_teams bt
                  where bt.post_id = p.id and bt.team_id = p_team_id)
         or (p.audience = 'club' and p.push_to_boards))
  order by p.pinned desc, p.created_at desc
  limit greatest(least(p_limit, 100), 1);
end;
$$;

/** One post, for its thread page. Same shape as the lobby feed rows. */
create or replace function public.board_post_detail(p_post_id uuid)
  returns table (
    post_id uuid, title text, body text, audience text, pinned boolean,
    author_name text, created_at timestamptz,
    read_count integer, read_of integer, reply_count integer,
    my_read boolean, can_manage boolean,
    team_names text[]
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  if not public.can_read_board_post(p_post_id) then
    raise exception 'This post is not for a team or age group you belong to.' using errcode = 'P0001';
  end if;
  return query
  select p.id, p.title, p.body, p.audience::text, p.pinned,
         a.first_name || ' ' || a.last_name, p.created_at,
         (select count(*) from public.board_reads r where r.post_id = p.id)::integer,
         case when p.audience = 'teams' then public.board_post_audience_count(p.id) end,
         (select count(*) from public.board_replies br where br.post_id = p.id and br.deleted_at is null)::integer,
         exists (select 1 from public.board_reads r
                  where r.post_id = p.id and r.person_id = public.current_person_id()),
         p.author_person_id = public.current_person_id() or public.is_club_admin(),
         (select array_agg(t.name order by t.name) from public.board_post_teams bt
           join public.teams t on t.id = bt.team_id where bt.post_id = p.id)
  from public.board_posts p
  join public.people a on a.id = p.author_person_id
  where p.id = p_post_id and p.deleted_at is null;
end;
$$;

/** The one thread: the post and its replies, wherever it was met. */
create or replace function public.board_post_thread(p_post_id uuid)
  returns table (
    reply_id uuid, author_name text, author_person_id uuid, body text,
    created_at timestamptz, is_mine boolean
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  if not public.can_read_board_post(p_post_id) then
    raise exception 'This post is not for a team or age group you belong to.' using errcode = 'P0001';
  end if;
  return query
  select r.id, a.first_name || ' ' || a.last_name, r.author_person_id, r.body,
         r.created_at, r.author_person_id = public.current_person_id()
  from public.board_replies r
  join public.people a on a.id = r.author_person_id
  where r.post_id = p_post_id and r.deleted_at is null
  order by r.created_at;
end;
$$;


-- =============================================================================
-- 5. ROW LEVEL SECURITY (reads go through the definer feeds; the policies are
-- the backstop for anything that queries the tables directly)
-- =============================================================================

alter table public.board_posts      enable row level security;
alter table public.board_post_teams enable row level security;
alter table public.board_replies    enable row level security;
alter table public.board_reads      enable row level security;

create policy "board_posts_read" on public.board_posts for select to authenticated
  using (public.can_read_board_post(id));
create policy "board_post_teams_read" on public.board_post_teams for select to authenticated
  using (public.can_read_board_post(post_id));
create policy "board_replies_read" on public.board_replies for select to authenticated
  using (public.can_read_board_post(post_id));
create policy "board_reads_self_read" on public.board_reads for select to authenticated
  using (person_id = public.current_person_id() or public.is_club_admin());

-- All writes go through the SECURITY DEFINER functions above; nothing else.
revoke all privileges on public.board_posts, public.board_post_teams, public.board_replies, public.board_reads
  from anon, authenticated;
grant select on public.board_posts, public.board_post_teams, public.board_replies, public.board_reads to authenticated;
grant select, insert, update, delete on public.board_posts, public.board_post_teams, public.board_replies, public.board_reads
  to service_role;


-- =============================================================================
-- 6. GRANTS
-- =============================================================================

revoke all privileges on function public.can_read_board_post(uuid)            from public, anon;
revoke all privileges on function public.board_post_audience_count(uuid)      from public, anon;
revoke all privileges on function public.create_board_post(text, text, uuid[], text[], boolean, boolean) from public, anon;
revoke all privileges on function public.reply_board_post(uuid, text)         from public, anon;
revoke all privileges on function public.mark_board_posts_read(uuid[])        from public, anon;
revoke all privileges on function public.set_board_post_pinned(uuid, boolean) from public, anon;
revoke all privileges on function public.delete_board_post(uuid)              from public, anon;
revoke all privileges on function public.club_lobby_posts(integer)            from public, anon;
revoke all privileges on function public.team_board_posts(uuid, integer)      from public, anon;
revoke all privileges on function public.board_post_detail(uuid)              from public, anon;
revoke all privileges on function public.board_post_thread(uuid)              from public, anon;

grant execute on function
  public.can_read_board_post(uuid), public.board_post_audience_count(uuid),
  public.create_board_post(text, text, uuid[], text[], boolean, boolean),
  public.reply_board_post(uuid, text), public.mark_board_posts_read(uuid[]),
  public.set_board_post_pinned(uuid, boolean), public.delete_board_post(uuid),
  public.club_lobby_posts(integer), public.team_board_posts(uuid, integer),
  public.board_post_detail(uuid), public.board_post_thread(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 7. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop the ten functions; drop tables board_reads, board_replies,
-- board_post_teams, board_posts; drop type board_audience. Audit rows stay.
