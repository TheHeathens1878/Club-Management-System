// The one outbound API (P4.4), as seen from Deno.
//
// Every function that sends anything goes through `enqueue()`. It never
// delivers: it writes the `outbound_messages` row and lets the database decide
// suppression / preference / dry-run. `comms-dispatch` does the delivering.

import type { Client } from "./auth.ts";

export type Channel = "email" | "sms" | "push" | "in_app";
export type Category = "transactional" | "reminder" | "marketing";
export type OutboundStatus =
  | "queued"
  | "sent"
  | "failed"
  | "suppressed"
  | "skipped_preference"
  | "dry_run";

export type EnqueueResult = {
  message_id: string;
  status: OutboundStatus;
  decision: string;
};

export type EnqueueArgs = {
  channel: Channel;
  category: Category;
  personId?: string | null;
  toAddress?: string | null;
  subject?: string | null;
  body?: string | null;
  template?: string | null;
  entity?: string | null;
  entityId?: string | null;
};

/**
 * `enqueue_message(...)` returns a one-row table, so PostgREST hands back an
 * array. Errors are returned, not thrown: a scheduled job that fails to notify
 * one person must still notify the rest.
 */
export async function enqueue(
  admin: Client,
  a: EnqueueArgs,
): Promise<{ ok: true; result: EnqueueResult } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("enqueue_message", {
    p_channel: a.channel,
    p_category: a.category,
    p_person_id: a.personId ?? null,
    p_to_address: a.toAddress ?? null,
    p_subject: a.subject ?? null,
    p_body: a.body ?? null,
    p_template: a.template ?? null,
    p_entity: a.entity ?? null,
    p_entity_id: a.entityId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as EnqueueResult[];
  if (rows.length === 0) return { ok: false, error: "enqueue_message returned no row" };
  return { ok: true, result: rows[0] };
}

/**
 * Has this exact (entity, entity_id, template) already gone out, or is it
 * waiting to? `dry_run`, `suppressed` and `skipped_preference` deliberately do
 * NOT count: a dry run must not consume a real send, and a suppressed address
 * on one channel should not block a later retry after the block is lifted.
 */
export async function alreadySent(
  admin: Client,
  entity: string,
  entityId: string,
  template: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("outbound_messages")
    .select("id")
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .eq("template", template)
    .in("status", ["queued", "sent"])
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Every person currently holding the `safeguarding_lead` role, with an email. */
export async function safeguardingLeads(
  admin: Client,
): Promise<{ person_id: string; email: string }[]> {
  const { data: roles, error: roleErr } = await admin
    .from("person_roles")
    .select("person_id")
    .eq("role", "safeguarding_lead")
    .is("revoked_at", null);
  if (roleErr) return [];
  const ids = [...new Set(((roles ?? []) as { person_id: string }[]).map((r) => r.person_id))];
  if (ids.length === 0) return [];

  const { data: people, error: peopleErr } = await admin
    .from("people")
    .select("id, email")
    .in("id", ids);
  if (peopleErr) return [];
  return ((people ?? []) as { id: string; email: string | null }[])
    .filter((p): p is { id: string; email: string } => typeof p.email === "string" && p.email !== "")
    .map((p) => ({ person_id: p.id, email: p.email }));
}

export function pounds(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
