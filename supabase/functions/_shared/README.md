# _shared

`fulltime/` is a verbatim copy of `packages/fulltime/src` so Edge Functions
(Deno) can import the parser without reaching outside `supabase/functions`.
Regenerate after changing the package:

    rm -rf supabase/functions/_shared/fulltime && cp -r packages/fulltime/src supabase/functions/_shared/fulltime

CI checks the copy is in sync (`scripts/check-shared-sync.sh`).
