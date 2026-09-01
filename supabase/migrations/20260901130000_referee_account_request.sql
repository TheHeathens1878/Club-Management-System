-- =============================================================================
-- A referee can ask to be one
-- =============================================================================
-- Adam, 2026-09-01: "on the sign in page, the membership workflow should be
-- prominent and they should be able to register as a referee too."
--
-- The referee hat already exists everywhere it matters: `app_role` has
-- 'referee', `person_roles.referee` is what `hasRefereeRole` reads, and the
-- Referees group posts and claims games on the strength of it. The only thing
-- missing was the front door. `account_requests` — the queue a club
-- administrator decides on in /approvals — accepted coach, assistant_coach,
-- manager, player and parent, and nothing else, so a referee had no way to put
-- their hand up and an administrator had to grant the role from the person's
-- record without ever having been asked.
--
-- Two constraints and one function:
--
--   1. `requested_role` accepts 'referee'.
--   2. The team requirement lets it through without one. Refereeing is not a
--      team's job — a referee takes games from every team in the club, which is
--      why the Referees group is club-wide — so it belongs with 'parent' on the
--      no-team side of that check, not with the coaching roles.
--   3. `approve_account_request()` grants the role. The parent branch already
--      did exactly this for one hardcoded role; it now does it for whichever of
--      the two club-wide roles was asked for, which is the same code saying
--      what it means.
--
-- Approval remains a club administrator's, `is_club_admin()` still guards it,
-- and the audit row is written as before. Nothing here grants anybody
-- anything: it lets them ASK.
--
-- Rollback: restore the two CHECKs to their 20260824150000 definitions and the
-- function's parent branch to `if r.requested_role = 'parent'`. Any 'referee'
-- rows would have to be decided or deleted first, which is why this is written
-- down rather than left to be worked out.
-- =============================================================================

alter table public.account_requests
  drop constraint if exists account_requests_requested_role_check;
alter table public.account_requests
  add constraint account_requests_requested_role_check
  check (requested_role in ('coach', 'assistant_coach', 'manager', 'player', 'parent', 'referee'));

alter table public.account_requests
  drop constraint if exists account_requests_team_for_team_roles;
alter table public.account_requests
  add constraint account_requests_team_for_team_roles
  check (requested_role in ('parent', 'referee') or team_id is not null);

create or replace function public.approve_account_request(p_request_id uuid, p_note text default null)
  returns table (outcome text, detail text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r        public.account_requests%rowtype;
  v_season uuid;
  v_err    text;
begin
  if not public.is_club_admin() then
    raise exception 'account_requests: only a club administrator can approve' using errcode = '42501';
  end if;
  select * into r from public.account_requests where id = p_request_id for update;
  if not found then
    raise exception 'account_requests: no such request' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    return query select 'already_decided'::text, r.status::text;
    return;
  end if;

  -- The club-wide hats: no team, no season, no SG-6 certificate to check —
  -- just the role. Parent has always been here; referee joins it.
  if r.requested_role in ('parent', 'referee') then
    insert into public.person_roles (person_id, role, notes)
    select r.person_id, r.requested_role::public.app_role, 'account request ' || r.id
    where not exists (select 1 from public.person_roles pr
                       where pr.person_id = r.person_id
                         and pr.role = r.requested_role::public.app_role
                         and pr.revoked_at is null);
  else
    select id into v_season from public.seasons where is_current limit 1;
    if v_season is null then
      raise exception 'account_requests: no current season — set one on the Teams page first' using errcode = 'P0001';
    end if;
    begin
      insert into public.team_memberships (person_id, team_id, season_id, role, notes, created_by)
      select r.person_id, r.team_id, v_season, r.requested_role::public.team_role, 'account request ' || r.id, auth.uid()
      where not exists (select 1 from public.team_memberships m
                         where m.person_id = r.person_id and m.team_id = r.team_id
                           and m.season_id = v_season and m.left_at is null);
    exception when others then
      -- The SG-6 guard (missing DBS / safeguarding certificate on a team with
      -- minors) is the expected refusal. Keep the request pending and record why.
      get stacked diagnostics v_err = message_text;
      update public.account_requests
         set decision_note = left(v_err, 500)
       where id = r.id;
      return query select 'blocked'::text, v_err;
      return;
    end;
    if r.requested_role in ('coach', 'assistant_coach', 'manager') then
      insert into public.person_roles (person_id, role, notes)
      select r.person_id, 'coach', 'account request ' || r.id
      where not exists (select 1 from public.person_roles pr
                         where pr.person_id = r.person_id and pr.role = 'coach' and pr.revoked_at is null);
    end if;
  end if;

  update public.account_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = r.id;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'account_request.approve', 'account_requests', r.id::text,
          jsonb_build_object('person_id', r.person_id, 'role', r.requested_role, 'team_id', r.team_id));
  return query select 'approved'::text, null::text;
end
$$;
revoke all privileges on function public.approve_account_request(uuid, text) from public, anon;
grant execute on function public.approve_account_request(uuid, text) to authenticated, service_role;

comment on constraint account_requests_team_for_team_roles on public.account_requests is
  'Parent and referee are club-wide and carry no team; every coaching or playing role names one.';
