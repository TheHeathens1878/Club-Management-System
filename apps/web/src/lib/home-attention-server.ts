import { outstandingPence } from "@/lib/collection";
import { getCapabilities } from "@/lib/capabilities";
import { loadNavCounts } from "@/lib/nav-counts";
import { createClient } from "@/lib/supabase/server";
import { parseEventPeople } from "@/app/(app)/events/shared";

import { attentionItems, type AttentionEvent, type AttentionInputs, type AttentionItem } from "./home-attention";

/**
 * The inputs to "what needs my attention", each the database's own answer to
 * THIS caller (P7.2):
 *
 *   · events — `my_events()`, SECURITY DEFINER, already scoped to the teams
 *     the person belongs to, coaches or has a child on;
 *   · money — the household's pending `charges` under `charges_read`, with
 *     their payments, netted by the SAME arithmetic the collector uses
 *     (`outstandingPence`) — no second way of adding money up;
 *   · unread — `my_unread_message_count()`;
 *   · queues — `loadNavCounts`, which is zero for anyone who is not a club
 *     administrator and whose RLS makes the number the club's, not the reader's.
 *
 * Four questions asked together; a failed one answers zero rather than
 * taking the Home screen down.
 */
const HORIZON_DAYS = 30;

export async function loadHomeAttention(): Promise<{
  items: AttentionItem[];
  next: AttentionEvent | null;
  inputs: AttentionInputs;
}> {
  const [supabase, capabilities] = await Promise.all([createClient(), getCapabilities()]);
  const now = Date.now();

  const [eventsResult, chargesResult, unreadResult, counts] = await Promise.all([
    supabase.rpc("my_events", { p_horizon_days: HORIZON_DAYS }),
    supabase
      .from("charges")
      .select("id,amount_pence,status,payments(amount_pence,refunded_pence)")
      .eq("status", "pending"),
    supabase.rpc("my_unread_message_count"),
    loadNavCounts(capabilities.isClubAdmin),
  ]);

  const events: AttentionEvent[] = (eventsResult.data ?? []).map((row) => ({
    eventId: row.event_id,
    title: row.title,
    teamName: row.team_name,
    startsAt: row.starts_at,
    status: row.status,
    people: parseEventPeople(row.people),
  }));

  const owed = (chargesResult.data ?? []).reduce(
    (sum, charge) => sum + Math.max(0, outstandingPence(charge.amount_pence, charge.payments ?? [])),
    0,
  );

  const inputs: AttentionInputs = {
    now,
    events,
    outstandingPence: owed,
    unreadMessages: unreadResult.data ?? 0,
    approvals: counts.approvals,
    registrations: counts.registrations,
  };

  const upcoming = events
    .filter((event) => event.status !== "cancelled" && new Date(event.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { items: attentionItems(inputs), next: upcoming[0] ?? null, inputs };
}
