-- =============================================================================
-- A coach's pitch booking is a REQUEST, never a confirmation
-- =============================================================================
-- Adam, 2026-08-25: "Coaches should not be able to book pitches as confirmed -
-- it should go to admin for approval."
--
-- WHAT WAS ALREADY TRUE (20260824120000_pitch_bookings, 20260824310000):
--   * `bookings_team_staff_insert` only accepts `status = 'pending'` from team
--     staff, so a coach posting `confirmed` was REFUSED — with the bare
--     "new row violates row-level security policy" 42501 and no explanation.
--   * `bookings_team_guard()` already refuses a coach's UPDATE to any status
--     other than `cancelled`, with a readable P0001.
--   * `book_event_pitch()` (the events path) already writes `pending` for
--     anyone who is not `is_club_admin()`.
--   * `allocate_fixture()`, `allocate_team_fixtures*()` and
--     `assign_event_pitch()` are club_admin-only, so the fixture and event
--     allocation paths were never a coach's to confirm.
--
-- WHAT THIS MIGRATION CHANGES:
--   1. `bookings_team_guard()` INSERT branch now COERCES a non-admin's pitch
--      booking to `pending` instead of leaving it to be refused. Refusing lost
--      the request; pinning it puts it on the administrator's desk, which is
--      what Adam asked for. The BEFORE trigger runs ahead of the policy's WITH
--      CHECK, so the coerced row then satisfies `bookings_team_staff_insert`
--      on its own terms — the policy is not weakened, it is simply no longer
--      the thing that has to say no. A client that posts `confirmed` cannot
--      get one, whatever screen or API call it came from (SAFEGUARDING.md §1.2:
--      a rule enforced only in a screen is not enforced).
--   2. The UPDATE branch keeps its refusal and names where the decision is
--      made, so the coach is told what to do next rather than only what they
--      may not do.
--   3. `pitch_request_notify()` — a new pending pitch request tells every live
--      club_admin through the EXISTING in-app channel (`public.notify()` ->
--      `outbound_messages`, channel `in_app`), the same mechanism
--      `bookings_notify()` uses to tell the coach when it is decided. No email:
--      Adam's standing rule. One notification per statement per team+pitch, so
--      a twenty-week repeat is one message, not twenty.
--
-- WHO "ADMIN" IS HERE: `has_any_role(array['staff','club_admin'])` — the same
-- set `bookings_staff_insert`/`bookings_staff_update` have always used, and the
-- set a committee sign-in lands in (`map_user_role_to_app_role`: committee and
-- super_user -> club_admin). Deliberately unchanged: narrowing it to club_admin
-- alone would take the pitch-closure and diary screens away from the staff who
-- run the function-room desk, which is not what was asked for.
--
-- DATA: none touched. No existing booking's status, times or resource change.
-- RLS: no policy added, dropped or altered.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n; data touched: none;
-- rollback: `create or replace function public.bookings_team_guard()` from
-- 20260824120000 (the INSERT branch without the coercion), then
-- `drop trigger if exists trg_pitch_request_notify on public.bookings;
--  drop function if exists public.pitch_request_notify();`
-- =============================================================================


-- 1. The guard: a coach's pitch booking lands pending -------------------------

create or replace function public.bookings_team_guard()
  returns trigger
  language plpgsql
  security invoker   -- deliberately: current_user must be the caller's role, see below
  set search_path = public
as $$
begin
  -- Only the coach path is constrained: a row written directly by an
  -- authenticated client that holds no staff/club_admin app role. Service
  -- paths, the owner, and SECURITY DEFINER functions (inside which current_user
  -- is the function owner, not 'authenticated') are governed by their own rules.
  if current_user <> 'authenticated'
     or auth.uid() is null
     or public.has_any_role(array['staff', 'club_admin']::public.app_role[]) then
    return new;
  end if;

  -- From here the actor is a coach acting through the team-staff policies.
  if tg_op = 'INSERT' then
    if new.ends_at <= new.starts_at or new.starts_at < now() - interval '1 day' then
      raise exception 'bookings: a coach may only request future slots' using errcode = 'P0001';
    end if;
    -- A pitch booking made by anyone who is not a club administrator is a
    -- REQUEST. Whatever the client posted, it lands on the requests desk.
    if public.is_pitch_resource(new.resource_id)
       and coalesce(new.status, 'pending'::public.booking_status) <> 'pending'::public.booking_status then
      new.status := 'pending'::public.booking_status;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'cancelled' then
    raise exception 'bookings: a cancelled booking cannot be changed' using errcode = 'P0001';
  end if;
  if new.status <> old.status and new.status <> 'cancelled' then
    raise exception 'bookings: only a club administrator can confirm a pitch booking — it is waiting on Pitch requests'
      using errcode = 'P0001';
  end if;
  if new.status = old.status and old.status <> 'pending' then
    raise exception 'bookings: a confirmed booking can only be cancelled — ask a club administrator to change it' using errcode = 'P0001';
  end if;
  if new.resource_id <> old.resource_id and not public.is_pitch_resource(new.resource_id) then
    raise exception 'bookings: coaches may only book pitches' using errcode = 'P0001';
  end if;
  if new.kind not in ('block', 'training') then
    raise exception 'bookings: coaches may only create block or training bookings' using errcode = 'P0001';
  end if;
  if new.fixture_id is distinct from old.fixture_id then
    raise exception 'bookings: fixture links are managed through allocate_fixture()' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all privileges on function public.bookings_team_guard() from public, anon, authenticated, service_role;

comment on function public.bookings_team_guard() is
  'What a non-admin may do to a pitch booking: request a future slot (pinned to pending, whatever was posted), edit it while it is pending, cancel it. Confirming is a club administrator''s alone.';

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE, per row) — it is
-- re-declared only so a fresh database gets it in one place.
drop trigger if exists trg_bookings_team_guard on public.bookings;
create trigger trg_bookings_team_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_team_guard();


-- 2. The request reaches the administrator's desk ------------------------------
-- Statement-level with a transition table, like `bookings_events_sync_insert`
-- and `events_notify`: a weekly repeat is one INSERT, so it is one message.
-- `entity` is 'pitch_requests', not 'bookings', so this arrival notice never
-- gets confused with `bookings_notify()`'s decision notice on the same row.

create or replace function public.pitch_request_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := public.current_person_id();
  v_group record;
  v_admin uuid;
  v_subject text;
  v_body text;
begin
  for v_group in
    select b.team_id,
           coalesce(t.name, 'A team')            as team_name,
           r.name                                as pitch_name,
           count(*)                              as n,
           min(b.starts_at)                      as first_starts_at,
           min(b.id::text)                       as any_id,
           coalesce(min(b.occasion), 'Pitch booking') as occasion
      from new_rows b
      join public.resources r on r.id = b.resource_id and r.type = 'pitch'
      left join public.teams t on t.id = b.team_id
     where b.status = 'pending'
       and b.team_id is not null
       and b.starts_at > now()
     group by b.team_id, t.name, r.name
  loop
    v_subject := 'Pitch request: ' || v_group.team_name;
    v_body :=
      case when v_group.n = 1
           then v_group.team_name || ' has asked for ' || v_group.pitch_name || ' on '
                || to_char(v_group.first_starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                || ' (' || v_group.occasion || '). Confirm or decline it on Pitch requests.'
           else v_group.team_name || ' has asked for ' || v_group.n || ' sessions on '
                || v_group.pitch_name || ', from '
                || to_char(v_group.first_starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                || ' (' || v_group.occasion || '). Confirm or decline them on Pitch requests.'
      end;

    for v_admin in
      select distinct pr.person_id
        from public.person_roles pr
       where pr.role = 'club_admin' and pr.revoked_at is null
    loop
      -- Nobody is told about their own request.
      if v_admin is distinct from v_actor then
        perform public.notify(v_admin, v_subject, v_body,
                              '/pitches/requests', 'pitch_requests', v_group.any_id);
      end if;
    end loop;
  end loop;
  return null;
end;
$$;
revoke all privileges on function public.pitch_request_notify() from public, anon, authenticated, service_role;

comment on function public.pitch_request_notify() is
  'A new pending pitch booking tells every live club_admin in-app (no email — Adam''s rule). One message per statement per team and pitch.';

drop trigger if exists trg_pitch_request_notify on public.bookings;
create trigger trg_pitch_request_notify
  after insert on public.bookings
  referencing new table as new_rows
  for each statement execute function public.pitch_request_notify();


-- 3. Audit the schema change itself -------------------------------------------
insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'bookings',
        jsonb_build_object('migration', '20260825170000_coach_pitch_approval',
                           'changes', array['bookings_team_guard pins a non-admin pitch booking to pending',
                                            'pitch_request_notify tells club_admins in-app']));

notify pgrst, 'reload schema';
