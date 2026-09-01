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


-- -----------------------------------------------------------------------------
-- 4. The sign-up itself can open the request
-- -----------------------------------------------------------------------------
-- Same body as 20260901120000, plus the block at the end. A full definition
-- rather than a patch, because a plpgsql function has no other way to be
-- amended and half a definition is impossible to review.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_first       text;
  v_last        text;
  v_email       text;
  v_person      uuid;
  v_meta_person text;
  v_invited     uuid;
  v_invited_row public.people%rowtype;
  v_dob         date;
  v_phone       text;
  v_address     jsonb;
begin
  v_meta_person := new.raw_user_meta_data ->> 'person_id';
  if v_meta_person is not null
     and v_meta_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_invited := v_meta_person::uuid;
    select * into v_invited_row from public.people p where p.id = v_invited and p.deleted_at is null;
    if found
       and not exists (select 1 from public.profiles pr where pr.person_id = v_invited)
       and (
            public.has_active_consent(v_invited, 'app_account'::public.consent_type)
            or (
              not (v_invited_row.dob is not null and public.is_minor_dob(v_invited_row.dob))
              and v_invited_row.email is not null
              and lower(v_invited_row.email) = lower(new.email)
            )
       )
    then
      insert into profiles (id, role, full_name, person_id)
      values (new.id, 'member',
              coalesce(new.raw_user_meta_data ->> 'full_name', v_invited_row.first_name || ' ' || v_invited_row.last_name),
              v_invited)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- The two halves as typed, when the caller took the trouble to ask for them.
  -- Both, or neither: one half plus a guess at the other is the same guess the
  -- split was, wearing a better hat.
  v_first := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last  := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  if v_first is null or v_last is null then
    select s.first_name, s.last_name
      into v_first, v_last
      from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;
  end if;

  v_email := nullif(btrim(new.email), '');
  if v_email is not null
     and (
       length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or exists (
            select 1 from public.people pe
             where pe.deleted_at is null
               and lower(pe.email) = lower(v_email)
          )
     )
  then
    v_email := null;
  end if;

  begin
    v_dob := nullif(btrim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null and v_dob > current_date then
    v_dob := null;
  end if;
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  -- The join wizard sends the home address at sign-up. Only an object is
  -- accepted; anything else is treated as absent.
  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

  insert into public.people (first_name, last_name, email, dob, phone, address)
  values (v_first, v_last, v_email, v_dob, v_phone, v_address)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member',
          coalesce(new.raw_user_meta_data ->> 'full_name', btrim(v_first || ' ' || v_last)),
          v_person)
  on conflict (id) do nothing;

  -- The sign-in page's referee door (/register?as=referee): the account and the
  -- request are made in the same breath, so it survives an email confirmation
  -- that has not been clicked yet — there is no session at this point in which
  -- the app could write it, and asking people to remember to ask again after
  -- confirming would lose most of them.
  --
  -- Only 'referee' is honoured. The metadata is browser-supplied, and while an
  -- account request grants NOTHING on its own — a club administrator approves
  -- it in /approvals, and `approve_account_request()` checks is_club_admin()
  -- itself — a self-declared coach appearing in the queue with no team behind
  -- it is noise nobody asked for.
  if lower(nullif(btrim(new.raw_user_meta_data ->> 'requested_role'), '')) = 'referee' then
    insert into public.account_requests (person_id, requested_role, message)
    values (v_person, 'referee', 'Asked to referee when creating their account');
  end if;

  return new;
end $function$;
