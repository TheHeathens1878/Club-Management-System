/**
 * Emergency contacts — on the PERSON, up to two (Adam, 2026-08-25: "Emergency
 * Contacts (up to 2) should be set at contact level, not on registration
 * form").
 *
 * They live in `public.emergency_contacts` (20260825150000): one row per
 * position, readable by the subject, their active guardians, club_admin and
 * safeguarding_lead — the readership `registrations.form` had — and written
 * only through `set_emergency_contacts()`, which replaces the whole set. This
 * module is the vocabulary every screen that asks for them shares: the join
 * wizard, the family screen, My Profile, the admin person page and the
 * registrations queue.
 *
 * THE TICK-BOX
 *   "I am the first emergency contact" (Adam: "Emergency contact can be lead
 *   contact also, so a tick button would be helpful"). Like the address tick
 *   on the family screen it is resolved on the SERVER from the caller's own
 *   `people` row, and the same rule protects it: the name and phone fields
 *   for contact 1 are only rendered while the box is unticked, so a typed
 *   contact arriving alongside a "yes" is the clearer statement and wins.
 *
 * Pure data and pure functions: imported by client components.
 */

export const MAX_EMERGENCY_CONTACTS = 2;

export type EmergencyContact = {
  position: number;
  /** The two halves, separately (20260825431000) — what the table holds. */
  firstName: string;
  lastName: string;
  /** The display value the table generates from the two halves. */
  name: string;
  phone: string;
  relationship: string;
};

/** The posted field names, one set per position: `ec1_first_name`, `ec2_phone`, … */
export type ContactFieldKey = "first_name" | "last_name" | "phone" | "relationship";
export function contactField(position: number, key: ContactFieldKey): string {
  return `ec${position}_${key}`;
}

/** Posted as "yes" when contact 1 should be the signed-in lead contact themselves. */
export const USE_LEAD_FIELD = "ec_use_lead";

export type PostedEmergencyContacts = {
  /** Contact 1 is the caller — resolved server-side from their own record. */
  useLead: boolean;
  /** The relationship typed beside the tick (the caller's, to the person). */
  leadRelationship: string;
  /** The contacts typed in full, in the order they will be numbered. */
  typed: { firstName: string; lastName: string; phone: string; relationship: string }[];
};

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read the posted contacts, or say what is wrong with them. Blank rows are
 * simply absent; a half-filled row (a name with no number, or the reverse) is
 * refused here with the sentence the form shows, so the database never has to.
 */
export function emergencyContactsFromFormData(
  formData: FormData,
): { error: string } | PostedEmergencyContacts {
  const rows: PostedEmergencyContacts["typed"] = [];
  for (let position = 1; position <= MAX_EMERGENCY_CONTACTS; position += 1) {
    rows.push({
      firstName: text(formData.get(contactField(position, "first_name"))),
      lastName: text(formData.get(contactField(position, "last_name"))),
      phone: text(formData.get(contactField(position, "phone"))),
      relationship: text(formData.get(contactField(position, "relationship"))),
    });
  }

  // The tick stands only when contact 1's own fields are empty — they are not
  // rendered while it is ticked, so both arriving means a reset checkbox.
  const first = rows[0]!;
  const useLead =
    formData.get(USE_LEAD_FIELD) === "yes" && !first.firstName && !first.lastName && !first.phone;

  const typed: PostedEmergencyContacts["typed"] = [];
  for (const [index, row] of rows.entries()) {
    if (useLead && index === 0) continue;
    if (!row.firstName && !row.lastName && !row.phone) continue;
    if (!row.firstName || !row.lastName || !row.phone) {
      return {
        error: `Emergency contact ${index + 1} needs a first name, a last name and a phone number.`,
      };
    }
    typed.push(row);
  }

  return { useLead, leadRelationship: first.relationship, typed };
}

/** True when a posted form names nobody at all. */
export function noEmergencyContacts(posted: PostedEmergencyContacts): boolean {
  return !posted.useLead && posted.typed.length === 0;
}

/** "Mary Mum · 07700 900111 · Mother" — the one-line reading. */
export function emergencyContactLine(contact: EmergencyContact): string {
  return [contact.name, contact.phone, contact.relationship].filter(Boolean).join(" · ");
}
