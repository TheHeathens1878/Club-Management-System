/**
 * The server half of emergency contacts: reading them for a set of people and
 * writing a posted set through `set_emergency_contacts()`.
 *
 * Reads are the caller's own — `emergency_contacts_self_read` (subject or
 * active guardian of a minor, via `can_act_for`) and `_admin_read`
 * (club_admin, safeguarding_lead) decide what comes back, and nothing here
 * filters by hand. The write is the RPC's decision too: it is SECURITY
 * DEFINER and re-checks `can_act_for()` / `is_club_admin()` itself, so a
 * refusal arrives as 42501 and is shown as a sentence.
 *
 * Plain server module (no "use server"): imported by the join, family,
 * profile and people actions, which are the "use server" files.
 */

import { createClient } from "@/lib/supabase/server";

import type { EmergencyContact, PostedEmergencyContacts } from "@/lib/emergency-contacts";

/** Every contact the caller may read for these people, keyed by person. */
export async function loadEmergencyContacts(
  personIds: string[],
): Promise<Map<string, EmergencyContact[]>> {
  const contacts = new Map<string, EmergencyContact[]>();
  if (personIds.length === 0) return contacts;
  const supabase = await createClient();
  const { data } = await supabase
    .from("emergency_contacts")
    .select("person_id,position,first_name,last_name,name,phone,relationship")
    .in("person_id", personIds)
    .order("position");
  for (const row of data ?? []) {
    const list = contacts.get(row.person_id) ?? [];
    list.push({
      position: row.position,
      firstName: row.first_name,
      lastName: row.last_name,
      name: row.name,
      phone: row.phone,
      relationship: row.relationship ?? "",
    });
    contacts.set(row.person_id, list);
  }
  return contacts;
}

/**
 * Resolve "I am the first emergency contact" from the caller's OWN `people`
 * row and write the set. The tick is a statement about the caller, so the
 * name and number come from what the club holds for them — never from the
 * browser — which is also why a caller with no phone on record is sent to
 * My Profile rather than guessed at.
 */
export async function saveEmergencyContacts(
  personId: string,
  posted: PostedEmergencyContacts,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const contacts: {
    first_name: string;
    last_name: string;
    phone: string;
    relationship: string | null;
  }[] = [];

  if (posted.useLead) {
    const { data: me } = await supabase.rpc("current_person_id");
    const { data: lead } = me
      ? await supabase
          .from("people")
          .select("first_name,last_name,phone")
          .eq("id", me)
          .maybeSingle()
      : { data: null };
    if (!lead) {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so you cannot be recorded as a contact. Ask the club to link your account.",
      };
    }
    if (!lead.phone) {
      return {
        error:
          "There is no phone number on your own record to use. Add yours on My profile, or untick the box and type the contact in full.",
      };
    }
    contacts.push({
      first_name: lead.first_name,
      last_name: lead.last_name,
      phone: lead.phone,
      relationship: posted.leadRelationship || null,
    });
  }
  for (const row of posted.typed) {
    contacts.push({
      first_name: row.firstName,
      last_name: row.lastName,
      phone: row.phone,
      relationship: row.relationship || null,
    });
  }

  const { error } = await supabase.rpc("set_emergency_contacts", {
    p_person_id: personId,
    p_contacts: contacts,
  });
  if (error) {
    if (error.code === "42501") {
      return {
        error:
          "The club's records do not show you as able to set contacts for this person — only they, an active guardian or a club administrator can.",
      };
    }
    // P0001 is the function's own validation, written for the reader.
    return { error: error.message.replace(/^set_emergency_contacts: /, "") };
  }
  return {};
}
