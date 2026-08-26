/**
 * Supabase Auth "Send Email" hook — the parts worth testing on their own.
 *
 * Supabase's built-in mailer is rate limited, and the club hit that limit on
 * new sign-ups (Adam, 2026-08-25). Auth can instead POST every email it was
 * about to send to an endpoint of ours and send nothing itself; we then post it
 * through Microsoft Graph, the same mailbox everything else in this app uses.
 * `apps/web/src/app/api/auth/send-email/route.ts` is that endpoint. This file
 * holds the pure work it does: checking the signature, turning the payload into
 * a link our own /auth/callback understands, and writing the words.
 *
 * The hook has to be turned on in the Supabase dashboard (Authentication →
 * Hooks → Send Email) — the app cannot do that from here, and until it is done
 * Supabase keeps sending its own rate-limited email and this endpoint is never
 * called.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailOtpType } from "@supabase/supabase-js";

import { emailLayout } from "@/lib/template-engine";

// ---------------------------------------------------------------------------
// Signature verification (Standard Webhooks)
// ---------------------------------------------------------------------------

/** How far out of step with our clock a request's timestamp may be. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Base64 with optional padding — nothing else may reach Buffer.from(). */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * 64 lowercase hex characters — how the Management API returns the secret,
 * and therefore a form somebody may well paste into the environment.
 *
 * It has to be tested BEFORE base64, because hex digits are a subset of the
 * base64 alphabet: `Buffer.from("8121…", "base64")` does not fail, it quietly
 * returns 48 bytes of the wrong key and every signature check fails with no
 * hint as to why. Anchored at 64 characters so a real 32-byte base64 secret
 * (44 characters, `=`-padded) can never be mistaken for hex.
 */
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

/**
 * The dashboard hands the secret over as `v1,whsec_<base64>`. Accept that,
 * and also the bare `whsec_<base64>`, raw base64 and raw hex forms, because
 * which one ends up in the environment depends on who copied it and from
 * where — the dashboard shows base64, the Management API returns hex.
 */
export function parseHookSecret(raw: string | null | undefined): Buffer | null {
  if (!raw) return null;
  let value = raw.trim();

  const comma = value.indexOf(",");
  if (comma !== -1 && /^v\d+$/.test(value.slice(0, comma))) value = value.slice(comma + 1);
  if (value.startsWith("whsec_")) value = value.slice("whsec_".length);

  if (HEX_32_BYTES.test(value)) return Buffer.from(value, "hex");
  if (!BASE64.test(value)) return null;

  const key = Buffer.from(value, "base64");
  return key.length > 0 ? key : null;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Standard Webhooks signature.
 *
 * The signed content is `${id}.${timestamp}.${body}` where `body` is the RAW
 * request text — re-serialising the parsed JSON changes the bytes and the
 * signature will never match. `webhook-signature` may carry several
 * space-separated `v1,<base64>` entries (Supabase rotates secrets that way);
 * any one of them matching is a pass.
 */
export function verifyHookSignature(params: {
  secret: string | null | undefined;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  /** Milliseconds since the epoch; defaults to now. */
  now?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const key = parseHookSecret(params.secret);
  if (!key) return { ok: false, reason: "secret_missing_or_malformed" };

  const { id, timestamp, signature, body } = params;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  if (!/^-?\d{1,15}$/.test(timestamp.trim())) return { ok: false, reason: "bad_timestamp" };
  const sent = Number(timestamp.trim());
  const tolerance = params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  if (nowSeconds - sent > tolerance) return { ok: false, reason: "timestamp_too_old" };
  if (sent - nowSeconds > tolerance) return { ok: false, reason: "timestamp_in_future" };

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma === -1) continue;
    if (part.slice(0, comma) !== "v1") continue;

    const candidate = part.slice(comma + 1);
    if (!BASE64.test(candidate)) continue;

    const bytes = Buffer.from(candidate, "base64");
    if (bytes.length !== expected.length) continue;
    if (timingSafeEqual(bytes, expected)) return { ok: true };
  }

  return { ok: false, reason: "signature_mismatch" };
}

/** Supabase sends `webhook-*`; some tooling still sends the older `svix-*`. */
export function readHookHeaders(headers: Headers): {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
} {
  const pick = (name: string) => headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`);
  return { id: pick("id"), timestamp: pick("timestamp"), signature: pick("signature") };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export const AUTH_EMAIL_ACTION_TYPES = [
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
  "email_change_current",
  "email_change_new",
  "reauthentication",
] as const;

export type AuthEmailActionType = (typeof AUTH_EMAIL_ACTION_TYPES)[number];

export function isAuthEmailActionType(value: unknown): value is AuthEmailActionType {
  return (
    typeof value === "string" &&
    (AUTH_EMAIL_ACTION_TYPES as readonly string[]).includes(value)
  );
}

export type AuthEmailPayload = {
  user: { email: string | null; new_email: string | null };
  emailData: {
    action: AuthEmailActionType;
    token: string | null;
    tokenHash: string | null;
    tokenNew: string | null;
    tokenHashNew: string | null;
    redirectTo: string | null;
  };
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Shape-check the hook body. Returns null rather than throwing so the route can
 * answer with a plain 400 — and so nothing from the payload is ever put in a
 * log line or an error message.
 */
export function parseAuthEmailPayload(raw: unknown): AuthEmailPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;

  const user = (root.user ?? {}) as Record<string, unknown>;
  const data = (root.email_data ?? {}) as Record<string, unknown>;
  if (typeof user !== "object" || typeof data !== "object") return null;
  if (!isAuthEmailActionType(data.email_action_type)) return null;

  return {
    user: { email: str(user.email), new_email: str(user.new_email) },
    emailData: {
      action: data.email_action_type,
      token: str(data.token),
      tokenHash: str(data.token_hash),
      tokenNew: str(data.token_new),
      tokenHashNew: str(data.token_hash_new),
      redirectTo: str(data.redirect_to),
    },
  };
}

// ---------------------------------------------------------------------------
// Who gets what
// ---------------------------------------------------------------------------

export type AuthEmailDelivery = {
  to: string;
  action: AuthEmailActionType;
  /** The `type` /auth/callback passes to verifyOtp. Null = code-only email. */
  otpType: EmailOtpType | null;
  tokenHash: string | null;
  /** The six-digit code that goes with this token. */
  token: string | null;
};

/** The `type` our /auth/callback hands to `verifyOtp` for each action. */
export function otpTypeFor(action: AuthEmailActionType): EmailOtpType | null {
  switch (action) {
    case "signup":
      return "signup";
    case "invite":
      return "invite";
    case "magiclink":
      return "magiclink";
    case "recovery":
      return "recovery";
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return "email_change";
    case "reauthentication":
      // Reauthentication is a six-digit code typed back into the page that
      // asked for it. There is no link to follow.
      return null;
  }
}

/**
 * Decide the address and the token for one hook call.
 *
 * With secure email change on, Auth calls the hook twice — once as
 * `email_change_current` (the address on the account, `token_hash`) and once as
 * `email_change_new` (the address being moved to, `token_hash_new`). With it
 * off there is a single `email_change` call for the new address.
 */
export function resolveDelivery(payload: AuthEmailPayload): AuthEmailDelivery | null {
  const { user, emailData } = payload;
  const action = emailData.action;

  let to: string | null;
  let tokenHash: string | null;
  let token: string | null;

  if (action === "email_change" || action === "email_change_new") {
    to = user.new_email ?? user.email;
    tokenHash = emailData.tokenHashNew ?? emailData.tokenHash;
    token = emailData.tokenNew ?? emailData.token;
  } else {
    to = user.email;
    tokenHash = emailData.tokenHash;
    token = emailData.token;
  }

  if (!to) return null;
  return { to, action, otpType: otpTypeFor(action), tokenHash, token };
}

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

const CALLBACK_PATH = "/auth/callback";

/**
 * A path we are willing to send somebody to after sign-in: our own site, and
 * not the callback itself (which would bounce straight back with no token).
 */
export function safeRelativePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  const path = value.split(/[?#]/)[0] ?? "";
  if (path === CALLBACK_PATH) return null;
  return value;
}

/**
 * Where the person should land after the token is verified.
 *
 * `redirect_to` is whatever the app asked for at sign-up time — today that is
 * always our own `${site}/auth/callback`, which is not somewhere to send them
 * on to, so it yields nothing and the callback's own role-based default wins.
 * Anything pointing off our origin is dropped: an open redirect on a link that
 * has just signed somebody in is how accounts get taken.
 */
export function nextPathFrom(
  redirectTo: string | null | undefined,
  siteUrl: string,
): string | null {
  if (!redirectTo) return null;

  let target: URL;
  let site: URL;
  try {
    site = new URL(siteUrl);
    target = new URL(redirectTo, site);
  } catch {
    return null;
  }
  if (target.origin !== site.origin) return null;

  if (target.pathname === CALLBACK_PATH) {
    // A callback URL that already carries its own destination.
    return safeRelativePath(target.searchParams.get("next"));
  }

  return safeRelativePath(`${target.pathname}${target.search}${target.hash}`);
}

/**
 * The link that goes in the email: our own callback, which verifies the token
 * and then decides where the person belongs. Null for an action with no link.
 */
export function buildAuthLink(params: {
  siteUrl: string;
  delivery: AuthEmailDelivery;
  redirectTo?: string | null;
}): string | null {
  const { siteUrl, delivery } = params;
  if (!delivery.otpType || !delivery.tokenHash) return null;

  const base = siteUrl.replace(/\/+$/, "");
  const query = [
    `token_hash=${encodeURIComponent(delivery.tokenHash)}`,
    `type=${encodeURIComponent(delivery.otpType)}`,
  ];

  const next = nextPathFrom(params.redirectTo, siteUrl);
  if (next) query.push(`next=${encodeURIComponent(next)}`);

  return `${base}${CALLBACK_PATH}?${query.join("&")}`;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

type Copy = {
  subject: string;
  /** Opening line, plain English. */
  lead: string;
  /** Label on the button. */
  cta: string;
  /** Whether the six-digit code is worth showing. */
  showCode: boolean;
};

function copyFor(action: AuthEmailActionType, clubName: string): Copy {
  switch (action) {
    case "signup":
      return {
        subject: `Confirm your email address — ${clubName}`,
        lead: `Welcome to ${clubName}. Please confirm this is your email address to finish setting up your account.`,
        cta: "Confirm my email address",
        showCode: false,
      };
    case "invite":
      return {
        subject: `You have been invited to ${clubName}`,
        lead: `${clubName} has set up an account for you. Use the button below to accept the invitation and choose a password.`,
        cta: "Accept the invitation",
        showCode: false,
      };
    case "magiclink":
      return {
        subject: `Sign in to ${clubName}`,
        lead: `You asked for a sign-in link for ${clubName}. Use the button below and you will be signed in — there is no password to remember.`,
        cta: "Sign in",
        showCode: true,
      };
    case "recovery":
      return {
        subject: `${clubName} — password reset link`,
        lead: `You asked to reset the password on your ${clubName} account. Use the button below to choose a new one.`,
        cta: "Choose a new password",
        showCode: true,
      };
    case "email_change":
    case "email_change_new":
      return {
        subject: `Confirm your new email address — ${clubName}`,
        lead: `Somebody asked to move a ${clubName} account to this email address. Confirm it below and it becomes the address you sign in with.`,
        cta: "Confirm this address",
        showCode: false,
      };
    case "email_change_current":
      return {
        subject: `Confirm the change to your email address — ${clubName}`,
        lead: `Somebody asked to move your ${clubName} account to a different email address. Confirm below that this was you.`,
        cta: "Confirm the change",
        showCode: false,
      };
    case "reauthentication":
      return {
        subject: `${clubName} — your confirmation code`,
        lead: `${clubName} asked you to confirm it is really you. Type the code below into the page that asked for it.`,
        cta: "",
        showCode: true,
      };
  }
}

export type AuthEmailContent = { subject: string; html: string; text: string };

/**
 * The email itself. Every one carries the link as a button and again as a
 * plain URL — some mail clients will not open a button — and every one says
 * what to do if the person did not ask for it.
 */
export function authEmailContent(params: {
  action: AuthEmailActionType;
  clubName: string;
  brandColor: string;
  linkUrl: string | null;
  token: string | null;
}): AuthEmailContent {
  const { action, clubName, brandColor, linkUrl, token } = params;
  const copy = copyFor(action, clubName);
  const ignore =
    action === "email_change_current"
      ? "If you did not ask for this, do not confirm it — contact the club straight away, because somebody else may have your password."
      : "If you did not ask for this, you can ignore this email. Nothing will happen.";

  const parts: string[] = [
    `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${copy.lead}</p>`,
  ];
  const textParts: string[] = [copy.lead, ""];

  if (linkUrl) {
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr><td style="background:${brandColor};border-radius:8px;padding:12px 28px;">
          <a href="${linkUrl}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${copy.cta}</a>
        </td></tr>
      </table>`,
      `<p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or copy this link into your browser:</p>`,
      `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;word-break:break-all;">${linkUrl}</p>`,
    );
    textParts.push(`${copy.cta}: ${linkUrl}`, "");
  }

  if (copy.showCode && token) {
    parts.push(
      `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">If you are asked for a code instead, use <strong style="font-size:16px;color:#111827;letter-spacing:2px;">${token}</strong>.</p>`,
    );
    textParts.push(`If you are asked for a code instead, use ${token}.`, "");
  }

  parts.push(
    `<p style="margin:0;font-size:13px;color:#9ca3af;">This link expires in one hour. ${ignore}</p>`,
  );
  textParts.push(`This link expires in one hour. ${ignore}`);

  return {
    subject: copy.subject,
    html: emailLayout(parts.join("\n"), brandColor, clubName),
    text: textParts.join("\n").trim(),
  };
}
