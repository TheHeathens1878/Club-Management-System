-- =============================================================================
-- BASELINE MIGRATION — aomsc-function-room (Supabase project rwpglslbkhsqyxjhnpue)
-- =============================================================================
-- PLAN.md task P0.2.
--
-- WHAT THIS IS
--   A single squashed baseline that reproduces the *entire* current production
--   schema of the `public` schema as it existed on 2026-08-21. It is the
--   starting point for all future CLI-managed migrations; every subsequent
--   change to the platform goes in a new timestamped migration on top of this.
--
-- HOW IT WAS GENERATED
--   Reconstructed on 2026-08-21 by reading the live production system catalogs
--   over MCP (read-only SELECTs against pg_attribute / pg_constraint /
--   pg_indexes / pg_trigger / pg_policies / pg_proc / pg_type / pg_extension).
--   `supabase db pull` was NOT available in that session, so this file is a
--   hand-assembled equivalent of its output rather than a literal pg_dump.
--
-- !! DO NOT RUN THIS AGAINST PRODUCTION !!
--   Production already has this schema. Mark it as applied instead:
--
--       supabase migration repair --status applied 20260821000000
--
--   This file is meant to be *executed* only against a fresh database: local
--   `supabase start`, a Supabase preview branch, or CI.
--
-- SCOPE / OMISSIONS
--   * Schema only. No data. The seed rows that live in bank_holidays,
--     site_settings and email_templates are data, not schema — see
--     supabase/seed.sql.
--   * Grants: production carries only the stock Supabase defaults (ALL
--     privileges to anon/authenticated/service_role via `alter default
--     privileges`, PUBLIC EXECUTE on functions); nothing is revoked. They are
--     nevertheless stated explicitly in section 9 because the CLI's local
--     shadow database does not apply the hosted default privileges, and
--     without them `supabase db diff` reports every grant as missing.
--   * There are no views, materialized views, storage buckets, storage
--     policies, table/column comments, cron jobs or realtime publications
--     beyond the Supabase defaults.
--   * The auth.users trigger `on_auth_user_created` IS included (last section)
--     because it calls a public function and is load-bearing for profiles.
--
-- CONTENTS
--   1. Extensions          6. Row Level Security
--   2. Types               7. Policies
--   3. Tables              8. auth.users trigger
--   4. Indexes             9. Grants
--   5. Functions & triggers
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- btree_gist lives in `public` on prod (not `extensions`) because the
-- room_bookings_no_overlap EXCLUDE constraint needs its `uuid WITH =` operator
-- class resolvable from the table's own schema. Do not relocate it.

create extension if not exists btree_gist with schema public;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;

-- plpgsql (pg_catalog) and supabase_vault (vault) are provisioned by the
-- platform and are not declared here. pg_cron is NOT installed on this project.


-- =============================================================================
-- 2. TYPES
-- =============================================================================
-- Value order matters: it is the enum's sort order on prod. Never reorder;
-- append new values with `alter type ... add value` in a later migration.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum (
      'committee',
      'bar',
      'bar_manager',
      'member',
      'super_user',
      'staff'
    );
  end if;
end $$;


-- =============================================================================
-- 3. TABLES
-- =============================================================================
-- Ordered so that every FK target exists before its referrer.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users row, created by the on_auth_user_created
-- trigger. Carries role (drives all RLS) and bar pay settings.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                       uuid primary key
                             references auth.users (id) on delete cascade,
  role                     public.user_role not null default 'member'::public.user_role,
  full_name                text,
  created_at               timestamptz not null default now(),
  bar_hourly_rate_pence    integer,
  bar_pay_type             text,
  bar_overtime_rate_pence  integer,
  bar_contracted_hours     numeric,
  holiday_allowance_days   numeric
);

-- ---------------------------------------------------------------------------
-- function_rooms — bookable rooms and their pricing model.
-- ---------------------------------------------------------------------------
create table public.function_rooms (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  capacity              integer,
  price_pence_per_hour  integer,
  price_pence_half_day  integer,
  price_pence_full_day  integer,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  resources             text[] not null default '{}'::text[],
  price_pence_fixed     integer,
  price_note            text,
  information           text,
  extras_config         jsonb not null default '[]'::jsonb,
  standard_price_pence  integer,
  standard_hours        numeric,
  extra_hour_pence      integer
);

-- ---------------------------------------------------------------------------
-- non_user_staff — staff who have no auth.users account (casual bar staff).
-- ---------------------------------------------------------------------------
create table public.non_user_staff (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  bar_hourly_rate_pence    integer,
  bar_pay_type             text,
  bar_overtime_rate_pence  integer,
  bar_contracted_hours     numeric
);

-- ---------------------------------------------------------------------------
-- clubhouse_checklists — recurring weekly checklist templates.
-- ---------------------------------------------------------------------------
create table public.clubhouse_checklists (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  items        jsonb not null default '[]'::jsonb,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  assignees    jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- clubhouse_projects — maintenance / improvement project tracker.
-- ---------------------------------------------------------------------------
create table public.clubhouse_projects (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  importance        text not null default 'medium'::text,
  progress          text not null default 'not_started'::text,
  cost_pence        integer not null default 0,
  sort_order        integer not null default 0,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  assigned_to_id    uuid references auth.users (id) on delete set null,
  assigned_to_name  text,
  due_date          date
);

-- ---------------------------------------------------------------------------
-- timesheets — one per week, holds the bar staff shifts for that week.
-- ---------------------------------------------------------------------------
create table public.timesheets (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null unique,
  status         text not null default 'draft'::text,
  submitted_at   timestamptz,
  submitted_by   uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewer_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- faqs — public-facing FAQ list on the hire pages.
-- ---------------------------------------------------------------------------
create table public.faqs (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- site_settings — flat key/value config store, keyed by text.
-- ---------------------------------------------------------------------------
create table public.site_settings (
  key         text primary key,
  value       text not null default ''::text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- bank_holidays — UK bank holiday calendar used by the rota/holiday logic.
-- ---------------------------------------------------------------------------
create table public.bank_holidays (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  title       text not null,
  source      text not null default 'manual'::text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- email_templates — editable transactional email bodies, looked up by `key`.
-- ---------------------------------------------------------------------------
create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  subject     text,
  body_html   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- ---------------------------------------------------------------------------
-- audit_log — append-only audit trail. `id` is an identity column (not a
-- serial): it owns sequence public.audit_log_id_seq implicitly.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references auth.users (id) on delete set null,
  actor_email  text,
  action       text not null,
  entity       text not null,
  entity_id    text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- holiday_requests — staff annual-leave requests and their committee review.
-- Note staff_profile_id references auth.users, not profiles.
-- ---------------------------------------------------------------------------
create table public.holiday_requests (
  id                uuid primary key default gen_random_uuid(),
  staff_profile_id  uuid references auth.users (id) on delete set null,
  staff_name        text not null,
  from_date         date not null,
  to_date           date not null,
  note              text,
  status            text not null default 'pending'::text,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewer_name     text,
  reviewer_note     text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- room_bookings — the core booking record. Overlap protection is enforced by
-- the room_bookings_no_overlap EXCLUDE constraint added after this table.
-- room_id has a plain FK with NO ON DELETE action (restrict/no action).
-- ---------------------------------------------------------------------------
create table public.room_bookings (
  id                                uuid primary key default gen_random_uuid(),
  room_id                           uuid not null references public.function_rooms (id),
  date                              date not null,
  start_time                        time not null,
  end_time                          time not null,
  booker_name                       text not null,
  booker_email                      text not null,
  booker_phone                      text,
  occasion                          text,
  estimated_guests                  integer,
  notes                             text,
  status                            text not null default 'pending'::text,
  amount_pence                      integer,
  stripe_checkout_id                text,
  stripe_ref                        text,
  payment_status                    text not null default 'unpaid'::text,
  internal_notes                    text,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  booking_type                      text not null default 'hire'::text,
  recurrence_group_id               uuid,
  payment_received_at               timestamptz,
  payment_received_by               text,
  payment_method                    text,
  payment_reference                 text,
  calendar_event_id                 text,
  booker_first_name                 text,
  booker_last_name                  text,
  total_pence                       integer,
  deposit_pence                     integer,
  deposit_due_date                  date,
  balance_due_date                  date,
  booker_profile_id                 uuid references public.profiles (id) on delete set null,
  deposit_reminder_sent_at          timestamptz,
  balance_reminder_sent_at          timestamptz,
  selected_extras                   jsonb not null default '[]'::jsonb,
  extras_total_pence                integer not null default 0,
  security_deposit_pence            integer not null default 0,
  security_deposit_returned_at      timestamptz,
  is_member                         boolean not null default false,
  membership_type                   text,
  member_number                     text,
  team_name                         text,
  child_name                        text,
  child_team                        text,
  base_hire_pence                   integer not null default 0,
  member_discount_pence             integer not null default 0,
  cancellation_warning_sent_at      timestamptz,
  security_deposit_returned_method  text,
  security_deposit_returned_note    text,
  confirmation_note                 text,
  deposit_terms_accepted_at         timestamptz,
  security_deposit_nudge_sent_at    timestamptz,
  quote_followup_sent_at            timestamptz,
  anonymised_at                     timestamptz,
  thank_you_sent_at                 timestamptz
);

-- No two pending/confirmed bookings may overlap in the same room. The tsrange
-- expression rolls an end_time that is earlier than start_time over midnight.
-- Requires btree_gist (for `room_id WITH =` on uuid).
alter table public.room_bookings
  add constraint room_bookings_no_overlap
  exclude using gist (
    room_id with =,
    tsrange(
      (date + start_time),
      ((date + end_time) + case when (end_time < start_time)
                                then '1 day'::interval
                                else '00:00:00'::interval
                           end)
    ) with &&
  )
  where ((status = any (array['pending'::text, 'confirmed'::text])));

-- ---------------------------------------------------------------------------
-- booking_emails — log of every email sent about a booking.
-- ---------------------------------------------------------------------------
create table public.booking_emails (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.room_bookings (id) on delete cascade,
  kind          text not null default 'manual'::text,
  to_email      text not null,
  cc            text,
  subject       text not null,
  body          text,
  sent_by       uuid references auth.users (id) on delete set null,
  sent_by_name  text,
  sent_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- booking_payments — individual payments taken against a booking.
-- ---------------------------------------------------------------------------
create table public.booking_payments (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid not null references public.room_bookings (id) on delete cascade,
  amount_pence            integer not null,
  paid_at                 timestamptz not null default now(),
  method                  text,
  reference               text,
  source                  text not null default 'manual'::text,
  sumup_checkout_id       text,
  sumup_txn_code          text,
  authorised_by_profile   uuid references public.profiles (id) on delete set null,
  authorised_by_name      text,
  authorised_by_email     text,
  note                    text,
  created_at              timestamptz not null default now(),
  constraint booking_payments_amount_pence_check check ((amount_pence > 0))
);

-- ---------------------------------------------------------------------------
-- clubhouse_project_notes — comment thread on a clubhouse project.
-- ---------------------------------------------------------------------------
create table public.clubhouse_project_notes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.clubhouse_projects (id) on delete cascade,
  body         text not null,
  author_id    uuid references auth.users (id) on delete set null,
  author_name  text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- clubhouse_checklist_runs — one run of a checklist for a given week.
-- ---------------------------------------------------------------------------
create table public.clubhouse_checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.clubhouse_checklists (id) on delete cascade,
  week_start    date not null,
  item_states   jsonb not null default '{}'::jsonb,
  notes         text,
  completed_at  timestamptz,
  completed_by  text,
  constraint clubhouse_checklist_runs_checklist_id_week_start_key
    unique (checklist_id, week_start)
);

-- ---------------------------------------------------------------------------
-- sickness_records — sickness absence for either an account holder
-- (staff_profile_id -> auth.users) or a non-user staff member.
-- ---------------------------------------------------------------------------
create table public.sickness_records (
  id                 uuid primary key default gen_random_uuid(),
  staff_profile_id   uuid references auth.users (id) on delete set null,
  non_user_staff_id  uuid references public.non_user_staff (id) on delete set null,
  staff_name         text not null,
  from_date          date not null,
  to_date            date,
  note               text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- staff_away — away/unavailable periods. Exactly one of staff_id (a profile)
-- or non_user_staff_id must be set, enforced by staff_away_one_staff_check.
-- ---------------------------------------------------------------------------
create table public.staff_away (
  id                 uuid primary key default gen_random_uuid(),
  staff_id           uuid references public.profiles (id) on delete cascade,
  from_date          date not null,
  to_date            date not null,
  note               text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  non_user_staff_id  uuid references public.non_user_staff (id) on delete cascade,
  constraint staff_away_dates_check check ((to_date >= from_date)),
  constraint staff_away_one_staff_check check (
    ((((staff_id is not null))::integer + ((non_user_staff_id is not null))::integer) = 1)
  )
);

-- ---------------------------------------------------------------------------
-- timesheet_shifts — individual shift lines within a weekly timesheet.
-- ---------------------------------------------------------------------------
create table public.timesheet_shifts (
  id                 uuid primary key default gen_random_uuid(),
  timesheet_id       uuid not null references public.timesheets (id) on delete cascade,
  staff_name         text not null,
  staff_profile_id   uuid references auth.users (id) on delete set null,
  non_user_staff_id  uuid references public.non_user_staff (id) on delete set null,
  work_date          date not null,
  start_time         time not null,
  end_time           time not null,
  break_minutes      integer not null default 0,
  work_type          text not null default 'Bar shift'::text,
  hourly_rate_pence  integer not null default 0,
  is_overtime        boolean not null default false,
  note               text,
  created_at         timestamptz not null default now()
);


-- =============================================================================
-- 4. INDEXES
-- =============================================================================
-- Non-constraint indexes only. PK / UNIQUE / EXCLUDE indexes are created
-- implicitly by their constraints above.

create index audit_entity_idx
  on public.audit_log using btree (entity, entity_id);

create index booking_emails_booking_idx
  on public.booking_emails using btree (booking_id);

create index booking_payments_booking_idx
  on public.booking_payments using btree (booking_id);

create index clubhouse_project_notes_project_idx
  on public.clubhouse_project_notes using btree (project_id);

create index staff_away_dates_idx
  on public.staff_away using btree (from_date, to_date);

create index staff_away_staff_id_idx
  on public.staff_away using btree (staff_id);

create index timesheet_shifts_ts_idx
  on public.timesheet_shifts using btree (timesheet_id);


-- =============================================================================
-- 5. FUNCTIONS & TRIGGERS
-- =============================================================================
-- The three is_* helpers are the entire basis of this project's RLS. They are
-- SECURITY DEFINER with a pinned search_path so that a policy on `profiles`
-- can read `profiles` without recursing into its own RLS.
--
-- Defined after the tables because a LANGUAGE sql function body is parsed and
-- validated at CREATE time, and these read public.profiles.

create or replace function public.is_committee()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('committee', 'super_user') from profiles where id = auth.uid()),
    false
  );
$function$;

create or replace function public.is_bar_manager()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('bar_manager', 'committee', 'super_user') from profiles where id = auth.uid()),
    false
  );
$function$;

create or replace function public.is_staff()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('committee', 'bar', 'bar_manager', 'super_user', 'staff') from profiles where id = auth.uid()),
    false
  );
$function$;

-- Generic updated_at stamper. NOT security definer on prod.
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end $function$;

-- Mirrors every new auth.users row into public.profiles as a 'member'.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  insert into profiles (id, role, full_name)
  values (new.id, 'member', new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $function$;

-- Only these two tables have updated_at triggers on prod. clubhouse_projects
-- and timesheets also have an updated_at column but NO trigger — the app
-- writes those columns itself. Do not "fix" that here; it is prod behaviour.
create trigger trg_email_templates_updated
  before update on public.email_templates
  for each row execute function public.set_updated_at();

create trigger trg_room_bookings_updated
  before update on public.room_bookings
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================
-- Every table in `public` has RLS enabled and none are FORCE'd (so the table
-- owner / service_role bypasses RLS, which is what the server-side code and
-- edge functions rely on).

alter table public.audit_log                enable row level security;
alter table public.bank_holidays            enable row level security;
alter table public.booking_emails           enable row level security;
alter table public.booking_payments         enable row level security;
alter table public.clubhouse_checklist_runs enable row level security;
alter table public.clubhouse_checklists     enable row level security;
alter table public.clubhouse_project_notes  enable row level security;
alter table public.clubhouse_projects       enable row level security;
alter table public.email_templates          enable row level security;
alter table public.faqs                     enable row level security;
alter table public.function_rooms           enable row level security;
alter table public.holiday_requests         enable row level security;
alter table public.non_user_staff           enable row level security;
alter table public.profiles                 enable row level security;
alter table public.room_bookings            enable row level security;
alter table public.sickness_records         enable row level security;
alter table public.site_settings            enable row level security;
alter table public.staff_away               enable row level security;
alter table public.timesheet_shifts         enable row level security;
alter table public.timesheets               enable row level security;


-- =============================================================================
-- 7. POLICIES
-- =============================================================================
-- 38 policies, all PERMISSIVE and all granted to role `public` (i.e. they apply
-- to anon and authenticated alike; the is_* helpers do the gating).
--
-- NOTE: public.non_user_staff and public.staff_away have RLS enabled but ZERO
-- policies on prod. They are therefore deny-all for anon/authenticated and are
-- only reachable via service_role. That is intentional — reproduce it as-is.

-- audit_log ------------------------------------------------------------------
create policy "audit_read" on public.audit_log
  for select
  using (public.is_committee());

-- bank_holidays --------------------------------------------------------------
create policy "bank_holidays_committee_write" on public.bank_holidays
  for all
  using (public.is_committee())
  with check (public.is_committee());

create policy "bank_holidays_staff_read" on public.bank_holidays
  for select
  using (public.is_staff());

-- booking_emails -------------------------------------------------------------
create policy "booking_emails_staff_insert" on public.booking_emails
  for insert
  with check (public.is_staff());

create policy "booking_emails_staff_read" on public.booking_emails
  for select
  using (public.is_staff());

-- booking_payments -----------------------------------------------------------
create policy "booking_payments_staff_all" on public.booking_payments
  for all
  using (public.is_staff())
  with check (public.is_staff());

-- clubhouse_checklist_runs ---------------------------------------------------
create policy "checklist_runs_committee_delete" on public.clubhouse_checklist_runs
  for delete
  using (public.is_committee());

create policy "checklist_runs_staff_insert" on public.clubhouse_checklist_runs
  for insert
  with check (public.is_staff());

create policy "checklist_runs_staff_read" on public.clubhouse_checklist_runs
  for select
  using (public.is_staff());

-- Deliberately has USING but no WITH CHECK on prod.
create policy "checklist_runs_staff_update" on public.clubhouse_checklist_runs
  for update
  using (public.is_staff());

-- clubhouse_checklists -------------------------------------------------------
create policy "checklists_committee_write" on public.clubhouse_checklists
  for all
  using (public.is_committee())
  with check (public.is_committee());

create policy "checklists_staff_read" on public.clubhouse_checklists
  for select
  using (public.is_staff());

-- clubhouse_project_notes ----------------------------------------------------
create policy "clubhouse_notes_committee_delete" on public.clubhouse_project_notes
  for delete
  using (public.is_committee());

create policy "clubhouse_notes_staff_read" on public.clubhouse_project_notes
  for select
  using (public.is_staff());

create policy "clubhouse_notes_staff_write" on public.clubhouse_project_notes
  for insert
  with check (public.is_staff());

-- clubhouse_projects ---------------------------------------------------------
create policy "clubhouse_projects_committee_write" on public.clubhouse_projects
  for all
  using (public.is_committee())
  with check (public.is_committee());

create policy "clubhouse_projects_staff_read" on public.clubhouse_projects
  for select
  using (public.is_staff());

-- email_templates ------------------------------------------------------------
create policy "email_templates_committee" on public.email_templates
  for all
  using (public.is_committee())
  with check (public.is_committee());

-- faqs -----------------------------------------------------------------------
create policy "faqs_committee_write" on public.faqs
  for all
  using (public.is_committee())
  with check (public.is_committee());

-- Intentionally world-readable: the public hire pages render FAQs anonymously.
create policy "faqs_public_read" on public.faqs
  for select
  using (true);

-- function_rooms -------------------------------------------------------------
create policy "rooms_committee" on public.function_rooms
  for all
  using (public.is_committee())
  with check (public.is_committee());

-- Anonymous visitors can see active rooms only.
create policy "rooms_public_read" on public.function_rooms
  for select
  using ((active = true));

-- holiday_requests -----------------------------------------------------------
create policy "holiday_requests_committee_write" on public.holiday_requests
  for all
  using (public.is_committee())
  with check (public.is_committee());

create policy "holiday_requests_own_insert" on public.holiday_requests
  for insert
  with check ((public.is_staff() and (staff_profile_id = auth.uid())));

create policy "holiday_requests_own_read" on public.holiday_requests
  for select
  using ((public.is_staff() and ((staff_profile_id = auth.uid()) or public.is_committee())));

-- profiles -------------------------------------------------------------------
create policy "profiles_committee_update" on public.profiles
  for update
  using (public.is_committee())
  with check (public.is_committee());

create policy "profiles_self_read" on public.profiles
  for select
  using (((id = auth.uid()) or public.is_committee()));

-- room_bookings --------------------------------------------------------------
create policy "bookings_committee_write" on public.room_bookings
  for all
  using (public.is_committee())
  with check (public.is_committee());

create policy "bookings_staff_insert" on public.room_bookings
  for insert
  with check (public.is_staff());

create policy "bookings_staff_read" on public.room_bookings
  for select
  using (public.is_staff());

create policy "bookings_staff_update" on public.room_bookings
  for update
  using (public.is_staff())
  with check (public.is_staff());

-- sickness_records -----------------------------------------------------------
create policy "sickness_committee_all" on public.sickness_records
  for all
  using (public.is_committee())
  with check (public.is_committee());

-- site_settings --------------------------------------------------------------
-- Policy names contain spaces on prod (created via the dashboard). Keep them
-- byte-identical so `supabase db diff` stays clean.
create policy "Anyone can read site_settings" on public.site_settings
  for select
  using (true);

create policy "Committee can manage site_settings" on public.site_settings
  for all
  using (public.is_committee())
  with check (public.is_committee());

-- timesheet_shifts -----------------------------------------------------------
create policy "timesheet_shifts_manager_write" on public.timesheet_shifts
  for all
  using (public.is_bar_manager())
  with check (public.is_bar_manager());

create policy "timesheet_shifts_staff_read" on public.timesheet_shifts
  for select
  using (public.is_staff());

-- timesheets -----------------------------------------------------------------
create policy "timesheets_manager_write" on public.timesheets
  for all
  using (public.is_bar_manager())
  with check (public.is_bar_manager());

create policy "timesheets_staff_read" on public.timesheets
  for select
  using (public.is_staff());


-- =============================================================================
-- 8. auth.users TRIGGER
-- =============================================================================
-- Lives on auth.users but calls a public function, so it belongs in this
-- baseline. On a hosted project the migration runs as `postgres`, which owns
-- auth.users, so this succeeds. `drop if exists` first because a re-run of the
-- baseline against a partially-built database would otherwise fail.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 9. GRANTS
-- =============================================================================
-- Identical to what Supabase's default privileges produce on a hosted project
-- (verified against prod: 420 table grants, all three API roles, nothing
-- revoked). Stated explicitly so the schema is reproducible in environments
-- that lack those defaults (CLI shadow DB, plain Postgres in CI). RLS is what
-- actually restricts access; these grants are the platform norm.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables    in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all routines  in schema public to anon, authenticated, service_role;


-- =============================================================================
-- END OF BASELINE
-- =============================================================================
