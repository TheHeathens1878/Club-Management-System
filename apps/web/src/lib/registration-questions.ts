/**
 * `registration_questions` — the registration form, as data.
 *
 * Adam, 2026-08-25: "create an editable registration form … We should be able
 * to drag questions around the form. As a default, need photo permissions and
 * GDPR."
 *
 * Two kinds of row live in that table and the difference matters everywhere
 * this type is used:
 *
 *   · a SYSTEM question (`system = true`) whose `qtype` the screen knows by
 *     name — an emergency contact is three fields, a medical block is three
 *     more, photo permissions are four SG-5 checkboxes. The table decides the
 *     ORDER, the WORDING and whether it is required; the rendering is code.
 *   · a CUSTOM question a club administrator added, rendered from `qtype` with
 *     a generic input and written to `form.custom.<qkey>`.
 *
 * Three system rows are LOCKED — photo permissions, GDPR and the club's terms.
 * The database refuses to archive them or make them optional; everything here
 * mirrors that so the builder shows the same rule it will be held to.
 *
 * Pure data and pure functions: imported by client components, so no cookies,
 * no service key, no server-only API.
 */

export type QuestionType =
  | "short_text"
  | "long_text"
  | "select"
  | "checkbox"
  | "date"
  | "phone"
  | "email"
  | "emergency_contact"
  | "medical"
  | "kit_size"
  | "player_photo"
  | "id_document"
  | "photo_consents"
  | "gdpr_consent"
  | "terms";

export type RegistrationQuestion = {
  id: string;
  qkey: string;
  label: string;
  helpText: string | null;
  qtype: QuestionType;
  options: string[];
  required: boolean;
  system: boolean;
  locked: boolean;
  position: number;
  archivedAt: string | null;
};

/** The types an administrator may pick when adding a question of their own. */
export const CUSTOM_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "select",
  "checkbox",
  "date",
  "phone",
  "email",
] as const satisfies readonly QuestionType[];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  select: "Choose one",
  checkbox: "Tick box",
  date: "Date",
  phone: "Phone number",
  email: "Email address",
  emergency_contact: "Emergency contact (retired — kept on the person's record)",
  medical: "Health questions (built in)",
  kit_size: "Kit size (built in)",
  player_photo: "Player photo (built in)",
  id_document: "Proof of identity (built in)",
  photo_consents: "Photo permissions (built in)",
  gdpr_consent: "Data protection (built in)",
  terms: "Club terms (built in)",
};

const KNOWN_TYPES = new Set<string>(Object.keys(QUESTION_TYPE_LABELS));

/**
 * Read a row back without trusting it. A `qtype` this build does not know
 * about — a newer migration against an older deployment — is dropped rather
 * than rendered as a mystery box.
 */
export function questionFromRow(row: {
  id: string;
  qkey: string;
  label: string;
  help_text: string | null;
  qtype: string;
  options: unknown;
  required: boolean;
  system: boolean;
  locked: boolean;
  position: number;
  archived_at: string | null;
}): RegistrationQuestion | null {
  if (!KNOWN_TYPES.has(row.qtype)) return null;
  return {
    id: row.id,
    qkey: row.qkey,
    label: row.label,
    helpText: row.help_text,
    qtype: row.qtype as QuestionType,
    options: Array.isArray(row.options)
      ? row.options.filter((value): value is string => typeof value === "string")
      : [],
    required: row.required,
    system: row.system,
    locked: row.locked,
    position: row.position,
    archivedAt: row.archived_at,
  };
}

/**
 * A label from a free-typed one, the way the builder mints a `qkey`.
 * Deliberately the same shape as the database's own CHECK constraint, so a
 * name that cannot become a key is refused in the browser rather than by
 * Postgres.
 */
export function slugifyQuestionKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "q$1")
    .slice(0, 59);
}

export function isValidQuestionKey(qkey: string): boolean {
  return /^[a-z][a-z0-9_]{1,58}$/.test(qkey);
}

/** Identity documents, in the order the join screen offers them. */
export const ID_DOCUMENT_KINDS = [
  { value: "passport", label: "Passport" },
  { value: "birth_certificate", label: "Birth certificate" },
  { value: "driving_licence", label: "Driving licence" },
  { value: "other", label: "Something else" },
] as const;

export function idDocumentKindLabel(kind: string): string {
  return ID_DOCUMENT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/** Adam: "Max 5Mb". Both buckets carry the same limit; so does the browser. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const ID_MIME_TYPES = [...PHOTO_MIME_TYPES, "application/pdf"];

/**
 * The four SG-5 photo decisions, in the order docs/specs/P2.2-registration-flow.md
 * §3 tabulates them. Each ticked box is one `guardian_consents` row; each
 * unticked box is NO ROW — absence is refusal, and that is the fail-closed
 * position SG-5 requires.
 */
export const PHOTO_CONSENT_CHOICES = [
  { field: "photo_team_album", consentType: "photo_team_album", label: "Team album (private, the team only)" },
  { field: "photo_club_website", consentType: "photo_club_website", label: "Club website and public gallery" },
  { field: "photo_social_media", consentType: "photo_social_media", label: "Club social media" },
  { field: "photo_press", consentType: "photo_press", label: "Press and local media" },
] as const;

/** A file name safe to put in a storage path. */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80) || "upload";
}
