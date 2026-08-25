"use server";

/**
 * People admin (gap 2): create, edit and retire a member record.
 *
 * Every write here uses the USER-SCOPED client. `people` RLS is
 * `people_admin_insert` / `people_admin_update` — a club_admin, which is what a
 * committee sign-in holds through the profiles → person_roles sync — and the
 * `people_dob_guard` trigger carries SG-1.2 and SG-6 tier 1(c), so a date of
 * birth correction that turns an existing team member into a minor is
 * re-evaluated by the database, not by this file.
 *
 * There is no delete. `deleted_at` is a soft delete (SG-2): `people` has no
 * FOR DELETE policy, no DELETE grant and a `deny_hard_delete` trigger, and
 * none of those may be relaxed.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Json } from "@club/db";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import {
  ADDRESS_KEYS,
  addressFromFields,
  friendlyDbError,
  type AddressFields,
} from "@/lib/people-display";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PersonActionState = { error?: string; notice?: string };

const NOT_ADMIN =
  "Only a club administrator can add or change a member record. Ask one to make the change, or to grant you the club_admin role.";

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/lobby");
  return session;
}

type PersonInput = {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  dob: string | null;
  email: string | null;
  phone: string | null;
  address: Json | null;
  notes: string | null;
};

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function readPerson(formData: FormData): PersonInput | { error: string } {
  const firstName = text(formData, "first_name");
  const lastName = text(formData, "last_name");
  if (!firstName || !lastName) return { error: "A first name and a last name are both required." };

  const dob = text(formData, "dob");
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { error: "Enter the date of birth as a date, or leave it blank." };
  }

  const fields = {} as AddressFields;
  for (const key of ADDRESS_KEYS) fields[key] = text(formData, `address_${key}`);

  return {
    first_name: firstName,
    last_name: lastName,
    preferred_name: text(formData, "preferred_name") || null,
    dob: dob || null,
    email: text(formData, "email") || null,
    phone: text(formData, "phone") || null,
    address: addressFromFields(fields),
    notes: text(formData, "notes") || null,
  };
}

export async function createPerson(
  _prev: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> {
  await requireCommittee();

  const input = readPerson(formData);
  if ("error" in input) return { error: input.error };

  const supabase = await createClient();
  const { data, error } = await supabase.from("people").insert(input).select("id").single();
  if (error) {
    return {
      error: friendlyDbError(error, NOT_ADMIN, "Someone with that email address already exists."),
    };
  }

  revalidatePath("/people");
  redirect(`/people/${data.id}`);
}

export async function updatePerson(
  _prev: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  if (!personId) return { error: "No person given." };

  const input = readPerson(formData);
  if ("error" in input) return { error: input.error };

  const supabase = await createClient();

  // What the record said before the write, so "an administrator has just
  // supplied a date of birth that was missing" is a fact rather than a guess.
  const { data: before } = await supabase
    .from("people")
    .select("dob")
    .eq("id", personId)
    .maybeSingle();

  const { error } = await supabase.from("people").update(input).eq("id", personId);
  if (error) {
    return {
      error: friendlyDbError(error, NOT_ADMIN, "Someone with that email address already exists."),
    };
  }

  let notice = "Saved.";
  const dobJustSupplied = !before?.dob && input.dob !== null;
  if (dobJustSupplied) {
    const { count } = await supabase
      .from("neon_import_pending")
      .select("id", { count: "exact", head: true })
      .eq("person_id", personId)
      .is("applied_at", null);

    if ((count ?? 0) > 0 && (await isClubAdmin())) {
      // ------------------------------------------------------------------
      // THE ONE SERVICE-ROLE CALL IN THE PEOPLE SCREENS, AND WHY.
      //
      // `apply_neon_pending()` is service_role-only BY DESIGN (P3.3 §12
      // revokes EXECUTE from public, anon and authenticated). It does things
      // no signed-in user may do: it inserts guardianships and team
      // memberships on the club's behalf and, where SG-6 tier 1 demands it,
      // grants the safeguarding lead's 30-day certification exemption
      // (D-P3-2). Handing that to `authenticated` would be a standing
      // privilege escalation, so the function stays where it is and the app
      // reaches it with the admin key here and nowhere else.
      //
      // The caller's own authority is established twice before this line:
      // the `people` UPDATE above ran under RLS and only a club_admin's
      // update survives `people_admin_update`, and `isClubAdmin()` is asked
      // again immediately above. The call is scoped to this one person.
      // ------------------------------------------------------------------
      const admin = createAdminClient();
      const { data: applied, error: applyError } = await admin.rpc("apply_neon_pending", {
        p_person_id: personId,
      });
      if (applyError) {
        notice = `Saved. The queued imports could not be applied: ${applyError.message}`;
      } else {
        const result = applied?.[0];
        const done = result?.applied ?? 0;
        const left = result?.still_pending ?? 0;
        notice =
          `Saved. Date of birth recorded, so the queued imports ran: ` +
          `${done} applied, ${left} still waiting.` +
          (left > 0 ? " Open the rows below to see why the rest are held back." : "");
      }
      // A queued membership that has just been applied changes a team page.
      revalidatePath("/teams", "layout");
    }
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return { notice };
}

/** SG-2: a person record is retired, never destroyed. */
export async function softDeletePerson(
  _prev: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  if (!personId) return { error: "No person given." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("people")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq("id", personId)
    .is("deleted_at", null);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN) };

  revalidatePath("/people");
  redirect("/people");
}

/** Undo the above. The row was never gone, so this is just clearing the stamp. */
export async function restorePerson(
  _prev: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> {
  await requireCommittee();

  const personId = text(formData, "person_id");
  if (!personId) return { error: "No person given." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("people")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", personId);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN) };

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return { notice: "Restored." };
}
