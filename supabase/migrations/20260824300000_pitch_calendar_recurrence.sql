-- =============================================================================
-- pitch_calendar() carries the series id
-- =============================================================================
-- The legacy pitch-booking app marked block bookings on its calendar (the 🔁
-- tile). To match it, the calendar needs to know a booking belongs to a
-- weekly series — `bookings.recurrence_group_id` already exists; the
-- SECURITY DEFINER view of it did not expose the column. Still no booker PII.
--
-- Return-type change requires drop + recreate; grants re-applied.
-- Rollback: recreate the function from 20260824120000_pitch_bookings.sql.
-- =============================================================================

drop function if exists public.pitch_calendar(timestamptz, timestamptz);

create function public.pitch_calendar(p_from timestamptz, p_to timestamptz)
  returns table (
    booking_id uuid, resource_id uuid, resource_name text, kind public.booking_kind,
    status public.booking_status, starts_at timestamptz, ends_at timestamptz,
    label text, team_id uuid, team_name text, fixture_id uuid, opponent text, is_home boolean,
    shared_team_ids uuid[], recurrence_group_id uuid
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select b.id, r.id, r.name, b.kind, b.status, b.starts_at, b.ends_at,
         case when b.kind = 'maintenance' then coalesce(b.occasion, 'Closed')
              when b.kind = 'fixture' then coalesce(t.name, '') || ' v ' || coalesce(f.opponent, '')
              else coalesce(b.occasion, t.name, b.kind::text) end,
         b.team_id, t.name, b.fixture_id, f.opponent, f.is_home,
         (select array_agg(bt.team_id) from public.booking_teams bt where bt.booking_id = b.id),
         b.recurrence_group_id
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  left join public.teams t on t.id = b.team_id
  left join public.fixtures f on f.id = b.fixture_id
  where r.type = 'pitch'
    and b.status in ('pending', 'confirmed')
    and b.ends_at > p_from and b.starts_at < p_to
    and (public.can_view_pitch_calendar() or public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  order by b.starts_at, r.sort_order, r.name;
$$;
comment on function public.pitch_calendar(timestamptz, timestamptz) is
  'Every live pitch booking in a window with no booker PII. For members, guardians and staff (can_view_pitch_calendar()).';
revoke all privileges on function public.pitch_calendar(timestamptz, timestamptz) from public, anon;
grant execute on function public.pitch_calendar(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
