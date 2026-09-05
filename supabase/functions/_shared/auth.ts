// Auth and client helpers shared by every Edge Function.
//
// Three ways in, and each function states which it accepts:
//   * `requireServiceRole(req)`  — the cron caller (pg_cron → pg_net → here
//     with the service-role key), and nothing else. ONLY behind
//     `verify_jwt = true` — see the note on the function.
//   * `userClient(req)`          — a signed-in member; the client carries the
//     caller's JWT so RLS and every SECURITY DEFINER accessor see *them*, not
//     the service role. This is how the consent/participant filters stay
//     honest inside a function that also holds the service key.
//   * `requireWebhookSecret(req)` — a Database Webhook, which cannot present a
//     JWT; it sends a shared secret header instead. Safe behind
//     `verify_jwt = false`, because nothing it accepts is a decoded claim.
//
// `adminClient()` bypasses RLS and must only ever be used for work the caller
// has already been authorised for.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ANON_KEY, optionalEnv, SERVICE_KEY, SUPABASE_URL } from "./env.ts";

export type Client = SupabaseClient;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function bearer(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Service-role client: bypasses RLS. Never hand it a caller's input unchecked. */
export function adminClient(): Client {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/**
 * True when the bearer token IS the service-role key, byte for byte. This is
 * the one test that needs nothing from the gateway: it holds whether or not
 * the function's JWT verification is on.
 */
export function presentsServiceKey(req: Request): boolean {
  const token = bearer(req);
  return token.length > 0 && timingSafeEqual(token, SERVICE_KEY);
}

/**
 * True when the request presents the service-role key (i.e. it is the
 * scheduler).
 *
 * ONLY FOR FUNCTIONS WITH `verify_jwt = true`. The second branch reads the
 * `role` claim out of the token WITHOUT checking its signature — it cannot,
 * the signing secret is not available here — and is sound only because the
 * gateway has already refused any token whose signature does not verify
 * before this code runs. Behind `verify_jwt = false` that branch would accept
 * a token anybody typed, so a function configured that way must use
 * `presentsServiceKey()` or `requireWebhookSecret()` instead, never this.
 *
 * Why the branch exists at all: the platform injects
 * SUPABASE_SERVICE_ROLE_KEY in the sb_secret_… format, while pg_cron /
 * invoke_edge_function present the legacy service-role JWT, which is the only
 * form the gateway accepts with verify_jwt = true. The two never compare equal.
 */
export function requireServiceRole(req: Request): boolean {
  if (presentsServiceKey(req)) return true;
  const token = bearer(req);
  if (token.length === 0) return false;
  return jwtRole(token) === "service_role";
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * A client acting as the caller. Returns null when there is no usable JWT, or
 * when the token *is* the service-role key (which would silently escalate a
 * "as the user" read into an "as the service" read).
 */
export function userClient(req: Request): Client | null {
  const token = bearer(req);
  if (!token) return null;
  if (timingSafeEqual(token, SERVICE_KEY)) return null;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** The caller's auth user id, or null. */
export async function callerUserId(client: Client): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

/** The caller's `people.id` via `current_person_id()`, or null. */
export async function callerPersonId(client: Client): Promise<string | null> {
  const { data, error } = await client.rpc("current_person_id");
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * Database Webhooks cannot present a JWT, so they send `x-webhook-secret`.
 * The service-role key itself is also accepted so the same endpoint can be
 * replayed by hand from the scheduler.
 *
 * This runs behind `verify_jwt = false`, so NOTHING here may trust a decoded
 * claim: both accepted credentials are compared byte for byte against a
 * secret this function holds. A JWT whose payload merely says
 * `"role":"service_role"` proves nothing without the gateway having checked
 * its signature, and here the gateway has not.
 */
export function requireWebhookSecret(req: Request): boolean {
  if (presentsServiceKey(req)) return true;
  const expected = optionalEnv("WEBHOOK_SECRET");
  if (expected === null) return false;
  const given = req.headers.get("x-webhook-secret") ?? "";
  return given.length > 0 && timingSafeEqual(given, expected);
}

/** Length-independent comparison, so a wrong secret leaks nothing by timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** POST-only guard with a parsed JSON body (never throws on a bad body). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  try {
    const parsed = await req.json();
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** A site_settings integer with a default and hard bounds. */
export async function settingInt(
  admin: Client,
  key: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): Promise<number> {
  const { data } = await admin.from("site_settings").select("value").eq("key", key).maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  const parsed = raw === undefined || raw === null ? NaN : Number.parseInt(raw, 10);
  let n = Number.isFinite(parsed) ? parsed : fallback;
  if (opts.min !== undefined) n = Math.max(opts.min, n);
  if (opts.max !== undefined) n = Math.min(opts.max, n);
  return n;
}
