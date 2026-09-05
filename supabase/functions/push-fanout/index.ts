// push-fanout — P5.5. One inserted message → one push per active participant.
//
// AUTH. `verify_jwt = false`: a Database Webhook cannot present a Supabase JWT.
// It sends `x-webhook-secret` instead, checked against the WEBHOOK_SECRET
// secret with a timing-safe compare (the service-role key ITSELF is also
// accepted, byte for byte, so a delivery can be replayed by hand). No secret
// configured ⇒ 401, never an open endpoint.
//
// Because the gateway verifies nothing here, this function must never decide
// on a decoded claim: a token whose payload says `role: service_role` is just
// text until somebody checks its signature, and nobody has. `requireWebhookSecret`
// therefore compares credentials and reads no claims — `requireServiceRole`,
// which does read one, is for `verify_jwt = true` functions only.
//
// WHAT GOES ON THE LOCK SCREEN. Per P5.1 §6: the payload carries the sender's
// name and the conversation, and the **body only when the conversation has no
// minor participant** — `conversation_has_minor()` decides, not this function.
// A lock screen is not a participant, so for anything involving a child the
// body is replaced with "New message" and the reader has to open the app,
// where RLS applies.
//
// WHO GETS IT. Active participants (`left_at is null`) other than the sender,
// skipping anyone muted (`muted_until` in the future) and anyone who has turned
// the push channel off. Delivery itself is `comms-dispatch`'s job: this
// function only calls `enqueue_message`, so suppression, dry-run and the
// `outbound_messages` audit trail all still apply.

import { adminClient, json, readJson, requireWebhookSecret } from "../_shared/auth.ts";
import { enqueue } from "../_shared/comms.ts";

type MessageRecord = {
  id?: string;
  conversation_id?: string;
  sender_person_id?: string;
  body?: string | null;
  deleted_at?: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: MessageRecord | null;
};

type Participant = { person_id: string; muted_until: string | null };

const TYPE_LABEL: Record<string, string> = {
  dm: "Direct message",
  group: "Group",
  team: "Team",
  announcement: "Announcement",
};

const PREVIEW_CHARS = 140;

function preview(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return "New message";
  return text.length <= PREVIEW_CHARS ? text : `${text.slice(0, PREVIEW_CHARS - 1)}…`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!requireWebhookSecret(req)) return json({ error: "unauthorised" }, 401);

  const payload = await readJson(req) as unknown as WebhookPayload;
  if (payload.type !== "INSERT" || payload.table !== "messages") {
    return json({ ignored: `${payload.type ?? "?"} on ${payload.table ?? "?"}` });
  }

  const record = payload.record ?? null;
  const conversationId = record?.conversation_id;
  const senderId = record?.sender_person_id;
  if (!record || !conversationId || !senderId) {
    return json({ error: "payload is missing conversation_id or sender_person_id" }, 400);
  }
  if (record.deleted_at) return json({ ignored: "message was inserted already deleted" });

  const admin = adminClient();

  const { data: convData, error: convError } = await admin
    .from("conversations")
    .select("id, type, title, closed_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (convError) return json({ error: convError.message }, 500);
  const conversation = convData as
    | { id: string; type: string; title: string | null; closed_at: string | null }
    | null;
  if (!conversation) return json({ error: "no such conversation" }, 404);

  const { data: partData, error: partError } = await admin
    .from("conversation_participants")
    .select("person_id, muted_until")
    .eq("conversation_id", conversationId)
    .is("left_at", null)
    .neq("person_id", senderId);
  if (partError) return json({ error: partError.message }, 500);

  const now = Date.now();
  const recipients = ((partData ?? []) as Participant[]).filter(
    (p) => p.muted_until === null || Date.parse(p.muted_until) <= now,
  );
  const muted = (partData ?? []).length - recipients.length;

  // The database decides whether a body may appear on a lock screen.
  const { data: minorData, error: minorError } = await admin.rpc("conversation_has_minor", {
    p_conversation_id: conversationId,
  });
  if (minorError) return json({ error: minorError.message }, 500);
  const hasMinor = minorData === true;

  const { data: senderData } = await admin
    .from("people")
    .select("first_name, last_name")
    .eq("id", senderId)
    .maybeSingle();
  const sender = senderData as { first_name: string | null; last_name: string | null } | null;
  const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ").trim() ||
    "A club member";

  const where = conversation.title?.trim() || TYPE_LABEL[conversation.type] || "Conversation";
  const title = `${senderName} · ${where}`;
  const body = hasMinor ? "New message" : preview(record.body);

  // `transactional` skips the preference check inside enqueue_message, so the
  // per-person push opt-out (P4.4, spec §6) is applied explicitly here — one
  // query for the whole conversation, not one per participant. Push defaults to
  // enabled, so only an explicit `enabled = false` row opts out. Suppression and
  // dry-run remain the database's call.
  const optedOut = new Set<string>();
  if (recipients.length > 0) {
    const { data: prefData } = await admin
      .from("comms_preferences")
      .select("person_id")
      .eq("channel", "push")
      .eq("enabled", false)
      .in("person_id", recipients.map((r) => r.person_id));
    for (const p of (prefData ?? []) as { person_id: string }[]) optedOut.add(p.person_id);
  }

  let enqueued = 0;
  let preferenceOff = 0;
  const outcomes: Record<string, number> = {};
  const failures: { person_id: string; error: string }[] = [];

  for (const recipient of recipients) {
    if (optedOut.has(recipient.person_id)) {
      preferenceOff++;
      continue;
    }

    const result = await enqueue(admin, {
      channel: "push",
      category: "transactional",
      personId: recipient.person_id,
      subject: title,
      body,
      template: "message",
      entity: "conversations",
      entityId: conversationId,
    });
    if (!result.ok) {
      failures.push({ person_id: recipient.person_id, error: result.error });
      continue;
    }
    enqueued++;
    outcomes[result.result.status] = (outcomes[result.result.status] ?? 0) + 1;
  }

  return json({
    conversation_id: conversationId,
    message_id: record.id ?? null,
    participants: (partData ?? []).length,
    muted,
    preference_off: preferenceOff,
    enqueued,
    body_withheld: hasMinor,
    by_status: outcomes,
    failures,
  });
});
