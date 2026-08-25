-- =============================================================================
-- Editing an event — the coach who created it, and the club
-- =============================================================================
-- Adam, 2026-08-25: "I also need the ability to edit events (as a coach and
-- admin)."
--
-- Creating an event has had one door since 20260824310000 (`create_team_event`)
-- and cancelling one has had another (`cancel_team_event`); between them there
-- was nothing, so a practice with the wrong start time could only be cancelled
-- and re-made — losing every accept and decline already given. This is the
-- missing door, and it carries the same guard as the other two.
--
-- WHAT IT WILL NOT DO
--   * A FIXTURE-mirrored event stays un-editable by hand. The fixture is the
--     master record: the sync triggers own its kickoff, venue, title and
--     cancellation, and an edit here would simply be overwritten by the next
--     Full-Time import. The refusal says so and names the fixture as the place
--     to go.
--   * A CANCELLED event cannot be edited — reinstating one is a different act
--     with a different message to send, and it is not this function's.
--   * A PAST event cannot be edited. The answers people gave were given against
--     what actually happened; rewriting it afterwards changes the record of an
--     occasion, not the plan for one.
--
-- THE PITCH MOVES WITH THE EVENT
--   When the event holds a booking, moving the event moves the BOOKING and
--   lets the existing bookings→events sync carry the change back, so the pitch
--   diary and the event can never disagree. A clash refuses by slot and nothing
--   is saved. Letting go of the pitch altogether stays a deliberate act
--   (cancel the event, or the diary) rather than a side effect of an edit —
--   `assign_event_pitch` takes the same line.
--
-- THE HOUSEHOLDS ARE TOLD
--   A new time or a new venue is exactly what 20260824350000 already calls "the
--   details have changed": the flag, the sentence, and one batched in-app
--   message per household, with the answers left standing. This reuses that
--   machinery rather than inventing a second notion of a changed event. A new
--   title, note or meet time is not a change of details and sends nothing.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table or policy change —
-- the function gates itself with the same test `create_team_event` uses);
-- data touched: none; rollback: end.
-- =============================================================================

create or replace function public.update_team_event(
  p_event_id            uuid,
  p_type                text,
  p_title               text,
  p_starts_at           timestamptz,
  p_duration_minutes    integer,
  p_venue_resource_id   uuid    default null,
  p_venue_text          text    default null,
  p_notes               text    default null,
  p_meet_minutes_before integer default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event    record;
  v_booking  record;
  v_ends_at  timestamptz;
  v_title    text := btrim(coalesce(p_title, ''));
  v_venue    text := nullif(btrim(coalesce(p_venue_text, '')), '');
  v_note     text;
  v_moved    boolean := false;
  v_notified boolean := false;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'update_team_event: no such event' using errcode = 'P0001';
  end if;
  if not (public.is_club_admin() or public.is_team_staff(v_event.team_id)) then
    raise exception 'update_team_event: only the team''s staff or a club admin may edit events'
      using errcode = 'P0001';
  end if;
  if v_event.fixture_id is not null then
    raise exception 'This event mirrors a fixture — edit the fixture instead.' using errcode = 'P0001';
  end if;
  if v_event.status <> 'scheduled' then
    raise exception 'This event has been cancelled, so it cannot be edited.' using errcode = 'P0001';
  end if;
  if v_event.starts_at < now() then
    raise exception 'This event has already started, so it cannot be edited.' using errcode = 'P0001';
  end if;

  if p_type is null or p_type not in ('league_match', 'cup_match', 'friendly', 'practice', 'social') then
    raise exception 'update_team_event: unknown event type' using errcode = 'P0001';
  end if;
  if v_title = '' then
    raise exception 'update_team_event: the event needs a name' using errcode = 'P0001';
  end if;
  if p_starts_at is null then
    raise exception 'update_team_event: the event needs a date and time' using errcode = 'P0001';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'update_team_event: the length must be between 15 minutes and 8 hours' using errcode = 'P0001';
  end if;
  if p_meet_minutes_before is not null
     and (p_meet_minutes_before < 0 or p_meet_minutes_before > 240) then
    raise exception 'update_team_event: the meet time must be within four hours of the start' using errcode = 'P0001';
  end if;
  if p_starts_at < now() then
    raise exception 'update_team_event: an event cannot be moved into the past' using errcode = 'P0001';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);

  -- What changed, in the words 20260824350000 already uses, computed BEFORE
  -- anything moves.
  if p_starts_at is distinct from v_event.starts_at
     or p_venue_resource_id is distinct from v_event.venue_resource_id
     or v_venue is distinct from v_event.venue_text then
    v_note := public.event_change_note(
      v_event.starts_at, p_starts_at,
      public.venue_label(v_event.venue_resource_id, v_event.venue_text),
      public.venue_label(p_venue_resource_id, v_venue));
  end if;

  -- The pitch, when this event is holding one.
  select b.id, b.resource_id, b.starts_at, b.ends_at, r.name as resource_name into v_booking
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  where b.id = v_event.booking_id and b.status <> 'cancelled';

  if v_booking.id is not null then
    if p_venue_resource_id is null then
      raise exception
        'This event is holding %. Keep it as the venue, or cancel the event to give the pitch back.',
        v_booking.resource_name using errcode = 'P0001';
    end if;
    v_moved := p_venue_resource_id is distinct from v_booking.resource_id
               or p_starts_at is distinct from v_booking.starts_at
               or v_ends_at   is distinct from v_booking.ends_at;
    if v_moved or v_title is distinct from v_event.title then
      if not public.is_bookable_pitch(p_venue_resource_id) then
        raise exception 'That venue is not an active pitch.' using errcode = 'P0001';
      end if;
      if public.booking_has_conflict(p_venue_resource_id, p_starts_at, v_ends_at, 0, 0, v_booking.id) then
        raise exception 'That pitch is already booked for % — nothing has been saved.',
          public.event_slot_label(p_starts_at, v_ends_at) using errcode = 'P0001';
      end if;
      -- The bookings→events sync carries the new slot back onto this event and
      -- raises the changed-details flag; the statement trigger beside it tells
      -- the households. Both run before the update below, which is why that
      -- update is written to end at the same place either way.
      update public.bookings
         set resource_id = p_venue_resource_id,
             starts_at   = p_starts_at,
             ends_at     = v_ends_at,
             occasion    = v_title
       where id = v_booking.id;
      -- Only a MOVED booking reaches trg_bookings_changed_notify; a renamed
      -- one does not, so the message is not counted as sent.
      v_notified := v_moved and v_note is not null;
    end if;
  end if;

  update public.events
     set type                = p_type::public.event_type,
         title               = v_title,
         starts_at           = p_starts_at,
         ends_at             = v_ends_at,
         venue_resource_id   = p_venue_resource_id,
         venue_text          = v_venue,
         notes               = nullif(btrim(coalesce(p_notes, '')), ''),
         meet_minutes_before = p_meet_minutes_before,
         details_changed_at  = case when v_note is not null then now() else details_changed_at end,
         change_note         = case when v_note is not null then v_note else change_note end
   where id = p_event_id;

  if v_note is not null and not v_notified then
    perform public.notify_events_changed(v_event.team_id, array[p_event_id]);
  end if;
end;
$$;

comment on function public.update_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, integer) is
  'Edit a manually created event (team staff or club_admin). Refuses fixture-mirrored, cancelled and past events; moves the pitch booking with the event; a new time or venue raises the changed-details flag and tells the households.';

revoke all privileges on function
  public.update_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, integer)
  from public, anon;
grant execute on function
  public.update_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function public.update_team_event(uuid, text, text, timestamptz, integer, uuid, text, text, integer);
-- Nothing structural; events created or edited through it keep their rows.
