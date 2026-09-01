import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight, MessagesSquare, PenLine, Pin } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
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
 *
 * On a phone the same three things are re-stacked into the mobile design's
 * "Club lobby" artboard: the pinned notice leads as an accent card, the week
 * follows as coloured rows, then the rest of the board. The desktop two-column
 * layout is kept whole for lg+. The artboard's "Lend a hand" card has no
 * volunteer table behind it, so it is not drawn.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Club lobby" };

const DAY_MS = 86_400_000;

type LobbyPost = Database["public"]["Functions"]["club_lobby_posts"]["Returns"][number];

function outcome(isHome: boolean, home: number, away: number): { label: string; tone: string } {
  const ours = isHome ? home : away;
  const theirs = isHome ? away : home;
  if (ours > theirs) return { label: `W ${ours}–${theirs}`, tone: "text-emerald-700" };
  if (ours < theirs) return { label: `L ${ours}–${theirs}`, tone: "text-destructive" };
  return { label: `D ${ours}–${theirs}`, tone: "text-muted-foreground" };
}

/** The event's colour bar — the same three tones on both layouts. */
function eventBar(type: string): string {
  if (type === "social") return "bg-emerald-600";
  if (type === "practice") return "bg-primary";
  return "bg-amber-600";
}

/**
 * A board post as the artboard draws it on a phone: eyebrow, author · date,
 * headline, body, then the read and reply counts. The pinned one wears the
 * accent border.
 */
function PhonePostCard({ post }: { post: LobbyPost }) {
  return (
    <Link
      href={`/lobby/${post.post_id}`}
      className={
        "block rounded-xl border bg-card px-4 py-3.5 " +
        (post.pinned ? "border-accent/30" : "")
      }
    >
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {post.pinned ? (
          <span className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
            Pinned
          </span>
        ) : null}
        <span className="text-[11.5px] leading-none text-muted-foreground">
          {post.author_name} · {formatEventDate(post.created_at)}
        </span>
        {post.audience === "teams" && post.team_names ? (
          <Badge variant="outline">{post.team_names.join(", ")}</Badge>
        ) : null}
      </p>
      <p className="text-[15px] font-semibold leading-snug">{post.title}</p>
      <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
        {post.body}
      </p>
      <p className="mt-2.5 flex gap-3.5 text-[11.5px] leading-none text-muted-foreground">
        <span>
          {post.read_of !== null ? `${post.read_count} of ${post.read_of} read` : `${post.read_count} read`}
        </span>
        <span>
          {post.reply_count} {post.reply_count === 1 ? "reply" : "replies"}
        </span>
      </p>
    </Link>
  );
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
      // Adam, 2026-08-25: normal training and matches stay off the club lobby
      // — a parent or coach should not be shown other teams' diaries here.
      // Social/club happenings are the week feed; team diaries live on the
      // team pages and in Events.
      .eq("type", "social")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 7 * DAY_MS).toISOString())
      .order("starts_at")
      .limit(8),
  ]);

  const posts = postsResult.data ?? [];
  const results = resultsResult.data ?? [];
  const week = weekResult.data ?? [];
  // Adam, 2026-08-25: only admins post to the club noticeboard (coaches keep
  // their own team's lobby on the team page) — and only while wearing the
  // admin hat (Adam, later: "Coaches should not be able to post to the club
  // lobby, so remove that option - just admins"). An admin looking at the
  // lobby as a coach or a parent sees what a coach or a parent sees.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const canPost =
    (capabilities.isClubAdmin || capabilities.isCommittee) && (view === "admin" || view === null);
  // Presentation only: the phone leads with the pinned notice, so the board is
  // split for that layout. The desktop list below still shows every post.
  const pinnedPost = posts.find((post) => post.pinned);
  const unpinnedPosts = posts.filter((post) => post !== pinnedPost);

  // The joining workflow (Adam, 2026-08-25): somebody who has just signed up
  // lands here with nothing registered, and the club needs them to register
  // whoever plays. The prompt shows only until the household has its first
  // registration, and only in the member views — a coach or an admin looking
  // at the lobby is not being asked to join.
  const { data: myRegistrations } = await supabase.rpc("my_registrations");
  const memberView = view === "me" || view === "parent" || view === "player" || view === null;
  const showJoinPrompt = memberView && (myRegistrations ?? []).length === 0;

  return (
    <>
      <PageHeader
        title="Club lobby"
        subtitle="Everything happening across the club this week — one place everyone can see"
        action={
          canPost ? (
            <Link
              href="/lobby/new"
              className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}
            >
              <PenLine className="h-4 w-4" /> Post to the lobby
            </Link>
          ) : undefined
        }
      />

      {showJoinPrompt && (
        <div className="px-4 pt-4 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">New to the club?</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Add your children and any connected adults, then register whoever plays — yourself
                included.
              </p>
            </div>
            <Link
              href="/my-registrations"
              className={buttonVariants({ size: "sm" }) + " min-h-[44px] shrink-0 lg:min-h-0"}
            >
              Register a player
            </Link>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- the phone */}
      <div className="flex flex-col gap-3 p-4 lg:hidden">
        {postsResult.error ? (
          <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load the noticeboard: {postsResult.error.message}
          </p>
        ) : posts.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-5 text-sm text-muted-foreground">
            Nothing on the board yet
            {canPost ? " — start it with “Post to the lobby”." : "."}
          </p>
        ) : null}

        {pinnedPost ? <PhonePostCard post={pinnedPost} /> : null}

        <div className="overflow-hidden rounded-xl border bg-card">
          <p className="border-b px-4 py-3 text-[13px] font-semibold leading-none">On this week</p>
          {week.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              Nothing in the diary for the next seven days.
            </p>
          ) : (
            week.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="flex min-h-[44px] items-center gap-2.5 border-b px-4 py-3"
              >
                <span
                  className={"w-[3px] flex-none self-stretch rounded-full " + eventBar(event.type)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-snug">
                    {event.title} · {formatEventDate(event.starts_at)}{" "}
                    {formatEventTime(event.starts_at)}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                    {(event.teams as { name: string } | null)?.name ?? "Club"}
                  </span>
                </span>
                <ChevronRight className="h-[15px] w-[15px] flex-none text-muted-foreground" />
              </Link>
            ))
          )}
          <Link
            href="/events"
            className="flex min-h-[44px] items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground"
          >
            <CalendarDays className="h-3.5 w-3.5" /> The whole diary
          </Link>
        </div>

        {unpinnedPosts.map((post) => (
          <PhonePostCard key={post.post_id} post={post} />
        ))}

        {results.length > 0 ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <p className="border-b px-4 py-3 text-[13px] font-semibold leading-none">
              Last weekend across the club
            </p>
            {results.map((fixture) => {
              const score = outcome(
                fixture.is_home,
                fixture.home_score ?? 0,
                fixture.away_score ?? 0,
              );
              return (
                <div
                  key={fixture.id}
                  className="flex min-h-[44px] items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-snug">
                      {(fixture.teams as { name: string } | null)?.name ?? "Team"}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">
                      v {fixture.opponent}
                    </span>
                  </span>
                  <span className={`flex-none text-sm font-semibold ${score.tone}`}>
                    {score.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="rounded-xl border bg-card px-4 py-3.5">
          <p className="text-[13px] font-semibold leading-none">The board reaches everyone</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            A lobby post can be pushed onto every team&apos;s bulletin board, or aimed at just the
            teams and age groups it concerns — and wherever people meet it, replies come back to
            the one thread here.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <MessagesSquare className="h-3.5 w-3.5 flex-none" /> Team boards live on each team&apos;s
            page.
          </p>
        </div>
      </div>

      {/* --------------------------------------------- the desk, unchanged */}
      <div className="hidden gap-6 p-6 lg:grid lg:grid-cols-[3fr_2fr]">
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
                    <span className={"w-1 flex-none rounded-full " + eventBar(event.type)} />
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
                A lobby post can be pushed onto every team&apos;s lobby, or aimed at just
                the teams and age groups it concerns — and wherever people meet it, replies come
                back to the one thread here.
              </p>
              <p className="flex items-center gap-1 text-xs">
                <MessagesSquare className="h-3.5 w-3.5" /> Team lobbies live on each team&apos;s
                page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
