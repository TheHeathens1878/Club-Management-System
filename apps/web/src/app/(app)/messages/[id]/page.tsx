import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Settings } from "lucide-react";


import { PageHeader } from "@/components/page-header";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { instantToLocal } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";
import { createClient } from "@/lib/supabase/server";

import { type FixtureOption } from "./match-post-composer";
import { ParticipantsButton } from "./participants-button";
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
          .select("id,team_id,opponent,is_home,kickoff_at,duration_minutes,teams(name,age_group,home_resource_id,central_venue_name,match_halves,half_length_minutes)")
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
        // Length of game is PLAYING time (Adam, 2026-08-25: "just playing time
        // and not half time"): the team's halves × half length when the club
        // has set them, else the FA table's "N mins each way" doubled. The
        // fixture's duration_minutes includes the interval and is the last
        // resort only.
        const halves = team?.match_halves ?? 2;
        const eachWay =
          team?.half_length_minutes ??
          (rules ? Number(/^(\d+)\s*mins each way/.exec(rules.matchLength)?.[1]) : NaN);
        const playing = Number.isFinite(eachWay) && eachWay ? halves * eachWay : null;
        return {
          id: fixture.id,
          label: `${team?.name ?? "Team"} v ${fixture.opponent} (${team?.age_group ?? "age group?"})`,
          durationText: playing
            ? `${playing} mins (${halves} × ${eachWay})`
            : `${fixture.duration_minutes} mins`,
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
            {/* Who is in here, on demand — the list used to sit above the
                first message and, on a phone, pushed the conversation off the
                screen (Adam, 2026-08-25). */}
            <ParticipantsButton
              participants={data.participants.map((p) => ({
                personId: p.person_id,
                name:
                  p.person_id === data.personId
                    ? "You"
                    : (data.nameMap[p.person_id] ?? data.unnamedLabel),
                isSelf: p.person_id === data.personId,
                left: p.left_at !== null,
              }))}
              canOpenContacts={isCommittee(session.profile?.role)}
            />
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
