#!/usr/bin/env node
/**
 * P3.2 / P3.4 — create Supabase Auth users for the imported Neon accounts,
 * carrying their bcrypt password hashes so nobody has to reset a password.
 *
 * Runs AFTER `select * from public.migrate_neon()` (the people rows must
 * exist) and reads its worklist from `neon_auth_import_candidates()`, which
 * only service_role may call. Idempotent: a person who already has an
 * auth.users row is not a candidate.
 *
 * Usage (from the repo root, inside the cutover window or against a preview
 * branch for the P3.2 dry run):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node apps/web/scripts/neon-auth-import.mjs [--dry-run]
 *
 * handle_new_user() adopts the existing person because BOTH
 * user_metadata.person_id and the email match (20260824000000_neon_import.sql
 * §4). The person's DOB is still unknown after this; the first-login gate
 * (/complete-profile) collects it and activates their team memberships.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: candidates, error } = await supabase.rpc("neon_auth_import_candidates");
if (error) {
  console.error("neon_auth_import_candidates failed:", error.message);
  process.exit(1);
}

console.log(`${candidates.length} account(s) to create${dryRun ? " (dry run — nothing written)" : ""}`);

let created = 0;
const failures = [];
for (const c of candidates) {
  if (dryRun) {
    console.log(`  would create ${c.email} → person ${c.person_id}`);
    continue;
  }
  const { data, error: createError } = await supabase.auth.admin.createUser({
    email: c.email,
    password_hash: c.password_hash,
    email_confirm: true,
    user_metadata: { full_name: c.full_name, person_id: c.person_id },
  });
  if (createError) {
    failures.push({ email: c.email, reason: createError.message });
    console.error(`  FAILED ${c.email}: ${createError.message}`);
    continue;
  }
  // Belt and braces: the trigger must have linked the profile to the person.
  const { data: profile } = await supabase
    .from("profiles")
    .select("person_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile?.person_id !== c.person_id) {
    // The trigger refused the adoption (a minor, a profile that already
    // exists, ...). Do not leave an account behind that is attached to a
    // fresh, unknown person: remove it and report.
    await supabase.auth.admin.deleteUser(data.user.id);
    failures.push({ email: c.email, reason: `profile not linked to person ${c.person_id} — account removed` });
    console.error(`  LINK MISMATCH ${c.email}: profile.person_id=${profile?.person_id ?? "null"} (account removed)`);
    continue;
  }
  created += 1;
  console.log(`  created ${c.email}`);
}

console.log(`done: ${created} created, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
