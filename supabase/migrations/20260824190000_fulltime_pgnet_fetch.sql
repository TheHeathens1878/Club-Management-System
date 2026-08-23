-- =============================================================================
-- Full-Time: fetch through pg_net, link by widget code
-- =============================================================================
-- Why this exists. fulltime.thefa.com sits behind Cloudflare's bot wall. It is
-- not the IP that is judged: tested 2026-08-23 from this project, a Deno
-- fetch() in an Edge Function gets HTTP 403 for every Full-Time URL, while
-- pg_net (libcurl) from the same project gets HTTP 200 for both the embed
-- widget (`/js/cs1.html?cs=<code>`, 40 KB) and the ordinary fixtures page
-- (136 KB) — provided the request carries a desktop browser User-Agent AND an
-- `Accept-Language` header. Cloudflare fingerprints the TLS client, and
-- libcurl's passes. So the fetch lives here, in Postgres, and the Edge Function
-- / server action asks for it and collects the body.
--
-- The import source is now the team's Full-Time **widget** (`lrcode` from the
-- FA's "add to your website" snippet): it is already scoped to one team, it
-- carries fixtures and results with the same `displayFixture.html?id=` keys
-- the page scraper uses, and it is the endpoint the FA built for third-party
-- sites to call. The league/season/division URL remains as a fallback for a
-- link saved before widgets, so a widget-only link no longer needs league and
-- season ids.
--
-- Rollback: drop function fulltime_http_get, fulltime_http_result; drop table
-- fulltime_http_requests; restore the not-null/not-blank constraints on
-- team_fulltime_links.league_id/ft_season_id; recreate fulltime_import_targets
-- from 20260823150000_fulltime_import.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A widget-only link
-- -----------------------------------------------------------------------------
alter table public.team_fulltime_links alter column league_id drop not null;
alter table public.team_fulltime_links alter column ft_season_id drop not null;
alter table public.team_fulltime_links drop constraint if exists team_fulltime_links_league_not_blank;
alter table public.team_fulltime_links drop constraint if exists team_fulltime_links_season_not_blank;
alter table public.team_fulltime_links add constraint team_fulltime_links_has_source
  check (
    widget_code is not null
    or (coalesce(league_id, '') <> '' and coalesce(ft_season_id, '') <> '')
  );

-- -----------------------------------------------------------------------------
-- 2. Fetch through pg_net
-- -----------------------------------------------------------------------------
-- Every request made through fulltime_http_get() is recorded so that
-- fulltime_http_result() can only ever hand back a Full-Time body — never the
-- response to some other pg_net call (the Edge Function invocations carry the
-- service-role key in their request, and their responses are nobody's business).
create table if not exists public.fulltime_http_requests (
  id bigint primary key,
  url text not null,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.fulltime_http_requests enable row level security;
-- No policies: only the two SECURITY DEFINER functions below touch it.
comment on table public.fulltime_http_requests is
  'pg_net request ids issued by fulltime_http_get(); fulltime_http_result() reads only these.';

-- The headers that get a 200 from Cloudflare when sent by libcurl. Keep these
-- in step with packages/fulltime/src/fetch.ts DEFAULT_USER_AGENT.
create or replace function public.fulltime_http_get(p_url text)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id bigint;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'Only club admins can fetch from Full-Time' using errcode = '42501';
  end if;
  if p_url !~* '^https://fulltime\.thefa\.com/' then
    raise exception 'fulltime_http_get: not a Full-Time URL: %', p_url using errcode = '22023';
  end if;

  v_id := net.http_get(
    url := p_url,
    headers := jsonb_build_object(
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language', 'en-GB,en;q=0.9'),
    timeout_milliseconds := 20000);

  insert into public.fulltime_http_requests (id, url, requested_by) values (v_id, p_url, auth.uid());
  -- Keep the table from growing forever; pg_net itself forgets responses after a few hours.
  delete from public.fulltime_http_requests where created_at < now() - interval '1 day';
  return v_id;
end;
$$;

-- `done` is false until pg_net's worker has written the response; callers poll.
create or replace function public.fulltime_http_result(p_id bigint)
  returns table (done boolean, status_code integer, content text, error_msg text)
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'Only club admins can fetch from Full-Time' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fulltime_http_requests r where r.id = p_id) then
    raise exception 'fulltime_http_result: unknown request %', p_id using errcode = '22023';
  end if;
  return query
    select true, r.status_code, r.content::text, r.error_msg
    from net._http_response r
    where r.id = p_id;
  if not found then
    return query select false, null::integer, null::text, null::text;
  end if;
end;
$$;

revoke all privileges on function public.fulltime_http_get(text) from public, anon;
revoke all privileges on function public.fulltime_http_result(bigint) from public, anon;
grant execute on function public.fulltime_http_get(text) to authenticated, service_role;
grant execute on function public.fulltime_http_result(bigint) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Import targets carry the widget code
-- -----------------------------------------------------------------------------
drop function if exists public.fulltime_import_targets();
create function public.fulltime_import_targets()
  returns table (team_id uuid, team_name text, season_id uuid, source_url text, league_id text, ft_season_id text,
                 division_id text, fixture_group_key text, ft_team_id text, ft_team_name text, widget_code text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select l.team_id, t.name, s.id, l.source_url, l.league_id, l.ft_season_id, l.division_id, l.fixture_group_key,
         l.ft_team_id, coalesce(l.ft_team_name, t.name), l.widget_code
  from public.team_fulltime_links l
  join public.teams t on t.id = l.team_id
  cross join lateral (select id from public.seasons where is_current limit 1) s
  where l.enabled and t.active
  order by t.sort_order, t.name;
$$;
revoke all privileges on function public.fulltime_import_targets() from public, anon, authenticated;
grant execute on function public.fulltime_import_targets() to service_role;



-- -----------------------------------------------------------------------------
-- 4. Import trigger values
-- -----------------------------------------------------------------------------
-- 20260824130000 reserved 'browser_widget' for a browser-side import that the
-- pg_net path made unnecessary; nothing ever wrote it. The on-demand widget
-- import from the team page is 'manual_widget'.
alter table public.fixture_import_runs drop constraint if exists fixture_import_runs_trigger_check;
alter table public.fixture_import_runs
  add constraint fixture_import_runs_trigger_check
  check (trigger in ('scheduled', 'manual_url', 'manual_csv', 'manual_widget'));

comment on column public.team_fulltime_links.widget_code is
  'The lrcode from the team''s Full-Time widget snippet (var lrcode = ''…''). When set, the importer fetches /js/cs1.html?cs=<code> through pg_net instead of the fixtures page.';
notify pgrst, 'reload schema';
