-- =============================================================================
-- P2.1 — seasons, teams, team_memberships, certifications, SG-6 tier 1
-- =============================================================================
-- PLAN.md task P2.1 ("teams, seasons, team_memberships (person, team, season,
-- role: player/coach/manager)"; acceptance: "RLS: coaches see own teams; admins
-- see all"). Linear TH1-18.
--
-- PURPOSE
--   The team model, and with it SAFEGUARDING.md SG-6 tier 1 in full — both
--   directions, through one shared STABLE evaluation function — because SG-6
--   is "a statement about the state of the team", and a team model without it
--   would be an invitation to reach the prohibited state before P4.3 arrives.
--
-- WHAT THIS FILE CREATES
--   * `seasons`, `teams`, enum `team_role` (player / coach / manager / assistant_coach),
--     `child_facing_roles` (the lookup §4 asks for — "not a hard-coded list in
--     a trigger"), `team_memberships` (soft `left_at`, partial unique on live
--     rows).
--   * `certification_type` (fa_dbs, safeguarding_children, first_aid,
--     coaching_badge), `certifications`, `certification_exemptions` — the
--     minimum P4.3 would otherwise create, brought forward so that SG-6's
--     triggers evaluate something real. P4.3 adds the nudge scheduler, the
--     nightly re-evaluation report and the compliance views, and fixes the
--     `safeguarding.certification.*` audit vocabulary this file already uses.
--   * Helpers, STABLE / SECURITY DEFINER / `search_path = public`, EXECUTE
--     revoked from `public` and `anon` by name:
--       `team_has_minors(team_id)`            — any live member who is_minor()
--       `is_child_facing_role(team_role)`     — reads the lookup
--       `is_child_facing_compliant(person_id, team_id)` — in-date fa_dbs AND
--           safeguarding_children (C3), or an active exemption for that team
--       `team_noncompliant_child_facing(team_id)` — the names the error carries
--   * `team_memberships_sg6_guard()` BEFORE INSERT OR UPDATE — tier 1 (a) and
--     (b); `people_dob_guard()` extended with tier 1 (c) at the marker P1.7
--     left — still the single dob trigger.
--   * SG-7 audit triggers: `safeguarding.certification.change` on
--     `certifications`; `safeguarding.certification.exemption` (granted / used /
--     revoked) on `certification_exemptions` and from the guard when an
--     exemption is what lets a membership through.
--   * SG-2 applied to `certifications` and `certification_exemptions`
--     (strengthening, §6.2): soft revoke only; DELETE/TRUNCATE revoked from all
--     three API roles; `deny_hard_delete()` + `deny_truncate()`.
--
-- WHAT IS DELIBERATELY NOT DONE
--   * No `coach` person_role is granted automatically from a coach membership.
--     §1.3's `coach` app role governs what the person may see app-wide; a
--     membership governs one team. An administrator grants the app role
--     deliberately; the RLS here keys on the membership, not the app role.
--   * Tier 2 (nudges, nightly report) and tier 3 (continuation block, D6) are
--     P4.3's — they are controls, not invariants.
--   * Required-certification set is fixed at {fa_dbs, safeguarding_children}
--     (C3). Making it configurable is a P4.3 question.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (six new tables); data
-- touched: `child_facing_roles` seeded (4 rows); rollback: §12.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.team_role as enum ('player', 'coach', 'assistant_coach', 'manager');
create type public.certification_type as enum ('fa_dbs', 'safeguarding_children', 'first_aid', 'coaching_badge');


-- =============================================================================
-- 2. seasons
-- =============================================================================

create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seasons_name_not_blank check (btrim(name) <> ''),
  constraint seasons_dates_valid    check (ends_on > starts_on)
);

create unique index seasons_one_current_idx on public.seasons ((true)) where is_current;

create trigger trg_seasons_updated
  before update on public.seasons
  for each row execute function public.set_updated_at();

comment on table public.seasons is 'Club seasons, e.g. 2026/27. At most one is_current.';


-- =============================================================================
-- 3. teams
-- =============================================================================

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  age_group   text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint teams_name_not_blank check (btrim(name) <> '')
);

create unique index teams_name_idx on public.teams (lower(name));

create trigger trg_teams_updated
  before update on public.teams
  for each row execute function public.set_updated_at();

comment on table public.teams is 'A team persists across seasons; membership is per season.';


-- =============================================================================
-- 4. child_facing_roles — the SG-6 lookup
-- =============================================================================

create table public.child_facing_roles (
  role          public.team_role primary key,
  child_facing  boolean not null,
  updated_at    timestamptz not null default now()
);

insert into public.child_facing_roles (role, child_facing) values
  ('player', false), ('coach', true), ('assistant_coach', true), ('manager', true);

create trigger trg_child_facing_roles_updated
  before update on public.child_facing_roles
  for each row execute function public.set_updated_at();

create or replace function public.child_facing_roles_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'child_facing_roles: rows are never deleted; every team_role must have a designation [SAFEGUARDING.md SG-6]'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_child_facing_roles_no_delete
  before delete on public.child_facing_roles
  for each row execute function public.child_facing_roles_guard();

comment on table public.child_facing_roles is
  'Which team_role values count as child-facing for SG-6. A lookup, not a hard-coded list in a trigger.';


-- =============================================================================
-- 5. certifications, certification_exemptions
-- =============================================================================

create table public.certifications (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete restrict,
  type         public.certification_type not null,
  reference    text,
  issued_on    date,
  expires_on   date,
  verified_by  uuid references auth.users (id) on delete set null,
  verified_at  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users (id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint certifications_dates_valid check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create index certifications_person_idx on public.certifications (person_id, type) where revoked_at is null;

create trigger trg_certifications_updated
  before update on public.certifications
  for each row execute function public.set_updated_at();
create trigger trg_certifications_deny_hard_delete
  before delete on public.certifications
  for each row execute function public.deny_hard_delete();
create trigger trg_certifications_deny_truncate
  before truncate on public.certifications
  for each statement execute function public.deny_truncate();

comment on table public.certifications is
  'DBS checks, safeguarding and coaching qualifications per person. Soft-revoke only (SG-2 extended).';

create table public.certification_exemptions (
  id                    uuid primary key default gen_random_uuid(),
  person_id             uuid not null references public.people (id) on delete restrict,
  team_id               uuid not null references public.teams (id) on delete restrict,
  reason                text not null,
  granted_by_person_id  uuid not null references public.people (id) on delete restrict,
  granted_at            timestamptz not null default now(),
  expires_on            date not null,
  revoked_at            timestamptz,
  revoked_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint certification_exemptions_reason_not_blank check (btrim(reason) <> ''),
  -- SG-6: "expires_on capped at 30 days from grant by a CHECK"
  constraint certification_exemptions_max_30_days check (expires_on <= (granted_at at time zone 'Europe/London')::date + 30),
  constraint certification_exemptions_not_past check (expires_on >= (granted_at at time zone 'Europe/London')::date)
);

create index certification_exemptions_live_idx on public.certification_exemptions (person_id, team_id) where revoked_at is null;

create trigger trg_certification_exemptions_deny_hard_delete
  before delete on public.certification_exemptions
  for each row execute function public.deny_hard_delete();
create trigger trg_certification_exemptions_deny_truncate
  before truncate on public.certification_exemptions
  for each statement execute function public.deny_truncate();

comment on table public.certification_exemptions is
  'SG-6 escape hatch: a safeguarding_lead lets a named person work with a named team for at most 30 days while paperwork clears. Never silent.';


-- =============================================================================
-- 6. team_memberships
-- =============================================================================

create table public.team_memberships (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete restrict,
  team_id     uuid not null references public.teams (id) on delete restrict,
  season_id   uuid not null references public.seasons (id) on delete restrict,
  role        public.team_role not null default 'player',
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  shirt_number integer check (shirt_number is null or shirt_number between 0 and 99),
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint team_memberships_left_after_joined check (left_at is null or left_at >= joined_at)
);

create unique index team_memberships_live_idx
  on public.team_memberships (person_id, team_id, season_id, role) where left_at is null;
create index team_memberships_team_idx   on public.team_memberships (team_id, season_id) where left_at is null;
create index team_memberships_person_idx on public.team_memberships (person_id) where left_at is null;

create trigger trg_team_memberships_updated
  before update on public.team_memberships
  for each row execute function public.set_updated_at();

comment on table public.team_memberships is
  'A person''s role in a team for a season. left_at is a soft end; history is kept (P5.3 keys off it).';


-- =============================================================================
-- 7. HELPERS
-- =============================================================================

create or replace function public.is_child_facing_role(p_role public.team_role)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce((select child_facing from public.child_facing_roles where role = p_role), true);
$$;
-- coalesce(..., true): an undesignated role fails CLOSED (treated as child-facing).

create or replace function public.team_has_minors(p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.team_id = p_team_id
      and m.left_at is null
      and public.is_minor(m.person_id)
  );
$$;

-- The C3 requirement: an in-date, verified, unrevoked fa_dbs AND
-- safeguarding_children. "In-date" = expires_on null or >= today.
create or replace function public.has_current_certification(p_person_id uuid, p_type public.certification_type)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.certifications c
    where c.person_id = p_person_id
      and c.type = p_type
      and c.revoked_at is null
      and c.verified_at is not null
      and (c.expires_on is null or c.expires_on >= current_date)
  );
$$;

create or replace function public.has_active_exemption(p_person_id uuid, p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.certification_exemptions e
    where e.person_id = p_person_id
      and e.team_id = p_team_id
      and e.revoked_at is null
      and e.expires_on >= current_date
  );
$$;

-- THE shared evaluation function. Every SG-6 entry point calls this and nothing
-- else, so the rule cannot drift between them.
create or replace function public.is_child_facing_compliant(p_person_id uuid, p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select (public.has_current_certification(p_person_id, 'fa_dbs')
          and public.has_current_certification(p_person_id, 'safeguarding_children'))
      or public.has_active_exemption(p_person_id, p_team_id);
$$;

-- Names (and ids) of every live child-facing member of a team who is not
-- compliant. Empty set = the team is compliant.
create or replace function public.team_noncompliant_child_facing(p_team_id uuid)
  returns table (person_id uuid, full_name text, role public.team_role)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select m.person_id, p.first_name || ' ' || p.last_name, m.role
  from public.team_memberships m
  join public.people p on p.id = m.person_id
  where m.team_id = p_team_id
    and m.left_at is null
    and public.is_child_facing_role(m.role)
    and not public.is_child_facing_compliant(m.person_id, p_team_id)
  order by p.last_name, p.first_name;
$$;

-- "Does the caller hold a live child-facing membership on this team?" — the
-- RLS hook for "coaches see own teams".
create or replace function public.is_team_staff(p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.team_id = p_team_id
      and m.left_at is null
      and m.person_id = public.current_person_id()
      and public.is_child_facing_role(m.role)
  );
$$;


-- =============================================================================
-- 8. SG-6 TIER 1 — THE GUARD ON team_memberships
-- =============================================================================

create or replace function public.team_memberships_sg6_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_names text;
  v_used_exemption boolean;
begin
  -- Only live rows can create the prohibited state.
  if new.left_at is not null then
    return new;
  end if;
  -- On UPDATE, only a change that creates/retargets a live membership matters.
  if tg_op = 'UPDATE'
     and new.person_id = old.person_id and new.team_id = old.team_id
     and new.role = old.role and old.left_at is null then
    return new;
  end if;

  -- (a) staff side: a child-facing role joining a team that contains minors.
  if public.is_child_facing_role(new.role) and public.team_has_minors(new.team_id) then
    if not public.is_child_facing_compliant(new.person_id, new.team_id) then
      raise exception
        'team_memberships: % may not hold the child-facing role % on a team containing minors without an in-date DBS check and safeguarding qualification (or a safeguarding_lead exemption) [SAFEGUARDING.md SG-6]',
        (select first_name || ' ' || last_name from public.people where id = new.person_id),
        new.role
        using errcode = 'P0001';
    end if;
    v_used_exemption := not (public.has_current_certification(new.person_id, 'fa_dbs')
                             and public.has_current_certification(new.person_id, 'safeguarding_children'))
                        and public.has_active_exemption(new.person_id, new.team_id);
    if v_used_exemption then
      insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
      select auth.uid(), (select email from auth.users where id = auth.uid()),
             'safeguarding.certification.exemption', 'certification_exemptions', e.id::text,
             jsonb_build_object('person_id', new.person_id, 'team_id', new.team_id,
                                'expires_on', e.expires_on, 'event', 'used')
      from public.certification_exemptions e
      where e.person_id = new.person_id and e.team_id = new.team_id
        and e.revoked_at is null and e.expires_on >= current_date
      order by e.granted_at desc limit 1;
    end if;
  end if;

  -- (b) composition side: a minor joining a team revalidates every child-facing
  -- member already on it.
  if public.is_minor(new.person_id) then
    select string_agg(full_name || ' (' || role || ')', ', ' order by full_name)
      into v_names
    from public.team_noncompliant_child_facing(new.team_id) n
    where n.person_id <> new.person_id;
    if v_names is not null then
      raise exception
        'team_memberships: a minor may not be added to this team while these child-facing members lack an in-date DBS check and safeguarding qualification: % [SAFEGUARDING.md SG-6]',
        v_names
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_team_memberships_sg6_guard
  before insert or update of person_id, team_id, role, left_at on public.team_memberships
  for each row execute function public.team_memberships_sg6_guard();


-- =============================================================================
-- 9. SG-6 TIER 1 (c) — THE SINGLE people_dob_guard(), EXTENDED
-- =============================================================================
-- P1.7's body verbatim, with the block inserted at the marker it left.

create or replace function public.people_dob_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_min_age integer;
  v_team record;
  v_names text;
begin
  if new.dob is not null and new.dob > current_date then
    raise exception
      'people.dob may not be in the future (got %, today is %)',
      new.dob, current_date;
  end if;

  -- SG-10: a dob correction must not turn an existing account holder into an
  -- ineligible minor.
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and new.dob is not null
     and public.is_minor_dob(new.dob)
     and exists (select 1 from public.profiles pr where pr.person_id = new.id)
     and not public.is_account_eligible(new.id)
  then
    v_min_age := public.safeguarding_setting_int('safeguarding.min_account_age');

    if not public.is_at_least_age(new.dob, v_min_age) then
      raise exception
        'people: dob % would make person % a minor of %, below the minimum account age of %, and they already hold an app account [SAFEGUARDING.md SG-10]',
        new.dob,
        new.id,
        date_part('year', age(current_date, new.dob))::integer,
        v_min_age;
    end if;

    raise exception
      'people: dob % would make person % a minor with no active app_account consent, and they already hold an app account [SAFEGUARDING.md SG-10]',
      new.dob, new.id;
  end if;

  -- SG-6 tier 1 (c): a dob correction that makes an existing team member a
  -- minor revalidates every team they are live on, on the same terms as (b).
  if tg_op = 'UPDATE'
     and new.dob is distinct from old.dob
     and public.is_minor_dob(new.dob)
     and not public.is_minor_dob(old.dob)
  then
    for v_team in
      select distinct m.team_id, t.name
      from public.team_memberships m join public.teams t on t.id = m.team_id
      where m.person_id = new.id and m.left_at is null
    loop
      select string_agg(full_name || ' (' || role || ')', ', ' order by full_name)
        into v_names
      from public.team_noncompliant_child_facing(v_team.team_id) n
      where n.person_id <> new.id;
      if v_names is not null then
        raise exception
          'people: dob % would make person % a minor on team "%", whose child-facing members lack an in-date DBS check and safeguarding qualification: % [SAFEGUARDING.md SG-6]',
          new.dob, new.id, v_team.name, v_names
          using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- P5.2 (SG-1.2) re-evaluation goes here.

  return new;
end $function$;


-- =============================================================================
-- 10. certifications / exemptions — GUARDS AND SG-7 AUDIT
-- =============================================================================

-- Exemption grant guard: granted by a safeguarding_lead (the PERSON named,
-- who must be the caller when there is one), never a club_admin.
create or replace function public.certification_exemptions_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.person_has_role(new.granted_by_person_id, 'safeguarding_lead') then
      raise exception
        'certification_exemptions: only a safeguarding_lead may grant an exemption (person % does not hold it) [SAFEGUARDING.md SG-6]',
        new.granted_by_person_id using errcode = 'P0001';
    end if;
    if auth.uid() is not null and new.granted_by_person_id is distinct from public.current_person_id() then
      raise exception
        'certification_exemptions: granted_by_person_id must be the caller [SAFEGUARDING.md SG-6]'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE: identity and term are immutable; only revocation is allowed.
  if new.person_id <> old.person_id or new.team_id <> old.team_id
     or new.reason <> old.reason or new.granted_by_person_id <> old.granted_by_person_id
     or new.granted_at <> old.granted_at or new.expires_on <> old.expires_on then
    raise exception
      'certification_exemptions: an exemption cannot be edited — revoke it and grant a fresh one [SAFEGUARDING.md SG-6]'
      using errcode = 'P0001';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'certification_exemptions: a revocation cannot be undone' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_certification_exemptions_guard
  before insert or update on public.certification_exemptions
  for each row execute function public.certification_exemptions_guard();

create or replace function public.certification_exemptions_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := case when new.revoked_at is null then 'granted' else null end;
  elsif new.revoked_at is not null and old.revoked_at is null then
    v_event := 'revoked';
  end if;
  if v_event is null then
    return new;
  end if;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'safeguarding.certification.exemption', 'certification_exemptions', new.id::text,
          jsonb_build_object('person_id', new.person_id, 'team_id', new.team_id,
                             'expires_on', new.expires_on, 'event', v_event));
  return new;
end;
$$;

create trigger trg_certification_exemptions_audit
  after insert or update on public.certification_exemptions
  for each row execute function public.certification_exemptions_audit();

create or replace function public.certifications_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.expires_on is not distinct from old.expires_on
     and new.revoked_at is not distinct from old.revoked_at
     and new.verified_at is not distinct from old.verified_at
     and new.type = old.type then
    return new;  -- cosmetic edit (reference, notes): nothing safeguarding-relevant changed
  end if;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'safeguarding.certification.change', 'certifications', new.id::text,
          jsonb_build_object('person_id', new.person_id, 'type', new.type,
                             'old_expiry', case when tg_op = 'UPDATE' then old.expires_on end,
                             'new_expiry', new.expires_on,
                             'verified', new.verified_at is not null,
                             'revoked', new.revoked_at is not null));
  return new;
end;
$$;

create trigger trg_certifications_audit
  after insert or update on public.certifications
  for each row execute function public.certifications_audit();


-- =============================================================================
-- 11. ROW LEVEL SECURITY
-- =============================================================================

alter table public.seasons                  enable row level security;
alter table public.teams                    enable row level security;
alter table public.child_facing_roles       enable row level security;
alter table public.team_memberships         enable row level security;
alter table public.certifications           enable row level security;
alter table public.certification_exemptions enable row level security;

-- seasons / teams: any logged-in person reads; club_admin writes.
create policy "seasons_read" on public.seasons for select to authenticated using (true);
create policy "seasons_admin_write" on public.seasons for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "teams_read" on public.teams for select to authenticated using (true);
create policy "teams_admin_write" on public.teams for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "child_facing_roles_read" on public.child_facing_roles for select to authenticated using (true);
create policy "child_facing_roles_lead_update" on public.child_facing_roles for update to authenticated
  using (public.is_safeguarding_lead()) with check (public.is_safeguarding_lead());

-- team_memberships: admins all; team staff read their team; self-read; guardian reads child's.
create policy "team_memberships_admin_read" on public.team_memberships for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "team_memberships_admin_insert" on public.team_memberships for insert to authenticated
  with check (public.is_club_admin());
create policy "team_memberships_admin_update" on public.team_memberships for update to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());
create policy "team_memberships_admin_delete" on public.team_memberships for delete to authenticated
  using (public.is_club_admin());
create policy "team_memberships_staff_read" on public.team_memberships for select to authenticated
  using (public.is_team_staff(team_id));
create policy "team_memberships_self_read" on public.team_memberships for select to authenticated
  using (person_id = public.current_person_id());
create policy "team_memberships_guardian_read" on public.team_memberships for select to authenticated
  using (exists (
    select 1 from public.guardianships g
    where g.child_person_id = team_memberships.person_id
      and g.guardian_person_id = public.current_person_id()
      and g.ended_at is null
      and public.is_minor(g.child_person_id)));

-- certifications: self-read; admins + lead read/write.
create policy "certifications_self_read" on public.certifications for select to authenticated
  using (person_id = public.current_person_id());
create policy "certifications_admin_read" on public.certifications for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "certifications_admin_insert" on public.certifications for insert to authenticated
  with check (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "certifications_admin_update" on public.certifications for update to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]))
  with check (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- exemptions: lead grants/revokes; club_admin reads.
create policy "certification_exemptions_admin_read" on public.certification_exemptions for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "certification_exemptions_lead_insert" on public.certification_exemptions for insert to authenticated
  with check (public.is_safeguarding_lead());
create policy "certification_exemptions_lead_update" on public.certification_exemptions for update to authenticated
  using (public.is_safeguarding_lead()) with check (public.is_safeguarding_lead());


-- =============================================================================
-- 12. GRANTS
-- =============================================================================

revoke all privileges on public.seasons, public.teams, public.child_facing_roles,
  public.team_memberships, public.certifications, public.certification_exemptions
  from anon, authenticated, service_role;

grant select, insert, update, delete on public.seasons, public.teams, public.team_memberships
  to authenticated, service_role;
grant select, update on public.child_facing_roles to authenticated, service_role;
grant select, insert, update on public.certifications, public.certification_exemptions
  to authenticated, service_role;
-- SG-2 on the two evidence tables: nothing may delete or truncate.
revoke delete, truncate on public.certifications, public.certification_exemptions, public.child_facing_roles
  from anon, authenticated, service_role;

revoke all privileges on function public.is_child_facing_role(public.team_role)                          from public, anon;
revoke all privileges on function public.team_has_minors(uuid)                                           from public, anon;
revoke all privileges on function public.has_current_certification(uuid, public.certification_type)      from public, anon;
revoke all privileges on function public.has_active_exemption(uuid, uuid)                                from public, anon;
revoke all privileges on function public.is_child_facing_compliant(uuid, uuid)                           from public, anon;
revoke all privileges on function public.team_noncompliant_child_facing(uuid)                            from public, anon;
revoke all privileges on function public.is_team_staff(uuid)                                             from public, anon;
grant execute on function public.is_child_facing_role(public.team_role)                     to authenticated, service_role;
grant execute on function public.team_has_minors(uuid)                                      to authenticated, service_role;
grant execute on function public.has_current_certification(uuid, public.certification_type) to authenticated, service_role;
grant execute on function public.has_active_exemption(uuid, uuid)                           to authenticated, service_role;
grant execute on function public.is_child_facing_compliant(uuid, uuid)                      to authenticated, service_role;
grant execute on function public.team_noncompliant_child_facing(uuid)                       to authenticated, service_role;
grant execute on function public.is_team_staff(uuid)                                        to authenticated, service_role;

revoke all privileges on function public.team_memberships_sg6_guard()       from public, anon, authenticated, service_role;
revoke all privileges on function public.certification_exemptions_guard()   from public, anon, authenticated, service_role;
revoke all privileges on function public.certification_exemptions_audit()   from public, anon, authenticated, service_role;
revoke all privileges on function public.certifications_audit()             from public, anon, authenticated, service_role;
revoke all privileges on function public.child_facing_roles_guard()         from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 13. ROLLBACK (documented, not executed)
-- =============================================================================
-- As postgres, one transaction: restore people_dob_guard() to its P1.7 body
-- (§11 of 20260822140000); drop tables certification_exemptions,
-- certifications, team_memberships, child_facing_roles, teams, seasons (in
-- that order); drop the twelve functions; drop types certification_type,
-- team_role. Audit rows stay. Destroys any certification/exemption rows — the
-- only circumstance in which those may be destroyed.
