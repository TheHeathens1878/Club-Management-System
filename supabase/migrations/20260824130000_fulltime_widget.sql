-- =============================================================================
-- Full-Time widget import (post-P3.4)
-- =============================================================================
-- fulltime.thefa.com serves Cloudflare's bot wall to every cloud IP (Vercel,
-- Supabase, AWS — verified 2026-08-23 with pg_net: HTTP 403), so neither the
-- scheduled Edge Function nor a server action can read the fixtures page. The
-- FA's own embed widget (`/js/cs1.html?cs=<code>`) is meant to run in a
-- browser, and the admin's browser is not blocked. The team page therefore
-- loads the widget client-side, reads the rendered table, and posts the
-- fixtures to import_fixtures() — a third import trigger, 'browser_widget'.
--
-- Rollback: alter table team_fulltime_links drop column widget_code; restore
-- the two CHECK constraints without 'browser_widget'.
-- =============================================================================

alter table public.team_fulltime_links
  add column if not exists widget_code text
    check (widget_code is null or widget_code ~ '^[0-9]{6,12}$');
comment on column public.team_fulltime_links.widget_code is
  'The lrcode from a Full-Time "team" widget snippet (var lrcode = ''…''). Lets the admin''s browser fetch fixtures where servers are blocked.';

alter table public.fixture_import_runs drop constraint if exists fixture_import_runs_trigger_check;
alter table public.fixture_import_runs
  add constraint fixture_import_runs_trigger_check
  check (trigger in ('scheduled', 'manual_url', 'manual_csv', 'browser_widget'));
