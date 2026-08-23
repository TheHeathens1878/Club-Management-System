-- =============================================================================
-- Full-Time: prefetch for the nightly run
-- =============================================================================
-- pg_net works its queue in serial batches: a request queued while another is
-- in flight waits for that batch to finish. The nightly job reaches the Edge
-- Function *through* pg_net (invoke_edge_function), so a Full-Time fetch the
-- function queues cannot be served until the invocation itself ends — a
-- deadlock until one of them times out (seen 2026-08-23: response 335 queued
-- behind 334, served the moment 334 returned).
--
-- So the nightly run is two cron steps. 03:12 UTC `fulltime_prefetch()` queues
-- one fetch per enabled link straight from SQL (nothing is in flight, pg_net
-- runs them concurrently); 03:15 UTC the Edge Function is invoked as before
-- and finds each team's response already written. A run triggered any other
-- way (the team page's "Import now", a direct call) still fetches live.
--
-- Rollback: cron.unschedule('fulltime-import-prefetch'); drop function
-- fulltime_prefetch, fulltime_prefetched; drop table fulltime_prefetches.
-- =============================================================================

create table if not exists public.fulltime_prefetches (
  team_id uuid not null references public.teams (id) on delete cascade,
  request_id bigint not null,
  url text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, request_id)
);
alter table public.fulltime_prefetches enable row level security;
create index if not exists fulltime_prefetches_team_created_idx on public.fulltime_prefetches (team_id, created_at desc);
comment on table public.fulltime_prefetches is
  'pg_net requests queued by fulltime_prefetch() ahead of the nightly Edge Function run.';

-- The URL the importer would fetch for a link: the widget when there is a
-- code, else the canonical fixtures page the link stores.
create or replace function public.fulltime_source_url(p_widget_code text, p_source_url text)
  returns text
  language sql
  immutable
as $$
  select case
    when p_widget_code is not null then 'https://fulltime.thefa.com/js/cs1.html?cs=' || p_widget_code
    else p_source_url
  end;
$$;

create or replace function public.fulltime_prefetch()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  t record;
  v_url text;
  v_id bigint;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'fulltime_prefetch() is for the scheduler' using errcode = '42501';
  end if;
  for t in select * from public.fulltime_import_targets() loop
    v_url := public.fulltime_source_url(t.widget_code, t.source_url);
    begin
      v_id := public.fulltime_http_get(v_url);
      insert into public.fulltime_prefetches (team_id, request_id, url) values (t.team_id, v_id, v_url);
      v_count := v_count + 1;
    exception when others then
      raise notice 'fulltime_prefetch: % — %', t.team_name, sqlerrm;
    end;
  end loop;
  delete from public.fulltime_prefetches where created_at < now() - interval '1 day';
  return v_count;
end;
$$;

-- The most recent prefetch for a team, if it is fresh enough to trust.
create or replace function public.fulltime_prefetched(p_team_id uuid, p_max_age interval default interval '30 minutes')
  returns table (request_id bigint, url text, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.request_id, p.url, p.created_at
  from public.fulltime_prefetches p
  where p.team_id = p_team_id and p.created_at >= now() - p_max_age
  order by p.created_at desc
  limit 1;
$$;

revoke all privileges on function public.fulltime_prefetch() from public, anon, authenticated;
revoke all privileges on function public.fulltime_prefetched(uuid, interval) from public, anon, authenticated;
grant execute on function public.fulltime_prefetch() to service_role;
grant execute on function public.fulltime_prefetched(uuid, interval) to service_role;

select cron.schedule('fulltime-import-prefetch', '12 3 * * *', $cron$ select public.fulltime_prefetch() $cron$);

notify pgrst, 'reload schema';
