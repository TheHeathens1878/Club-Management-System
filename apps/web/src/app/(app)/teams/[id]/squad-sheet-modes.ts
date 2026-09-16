import type { PersonSheetMode } from "@/lib/person-record-state";

/**
 * What `?sheet=` may say on the Squad tab, and what each panel is called
 * there (P8.7a).
 *
 * The squad reuses `PersonSheet`'s chrome and three of its modes, not all
 * nine: a team page holds a member's details, the people to ring and their
 * place in the team, and nothing at all about their money, their
 * registration or their guardianships. Offering a chip that opened an empty
 * panel would be worse than not offering it, so the tab names the three it
 * can draw and hands them over as the sheet's `modes`.
 *
 * The captions differ from the member record's for the same reason —
 * "Membership" here is this team, this season, not the household's billing
 * number.
 *
 * A PLAIN MODULE, not part of a `"use client"` file: `page.tsx` is a server
 * component and it is the one that turns the search param into a mode before
 * deciding which body to render.
 */

export const SQUAD_SHEET_MODES = [
  "details",
  "contacts",
  "membership",
] as const satisfies readonly PersonSheetMode[];

export type SquadSheetMode = (typeof SQUAD_SHEET_MODES)[number];

export const SQUAD_SHEET_LABELS: Record<SquadSheetMode, string> = {
  details: "In this team",
  contacts: "Who to ring",
  membership: "Membership",
};

export const SQUAD_SHEET_CAPTIONS: Record<SquadSheetMode, string> = {
  details: "Their role, their shirt and whether they are still in the squad",
  contacts: "The emergency contacts the club holds for them",
  membership: "When they joined, and where they stand this season",
};

/** `?sheet=` from the URL, or null for a squad with no panel open. */
export function squadSheetModeFrom(
  value: string | string[] | undefined,
): SquadSheetMode | null {
  const key = Array.isArray(value) ? value[0] : value;
  return (SQUAD_SHEET_MODES as readonly string[]).includes(key ?? "")
    ? (key as SquadSheetMode)
    : null;
}
