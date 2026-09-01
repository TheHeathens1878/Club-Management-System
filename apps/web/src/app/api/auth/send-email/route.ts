/**
 * Supabase Auth "Send Email" hook.
 *
 * Adam, 2026-08-25: "The email rate limit was exceeded for new sign ups — it
 * comes from Supabase." Supabase's built-in mailer is rate limited and is what
 * sends confirmation, magic-link, recovery, email-change and invite mail. With
 * this hook enabled, Auth stops sending altogether and POSTs each of those
 * emails here instead; we send them through Microsoft Graph, the club's own
 * mailbox, which is what everything else in this app already uses.
 *
 * TURNING IT ON IS A DASHBOARD JOB — the app cannot do it from here.
 * Supabase dashboard → Authentication → Hooks → "Send Email hook": enable it,
 * set the URI to https://portal.aomsportsclub.co.uk/api/auth/send-email, and
 * copy the generated secret (`v1,whsec_…`) into the Vercel environment as
 * SUPABASE_AUTH_EMAIL_HOOK_SECRET. Until that is done this route is never
 * called and Supabase keeps sending its own rate-limited email; disabling the
 * hook again hands sending straight back to Supabase.
 *
 * Nothing from the payload is ever logged: the token and token_hash in it are
 * live credentials.
 */

import { NextResponse } from "next/server";

import {
  authEmailContent,
  buildAuthLink,
  parseAuthEmailPayload,
  readHookHeaders,
  resolveDelivery,
  verifyHookSignature,
} from "@/lib/auth-email-hook";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { getEmailBrandColor, getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Auth reads `error.http_code` and `error.message` and passes the message back
 * to whoever triggered the email, so it says what a person can act on.
 */
function hookError(status: number, message: string) {
  return NextResponse.json({ error: { http_code: status, message } }, { status });
}

export async function POST(req: Request) {
  const secret = process.env.SUPABASE_AUTH_EMAIL_HOOK_SECRET;
  if (!secret) {
    console.error("[auth email hook] SUPABASE_AUTH_EMAIL_HOOK_SECRET is not set");
    return hookError(500, "The club's email hook is not configured (missing hook secret).");
  }
  if (!isEmailConfigured()) {
    console.error("[auth email hook] Microsoft Graph is not configured");
    return hookError(500, "The club's mail service is not configured.");
  }

  // The signature covers the bytes as they arrived. Read the text, verify, and
  // only then parse — re-serialising the JSON would change the bytes.
  const body = await req.text();
  const { id, timestamp, signature } = readHookHeaders(req.headers);
  const check = verifyHookSignature({ secret, id, timestamp, signature, body });
  if (!check.ok) {
    console.error(`[auth email hook] rejected: ${check.reason}`);
    return hookError(401, "Invalid webhook signature.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return hookError(400, "The hook payload was not valid JSON.");
  }

  const payload = parseAuthEmailPayload(parsed);
  if (!payload) return hookError(400, "Unrecognised Send Email hook payload.");

  const delivery = resolveDelivery(payload);
  if (!delivery) return hookError(400, "The hook payload has no email address to send to.");

  let siteUrl: string;
  try {
    siteUrl = getSiteUrl();
  } catch (err) {
    console.error("[auth email hook]", err);
    return hookError(500, "The club's site URL is not configured.");
  }

  const linkUrl = buildAuthLink({
    siteUrl,
    delivery,
    redirectTo: payload.emailData.redirectTo,
  });

  // Reauthentication is the only action with no link — it is a code the person
  // types back in. Anything else without one means Auth sent no token, which we
  // cannot turn into an email worth reading.
  if (!linkUrl && delivery.action !== "reauthentication") {
    console.error(`[auth email hook] no token for ${delivery.action}`);
    return hookError(400, "The hook payload carried no token.");
  }

  const [settings, brandColor] = await Promise.all([getSettings(), getEmailBrandColor()]);
  const { subject, html, text } = authEmailContent({
    action: delivery.action,
    clubName: settings.club_name,
    brandColor,
    linkUrl,
    token: delivery.token,
  });

  try {
    await sendEmail({
      to: delivery.to,
      subject,
      html,
      text,
      // The link is a credential — keep it out of the outbound_messages row.
      logBody: `Supabase auth email (${delivery.action}) — link and code not recorded.`,
      template: `auth_${delivery.action}`,
      entity: "auth",
    });
  } catch (err) {
    console.error(
      `[auth email hook] send failed for ${delivery.action}:`,
      err instanceof Error ? err.message : String(err),
    );
    return hookError(500, "The club's mail service could not send this email. Please try again.");
  }

  return NextResponse.json({});
}
