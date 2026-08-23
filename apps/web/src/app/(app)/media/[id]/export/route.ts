import { NextResponse } from "next/server";

import { signMediaPaths, signedUrlTtl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";

/**
 * Bulk export for an album (PLAN.md P4.5 — SAFEGUARDING.md SG-5).
 *
 * `media_export()` applies the same consent filter as the gallery and writes
 * the `media.bulk_export` audit row — with the count it is returning and the
 * count it excluded — before it returns anything. Zipping is out of scope, so
 * what comes back here is the list plus short-lived signed URLs for exactly
 * the items the filter allowed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await supabase.rpc("media_export", { p_album_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  const items = data ?? [];
  const signed = await signMediaPaths(items.map((item) => item.storage_path));
  const ttl = await signedUrlTtl();

  const payload = {
    album_id: id,
    exported_at: new Date().toISOString(),
    url_expires_in_seconds: ttl,
    item_count: items.length,
    note: "Photos of anyone without consent for this album's purpose are absent by construction, not filtered out here.",
    items: items.map((item) => ({
      id: item.id,
      caption: item.caption,
      taken_at: item.taken_at,
      content_type: item.content_type,
      url: signed.get(item.storage_path) ?? null,
    })),
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="album-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
