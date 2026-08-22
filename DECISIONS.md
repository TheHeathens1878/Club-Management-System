# Decisions log

Record of decisions made with Adam that are not derivable from the code. Newest last.
Format: date · task · decision · why.

| Date | Task | Decision | Why |
|---|---|---|---|
| 2026-08-21 | §3 | Decisions Q1–Q6 as recorded in PLAN.md §3 (Neon auth unknown → discover in P3.1; fixtures-system untouched, FA Full-Time import instead; USC-Sale out of scope; Supabase Storage for media; cutover ASAP after P3.3 gate; Cheshire FA safeguarding framework). | Resolved in planning session. |
| 2026-08-22 | P0.2 | Baseline migration reconstructed from live prod catalogs (not `db pull`) and marked applied with `migration repair`; prod's five functions re-saved with LF via a no-op migration pushed with Adam's approval. | Prod had no migration history; CLI credentials were unavailable when the baseline was authored. CRLF bodies made `db diff` permanently noisy. |
| 2026-08-22 | P0.3 | CI proves migrations by replaying them on a fresh local Postgres in GitHub Actions plus a `db push --dry-run` against prod; no per-PR Supabase preview branches. | Equivalent rehearsal, no branch billing, no hosted project touched. Preview branches remain the tool for rehearsing specific risky migrations by hand. |
| 2026-08-22 | P0.4 | Import the function-room app into `apps/web` now. Leave the existing Vercel project and the `roombooking.aomsportsclub.co.uk` domain untouched until the platform is ready to cut over. | Single repo simplifies the P1.6 data-layer rewrite; the live site keeps serving from its current deploy meanwhile. |
