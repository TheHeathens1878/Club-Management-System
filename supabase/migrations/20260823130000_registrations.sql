-- =============================================================================
-- P2.2 — registrations, SG-5 photo-consent types
-- =============================================================================
-- PLAN.md task P2.2 ("registrations (person, season, status, forms/consents
-- captured)"; acceptance: "Registration flow spec'd; consent fields include
-- photo consent per child"). Linear TH1-19. Spec: docs/specs/P2.2-registration-flow.md.
--
-- PURPOSE
--   A registration is a person's request to play for the club in a season,
--   with the form answers the club needs (emergency contact, medical notes)
--   and — for a child — the guardian's consents captured at the same moment.
--
-- PHOTO CONSENT REUSES guardian_consents (P1.7), NOT A NEW TABLE
--   SAFEGUARDING.md §4 says under P1.7: "`consent_type` enum — `app_account`,
--   `unsupervised_messaging`; P2.2 adds the SG-5 photo-consent values by
--   `alter type … add value`". That is the newer, more specific instruction;
--   the older "photo_consents(...)" line in the P2.2 checklist predates P1.7
--   settling the consent model. One table means one grant guard (active
--   guardianship, adult guardian, known-dob), one immutability rule, one audit
--   trigger (`safeguarding.consent.granted` / `.revoked`, SG-7) and one
--   `has_active_consent()` for P4.5 to filter by. SG-5's four decisions are
--   four enum values: `photo_team_album`, `photo_club_website`,
--   `photo_social_media`, `photo_press`. "Absence of a row = no consent" holds
--   by construction. Per-season scoping is `expires_at` (set to the season's
--   `ends_on` at capture), which `has_active_consent()` already honours.
--   Recorded in DECISIONS.md.
--
--   Postgres refuses to USE a freshly added enum value in the same
--   transaction, so this file adds the values and nothing here references
--   them by literal; the tests and P4.5 do.
--
-- REGISTRATIONS
--   `registrations(person_id, season_id, team_id?, status, form jsonb,
--   submitted_by, submitted_at, decided_by, decided_at, decision_note)`.
--   Partial unique on (person, season) while pending/approved.
--   * Guard (BEFORE INSERT, SECURITY DEFINER): a MINOR's registration may be
--     submitted only by an active guardian of that child or by a club_admin;
--     an adult's by themself or a club_admin. service_role (no auth.uid())
--     passes — the Phase 3 import.
--   * Status machine (BEFORE UPDATE): pending → approved | rejected |
--     withdrawn; approved → withdrawn. Decisions are club_admin only; a
--     withdrawal may also come from the submitter / guardian. `decided_*`
--     stamped by the trigger. Identity columns immutable.
--   * On approval with a `team_id`, a live `team_memberships` (player) row is
--     created for the season if none exists — which means SG-6's composition
--     guard runs at approval time and an approval that would put a child on a
--     non-compliant team FAILS, naming the people at fault. Fail closed, at the
--     moment a human is looking.
--   * `form` is sensitive (medical, emergency contact): readable by the
--     subject, their active guardians, club_admin and safeguarding_lead;
--     never by coaches (P2.1's `is_team_staff` is deliberately not used here —
--     a coach needs the medical note at pitch-side, and that is a P4 accessor
--     with an audit row, not a blanket read).
--   * Audit: `registration.submitted` / `registration.decided` with
--     `{person_id, season_id, status}` — never the form.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table); data
-- touched: none; rollback: §8.
-- =============================================================================


-- =============================================================================
-- 1. SG-5 CONSENT TYPES
-- =============================================================================

alter type public.consent_type add value if not exists 'photo_team_album';
alter type public.consent_type add value if not exists 'photo_club_website';
alter type public.consent_type add value if not exists 'photo_social_media';
alter type public.consent_type add value if not exists 'photo_press';


-- =============================================================================
-- 2. registrations
-- =============================================================================

create type public.registration_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

create table public.registrations (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.people (id) on delete restrict,
  season_id      uuid not null references public.seasons (id) on delete restrict,
  team_id        uuid references public.teams (id) on delete set null,
  status         public.registration_status not null default 'pending',
  form           jsonb not null default '{}'::jsonb check (jsonb_typeof(form) = 'object'),
  form_version   text not null default '1',
  submitted_by   uuid references auth.users (id) on delete set null,
  submitted_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index registrations_live_idx
  on public.registrations (person_id, season_id) where status in ('pending', 'approved');
create index registrations_season_status_idx on public.registrations (season_id, status);
create index registrations_person_idx on public.registrations (person_id);

create trigger trg_registrations_updated
  before update on public.registrations
  for each row execute function public.set_updated_at();

comment on table public.registrations is
  'A person''s registration to play in a season, with the form answers captured. Minors are registered by an active guardian or a club_admin.';
comment on column public.registrations.form is
  'Form answers (emergency contact, medical notes, ...). Sensitive: subject, guardians, club_admin, safeguarding_lead only. Never copied into audit_log.';


-- =============================================================================
-- 3. GUARDS
-- =============================================================================

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
        raise exception 'registrations: an adult registers themself (or a club_admin does it for them)'
          using errcode = 'P0001';
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

create trigger trg_registrations_guard
  before insert or update on public.registrations
  for each row execute function public.registrations_guard();

create or replace function public.registrations_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          case when tg_op = 'INSERT' then 'registration.submitted' else 'registration.decided' end,
          'registrations', new.id::text,
          jsonb_build_object('person_id', new.person_id, 'season_id', new.season_id,
                             'team_id', new.team_id, 'status', new.status));
  return new;
end;
$$;

create trigger trg_registrations_audit
  after insert or update on public.registrations
  for each row execute function public.registrations_audit();


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

alter table public.registrations enable row level security;

create or replace function public.is_active_guardian_of(p_child uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.guardianships g
    where g.child_person_id = p_child
      and g.guardian_person_id = public.current_person_id()
      and g.ended_at is null
  );
$$;

create policy "registrations_admin_read" on public.registrations for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "registrations_admin_insert" on public.registrations for insert to authenticated
  with check (public.is_club_admin());
create policy "registrations_admin_update" on public.registrations for update to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "registrations_self_read" on public.registrations for select to authenticated
  using (person_id = public.current_person_id());
create policy "registrations_self_insert" on public.registrations for insert to authenticated
  with check (person_id = public.current_person_id());
create policy "registrations_self_withdraw" on public.registrations for update to authenticated
  using (person_id = public.current_person_id())
  with check (person_id = public.current_person_id() and status = 'withdrawn');

create policy "registrations_guardian_read" on public.registrations for select to authenticated
  using (public.is_active_guardian_of(person_id));
create policy "registrations_guardian_insert" on public.registrations for insert to authenticated
  with check (public.is_active_guardian_of(person_id));
create policy "registrations_guardian_withdraw" on public.registrations for update to authenticated
  using (public.is_active_guardian_of(person_id))
  with check (public.is_active_guardian_of(person_id) and status = 'withdrawn');


-- =============================================================================
-- 5. GRANTS
-- =============================================================================

revoke all privileges on public.registrations from anon, authenticated, service_role;
grant select, insert, update on public.registrations to authenticated;
grant select, insert, update, delete on public.registrations to service_role;

revoke all privileges on function public.is_active_guardian_of(uuid) from public, anon;
grant execute on function public.is_active_guardian_of(uuid) to authenticated, service_role;
revoke all privileges on function public.registrations_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.registrations_audit() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 8. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop table public.registrations; drop type public.registration_status;
-- drop function public.is_active_guardian_of(uuid), public.registrations_guard(),
-- public.registrations_audit(). Enum values cannot be removed from
-- consent_type (Postgres has no DROP VALUE); they are harmless unused labels.
