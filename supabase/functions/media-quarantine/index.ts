// media-quarantine — P4.5 (SG-5). Moves the object behind a flagged media item
// so any signed URL already in the wild stops resolving.
//
// AUTH. Scheduled only: the service-role key. `media_quarantined()` is granted
// to `service_role` alone, and `authenticated` has no SELECT on `media_items`
// at all.
//
// WHY A MOVE AND NOT A FLAG. Withdrawing consent is immediate at query level —
// `media_item_showable()` already excludes a quarantined item from every
// gallery and export. But a signed URL minted five minutes earlier is a bearer
// token against a *path*, and the database cannot revoke it. Moving the object
// to `quarantine/<old path>` breaks the signature's path, so the link dies too.
// Then `media_quarantined(item, new_path)` records the new path and clears the
// flag, so the row still points at the file for a lead under SG-8 (no hard
// deletes, ever).

import { adminClient, type Client, json, requireServiceRole } from "../_shared/auth.ts";

type FlaggedItem = {
  id: string;
  storage_bucket: string;
  storage_path: string;
};

const PREFIX = "quarantine/";
const BATCH = 200;

function quarantinePath(path: string): string {
  return path.startsWith(PREFIX) ? path : `${PREFIX}${path}`;
}

/** Cheap existence probe: a signature can only be minted for an object that exists. */
async function objectExists(admin: Client, bucket: string, path: string): Promise<boolean> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60);
  return !error && !!data?.signedUrl;
}

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();

  const { data, error } = await admin
    .from("media_items")
    .select("id, storage_bucket, storage_path")
    .eq("needs_quarantine", true)
    .limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  const items = (data ?? []) as FlaggedItem[];
  let moved = 0;
  let alreadyThere = 0;
  const failures: { id: string; error: string }[] = [];

  for (const item of items) {
    const target = quarantinePath(item.storage_path);
    const bucket = item.storage_bucket || "media";

    if (target === item.storage_path) {
      // Flagged again while already under quarantine/: just clear the flag.
      const { error: rpcError } = await admin.rpc("media_quarantined", {
        p_item_id: item.id,
        p_new_path: target,
      });
      if (rpcError) failures.push({ id: item.id, error: rpcError.message });
      else alreadyThere++;
      continue;
    }

    const { error: moveError } = await admin.storage.from(bucket).move(item.storage_path, target);

    if (moveError) {
      // A previous run may have moved the object and then failed to record it.
      // If the object is at the target, the move is done; finish the job.
      const settled = await objectExists(admin, bucket, target);
      if (!settled) {
        failures.push({ id: item.id, error: `move ${item.storage_path} → ${target}: ${moveError.message}` });
        continue;
      }
      alreadyThere++;
    } else {
      moved++;
    }

    const { error: rpcError } = await admin.rpc("media_quarantined", {
      p_item_id: item.id,
      p_new_path: target,
    });
    if (rpcError) {
      // The object has moved but the row still points at the old path. Say so
      // loudly: the next run finds the item still flagged and finishes it.
      failures.push({ id: item.id, error: `media_quarantined: ${rpcError.message}` });
    }
  }

  return json({
    scanned: items.length,
    moved,
    already_quarantined: alreadyThere,
    failed: failures.length,
    more_likely: items.length === BATCH,
    failures,
  });
});
