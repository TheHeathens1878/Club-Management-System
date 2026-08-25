import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, MessageSquarePlus, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { groupAttachment } from "@/lib/group-scope";
import { getCurrentPersonId, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

/**
 * The conversation list (PLAN.md P5.4).
 *
 * User-scoped client throughout: the participant-scoped policies in P5.2 are
 * what decide which conversations exist for this reader, and nothing here
 * should be able to see past them.
 */

/** Enough for a club; the list is ordered by activity, so the tail is cold. */
const CONVERSATION_LIMIT = 60;

function conversationLabel(
  type: string,
  title: string | null,
  otherNames: string[],
): string {
  if (title) return title;
  if (otherNames.length > 0) return otherNames.join(", ");
  return type === "announcement" ? "Announcement" : "Conversation";
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    ...(sameDay ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : { day: "numeric", month: "short" }),
  });
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  // "My Groups" in the parent menu (Adam, 2026-08-25) is this list narrowed to
  // the WhatsApp-style groups; everything else about the page is unchanged.
  const groupsOnly = (await searchParams).filter === "groups";

  const personId = await getCurrentPersonId();
  const supabase = await createClient();

  if (!personId) {
    return (
      <>
        <PageHeader title="Messages" subtitle="Club conversations" />
        <div className="p-6 max-w-2xl">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there are no conversations to
              show. An administrator can link it on your member profile.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const { data: participantRows, error: listError } = await supabase
    .from("conversation_participants")
    // One string literal, not a concatenation: supabase-js infers the row type
    // from the select text, and only a literal carries that type.
    .select(
      "conversation_id,last_read_message_id,left_at,muted_until,basis,conversations(id,type,title,team_id,resource_id,scope_label,supervised_by_lead,closed_at,created_at,resources(name),teams(name))",
    )
    .eq("person_id", personId)
    .limit(CONVERSATION_LIMIT);

  const rows = (participantRows ?? []).filter(
    (r) => r.conversations !== null && (!groupsOnly || r.conversations.type === "group"),
  );

  // One round trip for every "where had I got to", rather than one per row.
  const lastReadIds = rows.map((r) => r.last_read_message_id).filter((id): id is string => !!id);
  const readAt = new Map<string, string>();
  if (lastReadIds.length > 0) {
    const { data: readRows } = await supabase.from("messages").select("id,created_at").in("id", lastReadIds);
    for (const row of readRows ?? []) readAt.set(row.id, row.created_at);
  }

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const { data: lastRows } = await supabase
        .from("messages")
        .select("id,body,created_at,sender_person_id,deleted_at")
        .eq("conversation_id", row.conversation_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const last = lastRows?.[0] ?? null;

      let unreadQuery = supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", row.conversation_id)
        .neq("sender_person_id", personId);
      const cutoff = row.last_read_message_id ? readAt.get(row.last_read_message_id) : null;
      if (cutoff) unreadQuery = unreadQuery.gt("created_at", cutoff);
      const { count } = await unreadQuery;

      const { data: participants } = await supabase
        .from("conversation_participants")
        .select("person_id")
        .eq("conversation_id", row.conversation_id)
        .is("left_at", null)
        .neq("person_id", personId)
        .limit(8);

      return {
        row,
        last,
        unread: count ?? 0,
        otherIds: (participants ?? []).map((p) => p.person_id),
      };
    }),
  );

  const names = await resolveNames(summaries.flatMap((s) => [...s.otherIds, s.last?.sender_person_id ?? ""]));

  summaries.sort((a, b) => {
    const at = a.last?.created_at ?? a.row.conversations?.created_at ?? "";
    const bt = b.last?.created_at ?? b.row.conversations?.created_at ?? "";
    return bt.localeCompare(at);
  });

  return (
    <>
      <PageHeader
        title={groupsOnly ? "My Groups" : "Messages"}
        subtitle={groupsOnly ? "The groups you are in" : "Club conversations you are part of"}
        action={
          <Link href="/messages/new" className={buttonVariants({ size: "sm" }) + " gap-2"}>
            <MessageSquarePlus className="h-4 w-4" /> New message
          </Link>
        }
      />
      <div className="p-6 space-y-4 max-w-3xl">
        {listError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {listError.message}
          </div>
        )}

        {summaries.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet. Team rooms appear here automatically once you are on a team.
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {summaries.map(({ row, last, unread, otherIds }) => {
            const conversation = row.conversations;
            if (!conversation) return null;
            const otherNames = otherIds.map((id) => nameOf(names, id));
            const label = conversationLabel(conversation.type, conversation.title, otherNames);
            // What a group is about (venue, team or free-text scope). Read-only
            // here; it is set on /groups.
            const attachment =
              conversation.type === "group"
                ? groupAttachment({
                    teamName: conversation.teams?.name,
                    resourceName: conversation.resources?.name,
                    scopeLabel: conversation.scope_label,
                  })
                : null;
            const preview = last?.deleted_at
              ? "Message deleted"
              : last?.body?.replace(/\s+/g, " ").slice(0, 120) ?? "No messages yet";

            return (
              <Link
                key={row.conversation_id}
                href={`/messages/${row.conversation_id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {conversation.type === "team" && (
                        <Badge variant="muted" className="gap-1">
                          <Users className="h-3 w-3" /> Team room
                        </Badge>
                      )}
                      {conversation.type === "announcement" && <Badge variant="muted">Announcements</Badge>}
                      {attachment && attachment.kind !== "none" && (
                        <Badge variant={attachment.kind === "scope" ? "outline" : "muted"}>
                          {attachment.label}
                        </Badge>
                      )}
                      {conversation.supervised_by_lead && (
                        <Badge variant="warning" className="gap-1">
                          <Eye className="h-3 w-3" /> Lead can read
                        </Badge>
                      )}
                      {conversation.closed_at && <Badge variant="muted">Closed</Badge>}
                      {row.left_at && <Badge variant="muted">You left</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {last && !last.deleted_at && `${nameOf(names, last.sender_person_id)}: `}
                      {preview}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-muted-foreground">{whenLabel(last?.created_at ?? null)}</span>
                    {unread > 0 && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
