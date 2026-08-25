import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Settings } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { instantToLocal } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";
import { createClient } from "@/lib/supabase/server";

import { type FixtureOption } from "./match-post-composer";
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

  // The Referees group's composer auto-completes from the poster's own teams:
  // their upcoming fixtures with the FA format, the team's match length and
  // its home venue (address preferred) ready to drop into the card.
  let postFixtures: FixtureOption[] = [];
  if (data.isRefereesGroup && data.myLive) {
    const capabilities = await getCapabilities();
    const teamIds = capabilities.staffTeams.map((team) => team.id);
    if (teamIds.length > 0) {
      const supabase = await createClient();
      const [{ data: fixtureRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from("fixtures")
          .select("id,team_id,opponent,is_home,kickoff_at,duration_minutes,teams(name,age_group,home_resource_id,central_venue_name)")
          .in("team_id", teamIds)
          .eq("status", "scheduled")
          .gte("kickoff_at", new Date().toISOString())
          .order("kickoff_at")
          .limit(30),
        supabase.from("teams").select("id,home_resource_id").in("id", teamIds),
      ]);
      const pitchIds = Array.from(
        new Set(
          (teamRows ?? [])
            .map((row) => row.home_resource_id)
            .filter((value): value is string => !!value),
        ),
      );
      const { data: pitchRows } = pitchIds.length
        ? await supabase.from("resources").select("id,name,address").in("id", pitchIds)
        : { data: [] };
      const pitchById = new Map((pitchRows ?? []).map((row) => [row.id, row]));

      postFixtures = (fixtureRows ?? []).map((fixture) => {
        const team = fixture.teams;
        const rules = faFormatFor(team?.age_group ?? null);
        const pitch = team?.home_resource_id ? pitchById.get(team.home_resource_id) : undefined;
        const local = instantToLocal(fixture.kickoff_at);
        return {
          id: fixture.id,
          label: `${team?.name ?? "Team"} v ${fixture.opponent} (${team?.age_group ?? "age group?"})`,
          durationText: `${fixture.duration_minutes} mins`,
          formatText: rules?.format ?? "",
          locationText: fixture.is_home
            ? pitch?.address ?? pitch?.name ?? team?.central_venue_name ?? ""
            : "",
          kickoffDate: local.date,
          kickoffTime: local.time,
        };
      });
    }
  }

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
          <div className="flex flex-wrap items-center gap-x-4">
            {data.canManageGroup && (
              <Link
                href={`/groups/${data.conversation.id}`}
                className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
              >
                <Settings className="h-4 w-4" /> Group settings
              </Link>
            )}
            {teamHref && (
              <Link
                href={teamHref}
                className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
              >
                Team page
              </Link>
            )}
            <Link
              href="/messages"
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
            >
              <ChevronLeft className="h-4 w-4" /> All messages
            </Link>
          </div>
        }
      />

      <div className="max-w-3xl p-4 lg:p-6">
        <ThreadPanel data={data} postFixtures={postFixtures} />
      </div>
    </>
  );
}
