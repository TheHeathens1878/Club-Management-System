-- =============================================================================
-- Full-Time: club-wide widgets
-- =============================================================================
-- Full-Time also generates *club* widgets: one code for every team's upcoming
-- fixtures (five-cell rows, no scores) and a second for the club's results.
-- Two codes pasted once cover the whole club, instead of one snippet per team.
-- The codes live in site_settings (`fulltime_club_fixtures_code`,
-- `fulltime_club_results_code`); the importer matches each widget team name
-- ("Ashton On Mersey FC U14 Mavericks") onto the club's own team names
-- ("U14 Mavericks") by suffix, in code.
--
-- The prefetch step now works per URL rather than per team: a club URL serves
-- many teams, and per-team links can share a URL too. `fulltime_prefetches`
-- is re-keyed on the pg_net request id and read back by URL.
--
-- Rollback: restore fulltime_prefetch/fulltime_prefetched from
-- 20260824193000_fulltime_prefetch.sql; drop fulltime_prefetched_url,
-- fulltime_club_codes; re-key fulltime_prefetches on (team_id, request_id);
-- delete the two site_settings rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Prefetches are per URL
-- -----------------------------------------------------------------------------
alter table public.fulltime_prefetches drop constraint fulltime_prefetches_pkey;
alter table public.fulltime_prefetches alter column team_id drop not null;
alter table public.fulltime_prefetches add primary key (request_id);
create index if not exists fulltime_prefetches_url_created_idx
  on public.fulltime_prefetches (url, created_at desc);
comment on column public.fulltime_prefetches.team_id is
  'The team a per-team link prefetch was queued for; null for a club-wide widget URL.';

-- -----------------------------------------------------------------------------
-- 2. The club codes
-- -----------------------------------------------------------------------------
-- site_settings is the club-level key/value store (committee-writable).
create or replace function public.fulltime_club_codes()
  returns table (kind text, code text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select x.kind, s.value
  from (values ('fixtures', 'fulltime_club_fixtures_code'), ('results', 'fulltime_club_results_code')) as x (kind, key)
  join public.site_settings s on s.key = x.key
  where s.value ~ '^[0-9]{6,12}$';
$$;
revoke all privileges on function public.fulltime_club_codes() from public, anon, authenticated;
grant execute on function public.fulltime_club_codes() to service_role;

-- -----------------------------------------------------------------------------
-- 3. Prefetch every distinct URL once
-- -----------------------------------------------------------------------------
create or replace function public.fulltime_prefetch()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r record;
  v_id bigint;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'fulltime_prefetch() is for the scheduler' using errcode = '42501';
  end if;
  for r in
    select distinct on (u.url) u.url, u.team_id
    from (
      select public.fulltime_source_url(t.widget_code, t.source_url) as url, t.team_id
      from public.fulltime_import_targets() t
      union all
      select 'https://fulltime.thefa.com/js/cs1.html?cs=' || c.code, null::uuid
      from public.fulltime_club_codes() c
    ) u
    order by u.url, u.team_id nulls first
  loop
    begin
      v_id := public.fulltime_http_get(r.url);
      insert into public.fulltime_prefetches (team_id, request_id, url) values (r.team_id, v_id, r.url);
      v_count := v_count + 1;
    exception when others then
      raise notice 'fulltime_prefetch: % — %', r.url, sqlerrm;
    end;
  end loop;
  delete from public.fulltime_prefetches where created_at < now() - interval '1 day';
  return v_count;
end;
$$;

-- The most recent prefetch of a URL, if it is fresh enough to trust.
create or replace function public.fulltime_prefetched_url(p_url text, p_max_age interval default interval '30 minutes')
  returns table (request_id bigint, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.request_id, p.created_at
  from public.fulltime_prefetches p
  where p.url = p_url and p.created_at >= now() - p_max_age
  order by p.created_at desc
  limit 1;
$$;

drop function if exists public.fulltime_prefetched(uuid, interval);

revoke all privileges on function public.fulltime_prefetch() from public, anon, authenticated;
revoke all privileges on function public.fulltime_prefetched_url(text, interval) from public, anon, authenticated;
grant execute on function public.fulltime_prefetch() to service_role;
grant execute on function public.fulltime_prefetched_url(text, interval) to service_role;

notify pgrst, 'reload schema';
