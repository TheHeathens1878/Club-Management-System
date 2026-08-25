/**
 * `registrations.form` — version 1, as docs/specs/P2.2-registration-flow.md §2
 * defines it (gap 9).
 *
 * The column is `jsonb` with nothing but `jsonb_typeof(form) = 'object'` to
 * hold it, and `registrations_guard()` never looks inside it: the shape is the
 * application's promise, not the database's, which is exactly why it is
 * written down once here and shared by the screen that captures it and the
 * screen that reads it back. `form_version` says which promise was made.
 *
 * The form is SENSITIVE (emergency contact, medical). RLS lets the subject,
 * their active guardians, `club_admin` and `safeguarding_lead` read it and
 * nobody else — coaches included. Nothing here widens that; the parser simply
 * renders whatever the caller was allowed to select.
 *
 * Pure data and pure functions: imported by client components, so no cookies,
 * no service key, no server-only API.
 */

import type { Json } from "@club/db";

/** The shape below. Bump only alongside a new `RegistrationForm` type. */
export const REGISTRATION_FORM_VERSION = "2";

/** The wording the guardian ticked. Changing the terms means a new id. */
export const REGISTRATION_TERMS_VERSION = "2026-1";

/**
 * The photo-permissions wording shown beside the four SG-5 checkboxes. It is
 * written to `guardian_consents.notice_version` so what the guardian was told
 * can be reconstructed later; changing the wording means a new id.
 */
export const PHOTO_NOTICE_VERSION = "photo-2026-1";

/** The data-protection notice the registrant accepted. Same rule. */
export const GDPR_NOTICE_VERSION = "gdpr-2026-1";

/**
 * An adult's own photo preferences are informational only (spec §3): SG-5
 * consent for a CHILD is a `guardian_consents` row captured by the club, never
 * a checkbox buried in a registration form.
 */
export type PhotoPreferences = {
  team_album: boolean;
  club_website: boolean;
  social_media: boolean;
  press: boolean;
};

export type RegistrationForm = {
  emergency_contact: { name: string; phone: string; relationship: string };
  medical: { conditions: string; medication: string; allergies: string };
  previous_club: string;
  preferred_position: string;
  kit_size: string;
  terms_accepted_at: string;
  terms_version: string;
  /** Adults registering themselves only. Absent for a child. */
  photo_preferences?: PhotoPreferences;
  /**
   * Version 2. Answers to questions a club administrator added in the form
   * builder, keyed by `registration_questions.qkey`. A string per answer — a
   * checkbox is "yes" or "" — because the queue renders them beside the
   * question's own label and nothing here should need a schema to read.
   */
  custom?: Record<string, string>;
  /** Version 2. The GDPR tick the locked `gdpr_consent` question captures. */
  gdpr_accepted_at?: string;
  gdpr_notice_version?: string;
};

export const PHOTO_PREFERENCE_LABELS: Record<keyof PhotoPreferences, string> = {
  team_album: "Team album (private, the team only)",
  club_website: "Club website and public gallery",
  social_media: "Club social media",
  press: "Press and local media",
};

export const KIT_SIZES: readonly string[] = [
  "5-6 years",
  "7-8 years",
  "9-10 years",
  "11-12 years",
  "13-14 years",
  "Adult S",
  "Adult M",
  "Adult L",
  "Adult XL",
] as const;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function checked(value: FormDataEntryValue | null): boolean {
  return value === "yes" || value === "on" || value === "1";
}

/**
 * Build a version 1 form from a posted form, or say what is missing.
 *
 * The emergency contact and the terms are required by this screen — not by the
 * database. A registration with neither would be accepted by Postgres and be
 * useless to the person who has to ring somebody on a Saturday morning.
 */
export function registrationFormFromFormData(
  formData: FormData,
  options: {
    includePhotoPreferences: boolean;
    /**
     * Questions a club administrator added in the builder. Their answers go to
     * `form.custom.<qkey>`; a required one that is blank stops the submission
     * with the administrator's own wording, so the DB never has to know the
     * question exists.
     */
    customQuestions?: readonly { qkey: string; label: string; qtype: string; required: boolean }[];
    /** The locked `gdpr_consent` question is on the form. */
    requireGdpr?: boolean;
  },
): { form: RegistrationForm } | { error: string } {
  const name = text(formData.get("emergency_name"));
  const phone = text(formData.get("emergency_phone"));
  if (!name) return { error: "An emergency contact name is required." };
  if (!phone) return { error: "An emergency contact phone number is required." };
  if (!checked(formData.get("terms_accepted"))) {
    return { error: "Please confirm the details are correct and accept the club's terms." };
  }
  if (options.requireGdpr && !checked(formData.get("gdpr_accepted"))) {
    return { error: "Please confirm you have read how the club uses this information." };
  }

  const form: RegistrationForm = {
    emergency_contact: {
      name,
      phone,
      relationship: text(formData.get("emergency_relationship")),
    },
    medical: {
      conditions: text(formData.get("medical_conditions")),
      medication: text(formData.get("medical_medication")),
      allergies: text(formData.get("medical_allergies")),
    },
    previous_club: text(formData.get("previous_club")),
    preferred_position: text(formData.get("preferred_position")),
    kit_size: text(formData.get("kit_size")),
    terms_accepted_at: new Date().toISOString(),
    terms_version: REGISTRATION_TERMS_VERSION,
  };

  if (options.includePhotoPreferences) {
    form.photo_preferences = {
      team_album: checked(formData.get("photo_team_album")),
      club_website: checked(formData.get("photo_club_website")),
      social_media: checked(formData.get("photo_social_media")),
      press: checked(formData.get("photo_press")),
    };
  }

  if (options.requireGdpr) {
    form.gdpr_accepted_at = new Date().toISOString();
    form.gdpr_notice_version = GDPR_NOTICE_VERSION;
  }

  const custom: Record<string, string> = {};
  for (const question of options.customQuestions ?? []) {
    const field = formData.get(`custom_${question.qkey}`);
    const value =
      question.qtype === "checkbox" ? (checked(field) ? "yes" : "") : text(field);
    if (question.required && !value) {
      return { error: `${question.label} is required.` };
    }
    if (value) custom[question.qkey] = value;
  }
  if (Object.keys(custom).length > 0) form.custom = custom;

  return { form };
}

function readString(record: Record<string, Json | undefined>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readObject(
  record: Record<string, Json | undefined>,
  key: string,
): Record<string, Json | undefined> {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Json | undefined>;
}

/**
 * Read a stored `form` back without trusting it.
 *
 * Rows imported in Phase 3 and rows written by an older screen are both
 * possible, so every field is read defensively and a missing one comes back as
 * an empty string rather than throwing on an administrator's queue.
 */
export function parseRegistrationForm(value: Json | null | undefined): RegistrationForm {
  const empty: RegistrationForm = {
    emergency_contact: { name: "", phone: "", relationship: "" },
    medical: { conditions: "", medication: "", allergies: "" },
    previous_club: "",
    preferred_position: "",
    kit_size: "",
    terms_accepted_at: "",
    terms_version: "",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;

  const record = value as Record<string, Json | undefined>;
  const contact = readObject(record, "emergency_contact");
  const medical = readObject(record, "medical");
  const parsed: RegistrationForm = {
    emergency_contact: {
      name: readString(contact, "name"),
      phone: readString(contact, "phone"),
      relationship: readString(contact, "relationship"),
    },
    medical: {
      conditions: readString(medical, "conditions"),
      medication: readString(medical, "medication"),
      allergies: readString(medical, "allergies"),
    },
    previous_club: readString(record, "previous_club"),
    preferred_position: readString(record, "preferred_position"),
    kit_size: readString(record, "kit_size"),
    terms_accepted_at: readString(record, "terms_accepted_at"),
    terms_version: readString(record, "terms_version"),
  };

  const photo = record["photo_preferences"];
  if (photo && typeof photo === "object" && !Array.isArray(photo)) {
    const flags = photo as Record<string, Json | undefined>;
    parsed.photo_preferences = {
      team_album: flags["team_album"] === true,
      club_website: flags["club_website"] === true,
      social_media: flags["social_media"] === true,
      press: flags["press"] === true,
    };
  }

  // Version 2. A version 1 row simply has neither, which is why both are read
  // the same tolerant way as everything above rather than switched on
  // `form_version`: the column says what was promised, not what is there.
  const custom = record["custom"];
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(custom as Record<string, Json>)) {
      if (typeof value === "string") answers[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") answers[key] = String(value);
    }
    if (Object.keys(answers).length > 0) parsed.custom = answers;
  }

  const gdprAt = readString(record, "gdpr_accepted_at");
  if (gdprAt) {
    parsed.gdpr_accepted_at = gdprAt;
    parsed.gdpr_notice_version = readString(record, "gdpr_notice_version");
  }

  return parsed;
}

/** Has this form anything medical in it at all? */
export function hasMedicalDetail(form: RegistrationForm): boolean {
  return Boolean(form.medical.conditions || form.medical.medication || form.medical.allergies);
}

/**
 * "active" is not a `registration_status`: it is the pseudo-status
 * `my_registrations()` reports for a household player on a current-season
 * squad with no live registration row (children attached by an admin, or
 * imported) — so the parent's list tells the truth about them.
 */
export type RegistrationStatusValue = "pending" | "approved" | "rejected" | "withdrawn" | "active";

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatusValue, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  active: "On the squad",
};

export function registrationStatusVariant(
  status: RegistrationStatusValue,
): "default" | "success" | "warning" | "muted" | "destructive" {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
    case "active":
      return "success";
    case "rejected":
      return "destructive";
    case "withdrawn":
      return "muted";
  }
}
