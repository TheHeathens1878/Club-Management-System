/**
 * Who ticked "ID seen and verified" — by name.
 *
 * Adam, 2026-08-25: "It should put a name against the ID approval."
 * `set_id_verified()` already stamps `people.id_verified_by` with `auth.uid()`
 * (20260825140000), so the fact was recorded from the first day; nothing
 * showed it. That column is an AUTH USER, and every name in this application
 * belongs to a PERSON, so the walk is `auth.users.id` -> `profiles.person_id`
 * -> `resolveNames()`.
 *
 * Read through the caller's own client throughout. A reader who is not
 * entitled to the administrator's record gets `UNNAMED` ("Club member") rather
 * than a name borrowed from the service key — the tick still shows, the name
 * does not.
 *
 * Server module: imported by the registrations queue and the person page.
 */

import { resolveNames, UNNAMED } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

/**
 * Display names for a set of `auth.users` ids, keyed by the user id.
 *
 * An id the caller cannot resolve is simply absent from the map, so callers
 * fall back to `UNNAMED` through `verifierName()`.
 */
export async function resolveUserNames(
  userIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return names;

  const supabase = await createClient();
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id,person_id,full_name")
    .in("id", ids);

  const personByUser = new Map<string, string>();
  for (const row of profileRows ?? []) {
    if (row.person_id) personByUser.set(row.id, row.person_id);
  }
  const personNames = await resolveNames(Array.from(personByUser.values()));

  for (const row of profileRows ?? []) {
    const personId = row.person_id;
    const fromPerson = personId ? personNames.get(personId) : undefined;
    // The login's own `full_name` is the fallback, not the first choice: the
    // club's record of a person is `people`, and a login may carry a stale one.
    const name = fromPerson ?? row.full_name ?? null;
    if (name) names.set(row.id, name);
  }
  return names;
}

/** The name to print beside a tick, or "Club member" when the caller may not see it. */
export function verifierName(
  names: Map<string, string>,
  userId: string | null | undefined,
): string {
  if (!userId) return UNNAMED;
  return names.get(userId) ?? UNNAMED;
}
