#!/usr/bin/env bash
# Fails if supabase/functions/_shared/fulltime has drifted from packages/fulltime/src.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! diff -rq packages/fulltime/src supabase/functions/_shared/fulltime >/dev/null; then
  echo "supabase/functions/_shared/fulltime is out of sync with packages/fulltime/src — re-copy it (see supabase/functions/_shared/README.md)" >&2
  diff -rq packages/fulltime/src supabase/functions/_shared/fulltime || true
  exit 1
fi
echo "_shared/fulltime in sync"
