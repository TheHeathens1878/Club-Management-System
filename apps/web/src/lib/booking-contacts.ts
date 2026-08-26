import { createAdminClient } from "@/lib/supabase/admin";
import { joinContactName, splitContactName } from "@/lib/person-name";

/**
 * The function room's own contacts book (`booking_contacts`) — hire contacts
 * kept deliberately OUT of the members database. One contact per email; a
 * booking without a usable email stays snapshot-only, exactly as before.
 *
 * Since 20260825431000 the contact's name is TWO columns. `name` on the table
 * is a generated display value and must never be written; the two parts are.
 * A caller that only has one string (a legacy snapshot, a staff form that has
 * not been split yet) passes `name` and it is split on the last space here.
 * A name that cannot be split into two parts cannot become a contact — the
 * table's BEFORE INSERT trigger says so — and that booking stays snapshot-only,
 * the same fate as an email-less one.
 *
 * Server-only: both the public hire form and the staff desk write through the
 * admin client (the hire form has no session at all), and RLS on the table
 * still governs what staff read back in the app.
 */

export type BookingContactInput = {
  /** The two halves, separately. Preferred: this is what the table holds. */
  firstName?: string | null;
  lastName?: string | null;
  /** A one-string name, split on the last space when the halves are absent. */
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** "—", blank and non-addresses all mean "no email on this contact". */
function usableEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim();
  return trimmed.includes("@") && trimmed.length > 2 ? trimmed : null;
}

/** Both name parts, from whichever shape the caller had. */
function nameParts(input: BookingContactInput): { firstName: string; lastName: string } | null {
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  if (first && last) return { firstName: first, lastName: last };
  const split = splitContactName(input.name ?? joinContactName(first, last));
  if (!split.firstName || !split.lastName) return null;
  return split;
}

/**
 * Find-or-create by email, refreshing the details from the latest booking —
 * the newest name/phone wins, blanks never overwrite. Returns the contact id,
 * or null when there is no usable email to key on, or no splittable name.
 */
export async function upsertBookingContact(input: BookingContactInput): Promise<string | null> {
  const email = usableEmail(input.email);
  const parts = nameParts(input);
  if (!email || !parts) return null;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("booking_contacts")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await admin
      .from("booking_contacts")
      .update({
        first_name: parts.firstName,
        last_name: parts.lastName,
        ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created } = await admin
    .from("booking_contacts")
    .insert({
      first_name: parts.firstName,
      last_name: parts.lastName,
      email,
      phone: input.phone?.trim() || null,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}
