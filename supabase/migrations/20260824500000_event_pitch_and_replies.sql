-- =============================================================================
-- The event page assigns its pitch; replies demand only what Adam wants
-- (renumbered 480000 -> 500000: 480000 was never applied anywhere and 490000
-- reached prod first; 480000 is dead, never reuse)
-- =============================================================================
-- Three Adam rulings, 2026-08-25, all landing on the events surface:
--
--   1. "When in admin view, I should be able to click into an event and assign
--      a pitch." - `assign_event_pitch()`. A FIXTURE event routes through
--      `allocate_fixture()` - the P2.5 path, so `bookings_no_overlap` stays
--      the arbiter and a clash comes back named. An unbooked practice or
--      social books through `book_event_pitch()` and takes the link. An event
--      already holding a pitch refuses with the pitch's name - releasing one
--      is `cancel_team_event`'s or the allocator's job, not a side effect.
--   2. "For home matches, it should use the address from manage venues for the
--      google maps link, and include this address in the Event Details." -
--      `event_detail()` gains `venue_address` from `resources.address`
--      (20260824460000); the page shows it and feeds it to the maps search.
--   3. "Parents don't need to confirm availability for matches and training
--      but it would be helpful for social events." - the new-event
--      notification's call to action is now per-type: a social asks for the
--      accept/decline; a match or practice just tells you it is there. The
--      buttons remain everywhere (an answer is always welcome and the coach's
--      desk still counts them); what changes is what the club DEMANDS.
--
-- PR METADATA (PLAN.md Â§11): migrations y; RLS n (functions gate themselves);
-- data touched: none; rollback: end.
-- =============================================================================


-- 1. assign_event_pitch ------------------------------------------------------

create or replace function public.assign_event_pitch(
  p_event_id uuid,
  p_resource_id uuid,
  p_pre_buffer_minutes integer default null,
  p_post_buffer_minutes integer default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event   record;
  v_current text;
  v_booking uuid;
begin
  if not public.is_club_admin() then
    raise exception 'Only a club administrator can assign a pitch from the event.' using errcode = 'P0001';
  end if;
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'assign_event_pitch: no such event' using errcode = 'P0001';
  end if;
  if not public.is_bookable_pitch(p_resource_id) then
    raise exception 'That venue is not an active pitch.' using errcode = 'P0001';
  end if;

  if v_event.fixture_id is not null then
    -- The fixture path already owns conflicts, buffers, moves and the booking
    -- link; a reassign is the same call with a different pitch.
    perform public.allocate_fixture(v_event.fixture_id, p_resource_id, p_pre_buffer_minutes, p_post_buffer_minutes);
    return;
  end if;

  if v_event.booking_id is not null then
    select r.name into v_current
    from public.bookings b join public.resources r on r.id = b.resource_id
    where b.id = v_event.booking_id and b.status <> 'cancelled';
    if v_current is not null then
      raise exception 'This event already holds % - cancel the event''s booking first.', v_current using errcode = 'P0001';
    end if;
  end if;

  perform set_config('club.skip_booking_event', '1', true);
  v_booking := public.book_event_pitch(
    v_event.team_id, p_resource_id, v_event.starts_at,
    coalesce(v_event.ends_at, v_event.starts_at + interval '1 hour'), v_event.title);
  perform set_config('club.skip_booking_event', '', true);

  if v_booking is null then
    raise exception 'That pitch is already booked for % - nothing has been saved.',
      public.event_slot_label(v_event.starts_at, coalesce(v_event.ends_at, v_event.starts_at + interval '1 hour'))
      using errcode = 'P0001';
  end if;

  update public.events
     set booking_id = v_booking, venue_resource_id = p_resource_id
   where id = p_event_id;
end;
$$;

revoke all privileges on function public.assign_event_pitch(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.assign_event_pitch(uuid, uuid, integer, integer) to authenticated, service_role;


-- 2. event_detail carries the venue's address --------------------------------

create or replace function public.event_detail(p_event_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'team_id', e.team_id,
    'team_name', t.name,
    'type', e.type,
    'title', e.title,
    'status', e.status,
    'fixture_id', e.fixture_id,
    'booking_id', e.booking_id,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'meet_minutes_before', e.meet_minutes_before,
    'meet_at', case when e.meet_minutes_before is not null
                    then e.starts_at - make_interval(mins => e.meet_minutes_before) end,
    'venue', coalesce(r.name, e.venue_text),
    'venue_address', r.address,
    'venue_is_home', e.venue_resource_id is not null,
    'notes', e.notes,
    'created_at', e.created_at,
    'details_changed_at', e.details_changed_at,
    'change_note', e.change_note,
    'created_by_name', case
      when f.source = 'fulltime' then 'FA Full-Time import'
      else coalesce((select pp.first_name || ' ' || pp.last_name
                     from public.profiles pr join public.people pp on pp.id = pr.person_id
                     where pr.id = e.created_by), 'the club')
    end,
    'booking_status', coalesce(
      (select b.status::text from public.bookings b where b.id = e.booking_id),
      (select b.status::text from public.bookings b
        where b.fixture_id = e.fixture_id and e.fixture_id is not null
          and b.status <> 'cancelled' order by b.status limit 1),
      (select b.status::text from public.bookings b
        where e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
          and b.status = 'confirmed'
          and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
          and b.ends_at > e.starts_at
          and (b.team_id = e.team_id
               or exists (select 1 from public.booking_teams bt
                          where bt.booking_id = b.id and bt.team_id = e.team_id))
        limit 1)),
    'booked', coalesce(
      (select b.status = 'confirmed' from public.bookings b where b.id = e.booking_id),
      exists (select 1 from public.bookings b
               where e.fixture_id is not null and b.fixture_id = e.fixture_id and b.status = 'confirmed'),
      false)
      or exists (select 1 from public.bookings b
                  where e.booking_id is null and e.fixture_id is null
                    and e.venue_resource_id is not null and b.resource_id = e.venue_resource_id
                    and b.status = 'confirmed'
                    and b.starts_at < coalesce(e.ends_at, e.starts_at + interval '2 hours')
                    and b.ends_at > e.starts_at
                    and (b.team_id = e.team_id
                         or exists (select 1 from public.booking_teams bt
                                    where bt.booking_id = b.id and bt.team_id = e.team_id))),
    'series', case when s.id is not null then jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'weekday', trim(to_char(s.first_starts_at at time zone 'Europe/London', 'Day')),
      'time', to_char(s.first_starts_at at time zone 'Europe/London', 'HH24:MI'),
      'repeat_until', s.repeat_until,
      'occurrences', (select count(*) from public.events se where se.series_id = s.id)
    ) end)
  from public.events e
  join public.teams t on t.id = e.team_id
  left join public.resources r on r.id = e.venue_resource_id
  left join public.fixtures f on f.id = e.fixture_id
  left join public.event_series s on s.id = e.series_id
  where e.id = p_event_id;
$$;


-- 3. The call to action follows the type --------------------------------------

create or replace function public.events_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := public.current_person_id();
  v_team record;
  v_event record;
  v_person uuid;
  v_creator uuid;
  v_creators uuid[];
begin
  for v_team in
    select e.team_id, t.name, count(*) as n
    from new_rows e
    join public.teams t on t.id = e.team_id
    where e.status = 'scheduled' and e.starts_at > now()
    group by e.team_id, t.name
  loop
    if v_team.n > 3 then
      select array_agg(distinct pr.person_id) into v_creators
        from new_rows e join public.profiles pr on pr.id = e.created_by
       where e.team_id = v_team.team_id and e.status = 'scheduled' and e.starts_at > now();
      for v_person in
        select distinct coalesce(g.guardian_person_id, m.person_id)
        from public.team_memberships m
        left join public.guardianships g
          on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
        where m.team_id = v_team.team_id and m.left_at is null
      loop
        if v_person is distinct from v_actor
           and not (coalesce(array_length(v_creators, 1), 0) = 1 and v_person = v_creators[1]) then
          perform public.notify(
            v_person,
            'New events: ' || v_team.name,
            v_team.n || ' new events have been added for ' || v_team.name
              || '. The diary is in the app.',
            '/events', 'events', v_team.team_id::text);
        end if;
      end loop;
    else
      for v_event in
        select e.* from new_rows e
        where e.team_id = v_team.team_id and e.status = 'scheduled' and e.starts_at > now()
      loop
        select pr.person_id into v_creator from public.profiles pr where pr.id = v_event.created_by;
        for v_person in
          select distinct coalesce(g.guardian_person_id, m.person_id)
          from public.team_memberships m
          left join public.guardianships g
            on g.child_person_id = m.person_id and g.ended_at is null and public.is_minor(m.person_id)
          where m.team_id = v_team.team_id and m.left_at is null
        loop
          if v_person is distinct from v_actor and v_person is distinct from v_creator then
            perform public.notify(
              v_person,
              'New event: ' || v_event.title,
              v_team.name || ' - ' || replace(v_event.type::text, '_', ' ') || ' on '
                || to_char(v_event.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                -- Adam: replies are asked for on socials; matches and training
                -- just tell you they exist. The buttons stay for anyone who
                -- wants to answer anyway.
                || case when v_event.type = 'social'
                        then '. Please accept or decline in the app.'
                        else '. Details in the app.' end,
              '/events/' || v_event.id, 'events', v_event.id::text);
          end if;
        end loop;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;
revoke all privileges on function public.events_notify() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function assign_event_pitch; restore event_detail from 20260824420000's
-- meet-time version and events_notify from 20260824310000. Nothing structural.
