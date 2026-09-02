-- =============================================================================
-- A retired question stops being owed (20260902180000)
-- =============================================================================
--   A  before anything: an unverified person with no document needs one
--   B  the club retires the Proof of identity question — and now nobody
--      needs a document, because the club is not collecting them
--   C  restoring the question restores the ask, untouched
--   D  Player photo retires and restores the same way (Adam's other one)
--   E  the SG-5 photo permissions question still cannot be retired
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(8);

-- An administrator to ask the question, and a person to ask it about.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a11d0000-1234-4111-8111-0000000000a1', 'rqp-admin@test.invalid',
   '{"full_name":"Ada Admin","dob":"1975-03-03"}'::jsonb);
insert into public.person_roles (person_id, role)
select person_id, 'club_admin' from public.profiles
 where id = 'a11d0000-1234-4111-8111-0000000000a1';

insert into public.people (id, first_name, last_name, dob)
  values ('a11d0000-1234-4111-8111-0000000000b1', 'Paul', 'Player', '1990-05-05');

-- A ── the ask, as seeded ────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"a11d0000-1234-4111-8111-0000000000a1","role":"authenticated"}';
select ok(
  public.needs_id_document('a11d0000-1234-4111-8111-0000000000b1'),
  'an unverified person with no document on file needs one while the club asks');
reset role;
set local request.jwt.claims to '{}';

-- B ── the club stops asking ─────────────────────────────────────────────────

select lives_ok($$
  update public.registration_questions set archived_at = now() where qkey = 'id_document'
$$, 'the Proof of identity question can be retired (guard 20260901170000)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a11d0000-1234-4111-8111-0000000000a1","role":"authenticated"}';
select ok(
  not public.needs_id_document('a11d0000-1234-4111-8111-0000000000b1'),
  'while the question is retired, nobody needs a document — the nag follows the form');
reset role;
set local request.jwt.claims to '{}';

-- C ── next season, the club asks again ──────────────────────────────────────

select lives_ok($$
  update public.registration_questions set archived_at = null where qkey = 'id_document'
$$, 'and it can be restored');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a11d0000-1234-4111-8111-0000000000a1","role":"authenticated"}';
select ok(
  public.needs_id_document('a11d0000-1234-4111-8111-0000000000b1'),
  'restoring the question restores the ask exactly — nothing about the person moved');
reset role;
set local request.jwt.claims to '{}';

-- D ── Player photo pauses the same way ──────────────────────────────────────

select lives_ok($$
  update public.registration_questions set archived_at = now() where qkey = 'player_photo'
$$, 'Player photo can be retired for the season');
select lives_ok($$
  update public.registration_questions set archived_at = null where qkey = 'player_photo'
$$, 'and brought back next season');

-- E ── SG-5 stands ───────────────────────────────────────────────────────────

select throws_like($$
  update public.registration_questions set archived_at = now() where qkey = 'photo_consents'
$$, '%cannot be archived%SG-5%',
  'photo permissions is still the one question the club may never stop asking');

select * from finish();

rollback;
