"use server";

import { getSessionProfile, isStaff, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addStaffAway(formData: FormData) {
  const session = await getSessionProfile();
  if (!session || !isStaff(session.profile?.role)) return { error: "Unauthorised" };

  const targetStaffId = String(formData.get("staff_id") || "").trim();
  const staffType = String(formData.get("staff_type") || "profile");
  const fromDate = String(formData.get("from_date") || "").trim();
  const toDate = String(formData.get("to_date") || "").trim();
  const note = String(formData.get("note") || "").trim();

  if (!targetStaffId || !fromDate || !toDate) return { error: "Missing required fields" };
  if (toDate < fromDate) return { error: "End date must be on or after start date" };

  const isExternal = staffType === "external";

  // Bar staff can only record their own absence; committee+ can record anyone's
  if (!isCommittee(session.profile?.role) && !isExternal && targetStaffId !== session.userId) {
    return { error: "You can only manage your own availability" };
  }

  const admin = createAdminClient();
  const base = { from_date: fromDate, to_date: toDate, note: note || null, created_by: session.userId };
  const row = isExternal
    ? { ...base, non_user_staff_id: targetStaffId }
    : { ...base, staff_id: targetStaffId };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await admin.from("staff_away").insert(row as any);

  if (error) return { error: error.message };
}

export async function removeStaffAway(id: string) {
  const session = await getSessionProfile();
  if (!session || !isStaff(session.profile?.role)) return { error: "Unauthorised" };

  const admin = createAdminClient();

  // Fetch the record to check ownership
  const { data: record } = await admin.from("staff_away").select("staff_id,non_user_staff_id").eq("id", id).single();
  if (!record) return { error: "Record not found" };

  const isExternal = !record.staff_id;
  if (!isCommittee(session.profile?.role) && !isExternal && record.staff_id !== session.userId) {
    return { error: "You can only remove your own availability entries" };
  }

  const { error } = await admin.from("staff_away").delete().eq("id", id);
  if (error) return { error: error.message };
}
