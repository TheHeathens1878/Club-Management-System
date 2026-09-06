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
 * WHAT THE PORTAL ASKS (Adam, 2026-09-06)
 *   The FA Clubs Portal registers a parent or carer with a date of birth, a
 *   sex, an email and an address with a postcode, so a contact now carries
 *   those too (20260906120000). A contact who IS a member — the parent who
 *   ticks the box — is LINKED to their own record and the export reads the
 *   fields from there; anyone else has them typed.
 *
 * THE TICK-BOX
 *   "I am the first emergency contact" (Adam: "Emergency contact can be lead
 *   contact also, so a tick button would be helpful"). Like the address tick
 *   on the family screen it is resolved on the SERVER from the caller's own
 *   `people` row, and the same rule protects it: the fields for contact 1 are
 *   only rendered while the box is unticked, so a typed contact arriving
 *   alongside a "yes" is the clearer statement and wins.
 *
 * Pure data and pure functions: imported by client components.
 */

export const MAX_EMERGENCY_CONTACTS = 2;

export type ContactSex = "male" | "female" | "";

export type ContactAddress = { line1: string; line2: string; town: string; postcode: string };

export const EMPTY_CONTACT_ADDRESS: ContactAddress = { line1: "", line2: "", town: "", postcode: "" };

export type EmergencyContact = {
  position: number;
  /** The two halves, separately (20260825491000) — what the table holds. */
  firstName: string;
  lastName: string;
  /** The display value the table generates from the two halves. */
  name: string;
  phone: string;
  relationship: string;
  /** Set when the contact is a member — their own record is the source. */
  contactPersonId: string | null;
  /** `YYYY-MM-DD`, or "". */
  dob: string;
  sex: ContactSex;
  email: string;
  address: ContactAddress;
};

/** The posted field names, one set per position: `ec1_first_name`, `ec2_phone`, … */
export type ContactFieldKey =
  | "first_name"
  | "last_name"
  | "phone"
  | "relationship"
  | "dob"
  | "sex"
  | "email"
  | "address_line1"
  | "address_line2"
  | "address_town"
  | "address_postcode";

export function contactField(position: number, key: ContactFieldKey): string {
  return `ec${position}_${key}`;
}

/**
 * Posted alongside the fieldset so a save can tell "they were not asked" from
 * "they cleared both". An absent fieldset must never be read as an instruction
 * to delete the numbers the club would ring in an emergency.
 */
export const EMERGENCY_FIELDS_PRESENT = "has_emergency_fields";

/** Posted as "yes" when contact 1 should be the signed-in lead contact themselves. */
export const USE_LEAD_FIELD = "ec_use_lead";

export type TypedEmergencyContact = {
  firstName: string;
  lastName: string;
  phone: string;
  relationship: string;
  dob: string;
  sex: ContactSex;
  email: string;
  address: ContactAddress;
};

export type PostedEmergencyContacts = {
  /** Contact 1 is the caller — resolved server-side from their own record. */
  useLead: boolean;
  /** The relationship typed beside the tick (the caller's, to the person). */
  leadRelationship: string;
  /** The contacts typed in full, in the order they will be numbered. */
  typed: TypedEmergencyContact[];
};

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function asSex(value: string): ContactSex {
  const lower = value.toLowerCase();
  return lower === "male" || lower === "female" ? lower : "";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when any of the address was typed. */
export function addressGiven(address: ContactAddress): boolean {
  return !!(address.line1 || address.line2 || address.town || address.postcode);
}

/**
 * Read the posted contacts, or say what is wrong with them. Blank rows are
 * simply absent; a half-filled row (a name with no number, or the reverse) is
 * refused here with the sentence the form shows, so the database never has to.
 * An address without a postcode is refused the same way (Adam, 2026-09-06:
 * "Postcode is required").
 */
export function emergencyContactsFromFormData(
  formData: FormData,
): { error: string } | PostedEmergencyContacts {
  const rows: TypedEmergencyContact[] = [];
  for (let position = 1; position <= MAX_EMERGENCY_CONTACTS; position += 1) {
    rows.push({
      firstName: text(formData.get(contactField(position, "first_name"))),
      lastName: text(formData.get(contactField(position, "last_name"))),
      phone: text(formData.get(contactField(position, "phone"))),
      relationship: text(formData.get(contactField(position, "relationship"))),
      dob: text(formData.get(contactField(position, "dob"))),
      sex: asSex(text(formData.get(contactField(position, "sex")))),
      email: text(formData.get(contactField(position, "email"))),
      address: {
        line1: text(formData.get(contactField(position, "address_line1"))),
        line2: text(formData.get(contactField(position, "address_line2"))),
        town: text(formData.get(contactField(position, "address_town"))),
        postcode: text(formData.get(contactField(position, "address_postcode"))).toUpperCase(),
      },
    });
  }

  // The tick stands only when contact 1's own fields are empty — they are not
  // rendered while it is ticked, so both arriving means a reset checkbox.
  const first = rows[0]!;
  const useLead =
    formData.get(USE_LEAD_FIELD) === "yes" && !first.firstName && !first.lastName && !first.phone;

  const typed: TypedEmergencyContact[] = [];
  for (const [index, row] of rows.entries()) {
    if (useLead && index === 0) continue;
    const anything =
      row.firstName || row.lastName || row.phone || row.dob || row.email || addressGiven(row.address);
    if (!anything) continue;
    if (!row.firstName || !row.lastName || !row.phone) {
      return {
        error: `Emergency contact ${index + 1} needs a first name, a last name and a phone number.`,
      };
    }
    if (row.dob && !DATE_RE.test(row.dob)) {
      return { error: `Emergency contact ${index + 1}: enter the date of birth as a date, or leave it blank.` };
    }
    if (addressGiven(row.address) && !row.address.postcode) {
      return { error: `Emergency contact ${index + 1} needs a postcode with their address.` };
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

/**
 * What the Portal still needs from a contact, in words — "" when complete.
 * A linked contact is judged on the member's own record by the export, not
 * here, so it is never called incomplete on the form.
 */
export function contactGaps(contact: EmergencyContact): string {
  if (contact.contactPersonId) return "";
  const gaps: string[] = [];
  if (!contact.dob) gaps.push("date of birth");
  if (!contact.sex) gaps.push("sex");
  if (!contact.email) gaps.push("email");
  if (!contact.address.postcode) gaps.push("postcode");
  return gaps.length === 0 ? "" : `Still needed for the FA Clubs Portal: ${gaps.join(", ")}.`;
}
