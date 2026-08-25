/**
 * "From the latest registration" — the read-only answers a registration left
 * on a person's contact record, plus the child's live SG-5 photo consents.
 *
 * Adam, 2026-08-25: "The registration form should update read-only information
 * in the contact record (consents, health etc). This is overwritten on each
 * registration."
 *
 * READ-ONLY is the whole point, and it is the database's position, not this
 * component's: `person_registration_details` has three SELECT policies and no
 * write policy at all, so there is nothing to offer an editor of. The answers
 * are changed by registering again.
 *
 * A plain server component — no state, no client bundle.
 */

import { ShieldCheck, ShieldX } from "lucide-react";

import type { Json } from "@club/db";

import { formatStamp } from "@/lib/people-display";
import {
  PHOTO_PREFERENCE_LABELS,
  hasMedicalDetail,
  parseRegistrationForm,
} from "@/lib/registration-form";
import { PHOTO_CONSENT_CHOICES } from "@/lib/registration-questions";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{children}</dd>
    </div>
  );
}

/** The sentence that says which registration these answers came from. */
export function registrationDetailsCaption(
  seasonName: string | null,
  updatedAt: string,
): string {
  return `${seasonName ? `${seasonName} · ` : ""}last updated ${formatStamp(updatedAt)}`;
}

export function RegistrationDetailsBody({
  details,
  /**
   * The child's live `guardian_consents` for the four SG-5 photo decisions.
   * Omitted for an adult, whose photo answers are the informational
   * `photo_preferences` below and not consents given on their behalf.
   */
  photoConsents,
  /** `registration_questions.label` by qkey, so a club's own question reads as it was asked. */
  questionLabels,
}: {
  details: Json;
  photoConsents?: Set<string>;
  questionLabels?: Map<string, string>;
}) {
  const form = parseRegistrationForm(details);
  const custom = Object.entries(form.custom ?? {});

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Detail label="Health">
            {hasMedicalDetail(form) ? (
              <span className="space-y-1">
                {form.medical.conditions && (
                  <span className="block">Conditions: {form.medical.conditions}</span>
                )}
                {form.medical.medication && (
                  <span className="block">Medication: {form.medical.medication}</span>
                )}
                {form.medical.allergies && (
                  <span className="block">Allergies: {form.medical.allergies}</span>
                )}
              </span>
            ) : (
              "Nothing declared"
            )}
          </Detail>
        </div>
        {form.kit_size && <Detail label="Kit size">{form.kit_size}</Detail>}
        {form.preferred_position && (
          <Detail label="Preferred position">{form.preferred_position}</Detail>
        )}
        {form.previous_club && <Detail label="Previous club">{form.previous_club}</Detail>}
        {form.photo_preferences && (
          <div className="sm:col-span-2">
            <Detail label="Photo preferences">
              <span className="space-y-0.5">
                {(
                  Object.keys(PHOTO_PREFERENCE_LABELS) as (keyof typeof PHOTO_PREFERENCE_LABELS)[]
                ).map((key) => (
                  <span key={key} className="block">
                    {form.photo_preferences?.[key] ? "Yes" : "No"} —{" "}
                    {PHOTO_PREFERENCE_LABELS[key]}
                  </span>
                ))}
              </span>
            </Detail>
          </div>
        )}
        {custom.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase text-muted-foreground">
              The club&apos;s own questions
            </dt>
            <dd className="mt-1 grid gap-2 text-sm sm:grid-cols-2">
              {custom.map(([qkey, value]) => (
                <span key={qkey} className="block">
                  <span className="text-xs text-muted-foreground">
                    {questionLabels?.get(qkey) ?? qkey.replace(/_/g, " ")}:{" "}
                  </span>
                  {value === "yes" ? "Yes" : value}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {photoConsents && (
        <div className="border-t pt-3">
          <p className="text-xs uppercase text-muted-foreground">Photo permissions</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {PHOTO_CONSENT_CHOICES.map((choice) => {
              const granted = photoConsents.has(choice.consentType);
              return (
                <li key={choice.consentType} className="flex items-center gap-2">
                  {granted ? (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <ShieldX className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={granted ? "" : "text-muted-foreground"}>
                    {choice.label}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            A permission that was never given, or has been withdrawn or has expired with the
            season, reads as a no — that is how the club treats it.
          </p>
        </div>
      )}
    </div>
  );
}
