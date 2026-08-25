import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, MessagesSquare, PenLine, Pin } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";

/**
 * The Club Lobby (Adam, 2026-08-25 — the Club CRM design): "Everything
 * happening across the club this week — one place everyone can see."
 *
 *   · The club noticeboard: everyone reads, admins and coaches post. A post
 *     the caller is not in the audience of never comes back from
 *     `club_lobby_posts()` — targeting is the database's, not this page's.
 *   · Last weekend across the club: fixtures with scores from the last seven
 *     days, W/D/L at a glance.
 *   · On this week: the club's next seven days of events.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Club lobby" };

const DAY_MS = 86_400_000;

function outcome(isHome: boolean, home: number, away: number): { label: string; tone: string } {
  const ours = isHome ? home : away;
  const theirs = isHome ? away : home;
  if (ours > theirs) return { label: `W ${ours}–${theirs}`, tone: "text-emerald-700" };
  if (ours < theirs) return { label: `L ${ours}–${theirs}`, tone: "text-destructive" };
  return { label: `D ${ours}–${theirs}`, tone: "text-muted-foreground" };
}

export default async function LobbyPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const [supabase, capabilities] = await Promise.all([createClient(), getCapabilities()]);
  const now = Date.now();

  const [postsResult, resultsResult, weekResult] = await Promise.all([
    supabase.rpc("club_lobby_posts", { p_limit: 30 }),
    supabase
      .from("fixtures")
      .select("id,opponent,is_home,home_score,away_score,kickoff_at,teams(name)")
      .gte("kickoff_at", new Date(now - 7 * DAY_MS).toISOString())
      .lte("kickoff_at", new Date(now).toISOString())
      .not("home_score", "is", null)
      .order("kickoff_at", { ascending: false })
      .limit(12),
    supabase
      .from("events")
      .select("id,title,type,starts_at,teams(name)")
      .eq("status", "scheduled")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 7 * DAY_MS).toISOString())
      .order("starts_at")
      .limit(8),
  ]);

  const posts = postsResult.data ?? [];
  const results = resultsResult.data ?? [];
  const week = weekResult.data ?? [];
  const canPost = capabilities.isClubAdmin || capabilities.isCommittee || capabilities.isTeamStaff;

  return (
    <>
      <PageHeader
        title="Club lobby"
        subtitle="Everything happening across the club this week — one place everyone can see"
        action={
          canPost ? (
            <Link href="/lobby/new" className={buttonVariants({ size: "sm" })}>
              <PenLine className="h-4 w-4" /> Post to the lobby
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        {/* --------------------------------------------------- noticeboard */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-baseline justify-between space-y-0">
              <CardTitle className="text-base">Club noticeboard</CardTitle>
              <span className="text-xs text-muted-foreground">
                Everyone can read · admins and coaches can post
              </span>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {postsResult.error ? (
                <p className="px-5 py-4 text-sm text-destructive">
                  Could not load the noticeboard: {postsResult.error.message}
                </p>
              ) : posts.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Nothing on the board yet
                  {canPost ? " — start it with “Post to the lobby”." : "."}
                </p>
              ) : (
                posts.map((post) => (
                  <Link
                    key={post.post_id}
                    href={`/lobby/${post.post_id}`}
                    className={
                      "block px-5 py-4 transition hover:bg-secondary/50 " +
                      (post.pinned ? "bg-primary/5" : "")
                    }
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {post.pinned ? (
                        <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-primary">
                          <Pin className="h-3 w-3" /> Pinned
                        </span>
                      ) : null}
                      <span>
                        {post.author_name} · {formatEventDate(post.created_at)}
                      </span>
                      {post.audience === "teams" && post.team_names ? (
                        <Badge variant="outline">{post.team_names.join(", ")}</Badge>
                      ) : null}
                    </p>
                    <p className={"text-[15px] font-semibold " + (post.my_read ? "" : "text-foreground")}>
                      {post.title}
                    </p>
                    <p className="mt-1 line-clamp-2 max-w-prose text-sm text-muted-foreground">
                      {post.body}
                    </p>
                    <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
                      <span>
                        {post.read_of !== null
                          ? `${post.read_count} of ${post.read_of} read`
                          : `${post.read_count} read`}
                      </span>
                      <span>
                        {post.reply_count} {post.reply_count === 1 ? "reply" : "replies"}
                      </span>
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-baseline justify-between space-y-0">
              <CardTitle className="text-base">Last weekend across the club</CardTitle>
              <span className="text-xs text-muted-foreground">Results from FA Full-Time</span>
            </CardHeader>
            <CardContent className="p-0">
              {results.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  No results recorded in the last seven days.
                </p>
              ) : (
                <ul className="grid sm:grid-cols-2">
                  {results.map((fixture) => {
                    const score = outcome(
                      fixture.is_home,
                      fixture.home_score ?? 0,
                      fixture.away_score ?? 0,
                    );
                    return (
                      <li
                        key={fixture.id}
                        className="flex items-center justify-between gap-3 border-b px-5 py-3 text-sm sm:odd:border-r"
                      >
                        <span>
                          <span className="font-semibold">
                            {(fixture.teams as { name: string } | null)?.name ?? "Team"}
                          </span>
                          <br />
                          <span className="text-xs text-muted-foreground">v {fixture.opponent}</span>
                        </span>
                        <span className={`flex-none text-sm font-semibold ${score.tone}`}>
                          {score.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* --------------------------------------------------- the right rail */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">On this week</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {week.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Nothing in the diary for the next seven days.
                </p>
              ) : (
                week.map((event) => (
                  <Link
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="flex gap-3 px-5 py-3 transition hover:bg-secondary/50"
                  >
                    <span
                      className={
                        "w-1 flex-none rounded-full " +
                        (event.type === "social"
                          ? "bg-emerald-600"
                          : event.type === "practice"
                            ? "bg-primary"
                            : "bg-amber-600")
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold">
                        {event.title} · {formatEventDate(event.starts_at)}{" "}
                        {formatEventTime(event.starts_at)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {(event.teams as { name: string } | null)?.name ?? "Club"}
                      </span>
                    </span>
                  </Link>
                ))
              )}
              <p className="px-5 py-3">
                <Link
                  href="/events"
                  className="flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <CalendarDays className="h-3.5 w-3.5" /> The whole diary
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">The board reaches everyone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                A lobby post can be pushed onto every team&apos;s bulletin board, or aimed at just
                the teams and age groups it concerns — and wherever people meet it, replies come
                back to the one thread here.
              </p>
              <p className="flex items-center gap-1 text-xs">
                <MessagesSquare className="h-3.5 w-3.5" /> Team boards live on each team&apos;s
                page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
