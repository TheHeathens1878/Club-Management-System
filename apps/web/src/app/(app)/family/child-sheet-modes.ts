import type { ChildSheetMode } from "@/lib/family-readiness";

/**
 * What `?sheet=` may say on `/family`, and what each mode is called on screen.
 *
 * A plain module, not part of `child-sheet.tsx`: the page is a server
 * component and it is the one that turns the search param into a mode before
 * it decides which body to read for. A server page must never call a function
 * exported from a `"use client"` file, so the parsing lives here and the sheet
 * imports the same names — the shape `person-sheet-modes.ts` established.
 *
 * The LIST is where this parts company with the member record. A parent holds
 * no `people` write policy: roles, guardianships, identity documents, money
 * and retiring are not theirs to open, and `update_child_details()` is the
 * only write they have. So the six modes below are the whole of it, and
 * "add" — the household-level door in `ChildSheetMode` — is not one of them,
 * because adding a child is not about a child that exists yet.
 */

export const CHILD_SHEET_MODES = [
  "details",
  "contacts",
  "access",
  "register",
  "registrations",
  "snapshot",
] as const satisfies readonly ChildSheetMode[];

/** The modes that open in the panel — `ChildSheetMode` minus "add". */
export type ChildSheetPanelMode = (typeof CHILD_SHEET_MODES)[number];

export const CHILD_SHEET_LABELS: Record<ChildSheetPanelMode, string> = {
  details: "Details",
  contacts: "Emergency contacts",
  access: "App access",
  register: "Register",
  registrations: "Registrations",
  snapshot: "From the form",
};

/** The line under the sheet's title: what this mode is for, in one sentence. */
export const CHILD_SHEET_CAPTIONS: Record<ChildSheetPanelMode, string> = {
  details: "Contact details and home address — the half a guardian may change",
  contacts: "Up to two, on the child rather than on a registration form",
  access: "Whether they may have a login of their own",
  register: "The club's registration form, for this season",
  registrations: "Where each registration stands, and withdrawing one",
  snapshot: "What the last registration said — read-only",
};

/** `?sheet=` from the URL, or null for a screen with no panel open. */
export function childSheetModeFrom(
  value: string | string[] | undefined,
): ChildSheetPanelMode | null {
  const key = Array.isArray(value) ? value[0] : value;
  return (CHILD_SHEET_MODES as readonly string[]).includes(key ?? "")
    ? (key as ChildSheetPanelMode)
    : null;
}

/** `?child=` from the URL — the child in focus, panel open or not. */
export function childIdFrom(value: string | string[] | undefined): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id && id.length > 0 ? id : null;
}
