-- =============================================================================
-- Team league and division (Adam, 2026-08-24)
-- =============================================================================
-- "There are a few teams which won't work on the club FT link as they are not
--  Timperley league or SMGFL. Can we put a league and division column on the
--  teams page?"
--
-- Two free-text columns on `teams`. The Teams list shows them next to the
-- Full-Time badge, so a team whose league has no club widget is visibly
-- accounted for rather than looking mis-configured; the team's own staff can
-- maintain them from the Match day card (the staff-update guard restricts
-- only name/age group/status/sort order/notes, so no guard change is needed).
--
-- Rollback: alter table public.teams drop column league, drop column division;
-- =============================================================================

alter table public.teams
  add column if not exists league   text check (league   is null or char_length(league)   between 1 and 120),
  add column if not exists division text check (division is null or char_length(division) between 1 and 120);

comment on column public.teams.league is
  'The competition the team plays in, free text (e.g. Timperley & District JFL). Named so teams outside the club''s Full-Time club widgets are accounted for.';
comment on column public.teams.division is
  'The division within the league, free text (e.g. Division 3).';
