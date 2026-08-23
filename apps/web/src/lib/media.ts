/**
 * Signed URLs for media (PLAN.md P4.5 — SAFEGUARDING.md SG-5).
 *
 * SERVER ONLY. The `media` bucket is private and `authenticated` has no read
 * on it, so a URL has to be minted with the service key. That is safe here for
 * exactly one reason, and it is worth stating plainly: this helper is only
 * ever called with paths that the caller's OWN `media_gallery()` or
 * `media_export()` call has already returned, and those functions have applied
 * the consent filter. Never call it with a path from anywhere else.
 *
 * The lifetime comes from `site_settings.media.signed_url_ttl_seconds` so that
 * withdrawal-driven quarantine (which moves the object and breaks outstanding
 * signatures) has a bounded window to matter in.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_TTL_SECONDS = 900;
/** The bucket's own policy caps this at 15 minutes; do not exceed it. */
const MAX_TTL_SECONDS = 900;

export async function signedUrlTtl(): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value")
      .eq("key", "media.signed_url_ttl_seconds")
      .maybeSingle();
    const parsed = Number(data?.value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
    return Math.min(Math.round(parsed), MAX_TTL_SECONDS);
  } catch {
    return DEFAULT_TTL_SECONDS;
  }
}

/**
 * Mint short-lived URLs for consent-filtered paths.
 * Returns a map keyed by storage path; a path that could not be signed is
 * simply absent, and the caller shows a placeholder rather than a broken image.
 */
export async function signMediaPaths(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return urls;

  const ttl = await signedUrlTtl();
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("media").createSignedUrls(unique, ttl);
  if (error || !data) return urls;

  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}
