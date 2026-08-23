-- =============================================================================
-- P3.3 — Neon pitch-booking import: legacy ids, waiting list, deferred
-- activation of safeguarding-gated rows, migrate_neon() + reconcile_neon()
-- =============================================================================
-- Source of truth for the mapping: MIGRATION_MAP.md §4 (Adam's decisions
-- 2026-08-23: 1a adult-DOB gate, 2a 30-day certification exemptions, 3a exact
-- email matches with auth.users are the same person).
--
-- Shape of the import (read MIGRATION_MAP §5 for the data):
--   * scripts/neon-restore.sh restores the Neon dump into a `neon_legacy`
--     schema (CamelCase Prisma tables: "User", "Team", "Booking", ...).
--   * `migrate_neon()` is idempotent (every target row carries a
--     `legacy_neon_*` key) and writes only what the safeguarding model allows
--     unconditionally: people, roles, teams, pitches, bookings, waiting list.
--   * Everything SG-4 / SG-6 gate on a KNOWN adult — guardianships and team
--     memberships — is queued in `neon_import_pending` and applied by
--     `apply_neon_pending()` once the person's DOB is known. Imported adults
--     all have NULL dob (MIGRATION_MAP §5.1); `complete_own_dob()` is the
--     first-login gate that supplies it. SG-0 is NOT relaxed anywhere: an
--     unknown-DOB import is a minor to every guard until the DOB arrives.
--   * Coaches without certifications get a 30-day `certification_exemptions`
--     row at activation (D-P3-2). The exemption guard requires a
--     safeguarding_lead granter, so activation waits for one to exist.
--   * `auth.users` rows are created OUTSIDE SQL by apps/web/scripts/neon-auth-import.mjs
--     (admin API with the bcrypt hash); `handle_new_user()` learns here to
--     adopt an existing adult person when the invite metadata AND the email
--     match.
--
-- Rollback: §9.
-- =============================================================================


-- =============================================================================
-- 0. neon_legacy STUBS
-- =============================================================================
-- The Prisma tables migrate_neon()/reconcile_neon() read, in the shape the
-- Neon dump has them (text cuid ids, enums as text here, timestamp(3) WITHOUT
-- time zone in UTC). They exist so the functions compile, lint and test
-- without a dump; scripts/neon-restore.sh drops and recreates the schema from
-- the real dump at rehearsal and cutover. Nothing but the owner and
-- service_role (through the two functions) may touch this schema: it will
-- hold personal data after the restore.

create schema if not exists neon_legacy;
revoke all on schema neon_legacy from public, anon, authenticated;

create table if not exists neon_legacy."User" (
  id text primary key, name text not null, email text not null, "passwordHash" text not null,
  role text not null default 'COACH', "clubRole" text, "contactPhone" text, "dateOfBirth" timestamp,
  "isActive" boolean not null default true, "isDelegatedOwner" boolean not null default false,
  "registeredAt" timestamp not null default now(), "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."Team" (
  id text primary key, name text not null, "ageGroup" text not null, "ageGroupTo" text,
  "contactName" text, "contactEmail" text, "contactPhone" text, notes text,
  "teamGender" text not null default 'MIXED', "isRecruiting" boolean not null default false,
  "isActive" boolean not null default true, "sessionDetails" text, "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."UserTeam" (
  id text primary key, "userId" text not null, "teamId" text not null, "displayName" text
);
create table if not exists neon_legacy."UserContact" (
  id text primary key, "parentUserId" text not null, "childUserId" text not null, relationship text,
  "isPrimary" boolean not null default false, "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."Venue" (
  id text primary key, name text not null, description text, info text,
  "isActive" boolean not null default true, "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."Pitch" (
  id text primary key, "venueId" text not null, name text not null, type text not null, description text,
  "isActive" boolean not null default true, "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."Booking" (
  id text primary key, "pitchId" text not null, "userId" text, "createdByUserId" text, "assignedCoachId" text,
  "teamId" text, "opponentTeamId" text, "bookingType" text not null default 'MATCH', "opponentType" text,
  "opponentName" text, title text not null, "bookedBy" text not null, "startTime" timestamp not null,
  "endTime" timestamp not null, notes text, "proposalNotes" text, "blockId" text,
  status text not null default 'PENDING', "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now()
);
create table if not exists neon_legacy."TrainingSession" (
  id text primary key, "pitchId" text not null, "startTime" timestamp not null, "endTime" timestamp not null,
  title text not null, notes text, "recurringGroupId" text, "createdByUserId" text not null,
  status text not null default 'CONFIRMED', "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now()
);
create table if not exists neon_legacy."TrainingSessionTeam" (
  id text primary key, "trainingSessionId" text not null, "teamId" text not null
);
create table if not exists neon_legacy."Closure" (
  id text primary key, scope text not null, "venueId" text, "pitchId" text, reason text,
  "startTime" timestamp not null, "endTime" timestamp not null, "isActive" boolean not null default true,
  "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now()
);
create table if not exists neon_legacy."ClubSettings" (
  id text primary key, "clubName" text not null, "adminEmail" text, "timeZone" text not null default 'Europe/London'
);
create table if not exists neon_legacy."WaitingListEntry" (
  id text primary key, "playerName" text not null, dob timestamp not null, "ageGroup" text not null,
  "schoolYear" text not null, "biologicalSex" text not null default 'MALE', "teamPreference" text, school text,
  "healthConditions" text, "parentName" text not null, "parentEmail" text not null, "parentPhone" text not null,
  "coachingInterest" boolean not null default false, "coachingNote" text, "dataConsent" boolean not null default false,
  status text not null default 'PENDING', priority integer, "reconfirmRequestedAt" timestamp,
  "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now()
);
create table if not exists neon_legacy."WaitingListNote" (
  id text primary key, "entryId" text not null, "authorId" text not null, body text not null,
  "createdAt" timestamp not null default now()
);
create table if not exists neon_legacy."WaitingListAccess" (
  id text primary key, "userId" text not null, "ageGroup" text not null, "grantedBy" text not null
);
create table if not exists neon_legacy."WaitingListAgeGroupConfig" (
  "ageGroup" text primary key, "isOpen" boolean not null default true,
  "isPubliclyAdvertised" boolean not null default false, "showCoachContact" boolean not null default false
);
create table if not exists neon_legacy."TeamApplication" (
  id text primary key, "teamId" text not null, "playerName" text not null, dob text not null,
  "parentName" text not null, "parentEmail" text not null, "parentPhone" text not null, message text,
  "playerSex" text not null default 'MALE', "previousExperience" text, "favouredPosition" text,
  status text not null default 'PENDING', "createdAt" timestamp not null default now(), "reviewedAt" timestamp
);


-- =============================================================================
-- 1. LEGACY KEYS
-- =============================================================================

alter table public.people    add column if not exists legacy_neon_user_id text;
alter table public.teams     add column if not exists legacy_neon_team_id text;
alter table public.resources add column if not exists legacy_neon_pitch_id text;
-- One text key for the three Neon sources that become bookings:
--   'booking:<id>' | 'training:<id>' | 'closure:<closureId>:<pitchId>'
alter table public.bookings  add column if not exists legacy_neon_ref text;

create unique index if not exists people_legacy_neon_user_idx    on public.people (legacy_neon_user_id)    where legacy_neon_user_id is not null;
create unique index if not exists teams_legacy_neon_team_idx     on public.teams (legacy_neon_team_id)     where legacy_neon_team_id is not null;
create unique index if not exists resources_legacy_neon_pitch_idx on public.resources (legacy_neon_pitch_id) where legacy_neon_pitch_id is not null;
create unique index if not exists bookings_legacy_neon_ref_idx   on public.bookings (legacy_neon_ref)      where legacy_neon_ref is not null;

comment on column public.people.legacy_neon_user_id is
  'Neon pitch-booking "User".id (cuid) this person was imported from (P3.3). NULL for everyone else.';
comment on column public.bookings.legacy_neon_ref is
  'P3.3 idempotency key: booking:<id> | training:<id> | closure:<closureId>:<pitchId>.';


-- =============================================================================
-- 2. WAITING LIST (Neon WaitingListEntry / Note / Access / AgeGroupConfig)
-- =============================================================================
-- Children's data (name, DOB, school, health conditions) supplied by a parent
-- on a public form. Readers: club_admin, and coaches granted an age group.
-- Writers: club_admin; the public form goes through
-- submit_waiting_list_entry() (SECURITY DEFINER, validated) — anon holds no
-- table privilege at all. service_role is revoked per SAFEGUARDING.md §2 and
-- reaches the rows only through the functions below.

create type public.waiting_list_status as enum
  ('pending', 'contacted', 'trialling', 'accepted', 'rejected', 'withdrawn', 'uncontactable');

create table public.waiting_list_age_groups (
  age_group              text primary key,
  is_open                boolean not null default true,
  is_publicly_advertised boolean not null default false,
  show_coach_contact     boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint waiting_list_age_groups_not_blank check (btrim(age_group) <> '')
);

create table public.waiting_list_entries (
  id                    uuid primary key default gen_random_uuid(),
  legacy_neon_entry_id  text,
  source                text not null default 'form',   -- 'form' | 'team_application' | 'import'
  player_name           text not null,
  dob                   date not null,
  age_group             text not null,
  school_year           text,
  biological_sex        text not null default 'MALE',
  team_preference       text,
  school                text,
  health_conditions     text,
  parent_name           text not null,
  parent_email          text not null,
  parent_phone          text not null,
  coaching_interest     boolean not null default false,
  coaching_note         text,
  data_consent          boolean not null default false,
  status                public.waiting_list_status not null default 'pending',
  priority              integer,
  reconfirm_requested_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint waiting_list_entries_player_not_blank check (btrim(player_name) <> ''),
  constraint waiting_list_entries_parent_not_blank check (btrim(parent_name) <> ''),
  constraint waiting_list_entries_email_format check (parent_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint waiting_list_entries_dob_past check (dob <= current_date),
  constraint waiting_list_entries_sex check (biological_sex in ('MALE', 'FEMALE')),
  constraint waiting_list_entries_source check (source in ('form', 'team_application', 'import'))
);
create unique index waiting_list_entries_legacy_idx on public.waiting_list_entries (legacy_neon_entry_id) where legacy_neon_entry_id is not null;
create index waiting_list_entries_age_group_idx on public.waiting_list_entries (age_group, status);

create table public.waiting_list_notes (
  id                uuid primary key default gen_random_uuid(),
  legacy_neon_note_id text,
  entry_id          uuid not null references public.waiting_list_entries (id) on delete cascade,
  author_person_id  uuid references public.people (id) on delete set null,
  body              text not null,
  created_at        timestamptz not null default now(),
  constraint waiting_list_notes_body_not_blank check (btrim(body) <> '')
);
create unique index waiting_list_notes_legacy_idx on public.waiting_list_notes (legacy_neon_note_id) where legacy_neon_note_id is not null;
create index waiting_list_notes_entry_idx on public.waiting_list_notes (entry_id);

create table public.waiting_list_access (
  person_id   uuid not null references public.people (id) on delete cascade,
  age_group   text not null,
  granted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (person_id, age_group)
);

create trigger trg_waiting_list_entries_updated
  before update on public.waiting_list_entries
  for each row execute function public.set_updated_at();
create trigger trg_waiting_list_age_groups_updated
  before update on public.waiting_list_age_groups
  for each row execute function public.set_updated_at();

alter table public.waiting_list_age_groups enable row level security;
alter table public.waiting_list_entries    enable row level security;
alter table public.waiting_list_notes      enable row level security;
alter table public.waiting_list_access     enable row level security;

-- age groups: anyone signed in may read (the public form needs the open list
-- via submit_waiting_list_entry / waiting_list_open_age_groups); admins write.
create policy "wl_age_groups_read"  on public.waiting_list_age_groups for select to authenticated using (true);
create policy "wl_age_groups_admin" on public.waiting_list_age_groups for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "wl_entries_admin" on public.waiting_list_entries for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());
create policy "wl_entries_coach_read" on public.waiting_list_entries for select to authenticated
  using (exists (select 1 from public.waiting_list_access a
                  where a.person_id = public.current_person_id() and a.age_group = waiting_list_entries.age_group));

create policy "wl_notes_admin" on public.waiting_list_notes for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());
create policy "wl_notes_coach_read" on public.waiting_list_notes for select to authenticated
  using (exists (select 1 from public.waiting_list_entries e
                   join public.waiting_list_access a on a.age_group = e.age_group
                  where e.id = waiting_list_notes.entry_id and a.person_id = public.current_person_id()));
create policy "wl_notes_coach_insert" on public.waiting_list_notes for insert to authenticated
  with check (author_person_id = public.current_person_id()
              and exists (select 1 from public.waiting_list_entries e
                            join public.waiting_list_access a on a.age_group = e.age_group
                           where e.id = waiting_list_notes.entry_id and a.person_id = public.current_person_id()));

create policy "wl_access_admin" on public.waiting_list_access for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());
create policy "wl_access_self_read" on public.waiting_list_access for select to authenticated
  using (person_id = public.current_person_id());

revoke all privileges on public.waiting_list_age_groups, public.waiting_list_entries,
                         public.waiting_list_notes, public.waiting_list_access
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.waiting_list_age_groups to authenticated;
grant select, insert, update         on public.waiting_list_entries    to authenticated;   -- no delete: status/withdrawn instead
grant select, insert                 on public.waiting_list_notes      to authenticated;
grant select, insert, delete         on public.waiting_list_access     to authenticated;

-- Public submission (the /waiting-list form, anon). Validates, refuses closed
-- age groups, never returns the row.
create or replace function public.submit_waiting_list_entry(
  p_player_name text, p_dob date, p_age_group text, p_school_year text,
  p_biological_sex text, p_team_preference text, p_school text, p_health_conditions text,
  p_parent_name text, p_parent_email text, p_parent_phone text,
  p_coaching_interest boolean, p_coaching_note text, p_data_consent boolean
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not coalesce(p_data_consent, false) then
    raise exception 'waiting list: data consent is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.waiting_list_age_groups g where g.age_group = p_age_group and g.is_open) then
    raise exception 'waiting list: age group % is not open' , p_age_group using errcode = 'P0001';
  end if;
  insert into public.waiting_list_entries (
    source, player_name, dob, age_group, school_year, biological_sex, team_preference, school,
    health_conditions, parent_name, parent_email, parent_phone, coaching_interest, coaching_note, data_consent
  ) values (
    'form', btrim(p_player_name), p_dob, p_age_group, nullif(btrim(p_school_year), ''), coalesce(p_biological_sex, 'MALE'),
    nullif(btrim(p_team_preference), ''), nullif(btrim(p_school), ''), nullif(btrim(p_health_conditions), ''),
    btrim(p_parent_name), lower(btrim(p_parent_email)), btrim(p_parent_phone),
    coalesce(p_coaching_interest, false), nullif(btrim(p_coaching_note), ''), true
  );
end $$;

create or replace function public.waiting_list_open_age_groups()
  returns table (age_group text, is_publicly_advertised boolean)
  language sql stable security definer set search_path = public
as $$
  select g.age_group, g.is_publicly_advertised from public.waiting_list_age_groups g where g.is_open order by 1;
$$;

revoke all privileges on function public.submit_waiting_list_entry(text, date, text, text, text, text, text, text, text, text, text, boolean, text, boolean) from public;
grant execute on function public.submit_waiting_list_entry(text, date, text, text, text, text, text, text, text, text, text, boolean, text, boolean) to anon, authenticated;
revoke all privileges on function public.waiting_list_open_age_groups() from public;
grant execute on function public.waiting_list_open_age_groups() to anon, authenticated;


-- =============================================================================
-- 3. DEFERRED ACTIVATION QUEUE
-- =============================================================================

create table public.neon_import_pending (
  id          bigint generated always as identity primary key,
  person_id   uuid not null references public.people (id) on delete cascade,
  kind        text not null,          -- 'guardianship' | 'membership'
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  attempts    integer not null default 0,
  last_error  text,
  applied_at  timestamptz,
  applied_id  uuid,
  constraint neon_import_pending_kind check (kind in ('guardianship', 'membership'))
);
create unique index neon_import_pending_key_idx on public.neon_import_pending (person_id, kind, (payload ->> 'key'));
create index neon_import_pending_open_idx on public.neon_import_pending (person_id) where applied_at is null;

comment on table public.neon_import_pending is
  'P3.3: guardianships and team memberships from the Neon import that SG-4/SG-6 cannot accept until the person''s DOB is known (and, for child-facing roles, a safeguarding_lead exists to grant the 30-day exemption). Applied by apply_neon_pending().';

alter table public.neon_import_pending enable row level security;
create policy "neon_import_pending_admin_read" on public.neon_import_pending for select to authenticated
  using (public.is_club_admin());
create policy "neon_import_pending_self_read" on public.neon_import_pending for select to authenticated
  using (person_id = public.current_person_id());
revoke all privileges on public.neon_import_pending from anon, authenticated, service_role;
grant select on public.neon_import_pending to authenticated;


-- =============================================================================
-- 4. handle_new_user(): adopt an existing ADULT person on invite
-- =============================================================================
-- P1.7's invite branch adopts a person only with an active app_account consent
-- (a minor's guardian granted it). Imported adults have no consent and no
-- DOB; SAFEGUARDING.md §SG-10 tolerates a profile for an unknown-DOB person.
-- Adoption of such a person is allowed only when BOTH the metadata person_id
-- AND the login email match the person — signUp() lets anyone set metadata,
-- so the metadata alone must never be enough.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_names       record;
  v_email       text;
  v_person      uuid;
  v_meta_person text;
  v_invited     uuid;
  v_invited_row public.people%rowtype;
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
              -- adult (or unknown-DOB, SG-10 tolerated) adoption: email must match
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
  select s.first_name, s.last_name
    into v_names
    from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;
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
  insert into public.people (first_name, last_name, email)
  values (v_names.first_name, v_names.last_name, v_email)
  returning id into v_person;
  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_person)
  on conflict (id) do nothing;
  return new;
end $function$;


-- =============================================================================
-- 5. apply_neon_pending()
-- =============================================================================
-- Tries every unapplied queue row (or one person's) in its own sub-transaction.
-- Guardianship rows need the guardian's DOB (SG-4 checks it); membership rows
-- need the member's DOB unless the member is a known minor, and child-facing
-- roles on teams with minors need certifications or an exemption, which this
-- function grants for 30 days on behalf of the current safeguarding_lead
-- (D-P3-2). Failures are recorded, never raised, so one stuck row cannot
-- block the rest. Idempotent: an applied row is never re-applied.

create or replace function public.apply_neon_pending(p_person_id uuid default null)
  returns table (applied integer, still_pending integer)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r          record;
  v_applied  integer := 0;
  v_season   uuid;
  v_lead     uuid;
  v_id       uuid;
  v_role     public.team_role;
  v_team     uuid;
begin
  select id into v_season from public.seasons where is_current;
  select r2.person_id into v_lead
    from public.person_roles r2
   where r2.role = 'safeguarding_lead' and r2.revoked_at is null
   order by r2.granted_at limit 1;

  -- guardianships first: a child's memberships and conversations lean on them
  for r in
    select q.* from public.neon_import_pending q
     where q.applied_at is null
       and (p_person_id is null or q.person_id = p_person_id)
     order by case q.kind when 'guardianship' then 0 else 1 end, q.id
  loop
    begin
      if r.kind = 'guardianship' then
        insert into public.guardianships (guardian_person_id, child_person_id, relationship, notes)
        values (r.person_id, (r.payload ->> 'child_person_id')::uuid,
                (r.payload ->> 'relationship')::public.guardian_relationship,
                'imported from Neon pitch-booking (P3.3)')
        on conflict do nothing
        returning id into v_id;
        if v_id is null then
          select g.id into v_id from public.guardianships g
           where g.guardian_person_id = r.person_id
             and g.child_person_id = (r.payload ->> 'child_person_id')::uuid
             and g.ended_at is null;
        end if;
      else
        if v_season is null then
          raise exception 'no current season' using errcode = 'P0001';
        end if;
        v_role := (r.payload ->> 'role')::public.team_role;
        v_team := (r.payload ->> 'team_id')::uuid;
        -- SG-0: an unknown DOB is a minor. Never put an unknown-DOB import on
        -- a team — a "minor" coach would poison the team's composition for
        -- every child added afterwards. Wait for the DOB gate.
        if (select p.dob from public.people p where p.id = r.person_id) is null then
          raise exception 'date of birth unknown — waiting for the first-login DOB gate (SG-0)' using errcode = 'P0001';
        end if;
        if public.is_child_facing_role(v_role)
           and public.team_has_minors(v_team)
           and not public.is_child_facing_compliant(r.person_id, v_team)
        then
          if v_lead is null then
            raise exception 'no safeguarding_lead exists to grant the certification exemption (D-P3-2)' using errcode = 'P0001';
          end if;
          insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
          values (r.person_id, v_team,
                  'Neon pitch-booking import (D-P3-2): certifications to be recorded within 30 days',
                  v_lead, (now() at time zone 'Europe/London')::date + 30);
        end if;
        -- Adding a minor to a team whose child-facing members are not yet
        -- compliant: grant each of them the same 30-day exemption first.
        if public.is_minor(r.person_id) then
          if exists (select 1 from public.team_noncompliant_child_facing(v_team) n where n.person_id <> r.person_id) then
            if v_lead is null then
              raise exception 'no safeguarding_lead exists to grant the certification exemption (D-P3-2)' using errcode = 'P0001';
            end if;
            insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
            select n.person_id, v_team,
                   'Neon pitch-booking import (D-P3-2): certifications to be recorded within 30 days',
                   v_lead, (now() at time zone 'Europe/London')::date + 30
              from public.team_noncompliant_child_facing(v_team) n
             where n.person_id <> r.person_id;
          end if;
        end if;
        insert into public.team_memberships (person_id, team_id, season_id, role, notes)
        values (r.person_id, v_team, v_season, v_role,
                nullif('imported from Neon pitch-booking (P3.3)'
                       || coalesce('; ' || (r.payload ->> 'display_name'), ''), ''))
        on conflict do nothing
        returning id into v_id;
        if v_id is null then
          select m.id into v_id from public.team_memberships m
           where m.person_id = r.person_id and m.team_id = v_team and m.season_id = v_season
             and m.role = v_role and m.left_at is null;
        end if;
      end if;
      update public.neon_import_pending
         set applied_at = now(), applied_id = v_id, last_error = null, attempts = attempts + 1
       where id = r.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.neon_import_pending
         set attempts = attempts + 1, last_error = left(sqlerrm, 500)
       where id = r.id;
    end;
  end loop;

  return query
    select v_applied,
           (select count(*)::integer from public.neon_import_pending q
             where q.applied_at is null and (p_person_id is null or q.person_id = p_person_id));
end $$;

revoke all privileges on function public.apply_neon_pending(uuid) from public, anon, authenticated;
grant execute on function public.apply_neon_pending(uuid) to service_role;


-- =============================================================================
-- 6. First-login DOB gate
-- =============================================================================

-- TRUE when the caller is an imported person whose DOB is still unknown.
create or replace function public.needs_dob_completion()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people p
     where p.id = public.current_person_id()
       and p.dob is null
       and p.legacy_neon_user_id is not null
  );
$$;

-- The caller supplies their own DOB exactly once. Allowed only for an imported
-- person with no DOB (people has no self-update policy; everything else stays
-- committee-only). The existing people.dob guard (SG-1.2 / SG-6 (c)) runs on
-- the update as usual; then this person's queued rows are applied.
create or replace function public.complete_own_dob(p_dob date)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_person uuid := public.current_person_id();
begin
  if v_person is null then
    raise exception 'complete_own_dob: no person is linked to this account' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > current_date or p_dob < current_date - interval '120 years' then
    raise exception 'complete_own_dob: date of birth out of range' using errcode = 'P0001';
  end if;
  if not public.needs_dob_completion() then
    raise exception 'complete_own_dob: date of birth is already recorded — ask a club administrator to change it' using errcode = 'P0001';
  end if;
  update public.people set dob = p_dob where id = v_person and dob is null;
  perform public.write_audit('people.dob.self_completed', 'people', v_person::text,
                             jsonb_build_object('source', 'neon_import_gate'));
  perform public.apply_neon_pending(v_person);
end $$;

revoke all privileges on function public.needs_dob_completion() from public, anon;
grant execute on function public.needs_dob_completion() to authenticated, service_role;
revoke all privileges on function public.complete_own_dob(date) from public, anon;
grant execute on function public.complete_own_dob(date) to authenticated;


-- =============================================================================
-- 7. migrate_neon()
-- =============================================================================

create or replace function public.migrate_neon()
  returns table (
    people_upserted      integer,
    people_matched       integer,
    roles_granted        integer,
    teams_upserted       integer,
    pitches_upserted     integer,
    bookings_upserted    integer,
    waiting_list_upserted integer,
    queued               integer,
    applied_now          integer
  )
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_people   integer := 0;
  v_matched  integer := 0;
  v_roles    integer := 0;
  v_teams    integer := 0;
  v_pitches  integer := 0;
  v_bookings integer := 0;
  v_wl       integer := 0;
  v_queued   integer := 0;
  v_applied  integer := 0;
  v_n        integer;
  v_season   uuid;
  v_club_email text;
  v_bad      text;
  v_cand     record;
begin
  if to_regclass('neon_legacy."User"') is null then
    raise exception 'migrate_neon: neon_legacy."User" does not exist — run scripts/neon-restore.sh first' using errcode = 'P0001';
  end if;

  -- guard: every value the mapping depends on
  select string_agg(distinct role::text, ', ') into v_bad from neon_legacy."User"
   where role::text not in ('OWNER', 'ADMIN', 'COACH', 'PARENT', 'PLAYER');
  if v_bad is not null then
    raise exception 'migrate_neon: unmapped User.role %', v_bad using errcode = 'P0001';
  end if;
  select string_agg(distinct status::text, ', ') into v_bad from neon_legacy."Booking"
   where status::text not in ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED');
  if v_bad is not null then
    raise exception 'migrate_neon: unmapped Booking.status %', v_bad using errcode = 'P0001';
  end if;

  -- 7.1 season (P2.1 left none current)
  select id into v_season from public.seasons where is_current;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, is_current)
    values ('2026/27', date '2026-08-01', date '2027-07-31', true)
    returning id into v_season;
  end if;

  -- 7.2 people — D-P3-5 (3a): an exact email match with an auth.users account
  -- is the same person; otherwise a new person. Never link to a people row
  -- that has no account (P1.2 rule).
  update public.people p
     set legacy_neon_user_id = u.id
    from neon_legacy."User" u
    join auth.users au on lower(au.email) = lower(u.email)
    join public.profiles pr on pr.id = au.id
   where pr.person_id = p.id
     and p.legacy_neon_user_id is null
     and u.email not like '%@placeholder.invalid'
     and not exists (select 1 from public.people p2 where p2.legacy_neon_user_id = u.id);
  get diagnostics v_matched = row_count;

  insert into public.people (first_name, last_name, email, phone, dob, notes, legacy_neon_user_id, created_at)
  select s.first_name, s.last_name,
         case when u.email like '%@placeholder.invalid' then null else lower(u.email) end,
         nullif(btrim(u."contactPhone"), ''),
         u."dateOfBirth"::date,
         nullif(concat_ws(' · ',
           case when u."clubRole" is not null and btrim(u."clubRole") <> '' then 'Club role: ' || u."clubRole" end,
           case when not u."isActive" then 'Neon account was awaiting approval' end,
           'Imported from the pitch-booking app (Neon role ' || u.role::text || ')'
         ), ''),
         u.id, u."createdAt" at time zone 'UTC'
    from neon_legacy."User" u
    cross join lateral public.split_person_name(u.name) s
   where not exists (select 1 from public.people p where p.legacy_neon_user_id = u.id)
     -- a second Neon user with an email already taken by a people row (not an
     -- account) must still become a new person: drop the email, keep the name
  on conflict do nothing;
  get diagnostics v_people = row_count;

  -- email collisions with non-account people rows: insert without email
  insert into public.people (first_name, last_name, phone, dob, notes, legacy_neon_user_id, created_at)
  select s.first_name, s.last_name, nullif(btrim(u."contactPhone"), ''), u."dateOfBirth"::date,
         'Imported from the pitch-booking app (Neon role ' || u.role::text || '); email ' || lower(u.email) || ' already belongs to another member record — merge by hand',
         u.id, u."createdAt" at time zone 'UTC'
    from neon_legacy."User" u
    cross join lateral public.split_person_name(u.name) s
   where not exists (select 1 from public.people p where p.legacy_neon_user_id = u.id);
  get diagnostics v_n = row_count;
  v_people := v_people + v_n;

  -- 7.3 roles
  insert into public.person_roles (person_id, role, granted_by, notes)
  select p.id,
         case u.role::text when 'OWNER' then 'club_admin' when 'ADMIN' then 'club_admin'
                           when 'COACH' then 'coach' when 'PLAYER' then 'member' end::public.app_role,
         null, 'imported from Neon pitch-booking (P3.3)'
    from neon_legacy."User" u
    join public.people p on p.legacy_neon_user_id = u.id
   where u.role::text in ('OWNER', 'ADMIN', 'COACH', 'PLAYER')
     and u."isActive"
  on conflict (person_id, role) where revoked_at is null do nothing;
  get diagnostics v_roles = row_count;

  -- 7.4 teams — name carries the age group ("U05 Lions"), as the live app shows it
  insert into public.teams as t (name, age_group, active, notes, legacy_neon_team_id, created_at)
  select nt."ageGroup" || ' ' || nt.name,
         nt."ageGroup" || coalesce('–' || nt."ageGroupTo", ''),
         nt."isActive",
         nullif(concat_ws(' · ',
           'Gender: ' || nt."teamGender"::text,
           case when nt."isRecruiting" then 'Recruiting' end,
           nullif(btrim(nt.notes), ''),
           case when nt."contactName" is not null then 'Contact: ' || concat_ws(' ', nt."contactName", nt."contactEmail", nt."contactPhone") end,
           nullif(btrim(nt."sessionDetails"), '')
         ), ''),
         nt.id, nt."createdAt" at time zone 'UTC'
    from neon_legacy."Team" nt
  on conflict (legacy_neon_team_id) where legacy_neon_team_id is not null do update set
    name = excluded.name, age_group = excluded.age_group, active = excluded.active, notes = excluded.notes;
  get diagnostics v_teams = row_count;

  -- 7.5 pitches → resources
  insert into public.resources as r (type, name, description, information, active, sort_order, legacy_neon_pitch_id, created_at)
  select 'pitch', v.name || ' – ' || np.name,
         replace(np.type::text, '_', ' ') || coalesce(' · ' || nullif(btrim(np.description), ''), ''),
         nullif(concat_ws(E'\n', nullif(btrim(v.description), ''), nullif(btrim(v.info), '')), ''),
         np."isActive" and v."isActive",
         row_number() over (order by v.name, np.name)::integer,
         np.id, np."createdAt" at time zone 'UTC'
    from neon_legacy."Pitch" np
    join neon_legacy."Venue" v on v.id = np."venueId"
  on conflict (legacy_neon_pitch_id) where legacy_neon_pitch_id is not null do update set
    name = excluded.name, description = excluded.description, information = excluded.information, active = excluded.active;
  get diagnostics v_pitches = row_count;

  -- 7.6 bookings (matches → fixture, training/other → block), training sessions
  -- (block) and venue closures (maintenance, one per pitch of the venue).
  -- The legacy app never enforced "one thing per pitch at a time"; the
  -- unified bookings table does (GiST). Candidates are inserted one at a
  -- time, bookings first, then training, then closures: a row that collides
  -- with one already imported lands as 'cancelled' with a review note instead
  -- of aborting the run, and reconcile_neon() reports every such downgrade
  -- of a booking or training session (closures overlapping a live booking
  -- are tolerated).
  select coalesce(
           (select nullif(btrim("adminEmail"), '') from neon_legacy."ClubSettings" limit 1),
           (select lower(email) from neon_legacy."User" where role::text = 'OWNER' order by "createdAt" limit 1),
           'club@aomsportsclub.co.uk')
    into v_club_email;

  for v_cand in
    select * from (
      select 1 as src, nb."createdAt" as ord,
             r.id as resource_id,
             case when nb."bookingType"::text = 'MATCH' then 'fixture' else 'block' end::public.booking_kind as kind,
             case nb.status::text when 'PENDING' then 'pending' when 'CONFIRMED' then 'confirmed' else 'cancelled' end::public.booking_status as status,
             nb."startTime" at time zone 'UTC' as starts_at, nb."endTime" at time zone 'UTC' as ends_at,
             cp.id as booker_person_id,
             coalesce(nullif(btrim(nb."bookedBy"), ''), cu.name, 'Club') as booker_name,
             coalesce(case when cu.email like '%@placeholder.invalid' then null else lower(cu.email) end, v_club_email) as booker_email,
             nullif(btrim(cu."contactPhone"), '') as booker_phone,
             concat_ws(' v ', nb.title, coalesce(ot."ageGroup" || ' ' || ot.name, nullif(btrim(nb."opponentName"), ''))) as occasion,
             nullif(btrim(nb.notes), '') as notes,
             nullif(concat_ws(' · ',
               'Neon ' || nb."bookingType"::text || ' booking',
               case when nb.status::text = 'REJECTED' then 'rejected in Neon' end,
               case when nb."blockId" is not null then 'block ' || nb."blockId" end,
               nullif(btrim(nb."proposalNotes"), '')
             ), '') as internal_notes,
             t."ageGroup" || ' ' || t.name as team_name,
             null::uuid as recurrence_group_id,
             'booking:' || nb.id as legacy_neon_ref,
             nb."createdAt" at time zone 'UTC' as created_at, nb."updatedAt" at time zone 'UTC' as updated_at
        from neon_legacy."Booking" nb
        join public.resources r on r.legacy_neon_pitch_id = nb."pitchId"
        left join neon_legacy."User" cu on cu.id = coalesce(nb."createdByUserId", nb."userId")
        left join public.people cp on cp.legacy_neon_user_id = cu.id
        left join neon_legacy."Team" t on t.id = nb."teamId"
        left join neon_legacy."Team" ot on ot.id = nb."opponentTeamId"
      union all
      select 2, ts."createdAt",
             r.id, 'block'::public.booking_kind,
             case ts.status::text when 'PENDING' then 'pending' when 'CONFIRMED' then 'confirmed' else 'cancelled' end::public.booking_status,
             ts."startTime" at time zone 'UTC', ts."endTime" at time zone 'UTC',
             cp.id, coalesce(cu.name, 'Club'),
             coalesce(case when cu.email like '%@placeholder.invalid' then null else lower(cu.email) end, v_club_email),
             null,
             ts.title, nullif(btrim(ts.notes), ''), 'Neon training session',
             (select string_agg(t."ageGroup" || ' ' || t.name, ', ' order by t."ageGroup", t.name)
                from neon_legacy."TrainingSessionTeam" tst join neon_legacy."Team" t on t.id = tst."teamId"
               where tst."trainingSessionId" = ts.id),
             case when ts."recurringGroupId" is not null then extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'neon:training-group:' || ts."recurringGroupId") end,
             'training:' || ts.id,
             ts."createdAt" at time zone 'UTC', ts."updatedAt" at time zone 'UTC'
        from neon_legacy."TrainingSession" ts
        join public.resources r on r.legacy_neon_pitch_id = ts."pitchId"
        left join neon_legacy."User" cu on cu.id = ts."createdByUserId"
        left join public.people cp on cp.legacy_neon_user_id = cu.id
      union all
      select 3, c."createdAt",
             r.id, 'maintenance'::public.booking_kind,
             case when c."isActive" then 'confirmed' else 'cancelled' end::public.booking_status,
             c."startTime" at time zone 'UTC', c."endTime" at time zone 'UTC',
             null, 'Club', v_club_email, null,
             coalesce(nullif(btrim(c.reason), ''), 'Closure'), null,
             'Neon ' || c.scope::text || ' closure',
             null, null,
             'closure:' || c.id || ':' || np.id,
             c."createdAt" at time zone 'UTC', c."updatedAt" at time zone 'UTC'
        from neon_legacy."Closure" c
        join neon_legacy."Pitch" np on (c.scope::text = 'PITCH' and np.id = c."pitchId")
                                    or (c.scope::text = 'VENUE' and np."venueId" = c."venueId")
        join public.resources r on r.legacy_neon_pitch_id = np.id
    ) cands
    order by src, ord, legacy_neon_ref
  loop
    begin
      insert into public.bookings as b (
        resource_id, kind, status, starts_at, ends_at, booker_person_id, booker_name, booker_email, booker_phone,
        occasion, notes, internal_notes, team_name, recurrence_group_id, legacy_neon_ref, created_at, updated_at
      ) values (
        v_cand.resource_id, v_cand.kind, v_cand.status, v_cand.starts_at, v_cand.ends_at, v_cand.booker_person_id,
        v_cand.booker_name, v_cand.booker_email, v_cand.booker_phone, v_cand.occasion, v_cand.notes,
        v_cand.internal_notes, v_cand.team_name, v_cand.recurrence_group_id, v_cand.legacy_neon_ref,
        v_cand.created_at, v_cand.updated_at
      )
      on conflict (legacy_neon_ref) where legacy_neon_ref is not null do update set
        status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        occasion = excluded.occasion, notes = excluded.notes, internal_notes = excluded.internal_notes,
        team_name = excluded.team_name, updated_at = excluded.updated_at
      where b.internal_notes is null or b.internal_notes not like '%OVERLAP AT IMPORT%';
      v_bookings := v_bookings + 1;
    exception when exclusion_violation then
      insert into public.bookings as b (
        resource_id, kind, status, starts_at, ends_at, booker_person_id, booker_name, booker_email, booker_phone,
        occasion, notes, internal_notes, team_name, recurrence_group_id, legacy_neon_ref, created_at, updated_at
      ) values (
        v_cand.resource_id, v_cand.kind, 'cancelled', v_cand.starts_at, v_cand.ends_at, v_cand.booker_person_id,
        v_cand.booker_name, v_cand.booker_email, v_cand.booker_phone, v_cand.occasion, v_cand.notes,
        concat_ws(' · ', v_cand.internal_notes,
                  'OVERLAP AT IMPORT: was ' || v_cand.status::text || ' in Neon but clashes with another booking on this pitch — review'),
        v_cand.team_name, v_cand.recurrence_group_id, v_cand.legacy_neon_ref, v_cand.created_at, v_cand.updated_at
      )
      on conflict (legacy_neon_ref) where legacy_neon_ref is not null do nothing;
      v_bookings := v_bookings + 1;
    end;
  end loop;

  -- 7.7 waiting list
  insert into public.waiting_list_age_groups as g (age_group, is_open, is_publicly_advertised, show_coach_contact)
  select "ageGroup", "isOpen", "isPubliclyAdvertised", "showCoachContact" from neon_legacy."WaitingListAgeGroupConfig"
  on conflict (age_group) do update set
    is_open = excluded.is_open, is_publicly_advertised = excluded.is_publicly_advertised, show_coach_contact = excluded.show_coach_contact;

  insert into public.waiting_list_entries as e (
    legacy_neon_entry_id, source, player_name, dob, age_group, school_year, biological_sex, team_preference, school,
    health_conditions, parent_name, parent_email, parent_phone, coaching_interest, coaching_note, data_consent,
    status, priority, reconfirm_requested_at, created_at, updated_at
  )
  select w.id, 'import', w."playerName", w.dob::date, w."ageGroup", w."schoolYear", w."biologicalSex", w."teamPreference", w.school,
         w."healthConditions", w."parentName", lower(w."parentEmail"), w."parentPhone", w."coachingInterest", w."coachingNote", w."dataConsent",
         lower(w.status::text)::public.waiting_list_status, w.priority, w."reconfirmRequestedAt" at time zone 'UTC',
         w."createdAt" at time zone 'UTC', w."updatedAt" at time zone 'UTC'
    from neon_legacy."WaitingListEntry" w
  on conflict (legacy_neon_entry_id) where legacy_neon_entry_id is not null do update set
    status = excluded.status, priority = excluded.priority, updated_at = excluded.updated_at;
  get diagnostics v_wl = row_count;

  insert into public.waiting_list_entries as e (
    legacy_neon_entry_id, source, player_name, dob, age_group, biological_sex, team_preference,
    parent_name, parent_email, parent_phone, coaching_note, data_consent, status, created_at
  )
  select 'app:' || a.id, 'team_application', a."playerName",
         case
           when a.dob ~ '^\d{2}/\d{2}/\d{4}$' then to_date(a.dob, 'DD/MM/YYYY')
           when a.dob ~ '^\d{4}-\d{2}-\d{2}'  then left(a.dob, 10)::date
           else current_date
         end,
         t."ageGroup", coalesce(a."playerSex", 'MALE'), t."ageGroup" || ' ' || t.name,
         a."parentName", lower(a."parentEmail"), a."parentPhone",
         nullif(concat_ws(' · ', a.message, a."previousExperience", a."favouredPosition"), ''),
         true,
         case a.status::text when 'ACCEPTED' then 'accepted' when 'REJECTED' then 'rejected' else 'pending' end::public.waiting_list_status,
         a."createdAt" at time zone 'UTC'
    from neon_legacy."TeamApplication" a
    join neon_legacy."Team" t on t.id = a."teamId"
  on conflict (legacy_neon_entry_id) where legacy_neon_entry_id is not null do update set status = excluded.status;
  get diagnostics v_n = row_count;
  v_wl := v_wl + v_n;

  insert into public.waiting_list_notes (legacy_neon_note_id, entry_id, author_person_id, body, created_at)
  select n.id, e.id, p.id, n.body, n."createdAt" at time zone 'UTC'
    from neon_legacy."WaitingListNote" n
    join public.waiting_list_entries e on e.legacy_neon_entry_id = n."entryId"
    left join public.people p on p.legacy_neon_user_id = n."authorId"
  on conflict (legacy_neon_note_id) where legacy_neon_note_id is not null do nothing;

  insert into public.waiting_list_access (person_id, age_group)
  select p.id, a."ageGroup"
    from neon_legacy."WaitingListAccess" a
    join public.people p on p.legacy_neon_user_id = a."userId"
  on conflict do nothing;

  -- 7.8 queue the safeguarding-gated rows
  insert into public.neon_import_pending (person_id, kind, payload)
  select gp.id, 'guardianship',
         jsonb_build_object('key', c.id, 'child_person_id', cp.id,
           'relationship',
           case
             when c.relationship ~* '(mother|father|mum|dad|parent|son|daughter)' then 'parent'
             when c.relationship ~* 'step' then 'step_parent'
             when c.relationship ~* 'grand' then 'grandparent'
             when c.relationship ~* 'foster' then 'foster_carer'
             when c.relationship ~* 'guardian' then 'legal_guardian'
             else 'other'
           end)
    from neon_legacy."UserContact" c
    join public.people gp on gp.legacy_neon_user_id = c."parentUserId"
    join public.people cp on cp.legacy_neon_user_id = c."childUserId"
  on conflict do nothing;
  get diagnostics v_queued = row_count;

  insert into public.neon_import_pending (person_id, kind, payload)
  select p.id, 'membership',
         jsonb_build_object('key', ut.id, 'team_id', t.id,
           'role', case u.role::text when 'COACH' then 'coach' when 'PLAYER' then 'player' else 'manager' end,
           'display_name', ut."displayName")
    from neon_legacy."UserTeam" ut
    join neon_legacy."User" u on u.id = ut."userId"
    join public.people p on p.legacy_neon_user_id = u.id
    join public.teams t on t.legacy_neon_team_id = ut."teamId"
   where u.role::text in ('COACH', 'PLAYER', 'OWNER', 'ADMIN')   -- parents "follow" a team; not a membership
     and u."isActive"
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_queued := v_queued + v_n;

  select a.applied into v_applied from public.apply_neon_pending(null) a;

  perform public.write_audit('import.neon', 'neon_legacy', null,
    jsonb_build_object('people', v_people, 'matched', v_matched, 'roles', v_roles, 'teams', v_teams,
                       'pitches', v_pitches, 'bookings', v_bookings, 'waiting_list', v_wl,
                       'queued', v_queued, 'applied_now', v_applied));

  return query select v_people, v_matched, v_roles, v_teams, v_pitches, v_bookings, v_wl, v_queued, v_applied;
end $$;

revoke all privileges on function public.migrate_neon() from public, anon, authenticated;
grant execute on function public.migrate_neon() to service_role;

comment on function public.migrate_neon() is
  'Idempotent Neon pitch-booking → unified import (P3.3). Needs neon_legacy (scripts/neon-restore.sh). service_role only.';


-- =============================================================================
-- 8. reconcile_neon()
-- =============================================================================

create or replace function public.reconcile_neon()
  returns table ("check" text, legacy bigint, unified bigint, ok boolean)
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  return query
  with checks as (
    select 'User → people' as c,
           (select count(*) from neon_legacy."User") as l,
           (select count(*) from public.people where legacy_neon_user_id is not null) as u
    union all
    select 'User (real email, active) → people with email',
           (select count(*) from neon_legacy."User" where "isActive" and email not like '%@placeholder.invalid'),
           (select count(*) from public.people p join neon_legacy."User" u on u.id = p.legacy_neon_user_id
             where u."isActive" and u.email not like '%@placeholder.invalid'
               and (p.email is not null or p.notes like '%merge by hand%'))
    union all
    select 'User with dateOfBirth → people.dob',
           (select count(*) from neon_legacy."User" where "dateOfBirth" is not null),
           (select count(*) from public.people p join neon_legacy."User" u on u.id = p.legacy_neon_user_id
             where u."dateOfBirth" is not null and p.dob = u."dateOfBirth"::date)
    union all
    select 'OWNER/ADMIN → club_admin',
           (select count(*) from neon_legacy."User" where role::text in ('OWNER', 'ADMIN') and "isActive"),
           (select count(*) from neon_legacy."User" u join public.people p on p.legacy_neon_user_id = u.id
             join public.person_roles r on r.person_id = p.id and r.role = 'club_admin' and r.revoked_at is null
            where u.role::text in ('OWNER', 'ADMIN') and u."isActive")
    union all
    select 'COACH → coach',
           (select count(*) from neon_legacy."User" where role::text = 'COACH' and "isActive"),
           (select count(*) from neon_legacy."User" u join public.people p on p.legacy_neon_user_id = u.id
             join public.person_roles r on r.person_id = p.id and r.role = 'coach' and r.revoked_at is null
            where u.role::text = 'COACH' and u."isActive")
    union all
    select 'Team → teams', (select count(*) from neon_legacy."Team"),
           (select count(*) from public.teams where legacy_neon_team_id is not null)
    union all
    select 'Pitch → resources(pitch)', (select count(*) from neon_legacy."Pitch"),
           (select count(*) from public.resources where legacy_neon_pitch_id is not null and type = 'pitch')
    union all
    select 'Booking → bookings', (select count(*) from neon_legacy."Booking"),
           (select count(*) from public.bookings where legacy_neon_ref like 'booking:%')
    union all
    select 'Booking CONFIRMED → confirmed', (select count(*) from neon_legacy."Booking" where status::text = 'CONFIRMED'),
           (select count(*) from public.bookings where legacy_neon_ref like 'booking:%' and status = 'confirmed')
    union all
    select 'Booking MATCH → fixture', (select count(*) from neon_legacy."Booking" where "bookingType"::text = 'MATCH'),
           (select count(*) from public.bookings where legacy_neon_ref like 'booking:%' and kind = 'fixture')
    union all
    select 'Booking on the same pitch', (select count(*) from neon_legacy."Booking"),
           (select count(*) from public.bookings b join neon_legacy."Booking" nb on 'booking:' || nb.id = b.legacy_neon_ref
              join public.resources r on r.id = b.resource_id where r.legacy_neon_pitch_id = nb."pitchId")
    union all
    select 'Booking times round-trip (UTC)', (select count(*) from neon_legacy."Booking"),
           (select count(*) from public.bookings b join neon_legacy."Booking" nb on 'booking:' || nb.id = b.legacy_neon_ref
             where b.starts_at = nb."startTime" at time zone 'UTC' and b.ends_at = nb."endTime" at time zone 'UTC')
    union all
    select 'Booking/TrainingSession downgraded for overlap at import (must be 0)', 0::bigint,
           (select count(*) from public.bookings where (legacy_neon_ref like 'booking:%' or legacy_neon_ref like 'training:%')
              and internal_notes like '%OVERLAP AT IMPORT%')
    union all
    select 'TrainingSession → bookings(block)', (select count(*) from neon_legacy."TrainingSession"),
           (select count(*) from public.bookings where legacy_neon_ref like 'training:%' and kind = 'block')
    union all
    select 'Closure × pitches → bookings(maintenance)',
           (select count(*) from neon_legacy."Closure" c join neon_legacy."Pitch" np
              on (c.scope::text = 'PITCH' and np.id = c."pitchId") or (c.scope::text = 'VENUE' and np."venueId" = c."venueId")),
           (select count(*) from public.bookings where legacy_neon_ref like 'closure:%' and kind = 'maintenance')
    union all
    select 'WaitingListEntry → waiting_list_entries', (select count(*) from neon_legacy."WaitingListEntry"),
           (select count(*) from public.waiting_list_entries where source = 'import')
    union all
    select 'WaitingListEntry status=' || s, (select count(*) from neon_legacy."WaitingListEntry" where status::text = upper(s)),
           (select count(*) from public.waiting_list_entries where source = 'import' and status::text = s)
      from unnest(array['pending', 'contacted', 'trialling', 'accepted', 'rejected', 'withdrawn', 'uncontactable']) s
    union all
    select 'WaitingListNote → waiting_list_notes', (select count(*) from neon_legacy."WaitingListNote"),
           (select count(*) from public.waiting_list_notes where legacy_neon_note_id is not null)
    union all
    select 'TeamApplication → waiting_list_entries', (select count(*) from neon_legacy."TeamApplication"),
           (select count(*) from public.waiting_list_entries where source = 'team_application')
    union all
    select 'UserContact → queued or applied guardianships', (select count(*) from neon_legacy."UserContact"),
           (select count(*) from public.neon_import_pending where kind = 'guardianship')
    union all
    select 'UserTeam (coach/player/admin, active) → queued or applied memberships',
           (select count(*) from neon_legacy."UserTeam" ut join neon_legacy."User" u on u.id = ut."userId"
             where u.role::text in ('COACH', 'PLAYER', 'OWNER', 'ADMIN') and u."isActive"),
           (select count(*) from public.neon_import_pending where kind = 'membership')
  )
  select c, l, u, l = u from checks;
end $$;

revoke all privileges on function public.reconcile_neon() from public, anon, authenticated;
grant execute on function public.reconcile_neon() to service_role;

-- The auth import (apps/web/scripts/neon-auth-import.mjs) runs outside SQL:
-- Supabase Auth's admin API is the only supported way to create a user with
-- an existing bcrypt hash. This is the one read of neon_legacy it needs —
-- people who (a) were active, (b) have a real email, (c) have no auth.users
-- row yet. The hash leaves the database only through this service_role-only
-- function and only during the cutover window.
create or replace function public.neon_auth_import_candidates()
  returns table (person_id uuid, email text, password_hash text, full_name text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id, lower(u.email), u."passwordHash", u.name
    from neon_legacy."User" u
    join public.people p on p.legacy_neon_user_id = u.id
   where u."isActive"
     and u.email not like '%@placeholder.invalid'
     and (u."passwordHash" like '$2a$%' or u."passwordHash" like '$2b$%')   -- any bcrypt cost (the seeded owner is cost 10)
     and p.email is not null                         -- not the merge-by-hand cases
     -- a KNOWN minor gets no account here: that is P1.7's invite flow, which
     -- needs a guardian's app_account consent first (SG-10). Unknown-DOB
     -- adults go through (SAFEGUARDING.md §SG-10 tolerates the profile).
     and not (p.dob is not null and public.is_minor_dob(p.dob))
     and not exists (select 1 from auth.users au where lower(au.email) = lower(u.email))
   order by u."createdAt";
$$;
revoke all privileges on function public.neon_auth_import_candidates() from public, anon, authenticated;
grant execute on function public.neon_auth_import_candidates() to service_role;

-- Nightly retry: DOBs arrive through the gate one person at a time, and a
-- safeguarding_lead may be appointed after the cutover.
select cron.schedule('neon-pending-nightly', '30 3 * * *', $cron$ select public.apply_neon_pending(null) $cron$);

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- select cron.unschedule('neon-pending-nightly');
-- drop function public.reconcile_neon(), public.migrate_neon(), public.complete_own_dob(date),
--   public.needs_dob_completion(), public.apply_neon_pending(uuid),
--   public.waiting_list_open_age_groups(),
--   public.submit_waiting_list_entry(text, date, text, text, text, text, text, text, text, text, text, boolean, text, boolean);
-- restore handle_new_user() from 20260822140000_consents_settings.sql §handle_new_user;
-- drop table public.neon_import_pending, public.waiting_list_access, public.waiting_list_notes,
--   public.waiting_list_entries, public.waiting_list_age_groups;
-- drop type public.waiting_list_status;
-- alter table public.bookings drop column legacy_neon_ref; alter table public.resources drop column legacy_neon_pitch_id;
-- alter table public.teams drop column legacy_neon_team_id; alter table public.people drop column legacy_neon_user_id;
-- Imported rows are identifiable by their legacy_neon_* keys and can be deleted
-- in dependency order (bookings, memberships, exemptions, guardianships,
-- person_roles, people) — people and person_roles have no hard delete for
-- authenticated; run as the owner inside the write freeze.
