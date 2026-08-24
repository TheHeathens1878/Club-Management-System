import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Settings } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";


import { loadThread } from "./thread-data";
import { ThreadPanel } from "./thread-panel";

/**
 * A thread (PLAN.md P5.4).
 *
 * The data assembly and the rendering live in `thread-data.ts` /
 * `thread-panel.tsx`, shared with the team page's Chat and Notice board tabs.
 * This page is the standalone shell: header, back link, and — for a group's
 * creator or an administrator — the Group settings link.
 *
 * User-scoped client: the reader sees this conversation because the P5.2
 * participant policies say so, and for no other reason. There is deliberately
 * no admin path through this page — oversight lives in /safeguarding, goes
 * through `read_conversation_as_lead()`, and is audited (SG-9).
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await loadThread(id);
  if (!data) notFound();

  // A team room's thread also lives on its team page — offer the way there.
  const teamHref = data.conversation.team_id ? `/teams/${data.conversation.team_id}` : null;

  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={
          data.conversation.type === "team"
            ? "Team room"
            : data.conversation.type === "announcement"
              ? "Announcements"
              : data.conversation.type === "group"
                ? "Group"
                : "Direct message"
        }
        action={
          <div className="flex items-center gap-4">
            {data.canManageGroup && (
              <Link
                href={`/groups/${data.conversation.id}`}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
              >
                <Settings className="h-4 w-4" /> Group settings
              </Link>
            )}
            {teamHref && (
              <Link
                href={teamHref}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
              >
                Team page
              </Link>
            )}
            <Link
              href="/messages"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
            >
              <ChevronLeft className="h-4 w-4" /> All messages
            </Link>
          </div>
        }
      />

      <div className="max-w-3xl p-6">
        <ThreadPanel data={data} />
      </div>
    </>
  );
}
