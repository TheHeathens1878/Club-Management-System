-- =============================================================================
-- P4.3 — safeguarding_concerns (SG-3, SG-7, SG-2, SG-8), SG-6 tier 2 state,
--        audit_read on person_roles
-- =============================================================================
-- PLAN.md task P4.3 ("certifications … expiry-nudge scheduler (90/30/7 days),
-- safeguarding_concerns (restricted RLS per §2.4)"; acceptance: "Access tests
-- prove only safeguarding_lead/admin can read concerns; nudges fire in test").
-- Linear TH1-30. `certifications` / `certification_exemptions` arrived in P2.1.
--
-- SG-3, IMPLEMENTED AS WRITTEN
--   "Roles with BYPASSRLS are controlled by privileges and triggers, not by
--   policies." So:
--   1. `safeguarding_concerns` and `safeguarding_concern_notes` have ALL
--      privileges revoked from anon, authenticated AND service_role, and the
--      sequences behind them. No direct access exists for any API role.
--   2. Every read and write is a SECURITY DEFINER function, owned by
--      `postgres` (the migration runner; the app cannot authenticate as it),
--      `SET search_path = public`, EXECUTE revoked from PUBLIC and anon,
--      granted to authenticated and service_role. Each function checks the
--      caller's authority with P1.4's role helpers plus the exclusions in the
--      write model, and writes its SG-7 audit row BEFORE returning — including
--      when it returns zero rows.
--   3. SG-2: `deny_hard_delete()` + `deny_truncate()` on both tables; the
--      trigger binds the function owner too.
--   4. RLS enabled AND FORCEd on both tables, with policies expressing the
--      write model, as defence in depth — never the thing that stops
--      service_role.
--
-- WRITE MODEL (SG-3 table, D3 recommended)
--   * any authenticated person: `report_concern()` — INSERT.
--   * reporter: `my_concern_receipts()` — own narrative, reference, status.
--     Never notes, never anything added later.
--   * safeguarding_lead: `read_concerns()` all; `update_concern()` status /
--     triage / legal_hold; `add_concern_note()`; `read_concern_notes()`.
--   * club_admin: `read_concerns()` all; NO note writes; NO status changes.
--   * subject (`subject_person_id` or `reported_person_id` = caller's person):
--     excluded from every read, even as club_admin or lead.
--   * nobody deletes, ever.
--
-- SG-7 VOCABULARY (fixed here, per SG-7 "to be fixed in P4.3"):
--   safeguarding.concern.create / .read / .update / .note.create / .note.read,
--   entity safeguarding_concerns, detail { concern_ref, … } and NEVER the
--   narrative or note text — asserted by a trigger on audit_log that refuses
--   a detail containing a 'narrative' or 'body' key for these actions.
--
-- SG-8: `legal_hold` on concerns (lead only, audited) and
--   `people.legal_hold` honoured by `pseudonymise_person()` (refuses anyone
--   named in an open concern or under hold). Retention periods stay D7: no
--   job here, only the flag and the refusal.
--
-- SG-6 TIER 2: `certification_nudges` records which (certification, days)
--   nudge has been sent so 90/30/7 are not re-sent; `due_certification_nudges()`
--   lists what is due today; `compliance_report()` is the nightly
--   "non-compliant and still assigned" list; `person_compliance_status()`
--   returns valid / expiring / expired / missing. The scheduled Edge Function
--   (`safeguarding-nudges`) calls these; sending is P4.4's API.
--
-- AUDIT: `audit_read` re-expressed on person_roles (club_admin +
--   safeguarding_lead), with `safeguarding.%` and `messaging.%` actions
--   narrowed to those two roles by the same policy (SG-7 "probably narrowed").
--
-- PR METADATA: migrations y; RLS y; data touched: none; rollback: §12.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.concern_status as enum ('received', 'under_review', 'closed');
create type public.concern_severity as enum ('low', 'medium', 'high', 'critical');


-- =============================================================================
-- 2. TABLES (no API-role privileges — see §10)
-- =============================================================================

create table public.safeguarding_concerns (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,
  reported_by_person_id uuid references public.people (id) on delete restrict,
  subject_person_id    uuid references public.people (id) on delete restrict,
  reported_person_id   uuid references public.people (id) on delete restrict,
  narrative            text not null,
  status               public.concern_status not null default 'received',
  severity             public.concern_severity,
  channel              text not null default 'web' check (channel in ('web', 'mobile', 'paper', 'import')),
  legal_hold           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users (id) on delete set null,
  constraint safeguarding_concerns_narrative_not_blank check (btrim(narrative) <> '')
);

create index safeguarding_concerns_status_idx on public.safeguarding_concerns (status, created_at desc);
create index safeguarding_concerns_subject_idx on public.safeguarding_concerns (subject_person_id);
create index safeguarding_concerns_reported_idx on public.safeguarding_concerns (reported_person_id);

create table public.safeguarding_concern_notes (
  id          uuid primary key default gen_random_uuid(),
  concern_id  uuid not null references public.safeguarding_concerns (id) on delete restrict,
  author_person_id uuid references public.people (id) on delete restrict,
  body        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint safeguarding_concern_notes_body_not_blank check (btrim(body) <> '')
);

create index safeguarding_concern_notes_concern_idx on public.safeguarding_concern_notes (concern_id, created_at);

create trigger trg_safeguarding_concerns_updated
  before update on public.safeguarding_concerns
  for each row execute function public.set_updated_at();
create trigger trg_safeguarding_concerns_deny_hard_delete
  before delete on public.safeguarding_concerns
  for each row execute function public.deny_hard_delete();
create trigger trg_safeguarding_concerns_deny_truncate
  before truncate on public.safeguarding_concerns
  for each statement execute function public.deny_truncate();
create trigger trg_safeguarding_concern_notes_deny_hard_delete
  before delete on public.safeguarding_concern_notes
  for each row execute function public.deny_hard_delete();
create trigger trg_safeguarding_concern_notes_deny_truncate
  before truncate on public.safeguarding_concern_notes
  for each statement execute function public.deny_truncate();

-- Reference numbers: SC-YYYY-NNNN
create sequence public.safeguarding_concern_ref_seq;

create or replace function public.safeguarding_concerns_ref_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.ref is null or new.ref = '' then
      new.ref := format('SC-%s-%s', to_char(now(), 'YYYY'), lpad(nextval('public.safeguarding_concern_ref_seq')::text, 4, '0'));
    end if;
    return new;
  end if;
  if new.ref <> old.ref or new.narrative <> old.narrative or new.reported_by_person_id is distinct from old.reported_by_person_id
     or new.created_at <> old.created_at then
    raise exception 'safeguarding_concerns: ref, narrative, reporter and created_at are immutable [SAFEGUARDING.md SG-2]' using errcode = 'P0001';
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_safeguarding_concerns_ref_guard
  before insert or update on public.safeguarding_concerns
  for each row execute function public.safeguarding_concerns_ref_guard();

comment on table public.safeguarding_concerns is
  'SG-3: no API role holds any privilege on this table. All access is through the audited accessor functions.';


-- =============================================================================
-- 3. AUDIT GUARD — detail must never carry content (SG-7)
-- =============================================================================

create or replace function public.audit_log_no_content_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.action like 'safeguarding.concern.%' and new.detail is not null
     and (new.detail ? 'narrative' or new.detail ? 'body' or new.detail ? 'note') then
    raise exception 'audit_log: detail for % must not carry concern content [SAFEGUARDING.md SG-7]', new.action
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_audit_log_no_content
  before insert on public.audit_log
  for each row execute function public.audit_log_no_content_guard();


-- =============================================================================
-- 4. INTERNAL HELPERS
-- =============================================================================

-- Is the caller the subject of this concern? (SG-3: excluded from every read,
-- even as club_admin.)
create or replace function public.concern_names_caller(c public.safeguarding_concerns)
  returns boolean
  language sql
  stable
  set search_path = public
as $$
  -- coalesce: a concern with no subject must compare FALSE, not NULL — a NULL
  -- here would silently drop the row from every read.
  select coalesce(c.subject_person_id = public.current_person_id(), false)
      or coalesce(c.reported_person_id = public.current_person_id(), false);
$$;

create or replace function public.concern_audit(p_action text, p_ref text, p_detail jsonb default '{}'::jsonb)
  returns void
  language sql
  set search_path = public
as $$
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          p_action, 'safeguarding_concerns', p_ref, jsonb_build_object('concern_ref', p_ref) || coalesce(p_detail, '{}'::jsonb));
$$;


-- =============================================================================
-- 5. ACCESSORS
-- =============================================================================

-- Anyone authenticated may report. service_role (an Edge Function on behalf
-- of a mobile user) must pass the reporter explicitly.
create or replace function public.report_concern(
  p_narrative          text,
  p_subject_person_id  uuid default null,
  p_reported_person_id uuid default null,
  p_channel            text default 'web',
  p_reporter_person_id uuid default null
)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_reporter uuid := coalesce(public.current_person_id(), p_reporter_person_id);
  v_ref text;
begin
  if auth.uid() is null and v_reporter is null and p_channel not in ('paper', 'import') then
    raise exception 'report_concern: a reporter is required' using errcode = '42501';
  end if;
  insert into public.safeguarding_concerns (reported_by_person_id, subject_person_id, reported_person_id, narrative, channel)
  values (v_reporter, p_subject_person_id, p_reported_person_id, p_narrative, p_channel)
  returning ref into v_ref;
  perform public.concern_audit('safeguarding.concern.create', v_ref, jsonb_build_object('channel', p_channel));
  return v_ref;
end;
$$;

-- Reporter's receipt: own rows, narrow columns. Audited even when empty.
create or replace function public.my_concern_receipts()
  returns table (ref text, status public.concern_status, narrative text, created_at timestamptz, closed_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if v_me is null then
    raise exception 'my_concern_receipts: sign in first' using errcode = '42501';
  end if;
  perform public.concern_audit('safeguarding.concern.read', 'receipts', jsonb_build_object('scope', 'own_receipts'));
  return query
    select c.ref, c.status, c.narrative, c.created_at, c.closed_at
    from public.safeguarding_concerns c
    where c.reported_by_person_id = v_me and c.deleted_at is null
    order by c.created_at desc;
end;
$$;

-- Full read for safeguarding_lead / club_admin, excluding concerns that name
-- the caller. One audit row per call (scope + count), never the narrative.
create or replace function public.read_concerns(p_status public.concern_status default null, p_ref text default null)
  returns setof public.safeguarding_concerns
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_count integer;
begin
  -- An unauthorised read returns NOTHING and is logged: a raise would roll the
  -- audit row back with it, and "an unsuccessful fishing attempt is exactly
  -- what we most want logged" (SG-7).
  if auth.uid() is not null and not public.has_any_role(array['safeguarding_lead', 'club_admin']::public.app_role[]) then
    perform public.concern_audit('safeguarding.concern.read', coalesce(p_ref, '*'), jsonb_build_object('refused', true, 'row_count', 0));
    return;
  end if;
  select count(*) into v_count from public.safeguarding_concerns c
   where c.deleted_at is null
     and (p_status is null or c.status = p_status)
     and (p_ref is null or c.ref = p_ref)
     and not public.concern_names_caller(c);
  perform public.concern_audit('safeguarding.concern.read', coalesce(p_ref, '*'),
    jsonb_build_object('status_filter', p_status, 'row_count', v_count));
  return query
    select c.* from public.safeguarding_concerns c
    where c.deleted_at is null
      and (p_status is null or c.status = p_status)
      and (p_ref is null or c.ref = p_ref)
      and not public.concern_names_caller(c)
    order by c.created_at desc;
end;
$$;

-- safeguarding_lead only: status / severity / legal_hold.
create or replace function public.update_concern(
  p_ref        text,
  p_status     public.concern_status default null,
  p_severity   public.concern_severity default null,
  p_legal_hold boolean default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c public.safeguarding_concerns%rowtype;
begin
  if auth.uid() is not null and not public.is_safeguarding_lead() then
    raise exception 'update_concern: safeguarding_lead only [SAFEGUARDING.md SG-3]' using errcode = '42501';
  end if;
  select * into c from public.safeguarding_concerns where ref = p_ref and deleted_at is null;
  if not found then
    perform public.concern_audit('safeguarding.concern.update', p_ref, jsonb_build_object('found', false));
    raise exception 'update_concern: unknown concern %', p_ref using errcode = 'P0001';
  end if;
  if public.concern_names_caller(c) then
    perform public.concern_audit('safeguarding.concern.update', p_ref, jsonb_build_object('refused', 'names_caller'));
    raise exception 'update_concern: you are named in this concern [SAFEGUARDING.md SG-3]' using errcode = '42501';
  end if;
  update public.safeguarding_concerns
     set status = coalesce(p_status, status),
         severity = coalesce(p_severity, severity),
         legal_hold = coalesce(p_legal_hold, legal_hold)
   where id = c.id;
  perform public.concern_audit('safeguarding.concern.update', p_ref,
    jsonb_build_object('status', p_status, 'severity', p_severity, 'legal_hold', p_legal_hold,
                       'changed', array_remove(array[
                         case when p_status is not null then 'status' end,
                         case when p_severity is not null then 'severity' end,
                         case when p_legal_hold is not null then 'legal_hold' end], null)));
end;
$$;

create or replace function public.add_concern_note(p_ref text, p_body text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c public.safeguarding_concerns%rowtype;
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_safeguarding_lead() then
    raise exception 'add_concern_note: safeguarding_lead only [SAFEGUARDING.md SG-3]' using errcode = '42501';
  end if;
  select * into c from public.safeguarding_concerns where ref = p_ref and deleted_at is null;
  if not found then
    raise exception 'add_concern_note: unknown concern %', p_ref using errcode = 'P0001';
  end if;
  if public.concern_names_caller(c) then
    raise exception 'add_concern_note: you are named in this concern [SAFEGUARDING.md SG-3]' using errcode = '42501';
  end if;
  insert into public.safeguarding_concern_notes (concern_id, author_person_id, body)
  values (c.id, public.current_person_id(), p_body)
  returning id into v_id;
  perform public.concern_audit('safeguarding.concern.note.create', p_ref, jsonb_build_object('note_id', v_id));
  return v_id;
end;
$$;

create or replace function public.read_concern_notes(p_ref text)
  returns table (id uuid, author_person_id uuid, body text, created_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c public.safeguarding_concerns%rowtype;
  v_count integer;
begin
  if auth.uid() is not null and not public.is_safeguarding_lead() then
    perform public.concern_audit('safeguarding.concern.note.read', p_ref, jsonb_build_object('refused', true));
    raise exception 'read_concern_notes: safeguarding_lead only (club_admin reads the concern, not the case notes) [SAFEGUARDING.md SG-3]'
      using errcode = '42501';
  end if;
  select * into c from public.safeguarding_concerns where ref = p_ref and deleted_at is null;
  if not found or public.concern_names_caller(c) then
    perform public.concern_audit('safeguarding.concern.note.read', p_ref, jsonb_build_object('row_count', 0));
    return;
  end if;
  select count(*) into v_count from public.safeguarding_concern_notes n where n.concern_id = c.id and n.deleted_at is null;
  perform public.concern_audit('safeguarding.concern.note.read', p_ref, jsonb_build_object('row_count', v_count));
  return query
    select n.id, n.author_person_id, n.body, n.created_at
    from public.safeguarding_concern_notes n
    where n.concern_id = c.id and n.deleted_at is null
    order by n.created_at;
end;
$$;


-- =============================================================================
-- 6. SG-8 — legal hold and pseudonymisation refusal
-- =============================================================================

-- people.legal_hold: safeguarding_lead only (policy-level: people_admin_update
-- is club_admin; this column is lead-only by trigger).
create or replace function public.people_legal_hold_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.legal_hold is distinct from old.legal_hold then
    if auth.uid() is not null and not public.is_safeguarding_lead() then
      raise exception 'people.legal_hold may only be set or cleared by a safeguarding_lead [SAFEGUARDING.md SG-8]' using errcode = '42501';
    end if;
    insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (auth.uid(), (select email from auth.users where id = auth.uid()),
            'safeguarding.legal_hold', 'people', new.id::text, jsonb_build_object('legal_hold', new.legal_hold));
  end if;
  if new.pseudonymised_at is not null and old.pseudonymised_at is null then
    if new.legal_hold then
      raise exception 'people: cannot pseudonymise a person under legal hold [SAFEGUARDING.md SG-8]' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.safeguarding_concerns c
               where c.status <> 'closed' and c.deleted_at is null
                 and (c.subject_person_id = new.id or c.reported_person_id = new.id or c.reported_by_person_id = new.id)) then
      raise exception 'people: cannot pseudonymise a person named in an open safeguarding concern [SAFEGUARDING.md SG-8]' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_people_legal_hold_guard
  before update of legal_hold, pseudonymised_at on public.people
  for each row execute function public.people_legal_hold_guard();


-- =============================================================================
-- 7. SG-6 TIER 2 — nudges and compliance
-- =============================================================================

create table public.certification_nudges (
  id                uuid primary key default gen_random_uuid(),
  certification_id  uuid not null references public.certifications (id) on delete cascade,
  days_before       integer not null check (days_before in (90, 30, 7)),
  sent_at           timestamptz not null default now(),
  unique (certification_id, days_before)
);

alter table public.certification_nudges enable row level security;
create policy "certification_nudges_admin_read" on public.certification_nudges for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
revoke all privileges on public.certification_nudges from anon, authenticated, service_role;
grant select on public.certification_nudges to authenticated;
grant select, insert on public.certification_nudges to service_role;

-- Nudges due today (or overdue and unsent): one row per (certification, tier).
create or replace function public.due_certification_nudges()
  returns table (certification_id uuid, person_id uuid, type public.certification_type, expires_on date, days_before integer, days_left integer)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select c.id, c.person_id, c.type, c.expires_on, d.days_before, (c.expires_on - current_date)::integer
  from public.certifications c
  cross join (values (90), (30), (7)) as d(days_before)
  where c.revoked_at is null
    and c.expires_on is not null
    and c.expires_on - current_date <= d.days_before
    and c.expires_on >= current_date
    and not exists (select 1 from public.certification_nudges n where n.certification_id = c.id and n.days_before = d.days_before)
  order by c.expires_on, d.days_before desc;
$$;

create or replace function public.mark_certification_nudged(p_certification_id uuid, p_days_before integer)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  insert into public.certification_nudges (certification_id, days_before) values (p_certification_id, p_days_before)
  on conflict do nothing;
$$;

-- valid / expiring / expired / missing for one certification type.
create or replace function public.person_compliance_status(p_person_id uuid, p_type public.certification_type)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce((
    select case
      when c.expires_on is null or c.expires_on - current_date > 30 then 'valid'
      when c.expires_on >= current_date then 'expiring'
      else 'expired' end
    from public.certifications c
    where c.person_id = p_person_id and c.type = p_type and c.revoked_at is null and c.verified_at is not null
    order by c.expires_on desc nulls first limit 1), 'missing');
$$;

-- The nightly report: every live child-facing membership on a team with minors
-- whose holder is not compliant (SG-6 tier 2 backstop).
create or replace function public.compliance_report()
  returns table (team_id uuid, team_name text, person_id uuid, person_name text, role public.team_role,
                 dbs_status text, safeguarding_status text, exemption_expires_on date)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select t.id, t.name, p.id, p.first_name || ' ' || p.last_name, m.role,
         public.person_compliance_status(p.id, 'fa_dbs'),
         public.person_compliance_status(p.id, 'safeguarding_children'),
         (select max(e.expires_on) from public.certification_exemptions e
           where e.person_id = p.id and e.team_id = t.id and e.revoked_at is null and e.expires_on >= current_date)
  from public.team_memberships m
  join public.teams t on t.id = m.team_id
  join public.people p on p.id = m.person_id
  where m.left_at is null
    and public.is_child_facing_role(m.role)
    and public.team_has_minors(t.id)
    and not public.is_child_facing_compliant(p.id, t.id)
    and (auth.uid() is null or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]))
  order by t.name, p.last_name;
$$;


-- =============================================================================
-- 8. audit_read ON THE NEW ROLE MODEL
-- =============================================================================

drop policy if exists "audit_read" on public.audit_log;
create policy "audit_read" on public.audit_log
  for select to authenticated
  using (
    case
      when action like 'safeguarding.%' or action like 'messaging.%'
        then public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
      else public.is_club_admin() or public.is_committee()
    end
  );


-- =============================================================================
-- 9. RLS (defence in depth on the concerns tables)
-- =============================================================================

alter table public.safeguarding_concerns enable row level security;
alter table public.safeguarding_concerns force row level security;
alter table public.safeguarding_concern_notes enable row level security;
alter table public.safeguarding_concern_notes force row level security;

create policy "safeguarding_concerns_admin_read" on public.safeguarding_concerns for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
         and not public.concern_names_caller(safeguarding_concerns));
create policy "safeguarding_concerns_lead_update" on public.safeguarding_concerns for update to authenticated
  using (public.is_safeguarding_lead() and not public.concern_names_caller(safeguarding_concerns))
  with check (public.is_safeguarding_lead());
create policy "safeguarding_concerns_report" on public.safeguarding_concerns for insert to authenticated
  with check (true);
create policy "safeguarding_concern_notes_lead_all" on public.safeguarding_concern_notes for all to authenticated
  using (public.is_safeguarding_lead()) with check (public.is_safeguarding_lead());


-- =============================================================================
-- 10. PRIVILEGES — the control (SG-3 §1)
-- =============================================================================

revoke all privileges on public.safeguarding_concerns, public.safeguarding_concern_notes
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.safeguarding_concern_ref_seq from public, anon, authenticated, service_role;

revoke all privileges on function public.report_concern(text, uuid, uuid, text, uuid) from public, anon;
revoke all privileges on function public.my_concern_receipts() from public, anon;
revoke all privileges on function public.read_concerns(public.concern_status, text) from public, anon;
revoke all privileges on function public.update_concern(text, public.concern_status, public.concern_severity, boolean) from public, anon;
revoke all privileges on function public.add_concern_note(text, text) from public, anon;
revoke all privileges on function public.read_concern_notes(text) from public, anon;
grant execute on function public.report_concern(text, uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.my_concern_receipts() to authenticated, service_role;
grant execute on function public.read_concerns(public.concern_status, text) to authenticated, service_role;
grant execute on function public.update_concern(text, public.concern_status, public.concern_severity, boolean) to authenticated, service_role;
grant execute on function public.add_concern_note(text, text) to authenticated, service_role;
grant execute on function public.read_concern_notes(text) to authenticated, service_role;

revoke all privileges on function public.concern_names_caller(public.safeguarding_concerns) from public, anon, authenticated, service_role;
revoke all privileges on function public.concern_audit(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function public.safeguarding_concerns_ref_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.audit_log_no_content_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.people_legal_hold_guard() from public, anon, authenticated, service_role;

revoke all privileges on function public.due_certification_nudges() from public, anon, authenticated;
revoke all privileges on function public.mark_certification_nudged(uuid, integer) from public, anon, authenticated;
grant execute on function public.due_certification_nudges() to service_role;
grant execute on function public.mark_certification_nudged(uuid, integer) to service_role;
revoke all privileges on function public.person_compliance_status(uuid, public.certification_type) from public, anon;
revoke all privileges on function public.compliance_report() from public, anon;
grant execute on function public.person_compliance_status(uuid, public.certification_type) to authenticated, service_role;
grant execute on function public.compliance_report() to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 12. ROLLBACK (documented, not executed)
-- =============================================================================
-- Restore the baseline audit_read policy (is_committee()); drop the trigger
-- on people and audit_log; drop functions compliance_report,
-- person_compliance_status, mark_certification_nudged, due_certification_nudges,
-- the six accessors, concern_audit, concern_names_caller, the two guards; drop
-- tables certification_nudges, safeguarding_concern_notes,
-- safeguarding_concerns (destroying concern rows — the only circumstance in
-- which that may happen); drop the sequence and the two enums.
