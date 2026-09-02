-- =============================================================================
-- Launch hardening (20260902170000)
-- =============================================================================
--   A  the five advisor-flagged policies now hoist auth.uid()/role helpers
--      into an init-plan (asked once per statement, not once per row)
--   B  member-only RPCs are not anon's to call; the ones public screens and
--      RLS policies genuinely evaluate as anon keep their EXECUTE
--   C  no trigger-returning function in public is EXECUTE-able by anon or
--      authenticated — swept generically, so the check holds for functions
--      this migration never named
--   D  the nine stray search_paths are pinned
--   E  the ten targeted foreign-key indexes exist
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(23);

-- A ── init-planned policies ─────────────────────────────────────────────────

select alike(
  (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'profiles_self_read'),
  '%( SELECT auth.uid()%',
  'profiles_self_read asks auth.uid() once per statement'
);

select alike(
  (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'holiday_requests_own_read'),
  '%( SELECT is_staff()%',
  'holiday_requests_own_read asks is_staff() once per statement'
);

select alike(
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'holiday_requests_own_insert'),
  '%( SELECT auth.uid()%',
  'holiday_requests_own_insert asks auth.uid() once per statement'
);

select alike(
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'identity_documents_insert'),
  '%( SELECT auth.uid()%',
  'identity_documents_insert asks auth.uid() once per statement'
);

-- …and the row-dependent limb stayed per-row, because it must.
select alike(
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'identity_documents_insert'),
  '%can_act_for(person_id)%',
  'identity_documents_insert still asks can_act_for per row'
);

select alike(
  (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'household_links_owner_read'),
  '%( SELECT auth.uid()%',
  'household_links_owner_read asks auth.uid() once per statement'
);

-- B ── anon EXECUTE, revoked and kept ────────────────────────────────────────

select ok(
  not has_function_privilege('anon', 'public.my_events(integer)', 'execute'),
  'anon cannot call my_events'
);
select ok(
  not has_function_privilege('anon', 'public.event_people(uuid)', 'execute'),
  'anon cannot call event_people'
);
select ok(
  not has_function_privilege('anon', 'public.is_known_minor(uuid)', 'execute'),
  'anon cannot call is_known_minor'
);

-- Kept: policies public screens hit evaluate these AS anon, and the public
-- waiting-list form submits as anon.
select ok(
  has_function_privilege('anon', 'public.is_committee()', 'execute'),
  'anon keeps is_committee — it is a policy predicate'
);
select ok(
  (select bool_and(has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_waiting_list_entry'),
  'anon keeps submit_waiting_list_entry — the public form is anon'
);

-- C ── trigger functions are not API ─────────────────────────────────────────

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'no trigger-returning function in public is executable by anon or authenticated'
);

-- D ── search_path pinned ────────────────────────────────────────────────────

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('album_consent_type','availability_for_response',
                        'event_change_note','event_slot_label',
                        'event_type_for_competition','fulltime_source_url',
                        'identity_documents_guard','registration_questions_guard',
                        'set_updated_at')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                       where c like 'search_path=%')),
  0,
  'the nine advisor-flagged functions all pin search_path'
);

-- E ── the indexes real queries stand on ─────────────────────────────────────

select has_index('public', 'message_attachments', 'message_attachments_message_idx', 'thread attachments indexed by message');
select has_index('public', 'booking_teams', 'booking_teams_team_idx', 'booking_teams indexed by team');
select has_index('public', 'registrations', 'registrations_team_idx', 'registrations indexed by team');
select has_index('public', 'selections', 'selections_person_idx', 'selections indexed by person');
select has_index('public', 'media_albums', 'media_albums_team_idx', 'media albums indexed by team');
select has_index('public', 'media_albums', 'media_albums_fixture_idx', 'media albums indexed by fixture');
select has_index('public', 'referee_match_posts', 'referee_match_posts_fixture_idx', 'referee posts indexed by fixture');
select has_index('public', 'identity_documents', 'identity_documents_registration_idx', 'identity documents indexed by registration');
select has_index('public', 'board_reads', 'board_reads_person_idx', 'board reads indexed by person');
select has_index('public', 'events', 'events_venue_resource_idx', 'events indexed by venue resource');

select * from finish();

rollback;
