-- =============================================================================
-- A parent can put their child's hand up
-- =============================================================================
-- Adam, 2026-09-01: the joining workflow becomes four steps — your profile,
-- your children, your connected adults, then the registrations — and the
-- player / coach / referee ticks appear on all three kinds of person, not just
-- on the one filling the form in.
--
-- The hats themselves already have a queue. `account_requests` is what
-- /approvals decides on, `approve_account_request()` grants the role, and
-- 20260901130000 taught it 'referee'. What it has never had is a way for
-- SOMEBODY ELSE to ask:
--
--   `account_requests_self_insert` is `person_id = current_person_id()`, and a
--   nine-year-old and a login-less connected adult have no current_person_id()
--   of their own. So the tick beside a child's name had nowhere to go.
--
-- Rather than widen that policy — "anybody in your household" is not a
-- sentence a WITH CHECK expression says well, and a policy that admits a row
-- says nothing about who the row is FOR — this adds one entry point:
--
--   request_role_for(person, role, team) — SECURITY DEFINER, and the standing
--   it demands is the club's existing answer to "is this person yours":
--   `can_act_for()` (you, or a minor you are the active guardian of) or
--   `is_household_member_of()` (an adult with no login that this account
--   created). Both were written for exactly this question and both are used
--   unchanged.
--
-- WHAT IT DOES NOT DO. It does not grant anything. Every request lands
-- `pending` and a club administrator still decides it in /approvals — which is
-- the whole point of the tick being a request rather than a checkbox on a
-- role. The referee age guard (20260901160000) fires on the insert exactly as
-- it does for a self-request, so a parent ticking "referee" beside a
-- twelve-year-old is told the date they may ask on, in the database's own
-- words, and no row is written.
--
-- THE READ SIDE. Having asked, the asker should be able to see that they
-- asked. `account_requests_self_read` shows you your own; this adds the
-- household's, on the same standing the write uses. It is a widening, and it
-- is a narrow one: role, team and status for people this account already
-- administers everywhere else in the app.
--
-- A COACH WITHOUT A TEAM. `account_requests_team_for_team_roles` has required
-- a team for every coaching role since 20260824150000, which is right when a
-- coach is asking to join a named squad. It is wrong on the joining form,
-- where "I coach" is often said by somebody who does not yet know which team
-- the club will put them with — and refusing the tick loses the volunteer. So
-- 'coach' joins 'parent' and 'referee' on the no-team side, and approving a
-- team-less coach request grants the club-wide coach hat and nothing else: no
-- team membership is invented, and the administrator puts them on a team from
-- the team page when there is one. 'assistant_coach' and 'manager' still
-- require a team — they are said about a squad, never in the abstract.
--
-- SG-6 is untouched. It lives on `team_memberships`, which is precisely what a
-- team-less approval does not write.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y — one new SELECT policy on
-- public.account_requests (household read, §3) and no policy dropped or
-- widened for INSERT; the new write path is a SECURITY DEFINER function with
-- EXECUTE revoked from anon. Data touched: none — no request is created, no
-- role granted. Rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. A coaching hat can be asked for without a team
-- =============================================================================

alter table public.account_requests
  drop constraint if exists account_requests_team_for_team_roles;
alter table public.account_requests
  add constraint account_requests_team_for_team_roles
  check (requested_role in ('parent', 'referee', 'coach') or team_id is not null);

comment on constraint account_requests_team_for_team_roles on public.account_requests is
  'A request about a squad names the squad. Parent and referee are club-wide, and so is "I coach" said on the joining form before anybody has been placed — approve_account_request() grants the hat alone in that case.';


-- =============================================================================
-- 2. request_role_for()
-- =============================================================================
-- Idempotent by design. The joining wizard is a form somebody may submit
-- twice, and the unique index `account_requests_one_open_idx` would turn the
-- second press into a constraint violation with nothing useful to say. An
-- existing pending request for the same person, role and team IS the answer,
-- so it is returned.
--
-- A role already held is not an error either: it returns null, meaning
-- "nothing to ask for". The tick beside a person who is already a referee is
-- a statement of fact, not a request.

create or replace function public.request_role_for(
  p_person_id uuid,
  p_role      text,
  p_team_id   uuid default null,
  p_message   text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_existing uuid;
  v_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'request_role_for: sign in first' using errcode = '42501';
  end if;
  if p_person_id is null then
    raise exception 'request_role_for: no person named' using errcode = 'P0001';
  end if;

  -- The standing, in the club's own words. can_act_for() is you or a minor you
  -- are the active guardian of; is_household_member_of() is a login-less adult
  -- this account created and holds. Anybody else is not yours to speak for.
  if not (public.can_act_for(p_person_id) or public.is_household_member_of(p_person_id)) then
    raise exception 'request_role_for: % is not somebody you can ask on behalf of', p_person_id
      using errcode = '42501';
  end if;

  -- Already held: nothing to ask. Only the club-wide hats can be "already
  -- held" in this sense — 'player', 'assistant_coach' and 'manager' are
  -- team_role values with no app_role of the same name, and a coach who holds
  -- the hat may still ask to be put on a named squad, so a request that names
  -- a team is never short-circuited.
  if p_team_id is null
     and p_role in ('coach', 'parent', 'referee')
     and public.person_has_role(p_person_id, p_role::public.app_role)
  then
    return null;
  end if;

  select r.id into v_existing
    from public.account_requests r
   where r.person_id = p_person_id
     and r.requested_role = p_role
     and coalesce(r.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and r.status = 'pending';
  if v_existing is not null then
    return v_existing;
  end if;

  -- The CHECKs on the table say which roles exist and which need a team, and
  -- the referee age guard says who may be one. All three speak for themselves.
  insert into public.account_requests (person_id, requested_role, team_id, message)
  values (p_person_id, p_role, p_team_id, nullif(btrim(p_message), ''))
  returning id into v_id;

  return v_id;
end $$;

comment on function public.request_role_for(uuid, text, uuid, text) is
  'Ask for a role on behalf of yourself, a child you are guardian of, or a login-less adult in your household. Always lands pending; a club administrator decides it in /approvals. Idempotent: an open request for the same person, role and team is returned rather than duplicated.';

revoke all privileges on function public.request_role_for(uuid, text, uuid, text) from public, anon;
grant execute on function public.request_role_for(uuid, text, uuid, text) to authenticated;


-- =============================================================================
-- 3. Seeing what you asked for
-- =============================================================================
-- `account_requests_self_read` (20260824150000) stays exactly as it is; this
-- sits beside it. A parent who ticked "referee" beside their child can see
-- that it is pending, on the same standing that let them tick it.

drop policy if exists "account_requests_household_read" on public.account_requests;
create policy "account_requests_household_read" on public.account_requests
  for select
  to authenticated
  using (
    public.can_act_for(person_id)
    or public.is_household_member_of(person_id)
  );


-- =============================================================================
-- 4. Approving a coach who has no team yet
-- =============================================================================
-- Only one branch changes: a 'coach' request with no team grants the club-wide
-- hat and stops. Everything else — the SG-6 refusal being kept pending with
-- its reason, the audit row, the already-decided short circuit — is the
-- 20260901130000 function unchanged.

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
  -- just the role. Parent has always been here; referee joined it in
  -- 20260901130000, and a coach who has not been placed on a squad is the
  -- third: the hat is true of them, the team is not known yet, and inventing
  -- one would be worse than leaving it to the administrator.
  if r.requested_role in ('parent', 'referee')
     or (r.requested_role = 'coach' and r.team_id is null)
  then
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


-- =============================================================================
-- 5. ROLLBACK
-- =============================================================================
--   drop policy if exists "account_requests_household_read" on public.account_requests;
--   drop function if exists public.request_role_for(uuid, text, uuid, text);
--   alter table public.account_requests
--     drop constraint account_requests_team_for_team_roles,
--     add constraint account_requests_team_for_team_roles
--       check (requested_role in ('parent', 'referee') or team_id is not null);
--   -- and restore approve_account_request() from 20260901130000.
-- Any team-less coach request would have to be decided or given a team first,
-- which is why this is written down rather than left to be worked out.
-- =============================================================================
