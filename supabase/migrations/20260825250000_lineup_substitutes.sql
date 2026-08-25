-- =============================================================================
-- Substitutes — the bench, as slot keys SUB1..SUB7
-- =============================================================================
-- Adam, 2026-08-25 (evening, on the match page's Line-up tab): "Should be able
-- to drag and drop players on to the pitch and also substitutes."
--
-- WHAT CHANGES: NOTHING BUT THE DOCUMENTATION.
--
-- A substitute is not a second kind of record. It is a row in
-- `fixture_lineup_slots` whose slot key is 'SUB1'..'SUB7' instead of 'GK' or
-- 'CB1' — and everything the bench needs enforcing, the table already
-- enforces:
--
--   * unique (lineup_id, slot)      — one player per bench place;
--   * unique (lineup_id, person_id) — nobody on the pitch AND on the bench;
--   * fixture_lineup_slots_guard()  — a substitute must hold a live PLAYER
--     membership of the fixture's team for its season, exactly as a starter
--     must. The guard never looks at the slot key, so it needed no change.
--   * check (slot ~ '^[A-Z]{2,4}[0-9]?$') — 'SUB1'..'SUB9' already satisfy it.
--
-- The constraint is deliberately left alone rather than tightened to name the
-- bench explicitly. The slot vocabulary belongs to the web app
-- (`apps/web/src/lib/formations.ts`, where `BENCH_SIZE` is 7 and every
-- formation's keys are built), for the same reason the catalogue of formations
-- does: a new shape, or an eighth substitute, should be a pull request and not
-- a migration. What the database owes the bench is the uniqueness and the
-- safeguarding guard, and it already gives both.
--
-- The single digit the CHECK allows is the real ceiling, so `BENCH_SIZE` must
-- stay at 9 or below; there is a pgTAP test (`fixture_lineups.test.sql`, §E)
-- that fails the day someone tries 'SUB10'.
--
-- No RLS change: `fixture_lineup_slots_read` and
-- `fixture_lineup_slots_staff_write` are keyed on the lineup's team and say
-- nothing about slots, so a parent sees their child on the bench exactly as
-- they see them on the pitch, and only the team's staff and club admins name
-- one.
--
-- PR METADATA (PLAN.md §11): migrations y (comments only, no DDL that touches
-- data or structure); RLS n; data touched: none; rollback: restore the previous
-- comment text — see §2.
-- =============================================================================


-- =============================================================================
-- 1. COMMENTS
-- =============================================================================

comment on table public.fixture_lineup_slots is
  'Who stands on which slot key of the lineup: a formation slot (''GK'', ''CB1'', ''ST2'' — the keys the web app builds) or a bench place (''SUB1''..''SUB7''). Bench keys belong to no formation, so substitutes survive a change of shape. A placement is NOT a team membership and carries no SG-6 weight; the guard requires a live player membership on the fixture''s team, so nobody can be drawn onto a team they are not registered to — bench included.';

comment on column public.fixture_lineup_slots.slot is
  'A formation slot key or a bench place. Pitch keys come from the chosen formation in apps/web/src/lib/formations.ts; bench keys are ''SUB1''..''SUB7'' (BENCH_SIZE). The CHECK admits any 2-4 letter code with at most one digit, so the bench cannot run past ''SUB9''.';


-- =============================================================================
-- 2. ROLLBACK (documented, not executed)
-- =============================================================================
-- comment on table public.fixture_lineup_slots is
--   'Who stands on which slot key of the lineup''s formation. A placement is NOT a team membership and carries no SG-6 weight; the guard requires a live player membership on the fixture''s team, so nobody can be drawn onto a team they are not registered to.';
-- comment on column public.fixture_lineup_slots.slot is null;


-- =============================================================================
-- 3. SCHEMA RELOAD
-- =============================================================================

notify pgrst, 'reload schema';
