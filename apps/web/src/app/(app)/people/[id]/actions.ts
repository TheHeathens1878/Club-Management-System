"use server";

/**
 * Everything a person's record can be changed to, other than their own fields
 * (those are `../actions.ts`).
 *
 * User-scoped client throughout, following `safeguarding/lead-actions.ts`:
 *
 *   * `person_roles` — club_admin only (`person_roles_admin_insert` /
 *     `_admin_update`), and the table's audit trigger records every grant and
 *     revocation. Roles are soft-revoked; the gap between two grants is the
 *     history SG-7 needs to answer "who could read this on the day?".
 *   * `guardianships` — club_admin or safeguarding_lead, and
 *     `guardianships_guard()` raises P0001 with a readable sentence for every
 *     SG-4 rule it enforces (guardian must be a known adult, child must be a
 *     minor, no self-guardianship, no duplicate live link). Those sentences are
 *     passed through untouched.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Database } from "@club/db";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { emergencyContactsFromFormData } from "@/lib/emergency-contacts";
import { saveEmergencyContacts } from "@/lib/emergency-contacts-server";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type PersonDetailState = { error?: string; notice?: string };

type AppRole = Database["public"]["Enums"]["app_role"];
type GuardianRelationship = Database["public"]["Enums"]["guardian_relationship"];

const APP_ROLES: AppRole[] = [
  "club_admin",
  "safeguarding_lead",
  "coach",
  "staff",
  "member",
  "parent",
  "hirer",
  "referee",
];
const RELATIONSHIPS: GuardianRelationship[] = [
  "parent",
  "step_parent",
  "grandparent",
  "foster_carer",
  "legal_guardian",
  "other",
];
const NOT_ADMIN = "Only a club administrator can grant or revoke a role.";
const NOT_SAFEGUARDING =
  "Only a club administrator or the safeguarding lead can change this. Ask one of them.";

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/lobby");
  return session;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function personPath(personId: string): string {
  return `/people/${personId}`;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function grantRole(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  const role = text(formData, "role");
  const notes = text(formData, "notes") || null;
  if (!personId) return { error: "No person given." };
  if (!APP_ROLES.includes(role as AppRole)) return { error: "Choose a role." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("person_roles")
    .insert({ person_id: personId, role: role as AppRole, notes });
  if (error) {
    return {
      error: friendlyDbError(error, NOT_ADMIN, "They already hold that role."),
    };
  }

  revalidatePath(personPath(personId));
  return { notice: "Role granted, and the grant is in the audit log." };
}

export async function revokeRole(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  const roleId = text(formData, "role_id");
  if (!roleId) return { error: "No role given." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("person_roles")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", roleId)
    .is("revoked_at", null);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN) };

  revalidatePath(personPath(personId));
  return { notice: "Role revoked. The grant stays on the record as history." };
}

/**
 * The referee tick (Adam, 2026-09-01: "admins should be able to tick a box in a
 * user record confirming they are a referee. That will add them to the referee
 * group").
 *
 * It is `grantRole`/`revokeRole` for one role, said in one gesture — the
 * dropdown could always do this, but a dropdown is a place to look for something
 * and a tick is a place to see it. The role is the only thing written; the
 * Referees conversation follows on its own, because `referee_role_sync_group()`
 * has fired on a `person_roles` insert since 20260825320000.
 *
 * The FA's minimum age is the database's business, not this action's: the guard
 * on `person_roles` refuses the insert and its sentence is passed through, so
 * the same answer comes back however the role is granted.
 */
export async function setPersonReferee(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  if (!personId) return { error: "No person given." };
  const shouldHold = text(formData, "is_referee") === "yes";

  const supabase = await createClient();

  if (shouldHold) {
    const { error } = await supabase
      .from("person_roles")
      .insert({ person_id: personId, role: "referee", notes: "confirmed on their record" });
    if (error) {
      return { error: friendlyDbError(error, NOT_ADMIN, "They are already a referee.") };
    }
    revalidatePath(personPath(personId));
    return { notice: "Confirmed as a referee, and added to the Referees group." };
  }

  const { error } = await supabase
    .from("person_roles")
    .update({ revoked_at: new Date().toISOString() })
    .eq("person_id", personId)
    .eq("role", "referee")
    .is("revoked_at", null);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN) };

  revalidatePath(personPath(personId));
  return { notice: "No longer a referee. They leave the Referees group; the grant stays as history." };
}

// ---------------------------------------------------------------------------
// Guardianships (SG-4)
// ---------------------------------------------------------------------------

/**
 * `direction` says which side of the link the person on screen is: `guardian_of`
 * makes them the guardian of the person picked, `child_of` makes the person
 * picked their guardian. The guard checks the ages either way.
 */
export async function addGuardianship(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  const otherId = text(formData, "other_person_id");
  const direction = text(formData, "direction");
  const relationship = text(formData, "relationship");
  const notes = text(formData, "notes") || null;

  if (!personId) return { error: "No person given." };
  if (!otherId) return { error: "Search for and choose the other person first." };
  if (otherId === personId) return { error: "Nobody can be their own guardian." };
  if (direction !== "guardian_of" && direction !== "child_of") {
    return { error: "Choose whether this person is the guardian or the child." };
  }
  if (!RELATIONSHIPS.includes(relationship as GuardianRelationship)) {
    return { error: "Choose the relationship." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("guardianships").insert({
    guardian_person_id: direction === "guardian_of" ? personId : otherId,
    child_person_id: direction === "guardian_of" ? otherId : personId,
    relationship: relationship as GuardianRelationship,
    notes,
  });
  if (error) {
    return {
      error: friendlyDbError(
        error,
        NOT_SAFEGUARDING,
        "That guardianship already exists and has not ended.",
      ),
    };
  }

  revalidatePath(personPath(personId));
  revalidatePath(personPath(otherId));
  return { notice: "Guardianship recorded." };
}

/**
 * SG-4: `ended_at` is for an arrangement that has actually ended — a placement
 * concluded, an order discharged, a mis-entered link superseded. It is NOT the
 * child's 18th birthday; the reading policies lapse on their own.
 */
export async function endGuardianship(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  const guardianshipId = text(formData, "guardianship_id");
  if (!guardianshipId) return { error: "No guardianship given." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("guardianships")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", guardianshipId)
    .is("ended_at", null);
  if (error) return { error: friendlyDbError(error, NOT_SAFEGUARDING) };

  revalidatePath(personPath(personId));
  return { notice: "Guardianship ended. The link stays on the record." };
}

// ---------------------------------------------------------------------------
// Emergency contacts (Adam, 2026-08-25)
// ---------------------------------------------------------------------------

/**
 * A club administrator sets a person's emergency contacts. The RPC decides:
 * `set_emergency_contacts()` admits club_admin (and the person or their
 * guardian from their own screens) and refuses everyone else with 42501, which
 * `saveEmergencyContacts` turns into a sentence — a safeguarding lead can read
 * the list but is told they cannot change it here.
 */
export async function setPersonEmergencyContacts(
  _prev: PersonDetailState,
  formData: FormData,
): Promise<PersonDetailState> {
  await requireCommittee();
  const personId = text(formData, "person_id");
  if (!personId) return { error: "Missing person." };

  const posted = emergencyContactsFromFormData(formData);
  if ("error" in posted) return { error: posted.error };

  const saved = await saveEmergencyContacts(personId, posted);
  if (saved.error) return { error: saved.error };

  revalidatePath(personPath(personId));
  return { notice: "Emergency contacts saved." };
}
