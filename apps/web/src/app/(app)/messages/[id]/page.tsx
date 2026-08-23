import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Eye } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId, nameOf, resolveNames, UNNAMED } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { LeaveButton } from "./leave-button";
import { ThreadClient, type ThreadMessage } from "./thread-client";

/**
 * A thread (PLAN.md P5.4).
 *
 * User-scoped client: the reader sees this conversation because the P5.2
 * participant policies say so, and for no other reason. There is deliberately
 * no admin path through this page — oversight lives in /safeguarding, goes
 * through `read_conversation_as_lead()`, and is audited (SG-9).
 */

/** The visible tail of a thread; older messages stay in the export. */
const MESSAGE_LIMIT = 200;

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const personId = await getCurrentPersonId();
  if (!personId) redirect("/messages");

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id,type,title,team_id,supervised_by_lead,closed_at")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  const [{ data: participantRows }, { data: messageRows }] = await Promise.all([
    supabase
      .from("conversation_participants")
      .select("person_id,basis,left_at,joined_at,last_read_message_id")
      .eq("conversation_id", id),
    supabase
      .from("messages")
      .select("id,body,created_at,sender_person_id,deleted_at,redacted_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
  ]);

  const participants = participantRows ?? [];
  const mine = participants.filter((p) => p.person_id === personId);
  const myLive = mine.find((p) => p.left_at === null) ?? null;
  if (mine.length === 0) notFound();

  const messages: ThreadMessage[] = (messageRows ?? []).slice().reverse();

  const names = await resolveNames([
    ...participants.map((p) => p.person_id),
    ...messages.map((m) => m.sender_person_id),
  ]);
  const nameMap: Record<string, string> = {};
  for (const p of participants) nameMap[p.person_id] = nameOf(names, p.person_id);
  for (const m of messages) nameMap[m.sender_person_id] = nameOf(names, m.sender_person_id);

  const activeOthers = participants.filter((p) => p.left_at === null && p.person_id !== personId);
  const isStaffHere = myLive ? myLive.basis === "staff" || myLive.basis === "creator" : false;
  const announcementReadOnly = conversation.type === "announcement" && !isStaffHere;

  const readOnlyNotice = conversation.closed_at
    ? "This conversation is closed. Its history is kept, but nothing new can be posted."
    : !myLive
      ? "You have left this conversation. You can still read what was said while you were in it."
      : announcementReadOnly
        ? "Announcements are one-way. Only team staff can post here."
        : null;

  const title =
    conversation.title ||
    (activeOthers.length > 0
      ? activeOthers.map((p) => nameOf(names, p.person_id)).join(", ")
      : conversation.type === "announcement"
        ? "Announcements"
        : "Conversation");

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          conversation.type === "team"
            ? "Team room"
            : conversation.type === "announcement"
              ? "Announcements"
              : conversation.type === "group"
                ? "Group"
                : "Direct message"
        }
        action={
          <Link href="/messages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ChevronLeft className="h-4 w-4" /> All messages
          </Link>
        }
      />

      <div className="p-6 space-y-4 max-w-3xl">
        {/*
          SG-9 acceptance criterion (P5.4): a conversation that is monitored
          without this banner is a defect. It is persistent, it is shown to
          every participant, and it says plainly who can read what.
        */}
        {conversation.supervised_by_lead && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">The club&apos;s safeguarding lead can read this conversation.</p>
              <p className="mt-0.5">
                This conversation is supervised because a young person is taking part without a
                parent or guardian in the room. The safeguarding lead (and a club administrator)
                can open and export everything said here, and every time they do it is recorded.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>In this conversation:</span>
          {participants.map((p) => (
            <Badge key={`${p.person_id}-${p.joined_at}`} variant={p.left_at ? "muted" : "outline"}>
              {p.person_id === personId ? "You" : (nameMap[p.person_id] ?? UNNAMED)}
              {p.left_at ? " (left)" : ""}
            </Badge>
          ))}
        </div>

        <ThreadClient
          conversationId={conversation.id}
          myPersonId={personId}
          myName={session.profile?.full_name || "Someone"}
          initialMessages={messages}
          names={nameMap}
          canPost={!!myLive && !conversation.closed_at && !announcementReadOnly}
          readOnlyNotice={readOnlyNotice}
        />

        {myLive && !conversation.closed_at && <LeaveButton conversationId={conversation.id} />}
      </div>
    </>
  );
}
