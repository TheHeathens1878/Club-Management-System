"use server";

/**
 * Who holds the `safeguarding_lead` role (SAFEGUARDING.md SG-3/SG-6/SG-9).
 *
 * User-scoped: `person_roles` RLS lets only a club_admin insert or revoke,
 * and the table's audit trigger records every change. There is exactly one
 * lead at a time by club policy (the exemption guard and the concern
 * accessors work with any number, but the committee wants one named person),
 * so appointing a new lead revokes the previous one in the same action.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type LeadActionState = { error?: string; notice?: string };

const PATH = "/safeguarding";

export async function appointSafeguardingLead(
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (!personId) return { error: "Choose a person." };

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("person_roles")
    .select("id, person_id")
    .eq("role", "safeguarding_lead")
    .is("revoked_at", null);
  if (readError) return { error: readError.message };

  if ((current ?? []).some((r) => r.person_id === personId)) {
    return { notice: "That person is already the safeguarding lead." };
  }

  const { error: insertError } = await supabase.from("person_roles").insert({
    person_id: personId,
    role: "safeguarding_lead",
    notes: "appointed from the safeguarding desk",
  });
  if (insertError) {
    return {
      error:
        insertError.code === "42501"
          ? "Only a club administrator can appoint the safeguarding lead."
          : insertError.message,
    };
  }

  const previous = (current ?? []).map((r) => r.id);
  if (previous.length > 0) {
    const { error: revokeError } = await supabase
      .from("person_roles")
      .update({ revoked_at: new Date().toISOString() })
      .in("id", previous);
    if (revokeError) return { error: `Appointed, but the previous lead was not revoked: ${revokeError.message}` };
  }

  revalidatePath(PATH);
  return { notice: "Safeguarding lead updated." };
}
