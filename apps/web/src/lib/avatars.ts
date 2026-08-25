/**
 * Signed URLs for player photos (Adam, 2026-08-25: the photo uploaded at
 * registration "will automatically become the avatar for the contact").
 *
 * SERVER ONLY, and the same shape as `lib/media.ts` for the same reason: the
 * `person-photos` bucket is private, so a URL has to be minted with the
 * service key. What keeps that safe is that this helper is only ever handed
 * `people.photo_path` values the CALLER'S OWN `people` read returned — and
 * that read is scoped by RLS to themselves, their children, their teams or
 * (for a committee reader) everyone. Never call it with a path from anywhere
 * else, and never with a path a client supplied.
 *
 * The TTL mirrors media's cap: a photo permission can be withdrawn, and a
 * bearer URL that outlives the withdrawal by an afternoon is not a control.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const TTL_SECONDS = 900;

/**
 * Mint short-lived URLs for a batch of photo paths.
 * Returns a map keyed by storage path; a path that could not be signed is
 * simply absent and the caller falls back to initials.
 */
export async function signPersonPhotoPaths(
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
      .from("person-photos")
      .createSignedUrls(unique, TTL_SECONDS);
    if (error || !data) return urls;
    for (const entry of data) {
      if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
    }
  } catch {
    // No service key configured (a placeholder-env build, say). Initials, then.
    return urls;
  }
  return urls;
}

/** One path, one URL. Prefer the batch form where a page renders many people. */
export async function signPersonPhotoPath(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const urls = await signPersonPhotoPaths([path]);
  return urls.get(path) ?? null;
}

/** Signed URLs for a set of people, keyed by PERSON id rather than by path. */
export async function signPeoplePhotos(
  people: { id: string; photo_path?: string | null }[],
): Promise<Map<string, string>> {
  const urls = await signPersonPhotoPaths(people.map((person) => person.photo_path));
  const byPerson = new Map<string, string>();
  for (const person of people) {
    const url = person.photo_path ? urls.get(person.photo_path) : undefined;
    if (url) byPerson.set(person.id, url);
  }
  return byPerson;
}
