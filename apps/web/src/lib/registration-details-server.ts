/**
 * The read-only copy of the registration answers that lives on a person's
 * contact record — `person_registration_details` (20260825230000).
 *
 * Adam, 2026-08-25: "The registration form should update read-only information
 * in the contact record (consents, health etc). This is overwritten on each
 * registration."
 *
 * The snapshot is deliberately NOT on `people`: that table is readable by the
 * committee and by team staff, which is far wider than the answers' own
 * readership. `person_registration_details` carries the three `registrations`
 * read policies word for word — subject, active guardians, club_admin,
 * safeguarding_lead — so a coach reading a person page gets nothing back here
 * and the card does not render. Nothing in this module filters anything by
 * hand; every read goes through the caller's own client.
 *
 * Server module (cookies): imported by /people/[id] and /family.
 */

import type { Json } from "@club/db";

import { PHOTO_CONSENT_CHOICES } from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/server";

export type RegistrationDetails = {
  personId: string;
  registrationId: string | null;
  seasonName: string | null;
  details: Json;
  updatedAt: string;
};

/** One snapshot per person, for the people the caller is entitled to see. */
export async function loadRegistrationDetails(
  personIds: string[],
): Promise<Map<string, RegistrationDetails>> {
  const out = new Map<string, RegistrationDetails>();
  const ids = Array.from(new Set(personIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const { data } = await supabase
    .from("person_registration_details")
    .select("person_id,registration_id,details,updated_at,seasons(name)")
    .in("person_id", ids);

  for (const row of data ?? []) {
    out.set(row.person_id, {
      personId: row.person_id,
      registrationId: row.registration_id,
      seasonName: row.seasons?.name ?? null,
      details: row.details,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

/**
 * The child's LIVE SG-5 photo consents — the `guardian_consents` rows
 * themselves, not the adult's informational `photo_preferences`.
 *
 * "Live" is the same test `has_active_consent()` makes: not revoked, and not
 * past its expiry (photo consent expires with the season, which is why
 * registration re-asks every year). A consent type with no row is a NO by
 * construction (SG-5 fails closed), so the card shows all four and marks the
 * missing ones as not given rather than hiding them.
 */
export async function loadLivePhotoConsents(
  childPersonIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const ids = Array.from(new Set(childPersonIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const { data } = await supabase
    .from("guardian_consents")
    .select("child_person_id,consent_type,expires_at,revoked_at")
    .in("child_person_id", ids)
    .in(
      "consent_type",
      PHOTO_CONSENT_CHOICES.map((choice) => choice.consentType),
    )
    .is("revoked_at", null);

  const now = Date.now();
  for (const row of data ?? []) {
    if (row.expires_at && Date.parse(row.expires_at) <= now) continue;
    const set = out.get(row.child_person_id) ?? new Set<string>();
    set.add(row.consent_type);
    out.set(row.child_person_id, set);
  }
  return out;
}
