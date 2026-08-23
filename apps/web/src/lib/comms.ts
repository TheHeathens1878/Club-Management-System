/**
 * The web app's door into P4.4's comms API (`supabase/migrations/20260823190000_comms.sql`).
 *
 * `enqueue_message()` is the only sanctioned way for anything in this platform
 * to send a message: it resolves the address, applies the suppression list,
 * applies the person's channel preference (transactional is exempt), applies
 * the platform-wide `comms.dry_run` setting, and writes the row in
 * `outbound_messages` that is the club's record that a send was decided. The
 * caller then sends and reports back with `mark_message_sent` /
 * `mark_message_failed`.
 *
 * Service client: `enqueue_message` is `service_role`-or-`club_admin`, and the
 * sends this wraps happen in contexts with no session at all (the public
 * booking form, the payment-reminder cron, the SumUp webhook).
 */

import type { Database } from "@club/db";

import { createAdminClient } from "@/lib/supabase/admin";

type Channel = Database["public"]["Enums"]["comms_channel"];
export type CommsCategory = Database["public"]["Enums"]["comms_category"];

/** Every channel a person can have a preference about. */
export const COMMS_CHANNELS: Channel[] = ["email", "sms", "push", "in_app"];
type OutboundStatus = Database["public"]["Enums"]["outbound_status"];

export type EnqueueResult = {
  /** Null when the comms API could not be reached — see `send` below. */
  messageId: string | null;
  status: OutboundStatus | "unknown";
  decision: string;
  /** Whether the caller should actually send. */
  send: boolean;
};

/**
 * Ask the comms API whether this message may be sent, and log it either way.
 *
 * Fail-open on an *infrastructure* error (the RPC itself is unreachable): a
 * transactional booking confirmation that is silently dropped because the log
 * was down is worse than one that is sent without a log row, and the
 * `console.error` is the signal that something needs fixing. A *decision* from
 * the API — suppressed, preference off, dry run — is always honoured.
 */
export async function enqueue(params: {
  channel: Channel;
  category: CommsCategory;
  toAddress?: string | null;
  personId?: string | null;
  subject?: string | null;
  body?: string | null;
  template?: string | null;
  entity?: string | null;
  entityId?: string | null;
}): Promise<EnqueueResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("enqueue_message", {
      p_channel: params.channel,
      p_category: params.category,
      p_person_id: params.personId ?? undefined,
      p_to_address: params.toAddress ?? undefined,
      p_subject: params.subject ?? undefined,
      p_body: params.body ?? undefined,
      p_template: params.template ?? undefined,
      p_entity: params.entity ?? undefined,
      p_entity_id: params.entityId ?? undefined,
    });
    if (error) throw new Error(error.message);

    const row = data?.[0];
    if (!row) throw new Error("enqueue_message returned no row");

    return {
      messageId: row.message_id,
      status: row.status,
      decision: row.decision,
      send: row.status === "queued",
    };
  } catch (err) {
    console.error("[comms] enqueue_message failed — sending anyway:", err);
    return { messageId: null, status: "unknown", decision: "enqueue_unavailable", send: true };
  }
}

export async function markSent(messageId: string | null, provider: string, providerRef?: string) {
  if (!messageId) return;
  try {
    const admin = createAdminClient();
    await admin.rpc("mark_message_sent", {
      p_message_id: messageId,
      p_provider: provider,
      p_provider_ref: providerRef,
    });
  } catch (err) {
    console.error("[comms] mark_message_sent failed:", err);
  }
}

export async function markFailed(messageId: string | null, error: string) {
  if (!messageId) return;
  try {
    const admin = createAdminClient();
    await admin.rpc("mark_message_failed", { p_message_id: messageId, p_error: error });
  } catch (err) {
    console.error("[comms] mark_message_failed failed:", err);
  }
}
