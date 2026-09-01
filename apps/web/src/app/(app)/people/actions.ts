"use server";

/**
 * People admin (gap 2): create, edit and retire a member record.
 *
 * Every write here uses the USER-SCOPED client. `people` RLS is
 * `people_admin_insert` / `people_admin_update` — a club_admin, which is what a
 * committee sign-in holds through the profiles → person_roles sync — and the
 * `people_dob_guard` trigger carries SG-1.2, so a date of birth correction
 * that turns an existing team member into a minor is re-evaluated by the
 * database, not by this file.
 *
 * `deleted_at` is a soft delete (SG-2): `people` has no FOR DELETE policy, no
 * DELETE grant and a `deny_hard_delete` trigger, and none of those may be
 * relaxed. There is exactly ONE hard delete in this file — `purgePerson()` at
 * the bottom — and it does not relax any of them either: it calls
 * `purge_person()`, which is the single audited door the database opens for a
 * super user and nobody else. See the comment there.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Json } from "@club/db";

import { getSessionProfile, isCommittee, isSuperUser } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { countyForTown } from "@/lib/address";
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

const NOT_SUPER_USER =
  "Only a super user can permanently delete a person. Everyone else retires the record, which keeps it (SAFEGUARDING.md SG-2).";

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
  // The town settles the county where the club knows the place (Adam,
  // 2026-08-25), re-derived so a posted form cannot store "Sale, Cheshire".
  fields.county = countyForTown(fields.town) ?? fields.county;

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
      // memberships on the club's behalf. Handing that to `authenticated`
      // would be a standing privilege escalation, so the function stays where
      // it is and the app reaches it with the admin key here and nowhere else.
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

// ---------------------------------------------------------------------------
// The one exception to the paragraph at the top of this file (2026-08-25)
// ---------------------------------------------------------------------------
/**
 * Adam, the club owner and the sole super user: "allow super users to hard
 * delete users and messages." GDPR erasure, and clearing out test accounts.
 *
 * Everything that decides whether this is allowed lives in the database:
 * `purge_person()` is SECURITY DEFINER, checks `is_super_user()` itself, and
 * refuses (P0001, in a sentence) anyone under a legal hold, anyone named by a
 * safeguarding concern or one of its notes, anyone in a conversation under a
 * legal hold, and the caller themselves. This file adds nothing to that: the
 * `isSuperUser()` check below is only so the panel is not offered to someone
 * the database would refuse, and the RPC goes through the USER-SCOPED client
 * so the answer is the database's.
 *
 * Storage: the person's files are removed with the SERVICE-ROLE client, and
 * only AFTER the RPC has returned. That ordering is what makes it safe — the
 * database has already decided the purge is permitted and has already written
 * the `people.purged` audit row, so the objects are the last remnant of rows
 * that no longer exist. Paths are read with the admin client too, because a
 * super user is not necessarily a participant of the conversations whose
 * attachments they are about to destroy, and the policies would (correctly)
 * hide those rows from their own client.
 */
export async function purgePerson(
  _prev: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) return { error: NOT_SUPER_USER };

  const personId = text(formData, "person_id");
  const reason = text(formData, "reason");
  const confirmation = text(formData, "confirm_name");
  const expectedName = text(formData, "person_name");
  if (!personId) return { error: "No person given." };
  if (!reason) return { error: "Say why this record is being destroyed. The reason is the audit trail." };
  if (confirmation.toLowerCase() !== expectedName.toLowerCase()) {
    return { error: `Type ${expectedName} exactly to confirm.` };
  }

  const admin = createAdminClient();

  // Read the file paths first: after the RPC these rows do not exist.
  const { data: theirMessages } = await admin
    .from("messages")
    .select("id")
    .eq("sender_person_id", personId);
  const messageIds = (theirMessages ?? []).map((m) => m.id);
  const attachments =
    messageIds.length > 0
      ? ((
          await admin
            .from("message_attachments")
            .select("storage_bucket,storage_path")
            .in("message_id", messageIds)
        ).data ?? [])
      : [];
  const { data: idDocs } = await admin
    .from("identity_documents")
    .select("storage_path")
    .eq("person_id", personId);
  const { data: personRow } = await admin
    .from("people")
    .select("photo_path")
    .eq("id", personId)
    .maybeSingle();

  const supabase = await createClient();
  const { data: summary, error } = await supabase.rpc("purge_person", {
    p_person_id: personId,
    p_reason: reason,
  });
  if (error) return { error: friendlyDbError(error, NOT_SUPER_USER) };

  // Only now, and only for rows the database has just destroyed.
  await removeStorageObjects(
    admin,
    attachments.map((a) => ({ bucket: a.storage_bucket, path: a.storage_path })),
  );
  await removeStorageObjects(
    admin,
    (idDocs ?? [])
      .map((d) => d.storage_path)
      .filter((p): p is string => Boolean(p))
      .map((path) => ({ bucket: "identity-documents", path })),
  );
  if (personRow?.photo_path) {
    await removeStorageObjects(admin, [{ bucket: "person-photos", path: personRow.photo_path }]);
  }

  // The login, last. `profiles.id references auth.users on delete cascade`, and
  // the profile row is already gone, so this only removes the account itself.
  const authUserId = readAuthUserId(summary);
  if (authUserId) await admin.auth.admin.deleteUser(authUserId);

  revalidatePath("/people");
  redirect(`/people?purged=${encodeURIComponent(purgeNotice(summary))}`);
}

type StorageObject = { bucket: string; path: string };

async function removeStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  objects: StorageObject[],
): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    if (!object.path) continue;
    byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);
  }
  for (const [bucket, paths] of byBucket) {
    // A file that is already gone is not an error worth failing the purge for:
    // the rows it belonged to have been destroyed either way.
    await admin.storage.from(bucket).remove(paths);
  }
}

function readAuthUserId(summary: Json): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const value = (summary as Record<string, Json>).auth_user_id;
  return typeof value === "string" ? value : null;
}

/** The counts the database returned, as one line the list page can show. */
function purgeNotice(summary: Json): string {
  const name = summaryString(summary, "person_name") ?? "That record";
  const deleted =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, Json>).deleted
      : null;
  const parts: string[] = [];
  if (deleted && typeof deleted === "object" && !Array.isArray(deleted)) {
    for (const [table, count] of Object.entries(deleted as Record<string, Json>)) {
      if (typeof count === "number" && count > 0) parts.push(`${count} ${table.replace(/_/g, " ")}`);
    }
  }
  return parts.length > 0
    ? `${name} was permanently deleted: ${parts.join(", ")}.`
    : `${name} was permanently deleted.`;
}

function summaryString(summary: Json, key: string): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const value = (summary as Record<string, Json>)[key];
  return typeof value === "string" ? value : null;
}
