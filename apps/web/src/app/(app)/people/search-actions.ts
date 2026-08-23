"use server";

/**
 * The person picker's search, shared by the team membership editor and the
 * guardianship editor.
 *
 * User-scoped client on purpose: `people` RLS (`people_admin_read`) is what
 * decides whether the caller may see anyone at all, so an empty list here is a
 * real answer rather than a silent failure. Committee sign-ins hold
 * `club_admin` through the `profiles` → `person_roles` sync, which is why the
 * committee screens can search; nobody else gets rows.
 */

import { createClient } from "@/lib/supabase/server";
import { personLabel, sanitiseSearch } from "@/lib/people-display";

/** Short enough to keep the dropdown readable; the search is a filter, not a report. */
const SEARCH_LIMIT = 20;

export type PersonOption = {
  id: string;
  name: string;
  email: string | null;
  /** SG-0 badge only. The date of birth itself never leaves the server here. */
  dobKnown: boolean;
};

export async function searchPeople(query: string): Promise<PersonOption[]> {
  const term = sanitiseSearch(query);
  if (term.length < 2) return [];

  const supabase = await createClient();
  const pattern = `%${term}%`;
  const { data } = await supabase
    .from("people")
    .select("id,first_name,last_name,preferred_name,email,dob")
    .is("deleted_at", null)
    .or(
      [
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `preferred_name.ilike.${pattern}`,
        `email.ilike.${pattern}`,
      ].join(","),
    )
    .order("last_name")
    .order("first_name")
    .limit(SEARCH_LIMIT);

  return (data ?? []).map((p) => ({
    id: p.id,
    name: personLabel(p),
    email: p.email,
    dobKnown: p.dob !== null,
  }));
}
