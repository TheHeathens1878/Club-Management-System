-- =============================================================================
-- A team may play a different game from the one its age says
-- =============================================================================
-- Adam, 2026-09-02: "I need the ability to change the default playing time and
-- format. For example, one of our adult women's teams plays 9 a side. So just
-- put in the team settings. I also need the ability as admin to change a team
-- name."
--
--
-- 1. THE FORMAT
-- ---------------------------------------------------------------------------
-- "Format is read from the age group, not stored per team" (the 2026-08-25
-- design build) and `lib/fa-formats` has derived it ever since, which is right
-- for the twelve youth teams: when the age group rolls over in the summer the
-- format follows it with nothing to remember. It is wrong for exactly the case
-- Adam has: an adult side that plays 9-a-side. The FA table says Senior means
-- 11v11 and there is no age group that will ever say otherwise.
--
-- So `teams.playing_format` is an OVERRIDE, not a replacement. Null — the
-- default and the state every existing row is in — keeps the derived answer and
-- keeps the rollover working. A value wins over it, and only the four shapes
-- the club actually fields a side in are allowed, because the lineup screen has
-- a formation set for each of those and nothing for "3v3 (carousel)".
--
-- THE PLAYING TIME needs nothing here: `match_halves`, `half_length_minutes`
-- and `half_time_minutes` have been on `teams` since 20260824200000 and
-- `team_match_duration()` already turns them into the pitch slot. What was
-- missing was somewhere to put the format beside them.
--
--
-- 2. THE NAME
-- ---------------------------------------------------------------------------
-- A club administrator has always been able to rename a team — `teams_admin_write`
-- is `for all` — but two things in the database quote the name into text of
-- their own and would have gone stale:
--
--   · the team's conversation titles ("U15 Rhinos 2026/27"), and
--   · the fixture event titles, which since 20260902140000 carry both teams.
--
-- Neither is anybody's to type: both are generated, and a room called after a
-- team that no longer exists is worse than no room name at all. So a rename
-- carries them with it. `ensure_team_conversation()` finds a room by `team_id`
-- and the season in the title, never by the team name, so nothing depends on
-- the old text and no second room appears.
--
-- Bookings' `occasion` is NOT rewritten. A booking is a record of something
-- that was arranged, under the name it was arranged in, and the pitch diary is
-- read backwards as often as forwards.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered; `teams_admin_write` already governs both columns. Data touched: none
-- by the migration itself; hereafter renaming a team rewrites its own rooms'
-- titles and its own fixtures' event titles. Safeguarding: none — no invariant
-- reads a team name or a playing format. Rollback: §3.
-- =============================================================================


-- =============================================================================
-- 1. teams.playing_format
-- =============================================================================

alter table public.teams
  add column if not exists playing_format text
    constraint teams_playing_format_check
      check (playing_format is null or playing_format in ('5v5', '7v7', '9v9', '11v11'));

comment on column public.teams.playing_format is
  'The shape this team actually plays, overriding the FA table''s answer for the age group. Null means "use the age group", which is right for every youth team and keeps the summer rollover automatic; a value is for the sides the age group cannot describe — an adult team playing 9-a-side, say.';


-- =============================================================================
-- 2. A RENAME CARRIES THE GENERATED TEXT WITH IT
-- =============================================================================

create or replace function public.teams_rename_sync()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
begin
  if new.name is not distinct from old.name then
    return null;
  end if;

  -- The rooms. Replacing the old name inside the title keeps the season and
  -- the " announcements " infix exactly as `ensure_team_conversation()` built
  -- them, without this function having to know how it builds them.
  update public.conversations c
     set title = replace(c.title, old.name, new.name)
   where c.team_id = new.id
     and c.type in ('team', 'announcement')
     and c.title like '%' || old.name || '%';

  -- The fixture events (20260902140000 — both teams in the title).
  update public.events e
     set title = public.fixture_event_title(f.team_id, f.opponent, f.is_home)
    from public.fixtures f
   where f.id = e.fixture_id
     and f.team_id = new.id;

  return null;
end $function$;

comment on function public.teams_rename_sync() is
  'Renaming a team rewrites the text the database generated from its old name: its team and announcement room titles, and its fixtures'' event titles. Booking occasions are deliberately left alone — a booking records what was arranged, under the name it was arranged in.';

drop trigger if exists trg_teams_rename_sync on public.teams;
create trigger trg_teams_rename_sync
  after update of name on public.teams
  for each row execute function public.teams_rename_sync();


-- =============================================================================
-- 3. ROLLBACK
-- =============================================================================
--   drop trigger if exists trg_teams_rename_sync on public.teams;
--   drop function if exists public.teams_rename_sync();
--   alter table public.teams drop column if exists playing_format;
-- Titles already rewritten stay rewritten; they name the team as it is now.
-- =============================================================================
