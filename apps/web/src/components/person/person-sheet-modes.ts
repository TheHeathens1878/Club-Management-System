import type { PersonSheetMode } from "@/lib/person-record-state";

/**
 * What `?sheet=` may say, and what each mode is called on screen.
 *
 * A plain module, not part of `person-sheet.tsx`: `/people/[id]` is a server
 * component and it is the one that has to turn the search param into a mode
 * before it decides which body to read for. A server page must never call a
 * function exported from a `"use client"` file, so the parsing lives here and
 * the sheet imports the same names.
 */

export const PERSON_SHEET_MODES = [
  "details",
  "contacts",
  "roles",
  "guardianships",
  "identity",
  "membership",
  "money",
  "registration",
  "danger",
] as const satisfies readonly PersonSheetMode[];

export const PERSON_SHEET_LABELS: Record<PersonSheetMode, string> = {
  details: "Details",
  contacts: "Emergency contacts",
  roles: "Roles",
  guardianships: "Guardianships",
  identity: "Proof of identity",
  membership: "Membership",
  money: "Subs and payments",
  registration: "Registration",
  danger: "Retire or delete",
};

/** The line under the sheet's title: what this mode is for, in one sentence. */
export const PERSON_SHEET_CAPTIONS: Record<PersonSheetMode, string> = {
  details: "Name, date of birth, contact details and address",
  contacts: "Up to two, on the person rather than on a registration form",
  roles: "What this person is allowed to do, and the referee tick",
  guardianships: "The adults responsible for a child, and the children an adult is responsible for",
  identity: "What the club has seen, and what it still holds",
  membership: "The household, the membership number and the family",
  money: "What is owed, and what has been paid",
  registration: "What the latest registration said — read-only",
  danger: "Retiring keeps the record. Deleting does not.",
};

/** `?sheet=` from the URL, or null for a record with no panel open. */
export function personSheetModeFrom(
  value: string | string[] | undefined,
): PersonSheetMode | null {
  const key = Array.isArray(value) ? value[0] : value;
  return (PERSON_SHEET_MODES as readonly string[]).includes(key ?? "")
    ? (key as PersonSheetMode)
    : null;
}

/**
 * The old `?tab=` values, and the mode each one now means.
 *
 * `?tab=membership` is in emails, in the billing links on this very page and
 * in anybody's history, so it keeps working: the page redirects it to
 * `?sheet=membership`. `?tab=record` was the default view and becomes the
 * record with nothing open.
 */
export const PERSON_TAB_REDIRECTS: Record<string, PersonSheetMode | null> = {
  record: null,
  membership: "membership",
};
