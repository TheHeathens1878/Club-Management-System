import { getSessionProfile } from "@/lib/auth";
import { groupAttachment } from "@/lib/group-scope";
import { getCurrentPersonId, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { ConversationRail, type RailItem } from "./conversation-rail";

/**
 * The Messages shell (design build, 2026-08-25): a fixed conversation rail on
 * the left, the open thread on the right — the two-pane layout every route
 * under /messages shares. The rail's data is assembled here, server-side,
 * through the USER-SCOPED client: the participant policies decide which
 * conversations exist for this reader (P5.2), exactly as the old single-column
 * list did.
 *
 * On a phone the rail IS the /messages page, and opening a thread replaces it
 * — the rail hides itself off the index route below lg (see ConversationRail).
 */

/** Enough for a club; the list is ordered by activity, so the tail is cold. */
const CONVERSATION_LIMIT = 60;

function conversationLabel(type: string, title: string | null, otherNames: string[]): string {
  if (title) return title;
  if (otherNames.length > 0) return otherNames.join(", ");
  return type === "announcement" ? "Announcement" : "Conversation";
}

/**
 * The design's timestamp ladder: today → "HH:mm", yesterday → "Yesterday",
 * this week → "Fri", older → "22 Aug".
 */
function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date();
  const dayOf = (d: Date) =>
    d.toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "short" });
  if (dayOf(at) === dayOf(now)) {
    return at.toLocaleTimeString("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayOf(at) === dayOf(yesterday)) return "Yesterday";
  if (now.getTime() - at.getTime() < 6 * 86_400_000) {
    return at.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  }
  return at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  const personId = session ? await getCurrentPersonId() : null;

  // An unlinked sign-in has no conversations; the index page explains why.
  if (!personId) return <>{children}</>;

  const supabase = await createClient();
  const { data: participantRows } = await supabase
    .from("conversation_participants")
    // One string literal, not a concatenation: supabase-js infers the row type
    // from the select text, and only a literal carries that type.
    .select(
      "conversation_id,last_read_message_id,left_at,joined_at,muted_until,basis,conversations(id,type,title,team_id,resource_id,scope_label,supervised_by_lead,closed_at,created_at,resources(name),teams(name))",
    )
    .eq("person_id", personId)
    .limit(CONVERSATION_LIMIT);

  // One row per CONVERSATION, not per participation: a person can hold several
  // rows in one room — left as staff, re-added as guardian — and the live one
  // (else the most recent) is the one that speaks for them.
  const byConversation = new Map<string, NonNullable<typeof participantRows>[number]>();
  for (const row of participantRows ?? []) {
    if (row.conversations === null) continue;
    const existing = byConversation.get(row.conversation_id);
    if (!existing) {
      byConversation.set(row.conversation_id, row);
      continue;
    }
    const rowLive = row.left_at === null;
    const existingLive = existing.left_at === null;
    if (
      (rowLive && !existingLive) ||
      (rowLive === existingLive && row.joined_at > existing.joined_at)
    ) {
      byConversation.set(row.conversation_id, row);
    }
  }
  const rows = Array.from(byConversation.values());

  // One round trip for every "where had I got to", rather than one per row.
  const lastReadIds = rows.map((r) => r.last_read_message_id).filter((id): id is string => !!id);
  const readAt = new Map<string, string>();
  if (lastReadIds.length > 0) {
    const { data: readRows } = await supabase
      .from("messages")
      .select("id,created_at")
      .in("id", lastReadIds);
    for (const row of readRows ?? []) readAt.set(row.id, row.created_at);
  }

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const [lastResult, unreadResult, othersResult, countResult] = await Promise.all([
        supabase
          .from("messages")
          .select("id,body,created_at,sender_person_id,deleted_at")
          .eq("conversation_id", row.conversation_id)
          .order("created_at", { ascending: false })
          .limit(1),
        (() => {
          let unreadQuery = supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", row.conversation_id)
            .neq("sender_person_id", personId);
          const cutoff = row.last_read_message_id ? readAt.get(row.last_read_message_id) : null;
          if (cutoff) unreadQuery = unreadQuery.gt("created_at", cutoff);
          return unreadQuery;
        })(),
        supabase
          .from("conversation_participants")
          .select("person_id")
          .eq("conversation_id", row.conversation_id)
          .is("left_at", null)
          .neq("person_id", personId)
          .limit(8),
        supabase
          .from("conversation_participants")
          .select("person_id", { count: "exact", head: true })
          .eq("conversation_id", row.conversation_id)
          .is("left_at", null),
      ]);
      return {
        row,
        last: lastResult.data?.[0] ?? null,
        unread: unreadResult.count ?? 0,
        otherIds: (othersResult.data ?? []).map((p) => p.person_id),
        members: countResult.count ?? 0,
      };
    }),
  );

  const names = await resolveNames(
    summaries.flatMap((s) => [...s.otherIds, s.last?.sender_person_id ?? ""]),
  );

  summaries.sort((a, b) => {
    const at = a.last?.created_at ?? a.row.conversations?.created_at ?? "";
    const bt = b.last?.created_at ?? b.row.conversations?.created_at ?? "";
    return bt.localeCompare(at);
  });

  const items: RailItem[] = summaries.flatMap(({ row, last, unread, otherIds, members }) => {
    const conversation = row.conversations;
    if (!conversation) return [];
    const otherNames = otherIds.map((id) => nameOf(names, id));
    const attachment =
      conversation.type === "group"
        ? groupAttachment({
            teamName: conversation.teams?.name,
            resourceName: conversation.resources?.name,
            scopeLabel: conversation.scope_label,
          })
        : null;
    const isGroupish =
      conversation.type === "team" ||
      conversation.type === "group" ||
      conversation.type === "announcement";
    const preview = last?.deleted_at
      ? "Message deleted"
      : (last?.body ?? "").replace(/\s+/g, " ").slice(0, 140) || "No messages yet";
    return [
      {
        id: conversation.id,
        name: conversationLabel(conversation.type, conversation.title, otherNames),
        kind: conversation.type,
        teamBound: conversation.type === "team" || conversation.teams !== null,
        members,
        unread,
        timeLabel: whenLabel(last?.created_at ?? conversation.created_at),
        // Groups prefix the sender; a DM's preview is just the message.
        preview:
          isGroupish && last && !last.deleted_at
            ? `${nameOf(names, last.sender_person_id)}: ${preview}`
            : preview,
        supervised: conversation.supervised_by_lead,
        closed: conversation.closed_at !== null,
        left: row.left_at !== null,
      },
    ];
  });

  return (
    <div className="flex min-h-full">
      <ConversationRail items={items} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
