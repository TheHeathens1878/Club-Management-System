"use server";

import { headers } from "next/headers";
import { recordLogin } from "@/lib/login-history";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { magicLinkEmail, passwordResetEmail } from "@/lib/email-templates";
import { getEmailBrandColor } from "@/lib/settings";
import { getSiteUrl } from "@/lib/utils";

// Per-email cooldown — prevents inbox spam and protects Gmail sending quota.
// Module-level state persists across requests within the same serverless instance.
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;

function checkRateLimit(email: string): boolean {
  const last = cooldowns.get(email);
  if (last && Date.now() - last < COOLDOWN_MS) return false;
  cooldowns.set(email, Date.now());
  if (cooldowns.size > 500) {
    const cutoff = Date.now() - COOLDOWN_MS * 2;
    for (const [k, v] of cooldowns) {
      if (v < cutoff) cooldowns.delete(k);
    }
  }
  return true;
}

export async function recordPasswordLogin(userId: string) {
  const hdrs = await headers();
  await recordLogin({
    userId,
    method: "password",
    ipAddress: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: hdrs.get("user-agent"),
  });
}

export async function requestMagicLink(email: string): Promise<{ error: string | null }> {
  if (!checkRateLimit(email)) {
    return { error: "Please wait a minute before requesting another link." };
  }

  let origin: string;
  try {
    origin = getSiteUrl();
  } catch (err) {
    console.error("[magic link]", err);
    return { error: "Site URL is not configured. Please contact the administrator." };
  }

  const admin = createAdminClient();

  // Check the email is known before generating a link
  const normalised = email.toLowerCase().trim();
  const { data: memberMatch } = await admin
    .from("members")
    .select("id")
    .ilike("email", normalised)
    .maybeSingle();

  // Bookers aren't in the members table — they're auth users with a profile
  // (created when they submit a booking). Allow them to request a link too.
  let known = !!memberMatch;
  if (!known) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const authUser = list?.users.find((u) => (u.email ?? "").toLowerCase() === normalised);
    if (authUser) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("id", authUser.id)
        .maybeSingle();
      known = !!profile;
    }
  }

  if (!known) {
    return {
      error:
        "We don't recognise that email address. If you're a member, please ask the committee to update your details. You can also contact us using the link below.",
    };
  }

  // First call: ensures the auth user exists (creates them if brand new).
  const { data: firstData, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !firstData?.properties?.hashed_token) {
    console.error("[magic link] generateLink error:", error?.message);
    return { error: "Failed to generate sign-in link. Please try again." };
  }

  // Supabase rejects verifyOtp for unconfirmed users even with a valid magiclink token.
  // Confirming email AFTER generating invalidates the token (clears email_otp).
  // Solution: confirm first, then generate a fresh token.
  let hashedToken = firstData.properties.hashed_token;
  if (firstData.user && !firstData.user.email_confirmed_at) {
    await admin.auth.admin.updateUserById(firstData.user.id, { email_confirm: true }).catch((e) => {
      console.error("[magic link] failed to confirm email for new user:", e);
    });
    // Generate a second token now the user is confirmed — this one will verify cleanly.
    const { data: secondData, error: secondError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (secondError || !secondData?.properties?.hashed_token) {
      console.error("[magic link] second generateLink error:", secondError?.message);
      return { error: "Failed to generate sign-in link. Please try again." };
    }
    hashedToken = secondData.properties.hashed_token;
  }

  const linkUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink`;

  try {
    const brandColor = await getEmailBrandColor();
    const { subject, html, text } = await magicLinkEmail({ linkUrl, brandColor });
    await sendEmail({ to: email, subject, html, text });
    return { error: null };
  } catch (err) {
    console.error("[magic link] email send error:", err);
    return { error: "Failed to send email. Please try again." };
  }
}

export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  if (!checkRateLimit(email)) {
    return { error: "Please wait a minute before requesting another link." };
  }

  let origin: string;
  try {
    origin = getSiteUrl();
  } catch (err) {
    console.error("[password reset]", err);
    return { error: "Site URL is not configured. Please contact the administrator." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !data?.properties?.hashed_token) {
    console.error("[password reset] generateLink error:", error?.message);
    return { error: "Failed to generate reset link. Please try again." };
  }

  const linkUrl = `${origin}/auth/callback?token_hash=${data.properties.hashed_token}&type=recovery`;

  try {
    const brandColor = await getEmailBrandColor();
    const { subject, html, text } = await passwordResetEmail({ linkUrl, brandColor });
    await sendEmail({ to: email, subject, html, text });
    return { error: null };
  } catch (err) {
    console.error("[password reset] email send error:", err);
    return { error: "Failed to send email. Please try again." };
  }
}
