"use client";

/**
 * One registration question, drawn the way the club currently asks it —
 * shared by /join (step 3) and the family screen's "Register for a team"
 * (Adam, 2026-08-25: the family form had been hand-coded and never showed the
 * builder's questions, the photo or the ID).
 *
 * The two files never reach a server action: they go to their private bucket
 * from the browser first, using the person's OWN client — the storage policy
 * (`can_act_for(<person>)` on the first path segment) is what admits them —
 * and the action is handed a PATH. `stageRegistrationUploads` is that
 * preamble, so both screens do it the same way.
 */

import { ShieldCheck } from "lucide-react";

import { Input, Label } from "@/components/ui/input";
import { PHOTO_PREFERENCE_LABELS } from "@/lib/registration-form";
import {
  ID_DOCUMENT_KINDS,
  ID_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  PHOTO_CONSENT_CHOICES,
  PHOTO_MIME_TYPES,
  safeFileName,
  type RegistrationQuestion,
} from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/client";

/** Who the question is being asked about. */
export type RegistrationPlayer = {
  personId: string;
  firstName: string;
  /** The registrant themselves (an adult registering to play). */
  isSelf: boolean;
  minor: boolean;
  /** The club has neither seen their ID nor holds a document. */
  needsId: boolean;
};

/**
 * Files go straight to their private bucket from the browser, using the
 * person's OWN client — the storage policy (`can_act_for(<person>)` on the
 * first path segment) is what admits them, exactly as the media album's
 * uploader works. The server action is then handed a PATH, never bytes, and
 * re-checks the ID rule before it accepts the registration.
 */
export async function uploadRegistrationFile(
  bucket: "person-photos" | "identity-documents",
  personId: string,
  file: File,
  accept: string[],
): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${file.name} is larger than 5MB. Please choose a smaller file.` };
  }
  if (file.type && !accept.includes(file.type)) {
    return { error: `${file.name} is not a sort of file the club can accept.` };
  }

  const supabase = createClient();
  const path = `${personId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) return { error: error.message };
  return { path };
}


/**
 * Upload the photo and the ID document (when present) and replace them in the
 * form with their storage paths. Returns the sentence to show when an upload
 * is refused; the action is only called once this has succeeded.
 */
export async function stageRegistrationUploads(
  formData: FormData,
  personId: string,
): Promise<{ error: string } | { ok: true }> {
  const photo = formData.get("player_photo_file");
  formData.delete("player_photo_file");
  if (photo instanceof File && photo.size > 0) {
    const result = await uploadRegistrationFile("person-photos", personId, photo, PHOTO_MIME_TYPES);
    if ("error" in result) return result;
    formData.set("photo_path", result.path);
  }

  const idFile = formData.get("id_document_file");
  formData.delete("id_document_file");
  if (idFile instanceof File && idFile.size > 0) {
    const result = await uploadRegistrationFile("identity-documents", personId, idFile, ID_MIME_TYPES);
    if ("error" in result) return result;
    formData.set("id_path", result.path);
  }
  return { ok: true };
}

/** The builder's custom questions, as the server action wants them posted. */
export function customQuestionsPayload(questions: RegistrationQuestion[]): string {
  return JSON.stringify(
    questions
      .filter((question) => !question.system)
      .map((question) => ({
        qkey: question.qkey,
        label: question.label,
        qtype: question.qtype,
        required: question.required,
      })),
  );
}

/**
 * One question, drawn the way the club currently asks it.
 *
 * A SYSTEM question keeps its own hard-coded block — an emergency contact is
 * three fields and photo permissions are four separate SG-5 decisions, and
 * neither survives being flattened into a text box. What the table decides is
 * the ORDER, the WORDING and whether it is required. A question an
 * administrator added is rendered generically and answers to
 * `form.custom.<qkey>`.
 */
export function QuestionBlock({
  question,
  player,
}: {
  question: RegistrationQuestion;
  player: RegistrationPlayer;
}) {
  const id = `${question.qkey}-${player.personId}`;
  const field = question.system ? question.qkey : `custom_${question.qkey}`;
  const help = question.helpText ? (
    <p className="text-xs text-muted-foreground">{question.helpText}</p>
  ) : null;

  // `can_act_for()` — yourself, or a child you are the guardian of. Another
  // adult in the household is neither, so the storage policy would refuse
  // their photo and their ID. Asking for a file that cannot be accepted is
  // worse than not asking; they upload theirs from their own account.
  const canUpload = player.isSelf || player.minor;

  switch (question.qtype) {
    case "emergency_contact":
      // Retired (Adam, 2026-08-25): emergency contacts live on the person's
      // record — <EmergencyContactsFields/> asks for them. The seed row is
      // deleted by 20260825150000; a row that somehow survives draws nothing.
      return null;

    case "medical":
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{question.label}</legend>
          {help}
          <div className="space-y-1">
            <Label htmlFor={id}>Any medical conditions we should know about?</Label>
            <textarea
              id={id}
              name="medical_conditions"
              rows={2}
              required={question.required}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="medical_medication" placeholder="Medication (if any)" />
            <Input name="medical_allergies" placeholder="Allergies (if any)" />
          </div>
        </fieldset>
      );

    case "kit_size":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <select
            id={id}
            name="kit_size"
            required={question.required}
            defaultValue=""
            className="block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64 lg:h-10"
          >
            <option value="">Not sure yet</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );

    case "player_photo":
      if (!canUpload) return null;
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <Input
            id={id}
            name="player_photo_file"
            type="file"
            accept={PHOTO_MIME_TYPES.join(",")}
            required={question.required}
            className="h-11 lg:h-10"
          />
        </div>
      );

    case "id_document":
      if (!canUpload) {
        return (
          <p className="text-sm text-muted-foreground">
            {player.firstName} adds their own photo and proof of identity when they sign in.
          </p>
        );
      }
      if (!player.needsId) {
        return (
          <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            The club has already seen ID for this player, so there is nothing to upload.
          </p>
        );
      }
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {question.label} <span className="text-destructive">*</span>
          </legend>
          {help}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-kind`}>What is it?</Label>
              <select
                id={`${id}-kind`}
                name="id_kind"
                defaultValue="birth_certificate"
                className="block h-11 w-full rounded-md border bg-background px-3 text-sm lg:h-10"
              >
                {ID_DOCUMENT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-file`}>The file</Label>
              <Input
                id={`${id}-file`}
                name="id_document_file"
                type="file"
                accept={ID_MIME_TYPES.join(",")}
                required
                className="h-11 lg:h-10"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Only club administrators can open this file. It is destroyed automatically three years
            after it is uploaded.
          </p>
        </fieldset>
      );

    case "photo_consents":
      if (!canUpload) {
        return (
          <p className="text-sm text-muted-foreground">
            The club asks {player.firstName} about photo permissions directly — an adult&rsquo;s
            permission is theirs to give, not yours.
          </p>
        );
      }
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{question.label}</legend>
          {help}
          {/* Adam, 2026-08-25: "Photo permissions should be pre-ticked." This
              is the STARTING POSITION of the boxes and nothing else. SG-5's
              fail-closed rule is untouched: what is submitted is what is
              ticked at that moment, an unticked box still writes NO
              `guardian_consents` row, and absence of a row is still refusal.
              Untick and the permission is not given. */}
          {player.isSelf ? (
            <>
              <p className="text-xs text-muted-foreground">
                Untick anywhere you would rather the club did not use photographs of you.
              </p>
              {PHOTO_CONSENT_CHOICES.map((choice) => (
                <label key={choice.field} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={choice.field}
                    value="yes"
                    defaultChecked
                    className="h-4 w-4"
                  />
                  {PHOTO_PREFERENCE_LABELS[
                    choice.field.replace("photo_", "") as keyof typeof PHOTO_PREFERENCE_LABELS
                  ] ?? choice.label}
                </label>
              ))}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Each of these is a separate decision. They start ticked — untick any you are not
                happy with, and one left unticked is a no. You can change any of them later, and
                they are re-asked every season.
              </p>
              {PHOTO_CONSENT_CHOICES.map((choice) => (
                <label key={choice.field} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={choice.field}
                    value="yes"
                    defaultChecked
                    className="h-4 w-4"
                  />
                  {choice.label}
                </label>
              ))}
            </>
          )}
        </fieldset>
      );

    case "gdpr_consent":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="gdpr_accepted"
            value="yes"
            required
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="font-medium">{question.label}.</span>{" "}
            {question.helpText ??
              "I have read how the club stores and uses this information."}
          </span>
        </label>
      );

    case "terms":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="terms_accepted"
            value="yes"
            required
            className="mt-1 h-4 w-4"
          />
          <span>
            {question.helpText ?? "The details are correct and I accept the club’s terms."}
          </span>
        </label>
      );

    case "long_text":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <textarea
            id={id}
            name={field}
            rows={3}
            required={question.required}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      );

    case "select":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <select
            id={id}
            name={field}
            required={question.required}
            defaultValue=""
            className="block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64 lg:h-10"
          >
            <option value="">Choose…</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );

    case "checkbox":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name={field}
            value="yes"
            required={question.required}
            className="mt-1 h-4 w-4"
          />
          <span>
            {question.label}
            {question.helpText && (
              <span className="block text-xs text-muted-foreground">{question.helpText}</span>
            )}
          </span>
        </label>
      );

    default:
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <Input
            id={id}
            name={field}
            type={
              question.qtype === "date"
                ? "date"
                : question.qtype === "email"
                  ? "email"
                  : question.qtype === "phone"
                    ? "tel"
                    : "text"
            }
            required={question.required}
          />
        </div>
      );
  }
}

