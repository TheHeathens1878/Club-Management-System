import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Settings, Shield } from "lucide-react";


import { PageHeader } from "@/components/page-header";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";
import { createClient } from "@/lib/supabase/server";

import { InfoBoard, type BoardPostItem } from "./info-board";
import { LeaveButton } from "./leave-button";
import { type FixtureOption } from "./match-post-composer";
import { ParticipantsButton } from "./participants-button";
import { loadThread } from "./thread-data";
import { ThreadPanel } from "./thread-panel";

/** One header action on a phone: a 44px icon target; the labelled link at lg. */
const HEADER_LINK =
  "inline-flex h-11 w-11 items-center justify-center gap-1 rounded-full text-sm text-muted-foreground hover:bg-secondary lg:h-auto lg:min-h-0 lg:w-auto lg:rounded-none lg:hover:bg-transparent lg:hover:underline";

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
export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const { tab } = await searchParams;
  const data = await loadThread(id);
  if (!data) notFound();

  // The group's two tabs (Adam, 2026-09-04): the chat stays the default and
  // the board sits beside it. Only groups — a team room's board is its team
  // page, a DM and the announcements thread keep no board at all.
  const hasBoard = data.conversation.type === "group";
  const boardTab = hasBoard && tab === "info";
  let boardPosts: BoardPostItem[] = [];
  if (boardTab) {
    const supabase = await createClient();
    const { data: postRows } = await supabase
      .from("conversation_posts")
      .select("id,title,body,pinned,author_person_id,created_at")
      .eq("conversation_id", id)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    boardPosts = (postRows ?? []).map((row) => {
      const local = instantToLocal(row.created_at);
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        authorName:
          row.author_person_id === data.personId
            ? "You"
            : (data.nameMap[row.author_person_id] ?? data.unnamedLabel),
        postedAt: `${formatBookingDateShort(local.date)}, ${local.time}`,
        canManage: row.author_person_id === data.personId || data.canManageGroup,
      };
    });
  }

  // A member hat puts the committee extras away (Adam, 2026-09-02): a parent
  // reading a team room sees the names, not a link into every one of those
  // people's contact records.
  const memberHat = isMemberView(
    resolveRoleView(await getStoredRoleView(), await getCapabilities()),
  );

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
        compact
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
          /* On a phone these are icons on one row: four 44px targets fit
             beside a truncated title, where the labelled version wrapped onto
             a second 44px line and took a chunk of the conversation with it
             (Adam, 2026-09-01). Every label is still there for a screen
             reader, and comes back in full at lg. */
          <div className="flex shrink-0 items-center gap-0.5 lg:flex-wrap lg:gap-x-4">
            {/* Who is in here, on demand — the list used to sit above the
                first message and, on a phone, pushed the conversation off the
                screen (Adam, 2026-08-25). Leaving now lives in that panel
                too: it is an action about who is in the room, and as its own
                block under the composer it cost a whole row. */}
            <ParticipantsButton
              compact
              participants={data.participants.map((p) => ({
                personId: p.person_id,
                name:
                  p.person_id === data.personId
                    ? "You"
                    : (data.nameMap[p.person_id] ?? data.unnamedLabel),
                isSelf: p.person_id === data.personId,
                left: p.left_at !== null,
              }))}
              canOpenContacts={!memberHat && isCommittee(session.profile?.role)}
              footer={
                data.myLive && !data.conversation.closed_at ? (
                  <LeaveButton conversationId={data.conversation.id} />
                ) : null
              }
            />
            {data.canManageGroup && (
              <Link href={`/groups/${data.conversation.id}`} className={HEADER_LINK}>
                <Settings className="h-4 w-4" />
                <span className="sr-only lg:not-sr-only">Group settings</span>
              </Link>
            )}
            {teamHref && (
              <Link href={teamHref} className={HEADER_LINK}>
                <Shield className="h-4 w-4" />
                <span className="sr-only lg:not-sr-only">Team page</span>
              </Link>
            )}
            <Link href="/messages" className={HEADER_LINK}>
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only lg:not-sr-only">All messages</span>
            </Link>
          </div>
        }
      />

      {/* The thread is the page: below lg it fills what is left of the screen
          exactly (`.app-shell-fill`, globals.css) so the message list is the
          only thing that scrolls and it has a real bottom to reach. Above lg
          the class is inert and this is the block it always was. */}
      <div className="app-shell-fill flex max-w-3xl flex-col px-3 pt-3 lg:px-6 lg:pb-6 lg:pt-6">
        {hasBoard && (
          <div className="flex shrink-0 gap-2 pb-3">
            <Link
              href={`/messages/${id}`}
              className={
                "inline-flex min-h-[36px] items-center rounded-full px-4 text-xs font-semibold transition " +
                (!boardTab
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
              }
            >
              Chat
            </Link>
            <Link
              href={`/messages/${id}?tab=info`}
              className={
                "inline-flex min-h-[36px] items-center rounded-full px-4 text-xs font-semibold transition " +
                (boardTab
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
              }
            >
              Important information
            </Link>
          </div>
        )}
        {boardTab ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InfoBoard
              conversationId={id}
              posts={boardPosts}
              canPost={Boolean(data.myLive && !data.conversation.closed_at)}
            />
          </div>
        ) : (
          <ThreadPanel data={data} postFixtures={postFixtures} showLeave={false} fill />
        )}
      </div>
    </>
  );
}
