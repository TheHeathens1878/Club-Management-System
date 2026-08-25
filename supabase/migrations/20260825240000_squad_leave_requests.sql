-- =============================================================================
-- "This player has left" is a REQUEST; ending a membership stays admin-only
-- =============================================================================
-- Adam, 2026-08-25: "Parents and coaches should not be able to click on End to
-- remove a squad member (in Squad in team page). Coaches should be able to
-- click 'This player has left' and it will go to approval for admin."
--
-- WHAT WAS ALREADY TRUE (20260823120000_teams_seasons) — checked, not assumed:
--   * `team_memberships_admin_update` is the ONLY update policy on the table:
--     `using (public.is_club_admin()) with check (public.is_club_admin())`.
--     There is no staff, self or guardian UPDATE policy. So a coach or a parent
--     setting `left_at` through the caller's own client already got nothing —
--     an UPDATE that matches no policy row simply affects zero rows.
--   * `team_memberships_admin_insert` / `_delete` are club_admin likewise.
--   * The Squad tab is drawn only for `canManageTeam` (committee or team
--     staff), and `MembersPanel` is handed `canEdit={clubAdmin}`, so the End
--     button was already club_admin-only in the screen as well.
--   * A parent is not `is_team_staff()` (that predicate wants a live
--     child-facing membership on the team), so a parent reaches neither.
--
-- SO NO POLICY IS WEAKENED OR TIGHTENED ON team_memberships HERE. The database
-- already refused a coach or a parent ending a membership, and it still does.
-- Adam's first sentence describes a screen he expected to be able to press;
-- the answer to it is the second sentence, which is what this migration builds.
--
-- HOW THAT REFUSAL ACTUALLY READS, precisely: `team_memberships_admin_update`
-- is an UPDATE policy, and Postgres applies an UPDATE policy's USING clause as
-- a row filter during the scan. A coach's `update ... set left_at = now()`
-- therefore matches NO ROWS and raises NOTHING — it is a silent no-op, not an
-- error. That is a real refusal (the data is untouched) but a poor one to build
-- a screen on, so the fix is in two places: `endMembership` now checks the
-- returned rows and says who to ask, and `leave_requests_guard()` (note 4)
-- stands behind it should a future migration ever give a non-admin an UPDATE
-- policy on this table. The guard is defence in depth against a policy that
-- does not exist yet; it is NOT what stops a coach today.
--
-- WHAT THIS MIGRATION ADDS:
--   1. `team_membership_leave_requests` — a coach's "this player has left",
--      waiting for a club administrator. RLS written with the table (§2.2):
--      insert by that team's staff or a club_admin; read by the requester, the
--      team's staff and club_admin/safeguarding_lead. NO update or delete
--      policy at all — exactly the arrangement `account_requests` uses, so a
--      decision can only be made through the RPC.
--   2. `leave_request_fill()` — a BEFORE INSERT trigger that derives
--      `person_id` / `team_id` from the membership and stamps the requester,
--      so a client cannot file a request against one team while naming
--      another. It runs AHEAD of the policy's WITH CHECK, so the policy then
--      judges the derived `team_id` rather than the posted one.
--   3. `decide_leave_request(uuid, boolean, text)` — SECURITY DEFINER,
--      club_admin only (42501). On approval it ends the membership with the
--      SAME statement the admin path uses (`set left_at = now() ... and
--      left_at is null`), so `trg_team_memberships_sg6_guard` still runs and a
--      refusal is returned as `blocked` with the guard's own sentence, the way
--      `approve_account_request()` handles it. Audited either way.
--   4. `leave_requests_guard()` — a BEFORE UPDATE trigger on
--      `team_memberships` that turns a non-admin's attempt to set `left_at`
--      from a silent no-op into a readable P0001 naming the button to press.
--      Belt and braces on top of the policy (SAFEGUARDING.md §1.2: a rule
--      enforced only in a screen is not enforced).
--   5. `leave_request_notify()` — a new request tells every live club_admin
--      in-app through `public.notify()`, an AFTER INSERT STATEMENT trigger with
--      a transition table, exactly as `pitch_request_notify()` does. NO EMAIL
--      (Adam's standing rule). The actor is never told about their own
--      request. `decide_leave_request()` notifies the requester in turn.
--
-- WHO "ADMIN" IS HERE: `public.is_club_admin()` — narrower than the pitch
-- desk's `has_any_role(array['staff','club_admin'])` on purpose, because this
-- is the same authority that `team_memberships_admin_update` already requires.
-- Anyone who could not have ended the membership directly cannot end it by
-- approving a request either.
--
-- DATA: none touched. No membership's `left_at` changes; no existing row of any
-- kind is written.
-- RLS: yes — new policies, on the new table only.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (new table only, none altered
-- on any existing table); data touched: none;
-- rollback:
--   drop trigger if exists trg_leave_requests_guard on public.team_memberships;
--   drop function if exists public.leave_requests_guard();
--   drop trigger if exists trg_leave_request_notify on public.team_membership_leave_requests;
--   drop function if exists public.leave_request_notify();
--   drop function if exists public.decide_leave_request(uuid, boolean, text);
--   drop trigger if exists trg_leave_request_fill on public.team_membership_leave_requests;
--   drop function if exists public.leave_request_fill();
--   drop table if exists public.team_membership_leave_requests;
-- =============================================================================


-- 1. The table ----------------------------------------------------------------

create table if not exists public.team_membership_leave_requests (
  id                      uuid primary key default gen_random_uuid(),
  team_membership_id      uuid not null references public.team_memberships (id) on delete cascade,
  -- Denormalised from the membership by `leave_request_fill()`, never trusted
  -- from the client: `team_id` is what the RLS policies below are written
  -- against, so it has to be the membership's own team.
  person_id               uuid not null references public.people (id) on delete cascade,
  team_id                 uuid not null references public.teams (id) on delete cascade,
  requested_by_person_id  uuid references public.people (id) on delete set null,
  note                    text,
  status                  text not null default 'pending'
                            check (status in ('pending', 'approved', 'rejected')),
  decided_by              uuid references auth.users (id) on delete set null,
  decided_at              timestamptz,
  decision_note           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.team_membership_leave_requests is
  'A coach''s "this player has left", waiting for a club administrator. Ending the membership itself stays club_admin-only; this is how everyone else asks.';

-- One open request per membership. A second "this player has left" while the
-- first is still on the desk is the same request, not a new one.
create unique index if not exists team_membership_leave_requests_one_pending
  on public.team_membership_leave_requests (team_membership_id)
  where status = 'pending';

create index if not exists team_membership_leave_requests_team_status_idx
  on public.team_membership_leave_requests (team_id, status);
create index if not exists team_membership_leave_requests_pending_idx
  on public.team_membership_leave_requests (created_at)
  where status = 'pending';

drop trigger if exists trg_team_membership_leave_requests_updated_at
  on public.team_membership_leave_requests;
create trigger trg_team_membership_leave_requests_updated_at
  before update on public.team_membership_leave_requests
  for each row execute function public.set_updated_at();


-- 2. RLS, written with the table (§2.2) ---------------------------------------

alter table public.team_membership_leave_requests enable row level security;

-- Read: the person who asked, the team's own child-facing staff, and the club.
create policy "team_membership_leave_requests_requester_read"
  on public.team_membership_leave_requests for select to authenticated
  using (requested_by_person_id = public.current_person_id());

create policy "team_membership_leave_requests_staff_read"
  on public.team_membership_leave_requests for select to authenticated
  using (public.is_team_staff(team_id));

create policy "team_membership_leave_requests_admin_read"
  on public.team_membership_leave_requests for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- Write: this team's staff ask; a club_admin may also file one (they would
-- normally just press End, but the queue should be able to hold their note).
-- `team_id` here is the value the BEFORE trigger derived from the membership.
create policy "team_membership_leave_requests_staff_insert"
  on public.team_membership_leave_requests for insert to authenticated
  with check (public.is_team_staff(team_id) or public.is_club_admin());

-- NO update policy and NO delete policy, deliberately. A decision is
-- `decide_leave_request()` and nothing else; a request is history once made.

-- Privileges. A policy grants nothing on its own — it only narrows what a
-- privilege already allows — so these are what let `authenticated` reach the
-- table at all. UPDATE and DELETE are withheld from `authenticated` on purpose:
-- that is a second lock on the same door as the missing policies, and it fails
-- closed if a policy is ever added without thinking it through.
-- `decide_leave_request()` needs none of this: it is SECURITY DEFINER and runs
-- as the owner.
grant select, insert         on public.team_membership_leave_requests to authenticated;
grant select, insert, update on public.team_membership_leave_requests to service_role;


-- 3. The request is derived, not declared -------------------------------------

create or replace function public.leave_request_fill()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare m public.team_memberships%rowtype;
begin
  select * into m from public.team_memberships where id = new.team_membership_id;
  if not found then
    raise exception 'team_membership_leave_requests: no such membership' using errcode = 'P0002';
  end if;
  if m.left_at is not null then
    raise exception 'team_membership_leave_requests: that membership has already ended' using errcode = 'P0001';
  end if;

  -- Whatever the client posted, the request is about THIS membership's person
  -- and THIS membership's team. The insert policy is judged on these values.
  new.person_id := m.person_id;
  new.team_id   := m.team_id;
  new.requested_by_person_id := coalesce(public.current_person_id(), new.requested_by_person_id);

  -- A request arrives pending. A client cannot post its own approval.
  new.status        := 'pending';
  new.decided_by    := null;
  new.decided_at    := null;
  new.decision_note := null;
  new.note          := nullif(btrim(new.note), '');
  return new;
end
$$;
revoke all privileges on function public.leave_request_fill() from public, anon, authenticated, service_role;

comment on function public.leave_request_fill() is
  'A leave request''s person, team and requester come from the membership, never from the client — so the insert policy judges the real team.';

drop trigger if exists trg_leave_request_fill on public.team_membership_leave_requests;
create trigger trg_leave_request_fill
  before insert on public.team_membership_leave_requests
  for each row execute function public.leave_request_fill();


-- 4. The desk is told ----------------------------------------------------------
-- Statement-level with a transition table, exactly like `pitch_request_notify()`
-- in 20260825170000: one message per statement per team, in-app only, and
-- nobody hears about their own request.

create or replace function public.leave_request_notify()
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
    select r.team_id,
           coalesce(t.name, 'a team') as team_name,
           count(*)                   as n,
           min(r.id::text)            as any_id,
           min(coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name) as who
      from new_rows r
      left join public.teams t  on t.id = r.team_id
      left join public.people p on p.id = r.person_id
     where r.status = 'pending'
     group by r.team_id, t.name
  loop
    v_subject := 'Squad change: ' || v_group.team_name;
    v_body :=
      case when v_group.n = 1
           then v_group.who || ' has been reported as having left ' || v_group.team_name
                || '. Approve it on Approvals and the membership ends; reject it and nothing changes.'
           else v_group.n || ' players have been reported as having left ' || v_group.team_name
                || '. Approve them on Approvals and the memberships end.'
      end;

    for v_admin in
      select distinct pr.person_id
        from public.person_roles pr
       where pr.role = 'club_admin' and pr.revoked_at is null
    loop
      -- Nobody is told about their own request.
      if v_admin is distinct from v_actor then
        perform public.notify(v_admin, v_subject, v_body,
                              '/approvals', 'leave_requests', v_group.any_id);
      end if;
    end loop;
  end loop;
  return null;
end
$$;
revoke all privileges on function public.leave_request_notify() from public, anon, authenticated, service_role;

comment on function public.leave_request_notify() is
  'A new leave request tells every live club_admin in-app (no email — Adam''s rule). One message per statement per team.';

drop trigger if exists trg_leave_request_notify on public.team_membership_leave_requests;
create trigger trg_leave_request_notify
  after insert on public.team_membership_leave_requests
  referencing new table as new_rows
  for each statement execute function public.leave_request_notify();


-- 5. The decision --------------------------------------------------------------

create or replace function public.decide_leave_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
  returns table (outcome text, detail text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r       public.team_membership_leave_requests%rowtype;
  v_team  text;
  v_who   text;
  v_err   text;
  v_note  text := nullif(btrim(p_note), '');
begin
  -- The same authority `team_memberships_admin_update` already requires:
  -- approving this ends a membership, so it may not be a softer test.
  if not public.is_club_admin() then
    raise exception 'team_membership_leave_requests: only a club administrator can decide a leave request'
      using errcode = '42501';
  end if;

  select * into r from public.team_membership_leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'team_membership_leave_requests: no such request' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    return query select 'already_decided'::text, r.status::text;
    return;
  end if;

  select name into v_team from public.teams where id = r.team_id;
  select coalesce(nullif(btrim(preferred_name), ''), first_name) || ' ' || last_name
    into v_who from public.people where id = r.person_id;

  if p_approve then
    -- The admin path, verbatim: a soft end, never a delete, and only if the
    -- membership is still live. The SG-6 BEFORE trigger runs on this UPDATE.
    begin
      update public.team_memberships
         set left_at = now()
       where id = r.team_membership_id
         and left_at is null;
    exception when others then
      -- A guard refused. The request stays pending and says why, exactly as
      -- `approve_account_request()` does with the same class of refusal.
      get stacked diagnostics v_err = message_text;
      update public.team_membership_leave_requests
         set decision_note = left(v_err, 500)
       where id = r.id;
      return query select 'blocked'::text, v_err;
      return;
    end;
  end if;

  update public.team_membership_leave_requests
     set status        = case when p_approve then 'approved' else 'rejected' end,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = v_note
   where id = r.id;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          case when p_approve then 'team_membership_leave_request.approve'
               else 'team_membership_leave_request.reject' end,
          'team_membership_leave_requests', r.id::text,
          jsonb_build_object('person_id', r.person_id,
                             'team_id', r.team_id,
                             'team_membership_id', r.team_membership_id,
                             'requested_by', r.requested_by_person_id));

  -- The coach who asked hears the answer. In-app only, like everything else here.
  if r.requested_by_person_id is not null
     and r.requested_by_person_id is distinct from public.current_person_id() then
    perform public.notify(
      r.requested_by_person_id,
      case when p_approve then 'Squad change approved' else 'Squad change not approved' end,
      case when p_approve
           then coalesce(v_who, 'That player') || ' has been removed from '
                || coalesce(v_team, 'the team') || '.'
           else coalesce(v_who, 'That player') || ' is still in '
                || coalesce(v_team, 'the team') || '.'
      end || coalesce(' ' || v_note, ''),
      '/teams/' || r.team_id || '?tab=squad',
      'leave_requests', r.id::text);
  end if;

  return query select (case when p_approve then 'approved' else 'rejected' end)::text, null::text;
end
$$;
revoke all privileges on function public.decide_leave_request(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave_request(uuid, boolean, text) to authenticated, service_role;

comment on function public.decide_leave_request(uuid, boolean, text) is
  'Approve or reject a squad leave request. club_admin only (42501). Approving ends the membership through the ordinary admin UPDATE, so SG-6 still runs; the outcome is approved / rejected / already_decided / blocked.';


-- 6. A non-admin ending a membership is told where to go -----------------------
-- The policy already refused this — silently, because an UPDATE matching no
-- policy row affects nothing and the screen said "Membership ended." This turns
-- that into a sentence. It changes no permission: everyone who could end a
-- membership before still can.

create or replace function public.leave_requests_guard()
  returns trigger
  language plpgsql
  security invoker   -- current_user must be the caller's role, as bookings_team_guard
  set search_path = public
as $$
begin
  if current_user <> 'authenticated'
     or auth.uid() is null
     or public.is_club_admin() then
    return new;
  end if;
  if new.left_at is distinct from old.left_at and new.left_at is not null then
    raise exception 'team_memberships: only a club administrator can end a membership — use "This player has left" and it goes to Approvals'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all privileges on function public.leave_requests_guard() from public, anon, authenticated, service_role;

comment on function public.leave_requests_guard() is
  'A coach or parent setting left_at is refused in words rather than silently. The club_admin-only policy is what actually decides; this only explains it.';

drop trigger if exists trg_leave_requests_guard on public.team_memberships;
create trigger trg_leave_requests_guard
  before update of left_at on public.team_memberships
  for each row execute function public.leave_requests_guard();


-- 7. Audit the schema change itself -------------------------------------------

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'team_membership_leave_requests',
        jsonb_build_object('migration', '20260825240000_squad_leave_requests',
                           'changes', array['team_membership_leave_requests table + RLS',
                                            'leave_request_fill derives person/team/requester',
                                            'leave_request_notify tells club_admins in-app',
                                            'decide_leave_request (club_admin only) ends the membership',
                                            'leave_requests_guard explains the existing admin-only refusal']));

notify pgrst, 'reload schema';
