import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Info, MessageSquare, Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { groupAttachment } from "@/lib/group-scope";
import { formatStamp } from "@/lib/people-display";
import { getCurrentPersonId, isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

/**
 * `/groups` — the club's group chats, for a club administrator.
 *
 * WHAT THIS LIST CAN AND CANNOT SEE, and why it is said on the screen too:
 * `conversations` has exactly one SELECT policy, `conversations_participant
 * _read`, and it is `is_participant_ever(id)`. There is no blanket admin read.
 * So this page lists the groups this administrator is in — which, because
 * creating a group puts the creator in it, is every group they set up plus
 * every group somebody has added them to — and nothing else. A group run by a
 * coach that the administrator was never in is invisible here, and no amount of
 * query writing changes that without a migration. The alternative — a
 * service-role read — is exactly the back door the messaging system is built to
 * refuse, so it is not on the table.
 *
 * Read through the caller's own client throughout.
 */

/** Enough for a club's groups; the list is newest-first, so the tail is cold. */
const GROUP_LIMIT = 100;

export default async function GroupsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!(await isClubAdmin())) redirect("/messages");

  const personId = await getCurrentPersonId();
  const supabase = await createClient();

  if (!personId) {
    return (
      <>
        <PageHeader title="Groups" subtitle="WhatsApp-style group chats for the club" />
        <div className="max-w-3xl p-4 lg:p-6">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there are no groups to show and
              none can be created. An administrator can link it on your member profile.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const { data: groupRows, error: listError } = await supabase
    // One string literal, not a concatenation: supabase-js infers the row type
    // from the select text, and only a literal carries that type.
    .from("conversations")
    .select(
      "id,title,type,team_id,resource_id,scope_label,supervised_by_lead,closed_at,created_at,created_by_person_id,resources(name),teams(name)",
    )
    .eq("type", "group")
    .order("created_at", { ascending: false })
    .limit(GROUP_LIMIT);

  const groups = groupRows ?? [];

  // 20260824260000: club_admin sees every group (metadata) plus an aggregate
  // member count; the participants policy still hides who is in them.
  const { data: countRows } = await supabase.rpc("group_member_counts");
  const countById = new Map((countRows ?? []).map((row) => [row.conversation_id, row.members]));

  const summaries = await Promise.all(
    groups.map(async (group) => {
      const { data: mine } = await supabase
        .from("conversation_participants")
        .select("left_at")
        .eq("conversation_id", group.id)
        .eq("person_id", personId)
        .limit(1);
      const myRow = (mine ?? [])[0] ?? null;
      return {
        group,
        members: countById.get(group.id) ?? 0,
        inIt: myRow !== null && myRow.left_at === null,
        everIn: myRow !== null,
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Group chats for a venue, a team, or anything else the club runs"
        action={
          <Link
            href="/groups/new"
            className={buttonVariants({ size: "sm" }) + " min-h-[44px] gap-2 lg:min-h-0"}
          >
            <Plus className="h-4 w-4" /> New group
          </Link>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {listError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {listError.message}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Administrators see every group here. Being listed is not membership: a group's messages
            stay readable only by the people in it, and safeguarding oversight goes through the
            lead's audited access.
          </p>
        </div>

        {summaries.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No groups yet. &ldquo;New group&rdquo; sets one up against a venue, a team, or
              anything else.
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {summaries.map(({ group, members, inIt, everIn }) => {
            const attachment = groupAttachment({
              teamName: group.teams?.name,
              resourceName: group.resources?.name,
              scopeLabel: group.scope_label,
            });

            return (
              <div key={group.id} className="rounded-xl border bg-card p-4 lg:rounded-lg">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{group.title || "Untitled group"}</span>
                      {attachment.kind !== "none" && (
                        <Badge variant={attachment.kind === "scope" ? "outline" : "muted"}>
                          {attachment.label}
                        </Badge>
                      )}
                      {group.supervised_by_lead && (
                        <Badge variant="warning" className="gap-1">
                          <Eye className="h-3 w-3" /> Lead can read
                        </Badge>
                      )}
                      {group.closed_at && <Badge variant="muted">Closed</Badge>}
                      {everIn && !inIt && <Badge variant="muted">You left</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {members} {members === 1 ? "member" : "members"} · created{" "}
                      {formatStamp(group.created_at)}
                    </p>
                  </div>
                  {/* Full-width, 44px controls on a phone; the pair the desk
                      has always had from lg up. */}
                  <div className="flex w-full shrink-0 items-center gap-2 lg:w-auto">
                    {everIn && (
                      <Link
                        href={`/messages/${group.id}`}
                        className={
                          buttonVariants({ variant: "outline", size: "sm" }) +
                          " min-h-[44px] flex-1 gap-1.5 lg:min-h-0 lg:flex-none"
                        }
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Open chat
                      </Link>
                    )}
                    <Link
                      href={`/groups/${group.id}`}
                      className={
                        buttonVariants({ size: "sm" }) + " min-h-[44px] flex-1 lg:min-h-0 lg:flex-none"
                      }
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
