/**
 * Signed URLs for identity documents — passports, birth certificates.
 *
 * SERVER ONLY, and narrower than anything else in this codebase. The
 * `identity-documents` bucket's SELECT policy names `club_admin` alone: the
 * guardian who uploaded a child's birth certificate can see their
 * `identity_documents` ROW (what it was, when it was filed, when it will be
 * destroyed) and can never fetch the bytes again. That asymmetry is the whole
 * point of holding the file at all.
 *
 * So the one rule for this helper: CALL IT ONLY AFTER CONFIRMING THE CALLER IS
 * A CLUB ADMINISTRATOR. It mints with the service key, which means it will
 * happily sign a path for anybody who asks. The `isClubAdmin()` check belongs
 * on the page, before the call.
 *
 * TTL mirrors `lib/media.ts`: a quarter of an hour, so a link that leaves the
 * screen has a short life.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const TTL_SECONDS = 900;

export async function signIdentityDocumentPaths(
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = Array.from(
    new Set(paths.filter((path): path is string => typeof path === "string" && path.length > 0)),
  );
  if (unique.length === 0) return urls;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("identity-documents")
      .createSignedUrls(unique, TTL_SECONDS);
    if (error || !data) return urls;
    for (const entry of data) {
      if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
    }
  } catch {
    return urls;
  }
  return urls;
}
