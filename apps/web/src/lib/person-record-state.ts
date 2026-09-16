/**
 * What a member record needs next (P8.3).
 *
 * `/people/[id]` already holds every fact this answer is made of — the Neon
 * import queue, the date of birth, the emergency contacts, the roles, the ID
 * tick — but says them in five separate cards and never joins them up. An
 * administrator opening a record has to read the whole page to find out that
 * the one thing standing between it and being usable is a missing birthday.
 *
 * SG-0 is why the date of birth comes first. An unknown date of birth is a
 * MINOR (`isMinorDob`, mirroring `public.is_minor_dob`), so until it is known
 * every safeguarding guard treats the person as a child, `migrate_neon()`'s
 * queued rows will not apply, and half the record is unreachable. The screen
 * should say that in one line rather than make somebody deduce it.
 *
 * NOTHING HERE DECIDES A SAFEGUARDING QUESTION. Whether a role is child-facing
 * is the database's answer (`is_child_facing_role`, over the
 * `child_facing_roles` lookup — SG-6 says it is never a hard-coded list), so
 * the caller passes in the roles it has already been told are child-facing.
 * This module only chooses which sentence to show.
 *
 * Pure: no Supabase client, no server-only import. Importable from a server
 * page and a `"use client"` component alike.
 */

import type { Database } from "@club/db";

import { isMinorDob } from "@/lib/people-display";

type PeopleRow = Database["public"]["Tables"]["people"]["Row"];

/** The `PersonSheet` mode a button opens (P8.3's mode list). */
export type PersonSheetMode =
  | "details"
  | "contacts"
  | "roles"
  | "guardianships"
  | "identity"
  | "membership"
  | "money"
  | "registration"
  | "danger";

export type PersonActionKey =
  | "apply-imports"
  | "add-dob"
  | "add-emergency-contact"
  | "record-id-seen"
  | "record-complete";

export type PersonTone = "idle" | "waiting" | "done" | "error" | "pending";

export type PersonNextAction = {
  key: PersonActionKey;
  label: string;
  why: string;
  tone: PersonTone;
  /** Every line on this bar opens the sheet somewhere. */
  mode: PersonSheetMode;
};

export type PersonRecordInput = {
  /** Only the columns the answer depends on — nothing here widens the row. */
  person: Pick<PeopleRow, "dob" | "id_verified" | "updated_at">;
  /** `neon_import_pending` rows still waiting on this person (`applied_at` null). */
  pendingImports: number;
  /** `emergency_contacts` rows the reader is entitled to see. */
  emergencyContacts: number;
  /**
   * The names of the child-facing roles this person holds, AS THE DATABASE
   * DESIGNATED THEM. Empty means no child-facing role, or a reader who was
   * not shown the roles — either way, no ID is asked for.
   */
  childFacingRoles: readonly string[];
  /** Live `identity_documents` rows (not purged) — a document waiting to be checked. */
  identityDocuments: number;
};

/**
 * "4 Sep" — the day a record last changed, the way a one-line bar says it.
 *
 * `updated_at` is a timestamptz, so the club's own zone decides which day it
 * was; the app's `formatStamp` says the year and the time too, which is more
 * than the bar has room for.
 */
function changedDayLabel(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

/** "Coach", or "Coach and Manager" — the roles that ask for an ID, in words. */
function rolesInWords(roles: readonly string[]): string {
  const words = roles.map((role) => role.replace(/_/g, " "));
  if (words.length <= 1) return words[0] ?? "a child-facing role";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The one thing this record needs next.
 *
 * Branches in priority order, first match wins. A missing date of birth
 * outranks a missing emergency contact deliberately: without the birthday the
 * record is a minor by default and the contact form is being filled in for a
 * person nobody has established the age of yet.
 */
export function personNextAction(input: PersonRecordInput): PersonNextAction {
  const { person, pendingImports, emergencyContacts, childFacingRoles, identityDocuments } = input;
  const hasDob = !!person.dob;

  // 1. Rows the Neon migration queued and SG-4/SG-6 will not accept until the
  //    birthday is known. Saving one date applies them all, so say how many
  //    are waiting on it.
  if (pendingImports > 0) {
    return {
      key: "apply-imports",
      tone: "error",
      label: `Save a date of birth — ${pendingImports} import${pendingImports === 1 ? "" : "s"} waiting`,
      why: "Records brought over from the pitch-booking app cannot be applied until this person's date of birth is known. Saving it applies them straight away.",
      mode: "details",
    };
  }

  // 2. No date of birth at all (SG-0): everything downstream treats this
  //    person as a child until there is one.
  if (!hasDob) {
    return {
      key: "add-dob",
      tone: "error",
      label: "Add a date of birth",
      why: "With no date of birth on file the club has to treat this person as a child, which blocks their age group, their FA band and every role a grown-up would hold.",
      mode: "details",
    };
  }

  // 3. A child with nobody to ring.
  if (isMinorDob(person.dob) && emergencyContacts === 0) {
    return {
      key: "add-emergency-contact",
      tone: "error",
      label: "Add an emergency contact",
      why: "This is a child's record and the club holds nobody to ring for them.",
      mode: "contacts",
    };
  }

  // 4. A grown-up working with children whose ID nobody has recorded seeing.
  if (!isMinorDob(person.dob) && childFacingRoles.length > 0 && !person.id_verified) {
    return {
      key: "record-id-seen",
      tone: "pending",
      label: "Record ID seen",
      why:
        identityDocuments > 0
          ? `${rolesInWords(childFacingRoles)} is a child-facing role. A document is on file waiting to be checked — tick it off once you have seen it.`
          : `${rolesInWords(childFacingRoles)} is a child-facing role, and nobody has recorded seeing this person's identification.`,
      mode: "identity",
    };
  }

  // 5. Nothing outstanding. The bar goes quiet and offers the ordinary door.
  const changed = changedDayLabel(person.updated_at);
  return {
    key: "record-complete",
    tone: "done",
    label: "Edit details",
    why: changed ? `Record complete · last changed ${changed}` : "Record complete",
    mode: "details",
  };
}
