import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Eye, MessageSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { groupAttachment, type AttachmentChoice } from "@/lib/group-scope";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { getCurrentPersonId, isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { refereeBandSummary } from "@/lib/referee-bands";
import { resolveRoleView } from "@/lib/role-view";
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
        <div className="max-w-2xl p-4 lg:p-6">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
              <p>
                This conversation is a team room. Team rooms take their name from the team and the
                season, and their membership from the team sheet — renaming one here would create a
                second room the next time somebody joins or leaves.
              </p>
              <Link
                href={`/messages/${id}`}
                className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}
              >
                Open the conversation
              </Link>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const clubAdmin = await isClubAdmin();
  // Adam, 2026-08-25: "make sure that coaches cannot edit the group settings
  // or close the group." Settings and closing are the club's: a creator who
  // is not an administrator keeps everything else — reading it, posting in it,
  // adding and removing members — but the name, the attachment and the close
  // button are the administrator's. The database says the same thing
  // (`conversations_update`, 20260825320000), so this only stops offering a
  // form the update would refuse.
  //
  // And Adam again, 2026-09-01: "coaches should not be able to edit group
  // settings or close the group UNDER THAT ROLE." Being an administrator is
  // what admits you; wearing the coach hat is what puts it away, the same rule
  // the team and match screens follow. An administrator who coaches sees what a
  // coach sees until they switch tiles.
  const hat = resolveRoleView(await getStoredRoleView(), await getCapabilities());
  const canEdit = clubAdmin && (hat === "admin" || hat === null);
  // Adam, 2026-08-25: "admins should be able to click on a member's name and
  // it takes you to their contact page". /people/[id] admits the committee and
  // nobody else, so the link is offered on exactly that answer — a group's
  // creator who is not on the committee keeps the plain name rather than a
  // link that would bounce them to the room diary.
  const canOpenContacts = isCommittee(session.profile?.role);

  const { data: participantRows } = await supabase
    .from("conversation_participants")
    .select("person_id,basis,joined_at,left_at")
    .eq("conversation_id", id)
    .order("joined_at");

  const participants = participantRows ?? [];
  const names = await resolveNames(participants.map((p) => p.person_id));

  // WHO HOLDS THE HAT, in every group. Adam, 2026-09-02: "being a member of
  // the referees group doesn't automatically make you a referee — all coaches
  // should be in there also. Member just means member of the group, I want the
  // referees to be obvious and highlighted." `conversation_referees()`
  // (20260902130000) is the only thing that can tell them apart: `person_roles`
  // is not a member's to read, and the participation basis says how somebody
  // got in, not what they are.
  const { data: refereeIds } = await supabase.rpc("conversation_referees", {
    p_conversation_id: id,
  });
  const referees = new Set<string>(refereeIds ?? []);

  // The Referees group, and only it, shows what each referee may take: one
  // age band below their own until they are 16 (Adam, 2026-09-01). The bands
  // come from `referees_group_bands()`, which computes them once and answers
  // only for somebody who can already see this group — the same readers this
  // page has. Every other group's list is unchanged.
  //
  // The band is kept for REFEREES ONLY. The function returns one for every
  // participant, so before today a coach who had never refereed a game was
  // shown the age groups they may take, which is not a thing about them.
  const { data: refereesGroupId } = await supabase.rpc("referees_group_id");
  const bands = new Map<string, string>();
  if (refereesGroupId === id) {
    const { data: bandRows } = await supabase.rpc("referees_group_bands");
    for (const row of bandRows ?? []) {
      if (!referees.has(row.person_id)) continue;
      bands.set(
        row.person_id,
        refereeBandSummary({
          personId: row.person_id,
          dobKnown: row.dob_known,
          ownBand: row.own_band,
          unlimited: row.unlimited,
          maxBand: row.max_band,
        }),
      );
    }
  }

  const members: GroupMemberRow[] = participants.map((p) => ({
    personId: p.person_id,
    name: p.person_id === personId ? "You" : nameOf(names, p.person_id),
    basis: p.basis,
    joinedAt: p.joined_at,
    leftAt: p.left_at,
    note: bands.get(p.person_id) ?? null,
    isReferee: referees.has(p.person_id),
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
              className={
                buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] gap-1.5 lg:min-h-0"
              }
            >
              <MessageSquare className="h-3.5 w-3.5" /> Open chat
            </Link>
            <Link
              href="/groups"
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
            >
              <ChevronLeft className="h-4 w-4" /> All groups
            </Link>
          </div>
        }
      />

      <div className="max-w-3xl space-y-4 p-4 lg:p-6">
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
            The group&apos;s name, what it is attached to and whether it is closed are the club&apos;s
            to set, so they are shown here read-only. You can still add and remove members below.
            Ask a club administrator for anything else.
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
            {refereesGroupId === id && (
              <p className="text-sm text-muted-foreground">
                Coaches are in this group as well as referees, so that a game needing an official
                can be posted here. The <span className="font-medium text-amber-700">referees</span>{" "}
                are marked, and each one shows their own age group and the games they may take: the
                club follows the FA, so a referee under 16 takes one age group below their own and
                from 16 takes any of them. A game above somebody&apos;s age group cannot be claimed
                by them — the database refuses it, not the screen.
              </p>
            )}
          </CardHeader>
          <CardContent>
            <GroupMembersPanel
              conversationId={conversation.id}
              members={members}
              canEdit={canEdit}
              canOpenContacts={canOpenContacts}
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
