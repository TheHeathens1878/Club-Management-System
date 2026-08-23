import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Eye, MessageSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { groupAttachment, type AttachmentChoice } from "@/lib/group-scope";
import { getCurrentPersonId, isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { loadAttachmentOptions } from "../attachment-options";
import { GroupMembersPanel, type GroupMemberRow } from "./group-members-panel";
import { CloseGroupForm, GroupSettingsForm } from "./group-settings-form";

/**
 * `/groups/[id]` — manage one group.
 *
 * Reachable by whoever RLS says can change it: the person who created it, or a
 * club administrator. Both still have to be IN the group to see it at all —
 * `conversations_participant_read` is participants-only and this page does not
 * go around it. Oversight of a conversation somebody else runs is not this
 * screen's job: that lives in /safeguarding, goes through
 * `read_conversation_as_lead()`, and is audited (SG-9).
 *
 * Nothing here touches a conversation that is not a group.
 */
export default async function ManageGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const personId = await getCurrentPersonId();
  if (!personId) redirect("/messages");

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select(
      "id,title,type,team_id,resource_id,scope_label,supervised_by_lead,closed_at,created_at,created_by_person_id,resources(name),teams(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  // A team room reached by URL is not editable here at any privilege level.
  if (conversation.type !== "group") {
    return (
      <>
        <PageHeader title="Not a group" subtitle="Team rooms are not edited here" />
        <div className="p-6 max-w-2xl">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
              <p>
                This conversation is a team room. Team rooms take their name from the team and the
                season, and their membership from the team sheet — renaming one here would create a
                second room the next time somebody joins or leaves.
              </p>
              <Link href={`/messages/${id}`} className={buttonVariants({ size: "sm" })}>
                Open the conversation
              </Link>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const clubAdmin = await isClubAdmin();
  const isCreator = conversation.created_by_person_id === personId;
  const canEdit = clubAdmin || isCreator;

  const { data: participantRows } = await supabase
    .from("conversation_participants")
    .select("person_id,basis,joined_at,left_at")
    .eq("conversation_id", id)
    .order("joined_at");

  const participants = participantRows ?? [];
  const names = await resolveNames(participants.map((p) => p.person_id));
  const members: GroupMemberRow[] = participants.map((p) => ({
    personId: p.person_id,
    name: p.person_id === personId ? "You" : nameOf(names, p.person_id),
    basis: p.basis,
    joinedAt: p.joined_at,
    leftAt: p.left_at,
  }));

  const { venues, teams } = await loadAttachmentOptions();

  const attachment = groupAttachment({
    teamName: conversation.teams?.name,
    resourceName: conversation.resources?.name,
    scopeLabel: conversation.scope_label,
  });
  const initialKind: AttachmentChoice = conversation.resource_id
    ? "resource"
    : conversation.team_id
      ? "team"
      : conversation.scope_label
        ? "label"
        : "none";

  return (
    <>
      <PageHeader
        title={conversation.title || "Untitled group"}
        subtitle={attachment.kind === "none" ? "Group" : `Group · ${attachment.label}`}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/messages/${id}`}
              className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-1.5"}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Open chat
            </Link>
            <Link
              href="/groups"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
            >
              <ChevronLeft className="h-4 w-4" /> All groups
            </Link>
          </div>
        }
      />

      <div className="p-6 space-y-4 max-w-3xl">
        {/*
          SG-9 (P5.4): a supervised conversation says so wherever it is shown,
          persistently and without a way to dismiss it. Same words as the thread
          itself, so nobody has to reconcile two descriptions of the same thing.
        */}
        {conversation.supervised_by_lead && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                The club&apos;s safeguarding lead can read this conversation.
              </p>
              <p className="mt-0.5">
                This conversation is supervised because a young person is taking part without a
                parent or guardian in the room. The safeguarding lead (and a club administrator) can
                open and export everything said here, and every time they do it is recorded.
              </p>
            </div>
          </div>
        )}

        {conversation.closed_at && (
          <div className="rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
            This group is closed. Its history is kept and can still be read, but nothing new can be
            posted and its membership is fixed.
          </div>
        )}

        {!canEdit && (
          <div className="rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
            You are in this group but did not set it up, so it is shown here read-only. The person
            who created it, or a club administrator, can change it.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Name and what it is about</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <GroupSettingsForm
                conversationId={conversation.id}
                title={conversation.title ?? ""}
                venues={venues}
                teams={teams}
                initialKind={initialKind}
                initialResourceId={conversation.resource_id ?? ""}
                initialTeamId={conversation.team_id ?? ""}
                initialScopeLabel={conversation.scope_label ?? ""}
                disabled={!!conversation.closed_at}
              />
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{conversation.title || "Untitled group"}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>About:</span>
                  <Badge variant="muted">{attachment.label}</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
            <p className="text-sm text-muted-foreground">
              People are added one at a time and the club&apos;s safeguarding rules are checked each
              time. If one is refused, the reason below is the database&apos;s own.
            </p>
          </CardHeader>
          <CardContent>
            <GroupMembersPanel
              conversationId={conversation.id}
              members={members}
              canEdit={canEdit}
              closed={!!conversation.closed_at}
            />
          </CardContent>
        </Card>

        {canEdit && !conversation.closed_at && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Close the group</CardTitle>
            </CardHeader>
            <CardContent>
              <CloseGroupForm conversationId={conversation.id} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
