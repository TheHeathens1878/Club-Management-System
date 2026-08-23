"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile, isSuperUser } from "@/lib/auth";
import { createLegacyAdminClient } from "@/lib/supabase/legacy";
import { writeAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/utils";

async function requireSuperUser() {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) throw new Error("Not authorised");
  return session;
}

export async function saveGeneralSettings(formData: FormData) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const keys = [
    "club_name", "club_tagline", "club_description", "login_subtitle", "login_no_email",
    "contact_email",
    "home_benefit_1_title", "home_benefit_1_desc",
    "home_benefit_2_title", "home_benefit_2_desc",
    "home_benefit_3_title", "home_benefit_3_desc",
  ] as const;
  for (const key of keys) {
    const value = String(formData.get(key) ?? "");
    await admin.from("site_settings").upsert({ key, value }, { onConflict: "key" });
  }

  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "update", entity: "site_settings", entityId: "general", detail: {} });
  revalidatePath("/", "layout");
  revalidatePath("/settings");
}

export async function saveBrandingSettings(formData: FormData) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const keys = ["logo_url", "logo_alt", "color_theme", "logo_height", "logo_max_width", "logo_object_fit"] as const;
  for (const key of keys) {
    const value = String(formData.get(key) ?? "");
    await admin.from("site_settings").upsert({ key, value }, { onConflict: "key" });
  }

  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "update", entity: "site_settings", entityId: "branding", detail: {} });
  revalidatePath("/", "layout");
  revalidatePath("/settings");
}

export async function savePaymentSettings(formData: FormData) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  // Deposit entered in pounds; store as pence
  const depositPounds = Number(formData.get("deposit_default_pounds") ?? 0);
  const depositPence = String(Math.max(0, Math.round(depositPounds * 100)));
  const depositWindow = String(Math.max(0, Number(formData.get("deposit_window_days") ?? 7)));
  const balanceDays = String(Math.max(0, Number(formData.get("balance_reminder_days") ?? 14)));

  const entries: Record<string, string> = {
    deposit_default_pence: depositPence,
    deposit_window_days: depositWindow,
    balance_reminder_days: balanceDays,
    auto_cancel_unpaid: formData.get("auto_cancel_unpaid") === "1" ? "true" : "false",
  };
  for (const [key, value] of Object.entries(entries)) {
    await admin.from("site_settings").upsert({ key, value }, { onConflict: "key" });
  }

  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "update", entity: "site_settings", entityId: "payments", detail: {} });
  revalidatePath("/settings");
}

export async function saveNotificationRecipients(formData: FormData) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const keys = ["notify_booking_request", "notify_cancellation", "notify_auto_cancellation"] as const;
  for (const key of keys) {
    const ids = (formData.getAll(key) as string[]).filter(Boolean);
    await admin.from("site_settings").upsert({ key, value: JSON.stringify(ids) }, { onConflict: "key" });
  }

  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "update", entity: "site_settings", entityId: "notifications", detail: {} });
  revalidatePath("/settings");
}

export async function bulkSetMemberAccess(
  memberIds: string[],
  opts: { member: boolean; barStaff: boolean; committee: boolean }
): Promise<{ error?: string }> {
  for (const id of memberIds) {
    const res = await setMemberAccess(id, opts);
    if (res?.error) return res;
  }
  return {};
}

export async function setMemberAccess(
  memberId: string,
  opts: { member: boolean; barStaff: boolean; committee: boolean }
): Promise<{ error?: string }> {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  // Derive the target role from the highest privilege ticked
  let newRole: string | null = null;
  if (opts.committee) newRole = "committee";
  else if (opts.barStaff) newRole = "bar";
  else if (opts.member) newRole = "member";
  // If nothing ticked: remove access (set pending_role to null; existing accounts revert to member)

  const { data: profile } = await admin
    .from("profiles")
    .select("id,role")
    .eq("member_id", memberId)
    .maybeSingle();

  if (profile) {
    // Has an existing account — update role
    const targetRole = newRole ?? "member"; // never truly remove an existing account here
    const { error } = await admin.from("profiles").update({ role: targetRole }).eq("id", profile.id);
    if (error) return { error: error.message };
    // Try to update is_bar_staff if that column exists
    await admin.from("profiles").update({ is_bar_staff: opts.barStaff }).eq("id", profile.id).then(() => {});
  } else {
    // No account yet — set or clear pending_role
    const { error } = await admin
      .from("members")
      .update({ pending_role: newRole })
      .eq("id", memberId);
    if (error) return { error: error.message };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "member_role",
    entityId: memberId,
    detail: { ...opts, newRole, has_account: !!profile },
  });

  revalidatePath("/settings");
  revalidatePath(`/members/${memberId}`);
  return {};
}

export async function assignRoleToMember(memberId: string, role: string) {
  const session = await requireSuperUser();
  const validRoles = ["super_user", "committee", "bar", "member"];
  if (!validRoles.includes(role)) throw new Error("Invalid role");

  const admin = createLegacyAdminClient();

  // Check if they have a profile (i.e. have logged in)
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("member_id", memberId)
    .maybeSingle();

  if (profile) {
    // Already has an account — update the role directly
    const { error } = await admin.from("profiles").update({ role }).eq("id", profile.id);
    if (error) throw new Error(error.message);
  } else {
    // No account yet — store as pending_role on the member record
    const { error } = await admin.from("members").update({ pending_role: role }).eq("id", memberId);
    if (error) throw new Error(error.message);
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "member_role",
    entityId: memberId,
    detail: { role, has_account: !!profile },
  });

  revalidatePath("/settings");
  revalidatePath(`/members/${memberId}`);
}

export async function clearPendingRole(memberId: string) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();
  await admin.from("members").update({ pending_role: null }).eq("id", memberId);
  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "update", entity: "member_role", entityId: memberId, detail: { cleared: true } });
  revalidatePath("/settings");
}

export async function createStaffAccount(
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "").trim();

  if (!name) return { error: "Name is required." };
  if (!email) return { error: "Email is required." };
  if (!["super_user", "committee", "bar"].includes(role)) return { error: "Invalid role." };

  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message?.toLowerCase().includes("already")) {
      return { error: "An account with that email already exists." };
    }
    return { error: createErr.message };
  }

  const userId = newUser.user.id;

  // Profile with member_id: null marks this as a non-member staff account
  await admin.from("profiles").upsert(
    { id: userId, role, member_id: null, password_set: false, full_name: name },
    { onConflict: "id" }
  );

  // Generate a magic link so they can set their password on first sign-in
  const origin = getSiteUrl();
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (linkData?.properties?.hashed_token) {
    const linkUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`;
    const roleLabel = role === "super_user" ? "Super User" : role.charAt(0).toUpperCase() + role.slice(1);
    sendEmail({
      to: email,
      subject: "You've been added as a staff member",
      html: `<p>You have been set up with a staff account (<strong>${roleLabel}</strong>) on the membership system.</p>
<p><a href="${linkUrl}" style="color:#1249bf">Click here to set your password and sign in →</a></p>
<p style="color:#666;font-size:13px">This link expires in 24 hours. If it has expired, ask a Super User to resend your invite.</p>`,
      text: `You have been set up as ${roleLabel}. Set your password here: ${linkUrl}`,
    }).catch(() => {});
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entity: "staff_account",
    entityId: userId,
    detail: { email, role },
  });

  revalidatePath("/settings");
  return { success: true };
}

export async function resendStaffInvite(userId: string): Promise<{ error?: string; success?: boolean }> {
  await requireSuperUser();
  const admin = createLegacyAdminClient();

  const { data: { user } } = await admin.auth.admin.getUserById(userId);
  if (!user?.email) return { error: "Could not retrieve email." };

  const origin = getSiteUrl();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (linkErr || !linkData?.properties?.hashed_token) return { error: "Failed to generate invite link." };

  const linkUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`;
  await sendEmail({
    to: user.email,
    subject: "Your staff account invite (resent)",
    html: `<p>Here is a fresh sign-in link for your staff account on the membership system.</p>
<p><a href="${linkUrl}" style="color:#1249bf">Click here to set your password and sign in →</a></p>
<p style="color:#666;font-size:13px">This link expires in 24 hours.</p>`,
    text: `Fresh invite link: ${linkUrl}`,
  });

  return { success: true };
}

export async function updateStaffAccount(
  userId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const name = String(formData.get("name") || "").trim();
  const role = String(formData.get("role") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const telephone = String(formData.get("telephone") || "").trim();
  const isBarStaff = formData.get("is_bar_staff") === "1";

  if (!name) return { error: "Name is required." };
  if (!["super_user", "committee", "bar"].includes(role)) return { error: "Invalid role." };

  const { error } = await admin.from("profiles").update({
    full_name: name,
    role,
    address: address || null,
    telephone: telephone || null,
    // bar-role users are always bar staff; for committee/super_user it's optional
    is_bar_staff: role === "bar" ? true : isBarStaff,
  }).eq("id", userId);

  if (error) return { error: error.message };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "staff_account",
    entityId: userId,
    detail: { name, role },
  });

  revalidatePath("/settings");
  return {};
}

export async function removeStaffAccount(userId: string): Promise<{ error?: string }> {
  const session = await requireSuperUser();
  if (userId === session.userId) return { error: "You cannot remove your own account." };

  const admin = createLegacyAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entity: "staff_account",
    entityId: userId,
    detail: {},
  });

  revalidatePath("/settings");
  return {};
}
