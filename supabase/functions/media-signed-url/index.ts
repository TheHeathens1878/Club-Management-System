// media-signed-url — P4.5 (SG-5). Mints short-lived URLs for exactly the media
// the caller is allowed to see.
//
// AUTH. `verify_jwt = true`. The consent filter is applied by calling
// `media_gallery(album)` with the **caller's** JWT, so `can_view_album()` and
// `media_item_showable()` run as them: subjects confirmed, nothing redacted or
// quarantined, and every minor subject holding an active consent for the
// album's purpose. The service client is used only afterwards, to sign the
// paths the user's own query returned — never to widen that set.
//
// Resolving `item_id` needs one service-client read (item → album), because
// `authenticated` has no SELECT on `media_items` by design. That read returns
// an album id and nothing else, and the item is then only signed if the user's
// own gallery query contains it.
//
//   POST { "album_id": "<uuid>" }  → every showable item in the album
//   POST { "item_id":  "<uuid>" }  → that item, if it is showable for them
//   → 200 [{ id, url, expires_at }]

import { adminClient, json, readJson, settingInt, userClient } from "../_shared/auth.ts";

type GalleryRow = {
  id: string;
  album_id: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string | null;
  caption: string | null;
  taken_at: string | null;
};

type SignedResult = { path?: string | null; signedUrl?: string | null; error?: string | null };

const TTL_CAP = 900; // SG-5 / Q4: fifteen minutes, whatever the setting says.
const TTL_FLOOR = 60;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const asUser = userClient(req);
  if (!asUser) return json({ error: "unauthorised" }, 401);

  const body = await readJson(req);
  const itemId = typeof body.item_id === "string" ? body.item_id : null;
  const albumId = typeof body.album_id === "string" ? body.album_id : null;
  if (!itemId && !albumId) return json({ error: "item_id or album_id is required" }, 400);

  const admin = adminClient();

  // Which album are we asking about? For item_id, look it up — the album id is
  // the only thing this read yields, and it grants nothing on its own.
  let targetAlbum = albumId;
  if (!targetAlbum && itemId) {
    const { data, error } = await admin
      .from("media_items")
      .select("album_id")
      .eq("id", itemId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    const row = data as { album_id: string } | null;
    if (!row) return json({ error: "no such item" }, 404);
    targetAlbum = row.album_id;
  }

  // The consent filter, as the caller.
  const { data: galleryData, error: galleryError } = await asUser.rpc("media_gallery", {
    p_album_id: targetAlbum,
  });
  if (galleryError) return json({ error: galleryError.message }, 403);

  let items = (galleryData ?? []) as GalleryRow[];
  if (itemId) items = items.filter((i) => i.id === itemId);
  if (items.length === 0) {
    return json(itemId ? { error: "not available" } : [], itemId ? 404 : 200);
  }

  const ttl = await settingInt(admin, "media.signed_url_ttl_seconds", TTL_CAP, {
    min: TTL_FLOOR,
    max: TTL_CAP,
  });
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  // Sign per bucket; `media` is the only one today, but the column exists.
  const byBucket = new Map<string, GalleryRow[]>();
  for (const item of items) {
    const bucket = item.storage_bucket || "media";
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), item]);
  }

  const out: { id: string; url: string; expires_at: string; content_type: string | null; caption: string | null }[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const [bucket, bucketItems] of byBucket) {
    const paths = bucketItems.map((i) => i.storage_path);
    const { data: signed, error: signError } = await admin.storage.from(bucket).createSignedUrls(paths, ttl);
    if (signError) {
      for (const i of bucketItems) failures.push({ id: i.id, error: signError.message });
      continue;
    }
    const urlByPath = new Map<string, string>();
    for (const s of (signed ?? []) as SignedResult[]) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }
    for (const item of bucketItems) {
      const url = urlByPath.get(item.storage_path);
      if (!url) {
        failures.push({ id: item.id, error: "could not sign this object" });
        continue;
      }
      out.push({
        id: item.id,
        url,
        expires_at: expiresAt,
        content_type: item.content_type,
        caption: item.caption,
      });
    }
  }

  if (out.length === 0 && failures.length > 0) {
    return json({ error: "could not sign the requested media", failures }, 502);
  }
  // Always an array on success: a partial failure drops that item rather than
  // changing the shape the caller has to parse.
  return json(out);
});
