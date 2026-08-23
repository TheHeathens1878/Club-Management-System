/**
 * The bridge between an app account (`profiles`, the legacy role model) and a
 * club member record (`people`), plus the two role questions the Phase 4/5
 * screens ask.
 *
 * Everything here goes through the USER-SCOPED client on purpose: the answer
 * must be the database's, evaluated under the caller's own RLS and
 * SECURITY DEFINER accessors, never the service key's. Safeguarding screens
 * are gated on these, so a wrong answer here is a wrong answer everywhere.
 */

import { createClient } from "@/lib/supabase/server";

/** `public.current_person_id()` — the caller's `people.id`, or null if unlinked. */
export async function getCurrentPersonId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_person_id");
  return data ?? null;
}

/** `public.is_safeguarding_lead()` — the `person_roles` answer, not `profiles.role`. */
export async function isSafeguardingLead(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_safeguarding_lead");
  return data === true;
}

/** `public.is_club_admin()` — the `person_roles` answer. */
export async function isClubAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_club_admin");
  return data === true;
}

/**
 * Does the caller hold a `waiting_list_access` row for any age group?
 *
 * `wl_access_self_read` lets someone see their own grants and nothing else, so
 * this is a safe question for any signed-in user to ask. Club administrators
 * reach the desk through `is_club_admin()` instead — they need no grant.
 */
export async function hasWaitingListAccess(): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("waiting_list_access")
    .select("age_group", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

/**
 * A display name the caller is entitled to see, for a set of people.
 *
 * Tries the bulk `people` read first (RLS decides what comes back — self,
 * guarded children, admins get everyone) and fills the gaps with
 * `display_name()`, the SECURITY DEFINER helper that reveals a name to team
 * staff too. Anyone still unnamed is shown as "Club member": a name the caller
 * is not entitled to is not a rendering problem to work around.
 */
export async function resolveNames(personIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = Array.from(new Set(personIds.filter(Boolean)));
  if (ids.length === 0) return names;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("people")
    .select("id,first_name,last_name,preferred_name")
    .in("id", ids);
  for (const row of rows ?? []) {
    names.set(row.id, `${row.preferred_name || row.first_name} ${row.last_name}`.trim());
  }

  const missing = ids.filter((id) => !names.has(id));
  if (missing.length > 0) {
    const resolved = await Promise.all(
      missing.map(async (id) => {
        const { data } = await supabase.rpc("display_name", { p_person_id: id });
        return [id, data] as const;
      }),
    );
    for (const [id, name] of resolved) {
      if (name) names.set(id, name);
    }
  }

  return names;
}

/** What to show when the caller may not see someone's name. */
export const UNNAMED = "Club member";

export function nameOf(names: Map<string, string>, personId: string | null | undefined): string {
  if (!personId) return UNNAMED;
  return names.get(personId) ?? UNNAMED;
}
