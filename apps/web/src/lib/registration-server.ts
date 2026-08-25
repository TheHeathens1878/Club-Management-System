/**
 * Registering a player for a team — the one write shared by /join (step 3)
 * and the family screen's "Register for a team" (Adam, 2026-08-25: the family
 * form had been hand-coded and never showed the builder's questions, the
 * photo or the ID; now both screens render the same questions and go through
 * this).
 *
 * Authorisation stays in the database throughout: `registrations_guard()` and
 * the insert policies decide who may register whom, `needs_id_document()` is
 * re-asked here rather than trusted from the browser, and the photo consents
 * are written through the caller's own client so P1.7's guard sees the
 * guardian. Two rules are this module's own, because Postgres does not know
 * them: an ID is owed unless the club has seen one, and at least one
 * emergency contact must be on the person's record before they can be
 * registered (the contact used to be a required field on the form; it is a
 * required fact about the person now).
 *
 * Plain server module (no "use server"): imported by the join and family
 * actions, which are the "use server" files.
 */

import { createClient } from "@/lib/supabase/server";
import {
  PHOTO_NOTICE_VERSION,
  REGISTRATION_FORM_VERSION,
  type RegistrationForm,
} from "@/lib/registration-form";
import { PHOTO_CONSENT_CHOICES } from "@/lib/registration-questions";
import { tidyRpcMessage } from "@/lib/waiting-list";

export type CustomQuestion = { qkey: string; label: string; qtype: string; required: boolean };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * The questions a club administrator added, as the client posts them (JSON in
 * `custom_questions`). Only their keys and requiredness matter here — the
 * answers are read back by `registrationFormFromFormData`.
 */
export function customQuestionsFrom(formData: FormData): CustomQuestion[] {
  try {
    const parsed: unknown = JSON.parse(text(formData, "custom_questions") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is CustomQuestion =>
        !!entry && typeof entry === "object" && typeof (entry as CustomQuestion).qkey === "string",
    );
  } catch {
    return [];
  }
}

/**
 * The instant that is 23:59, Europe/London, on the season's last day.
 *
 * Photo consent expires with the season (P2.2 §3), and "the season ends on
 * 2027-05-31" is a local statement about a club in Cheshire, not a UTC one.
 * Formatting the same moment in both zones and taking the difference is the
 * offset, so this is right in May (BST) and right in January (GMT) without a
 * timezone dependency.
 */
export function seasonEndInstant(endsOn: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return null;
  const naive = new Date(`${endsOn}T23:59:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const asLondon = new Date(naive.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const offsetMs = asLondon.getTime() - asUtc.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

/**
 * The SG-5 consent writes this flow has owed since P2.2 was specified.
 *
 * One `guardian_consents` row per TICKED box and NO ROW for an unticked one —
 * absence is refusal, which is the fail-closed position SG-5 requires and the
 * reason this cannot be a four-boolean column. Written through the caller's
 * own client so P1.7's guard sees the guardian, not the service role: it
 * checks the active guardianship and the granter's own adulthood itself, and
 * a refusal comes back verbatim.
 *
 * A failure here does NOT unwind the registration. The registration is the
 * thing the family came to do; a consent they can be asked for again is not
 * worth throwing it away over, and no row means no permission, so the failure
 * is safe in the only direction that matters.
 */
export async function writePhotoConsents(
  formData: FormData,
  childPersonId: string,
  guardianPersonId: string,
  expiresAt: string | null,
): Promise<void> {
  const wanted = PHOTO_CONSENT_CHOICES.filter((choice) => formData.get(choice.field) === "yes");
  if (wanted.length === 0) return;

  const supabase = await createClient();
  await supabase.from("guardian_consents").insert(
    wanted.map((choice) => ({
      child_person_id: childPersonId,
      guardian_person_id: guardianPersonId,
      consent_type: choice.consentType,
      notice_version: PHOTO_NOTICE_VERSION,
      expires_at: expiresAt,
    })),
  );
}

/** The photo becomes the avatar; the ID document becomes a three-year record. */
export async function attachUploads(
  formData: FormData,
  personId: string,
  registrationId: string | null,
): Promise<void> {
  const supabase = await createClient();

  const photoPath = text(formData, "photo_path");
  if (photoPath) {
    await supabase.rpc("set_person_photo", { p_person_id: personId, p_path: photoPath });
  }

  const idPath = text(formData, "id_path");
  const idKind = text(formData, "id_kind");
  if (idPath && idKind) {
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("identity_documents").insert({
      person_id: personId,
      registration_id: registrationId,
      kind: idKind,
      storage_path: idPath,
      uploaded_by: auth.user?.id ?? null,
    });
  }
}

/**
 * The ID rule, re-asked here and not trusted from the browser: the screen can
 * only ever be showing what was true when it was rendered. The sentence to
 * show, or null when nothing is owed.
 */
export async function idDocumentOwed(personId: string, formData: FormData): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("needs_id_document", { p_person_id: personId });
  if (data === true && !text(formData, "id_path")) {
    return "The club needs to see proof of identity for this player — add a passport, birth certificate or driving licence.";
  }
  return null;
}

/** How many emergency contacts the caller can see on this person's record. */
export async function emergencyContactsOnRecord(personId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("emergency_contacts")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId);
  return count ?? 0;
}

export const NO_EMERGENCY_CONTACT =
  "An emergency contact must be on this player's record before they can be registered.";

export type TeamRegistrationInput = {
  personId: string;
  isSelf: boolean;
  isMinor: boolean;
  seasonId: string;
  seasonEndsOn: string | null;
  /** Null for a team-less registration the club follows up by hand. */
  teamId: string | null;
  /** The form as `registrationFormFromFormData` built it — already validated. */
  form: RegistrationForm;
  /** The posted form, for the upload paths and the SG-5 tick-boxes. */
  formData: FormData;
  /** Extra keys written beside the form (the "no team" note). */
  extraForm?: Record<string, string>;
};

function registrationErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "There is already a registration waiting or approved for this season. Withdraw it first if you need to change it.";
  }
  if (error.code === "42501") {
    return "The club's records do not show you as able to register this player — only they, an active guardian or a club administrator can.";
  }
  return tidyRpcMessage(error.message);
}

/**
 * One pending `registrations` row, then the uploads and the consents that
 * hang off it. The two rules above are checked first so nothing is written
 * for a submission that is going to be refused.
 */
export async function submitTeamRegistration(
  input: TeamRegistrationInput,
): Promise<{ error: string } | { registrationId: string | null }> {
  const owed = await idDocumentOwed(input.personId, input.formData);
  if (owed) return { error: owed };
  if ((await emergencyContactsOnRecord(input.personId)) === 0) {
    return { error: NO_EMERGENCY_CONTACT };
  }

  const supabase = await createClient();
  const form = input.extraForm ? { ...input.form, ...input.extraForm } : input.form;
  const { data: inserted, error } = await supabase
    .from("registrations")
    .insert({
      person_id: input.personId,
      season_id: input.seasonId,
      team_id: input.teamId,
      form: JSON.parse(JSON.stringify(form)),
      form_version: REGISTRATION_FORM_VERSION,
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: registrationErrorMessage(error) };

  const registrationId = inserted?.id ?? null;
  await attachUploads(input.formData, input.personId, registrationId);
  if (input.isMinor && !input.isSelf) {
    const { data: guardianPersonId } = await supabase.rpc("current_person_id");
    if (guardianPersonId) {
      await writePhotoConsents(
        input.formData,
        input.personId,
        guardianPersonId,
        input.seasonEndsOn ? seasonEndInstant(input.seasonEndsOn) : null,
      );
    }
  }
  return { registrationId };
}
