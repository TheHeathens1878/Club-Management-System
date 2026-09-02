-- Launch hardening (2026-09-02): what the database advisors found, triaged.
--
-- Three families of fix, none of which changes who may see or do anything:
--
--   1. Five RLS policies re-evaluated auth.uid()/role helpers for EVERY ROW
--      they filtered (advisor: auth_rls_initplan). Wrapping each call in a
--      scalar subselect hoists it into the statement's init-plan — asked
--      once, not once per row. `profiles_self_read` is the one that matters:
--      profiles is read on every single request the app serves.
--
--   2. Trigger functions were EXECUTE-able by anon and authenticated
--      (advisor: *_security_definer_function_executable). Nobody can call a
--      trigger function through PostgREST usefully, but the grant should not
--      exist at all. Revoked generically for every trigger-returning
--      function in public — a trigger still fires under its table's owner,
--      so this cannot break a write. Three member-only RPCs lose anon
--      EXECUTE the same way. The role predicates used INSIDE policies
--      (is_staff, is_committee, is_bar_manager) keep anon EXECUTE on
--      purpose: anon evaluates those policies on public screens, and the
--      public forms keep theirs (recruiting_teams, team_options,
--      signup_email_check, submit_waiting_list_entry,
--      waiting_list_open_age_groups).
--
--   3. Nine functions had a mutable search_path (advisor:
--      function_search_path_mutable) — every other function in the schema
--      pins it; these slipped through. Pinned.
--
-- Plus the foreign keys that real query paths actually hit, indexed
-- (advisor: unindexed_foreign_keys, 105 flagged — the other ~95 are audit
-- columns nobody filters by, where an index would be pure write cost).

-- ---------------------------------------------------------------------------
-- 1. Init-plan the per-row policy calls. Semantics identical: these
-- functions are STABLE, so within one statement the hoisted answer is the
-- same answer every row would have computed.

alter policy profiles_self_read on public.profiles
  using ((id = (select auth.uid())) or (select public.is_committee()));

alter policy holiday_requests_own_read on public.holiday_requests
  using (
    (select public.is_staff())
    and ((staff_profile_id = (select auth.uid())) or (select public.is_committee()))
  );

alter policy holiday_requests_own_insert on public.holiday_requests
  with check (
    (select public.is_staff())
    and (staff_profile_id = (select auth.uid()))
  );

alter policy identity_documents_insert on public.identity_documents
  with check (
    (uploaded_by = (select auth.uid()))
    and (purged_at is null)
    and (public.can_act_for(person_id) or (select public.is_club_admin()))
  );

alter policy household_links_owner_read on public.household_links
  using (
    (owner_user_id = (select auth.uid()))
    or (select public.has_any_role(array['club_admin'::app_role, 'safeguarding_lead'::app_role]))
  );

-- ---------------------------------------------------------------------------
-- 2. Trigger functions are not API. Every trigger-returning function in
-- public loses anon/authenticated EXECUTE in one sweep, so the next
-- migration's trigger function is not a new hole to remember.

do $do$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from anon, authenticated', fn.sig);
  end loop;
end
$do$;

-- Member-only RPCs: signed-out visitors have no business asking. The app
-- only ever calls these with a session.
revoke execute on function public.event_people(uuid) from anon;
revoke execute on function public.my_events(integer) from anon;
revoke execute on function public.is_known_minor(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 3. Pin the nine stray search_paths.

alter function public.album_consent_type(album_visibility) set search_path = public;
alter function public.availability_for_response(event_response_status) set search_path = public;
alter function public.event_change_note(timestamptz, timestamptz, text, text) set search_path = public;
alter function public.event_slot_label(timestamptz, timestamptz) set search_path = public;
alter function public.event_type_for_competition(text) set search_path = public;
alter function public.fulltime_source_url(text, text) set search_path = public;
alter function public.identity_documents_guard() set search_path = public;
alter function public.registration_questions_guard() set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. The foreign keys real queries stand on.
--
--   message_attachments.message_id   — every thread render (.in on messages)
--   booking_teams.team_id            — the team page's pitch bookings
--   registrations.team_id            — the registrations desk, per team
--   selections.person_id             — a member's own selections (my_events)
--   media_albums.team_id/fixture_id  — the media tab; and fixture bulk delete
--   referee_match_posts.fixture_id   — fixture bulk delete (FK cascade scan)
--   identity_documents.registration_id — the approval desk's document check
--   board_reads.person_id            — unread notice-board counts, per person
--   events.venue_resource_id         — the pitch calendar, per resource

create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id);
create index if not exists booking_teams_team_idx
  on public.booking_teams (team_id);
create index if not exists registrations_team_idx
  on public.registrations (team_id);
create index if not exists selections_person_idx
  on public.selections (person_id);
create index if not exists media_albums_team_idx
  on public.media_albums (team_id);
create index if not exists media_albums_fixture_idx
  on public.media_albums (fixture_id);
create index if not exists referee_match_posts_fixture_idx
  on public.referee_match_posts (fixture_id);
create index if not exists identity_documents_registration_idx
  on public.identity_documents (registration_id);
create index if not exists board_reads_person_idx
  on public.board_reads (person_id);
create index if not exists events_venue_resource_idx
  on public.events (venue_resource_id);
