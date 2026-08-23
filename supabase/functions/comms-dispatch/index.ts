// comms-dispatch — P4.4. The one place anything is actually delivered.
//
// AUTH. Scheduled only: the service-role key. `queued_messages`,
// `mark_message_sent` and `mark_message_failed` are granted to `service_role`
// alone.
//
// WHAT IT DOES. Drains up to 100 `queued` rows from `outbound_messages` and
// hands each to its provider — Microsoft Graph for email, Twilio for SMS, Expo for push,
// nothing at all for in_app (the row itself is the message; marking it sent is
// the delivery). Every row ends the run in a terminal state: `sent` or
// `failed`. There is no retry loop and no back-off timer here; a failed row is
// a row a human or a later feature decides what to do with.
//
// A missing provider secret is DATA, not an exception: those rows are marked
// failed with a message that names the secret, the other channels still go, and
// the invocation returns 200. A scheduled job that throws on a config problem
// just disappears into the logs.

import { adminClient, type Client, json, requireServiceRole } from "../_shared/auth.ts";
import { checkSecrets, optionalEnv } from "../_shared/env.ts";

type OutboundRow = {
  id: string;
  person_id: string | null;
  channel: "email" | "sms" | "push" | "in_app";
  category: string;
  to_address: string | null;
  subject: string | null;
  body: string | null;
  template: string | null;
  entity: string | null;
  entity_id: string | null;
};

type PushToken = { token: string; platform: string | null };

type Delivery = { ok: true; provider: string; ref: string | null } | { ok: false; error: string };

const BATCH = 100;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Email goes out through Microsoft Graph from the club mailbox, exactly as the
// web app's room-booking emails do (apps/web/src/lib/email.ts): same Azure app
// registration, same MAIL_FROM, so there is one sender identity and one SPF/DKIM
// story for the club. Client-credentials token per invocation (Graph tokens
// last ~1 h; an invocation sends at most 100 mails).
let graphToken: { value: string; expires: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (graphToken && graphToken.expires > Date.now() + 60_000) return graphToken.value;
  const tenant = optionalEnv("AZURE_TENANT_ID")!;
  const form = new URLSearchParams({
    client_id: optionalEnv("AZURE_CLIENT_ID")!,
    client_secret: optionalEnv("AZURE_CLIENT_SECRET")!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const payload = await res.text();
  if (!res.ok) throw new Error(`graph token ${res.status}: ${payload.slice(0, 300)}`);
  const parsed = JSON.parse(payload) as { access_token: string; expires_in: number };
  graphToken = { value: parsed.access_token, expires: Date.now() + parsed.expires_in * 1000 };
  return graphToken.value;
}

async function sendEmail(row: OutboundRow): Promise<Delivery> {
  const secrets = checkSecrets(["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "MAIL_FROM"]);
  if (!secrets.ok) return { ok: false, error: `email not configured: ${secrets.missing.join(", ")} not set` };
  if (!row.to_address) return { ok: false, error: "no email address on the message" };

  let token: string;
  try {
    token = await getGraphToken();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const from = optionalEnv("MAIL_FROM")!;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: row.subject ?? "(no subject)",
        body: { contentType: "Text", content: row.body ?? "" },
        toRecipients: [{ emailAddress: { address: row.to_address } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const payload = await res.text();
    return { ok: false, error: `graph ${res.status}: ${payload.slice(0, 400)}` };
  }
  // sendMail returns 202 with no body; Graph's request id is the best reference we get.
  return { ok: true, provider: "microsoft-graph", ref: res.headers.get("request-id") };
}

async function sendSms(row: OutboundRow): Promise<Delivery> {
  const secrets = checkSecrets(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]);
  if (!secrets.ok) return { ok: false, error: `sms not configured: ${secrets.missing.join(", ")} not set` };
  if (!row.to_address) return { ok: false, error: "no phone number on the message" };

  const sid = optionalEnv("TWILIO_ACCOUNT_SID")!;
  const token = optionalEnv("TWILIO_AUTH_TOKEN")!;
  const form = new URLSearchParams({
    To: row.to_address,
    From: optionalEnv("TWILIO_FROM")!,
    Body: row.body ?? row.subject ?? "",
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = await res.text();
  if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${payload.slice(0, 400)}` };
  let messageSid: string | null = null;
  try {
    messageSid = (JSON.parse(payload) as { sid?: string }).sid ?? null;
  } catch { /* as above */ }
  return { ok: true, provider: "twilio", ref: messageSid };
}

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string } | null;
};

async function sendPush(admin: Client, row: OutboundRow): Promise<Delivery> {
  if (!row.person_id) return { ok: false, error: "push needs a person_id" };

  const { data, error } = await admin
    .from("push_tokens")
    .select("token, platform")
    .eq("person_id", row.person_id);
  if (error) return { ok: false, error: `push_tokens: ${error.message}` };

  const tokens = ((data ?? []) as PushToken[]).map((t) => t.token).filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: false, error: "no registered device for this person" };

  const messages = tokens.map((to) => ({
    to,
    title: row.subject ?? "AoM Sports Club",
    body: row.body ?? "",
    data: { entity: row.entity, entity_id: row.entity_id, template: row.template },
  }));

  const accessToken = optionalEnv("EXPO_ACCESS_TOKEN");
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(messages),
  });

  const payload = await res.text();
  if (!res.ok) return { ok: false, error: `expo ${res.status}: ${payload.slice(0, 400)}` };

  let tickets: ExpoTicket[] = [];
  try {
    tickets = ((JSON.parse(payload) as { data?: ExpoTicket[] }).data ?? []);
  } catch {
    return { ok: false, error: `expo returned an unparseable body: ${payload.slice(0, 200)}` };
  }

  // A token Expo says is dead is dead: drop it so the next push is not wasted.
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") dead.push(tokens[i]);
  });
  if (dead.length > 0) {
    await admin.from("push_tokens").delete().eq("person_id", row.person_id).in("token", dead);
  }

  const delivered = tickets.find((t) => t.status === "ok");
  if (delivered) return { ok: true, provider: "expo", ref: delivered.id ?? null };

  const first = tickets[0];
  const reason = first?.details?.error ?? first?.message ?? "no ticket returned";
  return { ok: false, error: `expo rejected every token: ${reason}` };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();

  const { data, error } = await admin.rpc("queued_messages", { p_channel: null, p_limit: BATCH });
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as OutboundRow[];
  const counts: Record<string, { sent: number; failed: number }> = {};
  const errors: { id: string; channel: string; error: string }[] = [];

  const tally = (channel: string, ok: boolean) => {
    const c = counts[channel] ?? { sent: 0, failed: 0 };
    if (ok) c.sent++;
    else c.failed++;
    counts[channel] = c;
  };

  for (const row of rows) {
    let result: Delivery;
    try {
      switch (row.channel) {
        case "email":
          result = await sendEmail(row);
          break;
        case "sms":
          result = await sendSms(row);
          break;
        case "push":
          result = await sendPush(admin, row);
          break;
        case "in_app":
          // The row is the message. Nothing to deliver; the app reads it.
          result = { ok: true, provider: "in_app", ref: null };
          break;
        default:
          result = { ok: false, error: `unknown channel ${row.channel}` };
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok) {
      const { error: markError } = await admin.rpc("mark_message_sent", {
        p_message_id: row.id,
        p_provider: result.provider,
        p_provider_ref: result.ref,
      });
      if (markError) errors.push({ id: row.id, channel: row.channel, error: `mark_sent: ${markError.message}` });
      tally(row.channel, true);
    } else {
      await admin.rpc("mark_message_failed", { p_message_id: row.id, p_error: result.error });
      errors.push({ id: row.id, channel: row.channel, error: result.error });
      tally(row.channel, false);
    }
  }

  return json({
    drained: rows.length,
    batch: BATCH,
    more_likely: rows.length === BATCH,
    by_channel: counts,
    errors,
  });
});
