import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The function room's own contacts book (`booking_contacts`) — hire contacts
 * kept deliberately OUT of the members database. One contact per email; a
 * booking without a usable email stays snapshot-only, exactly as before.
 *
 * Server-only: both the public hire form and the staff desk write through the
 * admin client (the hire form has no session at all), and RLS on the table
 * still governs what staff read back in the app.
 */

export type BookingContactInput = {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** "—", blank and non-addresses all mean "no email on this contact". */
function usableEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim();
  return trimmed.includes("@") && trimmed.length > 2 ? trimmed : null;
}

/**
 * Find-or-create by email, refreshing the details from the latest booking —
 * the newest name/phone wins, blanks never overwrite. Returns the contact id,
 * or null when there is no usable email to key on.
 */
export async function upsertBookingContact(input: BookingContactInput): Promise<string | null> {
  const email = usableEmail(input.email);
  const name = input.name.trim();
  if (!email || name === "") return null;

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
        name,
        ...(input.firstName?.trim() ? { first_name: input.firstName.trim() } : {}),
        ...(input.lastName?.trim() ? { last_name: input.lastName.trim() } : {}),
        ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created } = await admin
    .from("booking_contacts")
    .insert({
      name,
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      email,
      phone: input.phone?.trim() || null,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}
