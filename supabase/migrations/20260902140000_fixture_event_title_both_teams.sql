-- =============================================================================
-- A fixture says who is playing whom
-- =============================================================================
-- Adam, 2026-09-02: "On the match calendar, it should also have the home team
-- as well as the away team."
--
-- A fixture's event has been titled `'vs ' || opponent || ' (H)'` since
-- 20260824290000. On a team's own page that reads perfectly — the team is the
-- page. On a calendar it is half a sentence: "vs Worsley United U14 Wild Dogs
-- (H)" on a Saturday with nine other games on it does not say whose game it is,
-- and this club runs thirteen teams.
--
-- THE ORDER IS THE FOOTBALL ONE: home team first.
--
--   home   U14 Mavericks v Worsley United U14 Wild Dogs (H)
--   away   Worsley United U14 Wild Dogs v U14 Mavericks (A)
--
-- The (H)/(A) stays. With both names present it is no longer the only way to
-- tell, but it is how everybody reads a fixture list, and it is the quickest
-- answer to "is this one of ours at home?" — which is the question the pitch
-- diary is always really asking.
--
-- A fixture with no team on it keeps the old title. That is not a hypothetical:
-- `fixtures.team_id` is nullable and the Full-Time import can land a game
-- before the team it belongs to is matched. Half a sentence beats " v " with
-- nothing in front of it.
--
-- WHERE THE TITLE IS MADE, ONCE. Three call sites wrote that expression out
-- longhand — the insert sync, the update sync, and the update sync's
-- create-if-missing limb. They are now one function, so the next change to the
-- wording is one change.
--
-- The existing events are retitled in §3. They are generated rows: the title
-- has never been anybody's to type, and leaving today's fixtures reading one
-- way and tomorrow's another would be the worse outcome.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered; both triggers keep the SECURITY DEFINER they had. Data touched:
-- `events.title` for every row with a `fixture_id`, rewritten from the fixture
-- and the team it already points at. Safeguarding: none — a title carries no
-- personal data; it is two team names. Rollback: §4.
-- =============================================================================


-- =============================================================================
-- 1. fixture_event_title()
-- =============================================================================

create or replace function public.fixture_event_title(
  p_team_id  uuid,
  p_opponent text,
  p_is_home  boolean
)
  returns text
  language sql
  stable
  set search_path = public
as $function$
  select coalesce(
    (select case
              when p_is_home then t.name || ' v ' || p_opponent || ' (H)'
              else p_opponent || ' v ' || t.name || ' (A)'
            end
       from public.teams t
      where t.id = p_team_id),
    -- No team yet (the Full-Time import can arrive first): the old title.
    'vs ' || p_opponent || case when p_is_home then ' (H)' else ' (A)' end
  );
$function$;

comment on function public.fixture_event_title(uuid, text, boolean) is
  'The title of a fixture''s event: home team first, then the opponent, then (H) or (A). Falls back to the opponent alone when the fixture has no team on it yet.';


-- =============================================================================
-- 2. THE TWO SYNC TRIGGERS
-- =============================================================================
-- Both restated from their live definitions with the title expression replaced
-- and nothing else touched. The update sync is 20260824350000's body — the one
-- that carries the change note — not 20260824290000's.

create or replace function public.fixtures_events_sync_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
begin
  insert into public.events
    (team_id, type, title, status, fixture_id, starts_at, ends_at, venue_resource_id, venue_text, created_by)
  select f.team_id,
         public.event_type_for_competition(f.competition),
         public.fixture_event_title(f.team_id, f.opponent, f.is_home),
         case when f.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status,
         f.id,
         f.kickoff_at,
         f.kickoff_at + make_interval(mins => public.fixture_event_minutes(f.team_id)),
         f.venue_resource_id,
         f.venue_text,
         f.created_by
  from new_rows f
  on conflict (fixture_id) do nothing;
  return null;
end;
$function$;

create or replace function public.fixtures_events_sync_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_note text;
begin
  -- Only a move or a venue change is "the details changed". A score, a note or
  -- a status flip is not, and cancellation has its own path below.
  if new.kickoff_at is distinct from old.kickoff_at
     or new.venue_resource_id is distinct from old.venue_resource_id
     or new.venue_text is distinct from old.venue_text then
    v_note := public.event_change_note(
      old.kickoff_at, new.kickoff_at,
      public.venue_label(old.venue_resource_id, old.venue_text),
      public.venue_label(new.venue_resource_id, new.venue_text));
  end if;

  update public.events e
     set starts_at         = new.kickoff_at,
         ends_at           = new.kickoff_at + make_interval(mins => public.fixture_event_minutes(new.team_id)),
         venue_resource_id = new.venue_resource_id,
         venue_text        = new.venue_text,
         title             = public.fixture_event_title(new.team_id, new.opponent, new.is_home),
         type              = public.event_type_for_competition(new.competition),
         status            = case when new.status in ('cancelled', 'postponed') then 'cancelled' else 'scheduled' end::public.event_status,
         details_changed_at = case when v_note is not null then now() else e.details_changed_at end,
         change_note        = case when v_note is not null then v_note else e.change_note end
   where e.fixture_id = new.id;

  if not found and new.kickoff_at > now() and new.status not in ('cancelled', 'postponed') then
    insert into public.events
      (team_id, type, title, fixture_id, starts_at, ends_at, venue_resource_id, venue_text, created_by)
    values
      (new.team_id, public.event_type_for_competition(new.competition),
       public.fixture_event_title(new.team_id, new.opponent, new.is_home),
       new.id, new.kickoff_at,
       new.kickoff_at + make_interval(mins => public.fixture_event_minutes(new.team_id)),
       new.venue_resource_id, new.venue_text, new.created_by)
    on conflict (fixture_id) do nothing;
  end if;
  return null;
end;
$function$;


-- =============================================================================
-- 3. THE FIXTURES ALREADY ON THE CALENDAR
-- =============================================================================

do $backfill$
declare
  n integer;
begin
  update public.events e
     set title = public.fixture_event_title(f.team_id, f.opponent, f.is_home)
    from public.fixtures f
   where f.id = e.fixture_id
     and e.title is distinct from public.fixture_event_title(f.team_id, f.opponent, f.is_home);
  get diagnostics n = row_count;
  if n > 0 then
    perform public.write_audit(
      'migration.backfill', 'events', null,
      jsonb_build_object(
        'migration', '20260902140000_fixture_event_title_both_teams',
        'retitled', n,
        'note', 'Fixture events now name the home team as well as the away team.'));
  end if;
end
$backfill$;


-- =============================================================================
-- 4. ROLLBACK
-- =============================================================================
-- Restore both trigger functions from their previous definitions
-- (20260824290000 for the insert sync, 20260824350000 for the update sync),
-- then
--   update public.events e set title = 'vs ' || f.opponent
--          || case when f.is_home then ' (H)' else ' (A)' end
--     from public.fixtures f where f.id = e.fixture_id;
--   drop function if exists public.fixture_event_title(uuid, text, boolean);
-- =============================================================================
