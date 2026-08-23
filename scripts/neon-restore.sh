#!/usr/bin/env bash
# P3.3 — dump the Neon pitch-booking database (READ-ONLY source) and restore it
# into a `neon_legacy` schema on a Supabase PREVIEW BRANCH for rehearsal.
#
# Usage:
#   NEON_DATABASE_URL=postgresql://claude_ro:…@….neon.tech/db?sslmode=require \
#   TARGET_DB_URL=postgresql://postgres.<branch-ref>:…@aws-0-eu-west-2.pooler.supabase.com:5432/postgres \
#   bash scripts/neon-restore.sh
#
# Never point TARGET_DB_URL at prod for a rehearsal. The cutover run (P3.4 step
# 2) uses the same script with prod as the target, inside the write-freeze.
set -euo pipefail

: "${NEON_DATABASE_URL:?set NEON_DATABASE_URL (read-only role)}"
: "${TARGET_DB_URL:?set TARGET_DB_URL (preview branch pooler URL)}"
OUT="${OUT:-$(mktemp -d)}/neon.dump"
IMG="postgres:17-alpine"

# Neon's console hands out the pooled host by default; pg_dump needs the
# direct endpoint (same host without the "-pooler" label).
NEON_DATABASE_URL="${NEON_DATABASE_URL/-pooler./.}"

# 20260824000000_neon_import.sql ships empty neon_legacy stub tables so the
# import functions compile. Step 2 below drops that schema and the restore
# recreates it from the dump, with the real column types.

echo "1/4 dumping Neon (schema + data, no owners/privileges) → $OUT"
docker run --rm -v "$(dirname "$OUT"):/out" "$IMG" \
  pg_dump "$NEON_DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public \
  --file "/out/$(basename "$OUT")"

echo "2/4 preparing neon_legacy on the target"
docker run --rm -i "$IMG" psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
drop schema if exists neon_legacy cascade;
create schema neon_legacy;
SQL

echo "3/4 restoring into neon_legacy (public → neon_legacy via pg_restore search_path trick)"
# pg_restore cannot rename schemas directly; restore into a scratch DB-less path by
# rewriting the dump's schema references on the way in.
docker run --rm -v "$(dirname "$OUT"):/out" "$IMG" \
  pg_restore --no-owner --no-privileges --format=custom --file=/out/neon.sql "/out/$(basename "$OUT")"
sed -i -E 's/\bpublic\./neon_legacy./g; s/SET search_path = public/SET search_path = neon_legacy/g; s/CREATE SCHEMA public;//g' "$(dirname "$OUT")/neon.sql"
docker run --rm -i -v "$(dirname "$OUT"):/out" "$IMG" psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f /out/neon.sql

echo "4/4 row counts"
docker run --rm -i "$IMG" psql "$TARGET_DB_URL" -At <<'SQL'
select table_name || ': ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from neon_legacy.%I', table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema = 'neon_legacy' and table_type = 'BASE TABLE' order by 1;
SQL
echo "done — dump kept at $OUT (delete after the rehearsal; it contains personal data)"
