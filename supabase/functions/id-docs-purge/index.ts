// id-docs-purge — the three-year destruction of identity documents.
//
// Adam, 2026-08-25: "Max 5Mb and ID automatically deleted after 3 years."
// Storage limitation (UK GDPR Art. 5(1)(e), SAFEGUARDING.md C7) is not a
// promise in a policy document; it is this job.
//
// AUTH. Scheduled only: the service-role key. Both RPCs are granted to
// `service_role` alone, and `identity_document_purged()` refuses outright when
// `auth.uid()` is set — a member can never trigger the destruction of a record
// the club is holding.
//
// ORDER OF OPERATIONS, and why it is this way round. The object goes first and
// the row is stamped second. If the process dies in between, the file is gone
// and the row still says "live": the next run finds it again, the remove is a
// no-op, and the stamp lands. The other order would leave a row saying the
// document was destroyed while the file was still sitting in the bucket, which
// is the failure that actually matters.
//
// The row is never deleted (SG-2's shape): `identity_document_purged()` nulls
// the path and stamps `purged_at`, so the club can still show that ID was seen
// and when it was destroyed.

import { adminClient, json, requireServiceRole } from "../_shared/auth.ts";

type DueDocument = {
  id: string;
  person_id: string;
  storage_path: string;
};

const BUCKET = "identity-documents";

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();

  const { data, error } = await admin.rpc("identity_documents_due_purge");
  if (error) return json({ error: error.message }, 500);

  const due = (data ?? []) as DueDocument[];
  if (due.length === 0) return json({ scanned: 0, purged: 0, failed: 0, failures: [] });

  const paths = due.map((row) => row.storage_path).filter(Boolean);
  const failures: { id: string; error: string }[] = [];

  const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
  if (removeError) {
    // A missing object is not a reason to keep the row saying "live" — but a
    // storage outage is. Stop, and let the next run try again.
    return json({ scanned: due.length, purged: 0, failed: due.length, error: removeError.message }, 500);
  }

  let purged = 0;
  for (const row of due) {
    const { error: rpcError } = await admin.rpc("identity_document_purged", { p_id: row.id });
    if (rpcError) failures.push({ id: row.id, error: rpcError.message });
    else purged++;
  }

  return json({
    scanned: due.length,
    purged,
    failed: failures.length,
    more_likely: due.length === 500,
    failures,
  });
});
