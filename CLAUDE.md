## Project plan
Read PLAN.md before starting any work. Follow its phases in order. Respect the
hard rules in §2: all schema changes via Supabase CLI migrations rehearsed on a
branch; RLS on every table; a written §11 review in the PR body for anything
touching member data, safeguarding, messaging, auth, payments or RLS — Adam
delegated the merge itself to Claude on 2026-09-01, so those PRs no longer wait
for him, but a PR that weakens a §2.4 safeguarding invariant still does. Update task statuses in PLAN.md
as you complete them.

## Attribution
No "Co-Authored-By: Claude" trailers in commit messages and no Claude/AI
authorship notes in code or comments.

## Sub-agents
Always use Opus (`model: "opus"`) for sub-agents spawned via the Agent tool.

## Systems in scope
- Supabase aomsc-function-room (rwpglslbkhsqyxjhnpue) — the target platform.
- Neon (pitch booking) — SOURCE for the Phase 3 migration. READ-ONLY, never write to it.

## Forbidden
Never touch Supabase projects fixtures-system (boeaggxhkxbzuiojlbqi) or
USC-Sale (nxmtjolusgeblmgucptn).

## Reference repos (siblings, added via additionalDirectories)
- ../aom-fc-pitch-booking — Neon app. Read-only reference for Phase 3. Do not modify.
- ../AoM-Sports-Club-Function-Room — existing function room app. Source for P0.4
  (imported into apps/web). Follow its existing RLS and audit_log conventions.

Also create .claude/settings.json with permissions.additionalDirectories set to
those two sibling paths. Then stop.