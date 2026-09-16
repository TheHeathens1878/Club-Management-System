import type { Json } from "@club/db";

import type { HouseholdActionKey } from "@/lib/family-readiness";
import { ageGroupFromDobString } from "@/lib/waiting-list";

import type { ChildSheetPanelMode } from "./child-sheet-modes";

/**
 * The small readings `/family` makes of what the database handed back (P8.6).
 *
 * A plain module — no client directive, no Supabase client — so the server
 * page can CALL these. That is the rule a "use client" file would break, and
 * it is why they are not in `family-grid.tsx` beside the component that uses
 * their output.
 */

export type ChildTeam = { team_id: string; team_name: string; role: string };

/** `my_children().teams` is jsonb built by the function; read it defensively. */
export function parseTeams(value: Json | null | undefined): ChildTeam[] {
  if (!Array.isArray(value)) return [];
  const out: ChildTeam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json | undefined>;
    const id = record["team_id"];
    const name = record["team_name"];
    const role = record["role"];
    if (typeof id !== "string" || typeof name !== "string") continue;
    out.push({ team_id: id, team_name: name, role: typeof role === "string" ? role : "player" });
  }
  return out;
}

export function addressField(address: Json | null | undefined, key: string): string {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const value = (address as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : "";
}

/** "1 Lead Street, Sale, M33 1AA" — the tick-box's label, so it is not a guess. */
export function addressLine(address: Json | null | undefined): string | null {
  const parts = ["line1", "line2", "town", "postcode"]
    .map((key) => addressField(address, key))
    .filter((part) => part !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Whether the club holds an address of this child's own — the Details cell. */
export function hasOwnAddress(address: Json | null | undefined): boolean {
  return ["line1", "line2", "town", "postcode"].some((key) => addressField(address, key) !== "");
}

export function ageGroupHint(dob: string | null): string {
  // The DATE STRING, never a Date: `new Date("2014-09-01")` is midnight UTC,
  // which is the previous evening west of Greenwich, and the FA cohort
  // cut-off is 31 August.
  return ageGroupFromDobString(dob) ?? "Age group unknown";
}

/** `/family?child=…&sheet=…`, with both parts optional. */
export function familyHref(
  mode: ChildSheetPanelMode | null,
  childId: string | null | undefined,
): string {
  const query = new URLSearchParams();
  if (childId) query.set("child", childId);
  if (mode) query.set("sheet", mode);
  const rest = query.toString();
  return rest ? `/family?${rest}` : "/family";
}

/** The button word for each thing the household can owe. */
export const HOUSEHOLD_ACTION_BUTTON: Record<HouseholdActionKey, string> = {
  "add-child": "Add a child",
  "add-emergency-contact": "Add a contact",
  "grant-app-access": "Allow access",
  "register-child": "Register",
};
