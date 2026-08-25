-- =============================================================================
-- Four registration follow-ups (Adam, 2026-08-25 evening)
-- =============================================================================
--   1. "New Approvals should create an admin notification."
--      Two things arrive for a club administrator to decide: a new pending
--      `registrations` row (the queue at /registrations) and a new
--      `account_requests` row (/approvals). Neither told anybody: the only
--      existing notifier on `account_requests` is `account_requests_notify()`,
--      which fires AFTER UPDATE and tells the REQUESTER what was decided.
--      This migration adds the arrival notice at the other end, copying
--      `pitch_request_notify()` (20260825170000) exactly: statement-level with
--      a transition table, every live `club_admin`, never the actor, in-app
--      only (`public.notify()` -> `outbound_messages`, channel `in_app`).
--      NO EMAIL — Adam's standing rule.
--
--   3. "The registration form should update read-only information in the
--      contact record (consents, health etc). This is overwritten on each
--      registration."
--      NOT on `people`: that table is readable by the committee and by team
--      staff (`people_team_staff_read`), which is far wider than the form's
--      readership — subject, active guardians, club_admin, safeguarding_lead,
--      and coaches never (20260823130000 §3). Putting a medical note on
--      `people` would hand it to every coach in the club.
--      So: `person_registration_details`, one row per person, whose three
--      SELECT policies are the `registrations` read policies word for word.
--      An AFTER INSERT trigger on `registrations` upserts it from `form`,
--      overwriting on each registration — which is what "this is overwritten
--      on each registration" asks for. There is no client write policy at all:
--      the snapshot is the database's copy of an answer already given, not a
--      second place to edit it.
--
--   4. "Parents can't withdraw registration after it's been granted, only
--      admin."
--      `registrations_guard()` let the subject or an active guardian move
--      pending -> withdrawn AND approved -> withdrawn. From here a guardian or
--      the subject may withdraw only while the registration is still PENDING;
--      an approved registration is withdrawn by a club administrator, who is
--      also the person who has to unpick the team membership it created.
--
--      WHERE THE RULE LIVES, AND WHY IT IS THE GUARD AND NOT THE POLICY:
--      an UPDATE policy's USING clause is evaluated when the row is scanned,
--      so `and status = 'pending'` there would make an approved row simply not
--      match — nothing updated, no error, and a parent left staring at a
--      button that did nothing. The BEFORE trigger runs ahead of the policy's
--      WITH CHECK and can SPEAK, so the refusal is a readable P0001 that names
--      who to ask. The policies are re-declared below unchanged, so a fresh
--      database gets the pair of rules in one place. A trigger binds every
--      path (SAFEGUARDING.md §1.2) — the screen is not what enforces this.
--
--   (2 and 5 — the name against the ID tick, and photo permissions
--   pre-ticked — are screen-side only: `set_id_verified()` already records
--   `id_verified_by = auth.uid()`, and SG-5's fail-closed rule is unchanged.)
--
-- DATA: nothing existing is rewritten. The new table is seeded once from the
-- newest registration already on file for each person (§3), so a contact
-- record is not blank until everybody registers again. That is a copy of an
-- answer already given, into a table with exactly the same readership.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table, three SELECT
-- policies, no write policy); data touched: none; rollback: §5 below.
-- =============================================================================


-- =============================================================================
-- 1. A new registration reaches the administrator's desk
-- =============================================================================
-- Statement-level with a transition table, like `pitch_request_notify()`: an
-- admin typing in a stack of paper forms in one statement gets one message.

create or replace function public.registration_pending_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor   uuid := public.current_person_id();
  v_admin   uuid;
  v_n       bigint;
  v_any_id  text;
  v_name    text;
  v_team    text;
  v_season  text;
  v_subject text;
  v_body    text;
begin
  select count(*), min(r.id::text)
    into v_n, v_any_id
    from new_rows r
   where r.status = 'pending';
  if coalesce(v_n, 0) = 0 then
    return null;
  end if;

  -- The player's name is read here rather than through `display_name()`
  -- because this runs as the definer, not as the caller, and the recipients
  -- are club administrators — the one audience `registrations_admin_read`
  -- already shows the whole row to.
  select coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name,
         t.name, s.name
    into v_name, v_team, v_season
    from new_rows r
    join public.people p on p.id = r.person_id
    left join public.teams t on t.id = r.team_id
    left join public.seasons s on s.id = r.season_id
   where r.status = 'pending' and r.id::text = v_any_id;

  if v_n = 1 then
    v_subject := 'New registration: ' || coalesce(v_name, 'a player');
    v_body := coalesce(v_name, 'A player') || ' has registered'
              || coalesce(' for ' || v_team, '')
              || coalesce(' (' || v_season || ')', '')
              || '. Approve or reject it on Registrations.';
  else
    v_subject := v_n || ' new registrations';
    v_body := v_n || ' registrations are waiting to be approved, starting with '
              || coalesce(v_name, 'a player') || '. They are on Registrations.';
  end if;

  for v_admin in
    select distinct pr.person_id
      from public.person_roles pr
     where pr.role = 'club_admin' and pr.revoked_at is null
  loop
    -- An administrator who types in a paper form is not told about it.
    if v_admin is distinct from v_actor then
      perform public.notify(v_admin, v_subject, v_body,
                            '/registrations', 'registrations', v_any_id);
    end if;
  end loop;
  return null;
end;
$$;
revoke all privileges on function public.registration_pending_notify() from public, anon, authenticated, service_role;

comment on function public.registration_pending_notify() is
  'A new pending registration tells every live club_admin in-app (no email — Adam''s rule). One message per statement; never the person who submitted it.';

drop trigger if exists trg_registration_pending_notify on public.registrations;
create trigger trg_registration_pending_notify
  after insert on public.registrations
  referencing new table as new_rows
  for each statement execute function public.registration_pending_notify();


-- =============================================================================
-- 2. A new account request reaches the same desk
-- =============================================================================
-- `account_requests_notify()` (20260824160000) already exists and is left
-- alone: it fires AFTER UPDATE OF status and tells the REQUESTER the outcome.
-- This is the other half of that conversation, and it is deliberately a
-- separate function with a different name so neither can be mistaken for the
-- other in a stack trace.

create or replace function public.account_request_arrival_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor   uuid := public.current_person_id();
  v_admin   uuid;
  v_n       bigint;
  v_any_id  text;
  v_name    text;
  v_role    text;
  v_team    text;
  v_subject text;
  v_body    text;
begin
  select count(*), min(r.id::text)
    into v_n, v_any_id
    from new_rows r
   where r.status = 'pending';
  if coalesce(v_n, 0) = 0 then
    return null;
  end if;

  select coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name,
         replace(r.requested_role, '_', ' '), t.name
    into v_name, v_role, v_team
    from new_rows r
    join public.people p on p.id = r.person_id
    left join public.teams t on t.id = r.team_id
   where r.status = 'pending' and r.id::text = v_any_id;

  if v_n = 1 then
    v_subject := 'New account request: ' || coalesce(v_name, 'a member');
    v_body := coalesce(v_name, 'Someone') || ' has asked to be set up as '
              || coalesce(v_role, 'a member')
              || coalesce(' for ' || v_team, '')
              || '. Approve or decline it on Approvals.';
  else
    v_subject := v_n || ' new account requests';
    v_body := v_n || ' people are waiting to be set up, starting with '
              || coalesce(v_name, 'a member') || '. They are on Approvals.';
  end if;

  for v_admin in
    select distinct pr.person_id
      from public.person_roles pr
     where pr.role = 'club_admin' and pr.revoked_at is null
  loop
    if v_admin is distinct from v_actor then
      perform public.notify(v_admin, v_subject, v_body,
                            '/approvals', 'account_requests', v_any_id);
    end if;
  end loop;
  return null;
end;
$$;
revoke all privileges on function public.account_request_arrival_notify() from public, anon, authenticated, service_role;

comment on function public.account_request_arrival_notify() is
  'A new pending account request tells every live club_admin in-app (no email). The decision notice back to the requester is account_requests_notify().';

drop trigger if exists trg_account_request_arrival_notify on public.account_requests;
create trigger trg_account_request_arrival_notify
  after insert on public.account_requests
  referencing new table as new_rows
  for each statement execute function public.account_request_arrival_notify();


-- =============================================================================
-- 3. person_registration_details — the read-only copy on the contact record
-- =============================================================================

create table public.person_registration_details (
  person_id       uuid primary key references public.people (id) on delete cascade,
  registration_id uuid references public.registrations (id) on delete set null,
  season_id       uuid references public.seasons (id) on delete set null,
  details         jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(details) = 'object'),
  updated_at      timestamptz not null default now()
);

comment on table public.person_registration_details is
  'What the latest registration said about a person — health, kit size, previous club, preferred position, photo preferences and the club''s own questions. Overwritten by each new registration. Read-only to every client: written by registration_details_snapshot() alone, and readable by exactly the people registrations.form is readable by.';
comment on column public.person_registration_details.details is
  'A subset of registrations.form. Sensitive (medical). The terms and GDPR stamps are deliberately NOT copied — they are evidence about one submission, not a fact about the person.';

create index person_registration_details_registration_idx
  on public.person_registration_details (registration_id);

alter table public.person_registration_details enable row level security;

-- The `registrations` read policies, word for word (20260823130000 §4). Any
-- widening of them belongs there, and would then be copied here on purpose.
create policy "person_registration_details_admin_read"
  on public.person_registration_details for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "person_registration_details_self_read"
  on public.person_registration_details for select to authenticated
  using (person_id = public.current_person_id());
create policy "person_registration_details_guardian_read"
  on public.person_registration_details for select to authenticated
  using (public.is_active_guardian_of(person_id));

-- No INSERT, UPDATE or DELETE policy and no write grant: the only writer is
-- the SECURITY DEFINER trigger below. A coach, a committee member or the
-- subject themselves cannot put a word in here.
revoke all privileges on public.person_registration_details from anon, authenticated, service_role;
grant select on public.person_registration_details to authenticated;
grant select on public.person_registration_details to service_role;


create or replace function public.registration_details_snapshot()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_details jsonb;
begin
  -- A whitelist, not a blacklist: a key added to the form later is not
  -- silently copied onto the contact record. `terms_accepted_at`,
  -- `terms_version`, `gdpr_accepted_at` and `gdpr_notice_version` are evidence
  -- about one submission and stay on the registration; the legacy
  -- `emergency_contact` (form versions 1-2) is dropped because emergency
  -- contacts are the person's own rows now (20260825150000).
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
    into v_details
    from jsonb_each(coalesce(new.form, '{}'::jsonb)) as f(key, value)
   where f.key in ('medical', 'kit_size', 'previous_club', 'preferred_position',
                   'photo_preferences', 'custom');

  insert into public.person_registration_details
    (person_id, registration_id, season_id, details, updated_at)
  values (new.person_id, new.id, new.season_id, v_details, now())
  on conflict (person_id) do update
    set registration_id = excluded.registration_id,
        season_id       = excluded.season_id,
        details         = excluded.details,
        updated_at      = excluded.updated_at;

  return null;
end;
$$;
revoke all privileges on function public.registration_details_snapshot() from public, anon, authenticated, service_role;

comment on function public.registration_details_snapshot() is
  'Copy the answers a registration gives about a PERSON onto their contact record, overwriting the last set. Never widens who may read them.';

drop trigger if exists trg_registration_details_snapshot on public.registrations;
create trigger trg_registration_details_snapshot
  after insert on public.registrations
  for each row execute function public.registration_details_snapshot();


-- One-off seed, so the contact records are not blank until the club has been
-- round the houses again: the NEWEST registration on file for each person,
-- through the same whitelist the trigger uses. `do nothing` on conflict, so
-- re-running this migration cannot overwrite a fresher snapshot.
insert into public.person_registration_details
  (person_id, registration_id, season_id, details, updated_at)
select distinct on (r.person_id)
       r.person_id,
       r.id,
       r.season_id,
       (select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
          from jsonb_each(coalesce(r.form, '{}'::jsonb)) as f(key, value)
         where f.key in ('medical', 'kit_size', 'previous_club', 'preferred_position',
                         'photo_preferences', 'custom')),
       r.submitted_at
  from public.registrations r
 order by r.person_id, r.submitted_at desc, r.id
on conflict (person_id) do nothing;


-- =============================================================================
-- 4. Withdrawal: a family may withdraw a PENDING registration only
-- =============================================================================
-- The body below is 20260824280000_join_flow.sql's version of this function —
-- the CURRENT one, household-adult INSERT branch and all — with one new
-- paragraph, marked. Copying the older 20260823130000 body would silently
-- revert the join wizard's "register my spouse" case.

create or replace function public.registrations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_caller uuid := public.current_person_id();
  v_admin  boolean := public.is_club_admin();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and not v_admin and auth.uid() is not null then
      raise exception 'registrations: a new registration starts as pending' using errcode = 'P0001';
    end if;
    if new.submitted_by is null then
      new.submitted_by := auth.uid();
    end if;
    -- Who may submit.
    if auth.uid() is not null and not v_admin then
      if public.is_minor(new.person_id) then
        if not exists (
          select 1 from public.guardianships g
          where g.child_person_id = new.person_id
            and g.guardian_person_id = v_caller
            and g.ended_at is null)
        then
          raise exception
            'registrations: a minor may be registered only by an active guardian or a club_admin [SAFEGUARDING.md SG-4]'
            using errcode = 'P0001';
        end if;
      elsif new.person_id is distinct from v_caller then
        -- 20260824280000: an adult HOUSEHOLD member — created by this login
        -- and holding no login of their own — may be registered by whoever
        -- created them (the join wizard's spouse case). Anyone else: refused.
        if not public.is_household_member_of(new.person_id) then
          raise exception 'registrations: an adult registers themself (or a club_admin does it for them)'
            using errcode = 'P0001';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.person_id <> old.person_id or new.season_id <> old.season_id
     or new.submitted_by is distinct from old.submitted_by or new.submitted_at <> old.submitted_at then
    raise exception 'registrations: person, season and submission are immutable' using errcode = 'P0001';
  end if;

  if new.status <> old.status then
    if old.status in ('rejected', 'withdrawn') then
      raise exception 'registrations: a % registration is final; submit a new one', old.status using errcode = 'P0001';
    end if;
    if new.status = 'pending' then
      raise exception 'registrations: cannot return to pending' using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'rejected') and not v_admin and auth.uid() is not null then
      raise exception 'registrations: only a club_admin may approve or reject' using errcode = 'P0001';
    end if;
    if new.status = 'withdrawn' and not v_admin and auth.uid() is not null then
      -- the subject (adult) or an active guardian (minor) may withdraw
      if not (new.person_id = v_caller
              or exists (select 1 from public.guardianships g
                         where g.child_person_id = new.person_id
                           and g.guardian_person_id = v_caller and g.ended_at is null))
      then
        raise exception 'registrations: only the subject, an active guardian or a club_admin may withdraw'
          using errcode = 'P0001';
      end if;
      -- NEW (Adam, 2026-08-25): and only while it is still waiting. Once the
      -- club has approved it there is a squad place, and possibly a team
      -- membership this trigger created, hanging off it — undoing that is the
      -- club's job, not a button in a parent's screen.
      if old.status <> 'pending' then
        raise exception 'registrations: this registration has been approved — ask a club administrator to withdraw it'
          using errcode = 'P0001';
      end if;
    end if;
    new.decided_at := now();
    new.decided_by := auth.uid();

    -- Approval with a team: create the live player membership for the season.
    -- P2.1's SG-6 guard runs here and may refuse, which fails the approval.
    if new.status = 'approved' and new.team_id is not null
       and not exists (select 1 from public.team_memberships m
                       where m.person_id = new.person_id and m.team_id = new.team_id
                         and m.season_id = new.season_id and m.role = 'player' and m.left_at is null)
    then
      insert into public.team_memberships (person_id, team_id, season_id, role, created_by)
      values (new.person_id, new.team_id, new.season_id, 'player', auth.uid());
    end if;
  elsif (new.decided_at is distinct from old.decided_at or new.decided_by is distinct from old.decided_by) then
    raise exception 'registrations: decided_at/decided_by are set by the status change' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.registrations_guard() is
  'Who may register whom, and what may become what. A guardian or the subject may withdraw a PENDING registration; an approved one is a club administrator''s to withdraw.';

-- Re-declared unchanged, so a reader finds the withdrawal rules in one place.
-- The USING clauses deliberately do NOT test `status = 'pending'`: see the
-- header — a policy that hides the row cannot explain itself, and the guard
-- above raises a P0001 that names who to ask.
drop policy if exists "registrations_self_withdraw" on public.registrations;
create policy "registrations_self_withdraw" on public.registrations for update to authenticated
  using (person_id = public.current_person_id())
  with check (person_id = public.current_person_id() and status = 'withdrawn');

drop policy if exists "registrations_guardian_withdraw" on public.registrations;
create policy "registrations_guardian_withdraw" on public.registrations for update to authenticated
  using (public.is_active_guardian_of(person_id))
  with check (public.is_active_guardian_of(person_id) and status = 'withdrawn');


-- =============================================================================
-- 5. Audit the schema change itself
-- =============================================================================

insert into public.audit_log (actor_email, action, entity, detail)
values ('migration', 'migration.schema', 'registrations',
        jsonb_build_object('migration', '20260825230000_registration_followups',
                           'changes', array['registration_pending_notify tells club_admins in-app',
                                            'account_request_arrival_notify tells club_admins in-app',
                                            'person_registration_details snapshot of the latest form',
                                            'a family withdraws a pending registration only']));

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
--   drop trigger trg_registration_pending_notify on public.registrations;
--   drop function public.registration_pending_notify();
--   drop trigger trg_account_request_arrival_notify on public.account_requests;
--   drop function public.account_request_arrival_notify();
--   drop trigger trg_registration_details_snapshot on public.registrations;
--   drop function public.registration_details_snapshot();
--   drop table public.person_registration_details;
--   create or replace function public.registrations_guard() ... -- the body in
--     20260824280000_join_flow.sql (this one without the `old.status <>
--     'pending'` paragraph). The two withdraw policies are byte-identical to
--     20260823130000's and need no rollback.
-- =============================================================================
