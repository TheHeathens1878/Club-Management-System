-- =============================================================================
-- The pitch calendar shows active pitches only
-- =============================================================================
-- Adam, 2026-08-25: "disused or inactive pitches shouldn't show. The 9v9
-- Right shows on Ashton on Mersey Sports Club." `pitch_calendar()` filtered
-- on r.type = 'pitch' but never on r.active — unlike `pitch_grid()` and
-- unlike the legacy app, which loaded active pitches only — so bookings on a
-- deactivated pitch kept flowing back and the data layer dutifully gave the
-- pitch a column. Both inactive pitches on prod carry only past bookings, so
-- nothing live disappears.
--
-- A future booking on a pitch that is later deactivated would now vanish
-- from the calendar too — deliberately: deactivating a pitch is the club
-- saying "this pitch is not in use", and the booking remains visible to
-- staff on /pitches/mine and to admins on /pitches/requests, which is where
-- it would be moved or cancelled.
--
-- Rollback: recreate from 20260824300000_pitch_calendar_recurrence.sql.
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
    and r.active
    and b.status in ('pending', 'confirmed')
    and b.ends_at > p_from and b.starts_at < p_to
    and (public.can_view_pitch_calendar() or public.has_any_role(array['staff', 'club_admin']::public.app_role[]))
  order by b.starts_at, r.sort_order, r.name;
$$;
comment on function public.pitch_calendar(timestamptz, timestamptz) is
  'Every live booking on the club''s ACTIVE pitches in a window, no booker PII. For members, guardians and staff (can_view_pitch_calendar()).';
revoke all privileges on function public.pitch_calendar(timestamptz, timestamptz) from public, anon;
grant execute on function public.pitch_calendar(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
