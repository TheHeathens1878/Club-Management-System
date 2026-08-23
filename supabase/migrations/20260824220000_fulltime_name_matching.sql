-- =============================================================================
-- Full-Time: club name anchors team matching; several club widget codes
-- =============================================================================
-- Two lessons from the first live day:
--
-- 1. Suffix-only matching is unsafe: "AFC Urmston Meadowside U14 Mavericks"
--    ends with "U14 Mavericks" and would claim our team of that name. Matching
--    is now anchored on the club's own Full-Time name, stored once in
--    site_settings (`fulltime_club_name`); the importer refuses to run the
--    club feed without it. The same name is the default `ft_team_name` prefix
--    for per-team links.
--
-- 2. One club widget per kind is not enough: the girls' teams play in their
--    own league with its own club widget. `fulltime_club_fixtures_code` /
--    `fulltime_club_results_code` may now hold several codes (whitespace or
--    comma separated); `fulltime_club_codes()` returns one row per code and
--    `fulltime_prefetch()` follows suit automatically (it already fans out
--    over the returned rows).
--
-- Rollback: restore fulltime_club_codes from 20260824205000; delete the
-- fulltime_club_name row.
-- =============================================================================

create or replace function public.fulltime_club_codes()
  returns table (kind text, code text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select x.kind, c.code
  from (values ('fixtures', 'fulltime_club_fixtures_code'), ('results', 'fulltime_club_results_code')) as x (kind, key)
  join public.site_settings s on s.key = x.key
  cross join lateral (
    select trim(part) as code
    from regexp_split_to_table(s.value, '[^0-9]+') as part
  ) c
  where c.code ~ '^[0-9]{6,12}$';
$$;
revoke all privileges on function public.fulltime_club_codes() from public, anon, authenticated;
grant execute on function public.fulltime_club_codes() to service_role;

-- The club's name as Full-Time prints it before every team. Config, editable
-- in site_settings like any other setting; seeded so matching works at once.
insert into public.site_settings (key, value)
  values ('fulltime_club_name', 'Ashton On Mersey FC')
  on conflict (key) do nothing;

-- The import oversight channel: one in-app notification per import run to
-- every live club_admin, sent by the Edge Function via this RPC. Uses P3.6's
-- notify() (in_app outbound_messages).
create or replace function public.notify_club_admins(p_subject text, p_body text, p_link text default null)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'Only the importer may notify club admins' using errcode = '42501';
  end if;
  for r in select distinct person_id from public.person_roles where role = 'club_admin' and revoked_at is null loop
    perform public.notify(r.person_id, p_subject, p_body, p_link, 'fixture_import_runs', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all privileges on function public.notify_club_admins(text, text, text) from public, anon;
grant execute on function public.notify_club_admins(text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
