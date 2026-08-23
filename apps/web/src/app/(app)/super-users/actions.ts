"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile, isSuperUser, isBarManager } from "@/lib/auth";
import { createLegacyAdminClient } from "@/lib/supabase/legacy";
import { writeAudit } from "@/lib/audit";
import { getSiteUrl } from "@/lib/utils";
import { sendEmail } from "@/lib/email";
import { getSettings, getEmailBrandColor } from "@/lib/settings";

async function requireSuperUser() {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) throw new Error("Not authorised");
  return session;
}

export async function updateUserRole(
  profileId: string,
  role: "super_user" | "committee" | "bar_manager" | "bar" | "member",
) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();

  const { error } = await admin.from("profiles").update({ role }).eq("id", profileId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "profile",
    entityId: profileId,
    detail: { role },
  });

  revalidatePath("/super-users");
}

export async function updateUserName(profileId: string, name: string) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();
  const fullName = name.trim() || null;

  const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("id", profileId);
  if (error) throw new Error(error.message);

  // Keep auth metadata in sync so it survives profile rebuilds
  await admin.auth.admin.updateUserById(profileId, { user_metadata: { full_name: fullName } }).catch(() => {});

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "profile",
    entityId: profileId,
    detail: { full_name: fullName },
  });

  revalidatePath("/settings");
}

async function buildInviteEmail(inviteLink: string, invitedBy: string, clubName: string, brandColor: string) {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${brandColor};padding:24px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${clubName}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">You've been invited to access the ${clubName} function room booking system.</p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;">Click the button below to set up your account:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td style="background:${brandColor};border-radius:8px;padding:12px 28px;">
              <a href="${inviteLink}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">Accept invitation</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or copy this link into your browser:</p>
          <p style="margin:0 0 16px;font-size:13px;color:#6b7280;word-break:break-all;">${inviteLink}</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;">This link expires in 24 hours. If it has expired, ask an admin to resend your invite.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Invited by ${invitedBy} · ${clubName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return {
    html,
    text: `You've been invited to access the ${clubName} function room booking system.\n\nAccept your invitation: ${inviteLink}\n\nThis link expires in 24 hours.\n\nInvited by ${invitedBy}.`,
  };
}

export async function inviteUser(
  email: string,
  role: "super_user" | "committee" | "bar_manager" | "bar",
  name?: string,
) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();
  const siteUrl = getSiteUrl();
  const fullName = name?.trim() || null;

  // Create the user account first (email_confirm: true skips Supabase's own verification email)
  const { data: { user }, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { needs_password: true, full_name: fullName },
  });
  if (createError) throw new Error(createError.message);
  if (!user) throw new Error("Failed to create user account.");

  await admin.from("profiles").upsert({
    id: user.id,
    role,
    full_name: fullName,
  }, { onConflict: "id" });

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "invite",
    entity: "profile",
    entityId: user.id,
    detail: { email, role },
  });

  // Generate a magic link via hashed_token — this routes through our own /auth/callback
  // and avoids expiry issues with Supabase's invite action_link redirect
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl}/auth/callback` },
  });

  if (linkData?.properties?.hashed_token) {
    const inviteLink = `${siteUrl}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`;
    const [settings, brandColor] = await Promise.all([getSettings(), getEmailBrandColor()]);
    const { html, text } = await buildInviteEmail(inviteLink, session.email ?? "Admin", settings.club_name, brandColor);
    await sendEmail({ to: email, subject: `You've been invited to ${settings.club_name}`, html, text });
  }

  revalidatePath("/super-users");
}

export async function resendInvite(userId: string) {
  const session = await requireSuperUser();
  const admin = createLegacyAdminClient();
  const siteUrl = getSiteUrl();

  const { data: { user } } = await admin.auth.admin.getUserById(userId);
  if (!user?.email) throw new Error("Could not retrieve user email.");

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: `${siteUrl}/auth/callback` },
  });
  if (linkErr || !linkData?.properties?.hashed_token) throw new Error("Failed to generate invite link.");

  const inviteLink = `${siteUrl}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`;
  const [settings, brandColor] = await Promise.all([getSettings(), getEmailBrandColor()]);
  const { html, text } = await buildInviteEmail(inviteLink, session.email ?? "Admin", settings.club_name, brandColor);
  await sendEmail({ to: user.email, subject: `Your invite to ${settings.club_name} (resent)`, html, text });
}

export async function removeUser(profileId: string) {
  const session = await requireSuperUser();
  if (profileId === session.userId) throw new Error("You cannot remove your own account.");

  const admin = createLegacyAdminClient();

  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entity: "profile",
    entityId: profileId,
    detail: {},
  });

  revalidatePath("/super-users");
}

export async function addNonUserStaff(name: string) {
  const session = await getSessionProfile();
  if (!session || !isBarManager(session.profile?.role)) throw new Error("Not authorised");
  const admin = createLegacyAdminClient();
  const { error } = await admin.from("non_user_staff").insert({ name: name.trim() });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/bar");
}

export async function removeNonUserStaff(id: string) {
  const session = await getSessionProfile();
  if (!session || !isBarManager(session.profile?.role)) throw new Error("Not authorised");
  const admin = createLegacyAdminClient();
  const { error } = await admin.from("non_user_staff").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/bar");
}
