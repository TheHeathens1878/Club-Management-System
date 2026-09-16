import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBookingDateShort } from "@/lib/booking-time";
import type { PitchBookingItem } from "@/lib/pitch-booking";

import { BoardPanel, type BoardPost } from "./board-panel";
import type { loadThread } from "../../messages/[id]/thread-data";
import { ThreadPanel } from "../../messages/[id]/thread-panel";

/**
 * The team's two conversations, drawn (P8.7b).
 *
 * The bulletin board and the team chat are EXACTLY what they were — this file
 * is a move, not a redesign. They came out of `page.tsx` so that the page can
 * be read as "here is what each tab is" rather than as four hundred lines of
 * chat bubbles with the tab logic threaded through them.
 *
 * `BoardPanel` and `ThreadPanel` keep their props, their server actions and
 * the participant policies that decide whether there is a room to show at
 * all: a committee member who is not in the room is told so rather than
 * silently reading it (SG-9 — oversight lives in /safeguarding).
 */

type ThreadData = Awaited<ReturnType<typeof loadThread>>;

/** "AW" — two initials, for somebody with no photograph on the preview. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("en-GB") ?? "")
    .join("");
}

function chatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** The last three things said, and how many of them are new to this reader. */
function chatTail(thread: ThreadData): {
  messages: NonNullable<ThreadData>["messages"];
  unread: number;
} {
  if (!thread) return { messages: [], unread: 0 };
  const messages = thread.messages.filter((message) => !message.deleted_at).slice(-3);
  const lastRead = thread.myLive?.last_read_message_id ?? null;
  const index = lastRead ? thread.messages.findIndex((message) => message.id === lastRead) : -1;
  const unread = index >= 0 ? thread.messages.length - index - 1 : thread.messages.length;
  return { messages, unread };
}

/** The Communications tab: the board on the left, the chat on the right. */
export function CommunicationsTab({
  team,
  boardPosts,
  threadData,
  staffTools,
  glancePlayers,
  glanceNextSlot,
}: {
  team: { id: string };
  boardPosts: BoardPost[];
  threadData: ThreadData;
  staffTools: boolean;
  glancePlayers: number;
  glanceNextSlot: PitchBookingItem | null;
}) {
  return (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Team Lobby</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Visible to squad, parents and staff. A post marked Club-wide came from the club
                  lobby — replies to it belong on the club post, so its link takes you there.
                </p>
              </CardHeader>
              <CardContent>
                <BoardPanel teamId={team.id} posts={boardPosts} canPost={staffTools} />
              </CardContent>
            </Card>

            <div className="space-y-6">
              {threadData ? (
                <ThreadPanel data={threadData} showLeave={false} />
              ) : (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    This team&apos;s chat room isn&apos;t open to you. Players, their parents and
                    the team&apos;s staff are added automatically when they join the team — if
                    that&apos;s you and you still can&apos;t see it, ask a club administrator.
                  </CardContent>
                </Card>
              )}

              {staffTools && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Team at a glance</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Squad</dt>
                      <dd className="font-medium">
                        {glancePlayers} {glancePlayers === 1 ? "player" : "players"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Next pitch slot</dt>
                      <dd className="text-right font-medium">
                        {glanceNextSlot ? (
                          <Link
                            href={`/teams/${team.id}?tab=training`}
                            className="underline underline-offset-2"
                          >
                            {formatBookingDateShort(glanceNextSlot.date)} ·{" "}
                            {glanceNextSlot.startTime}
                          </Link>
                        ) : (
                          "None booked"
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Board</dt>
                      <dd className="font-medium">
                        {boardPosts.length} {boardPosts.length === 1 ? "post" : "posts"}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
              )}
            </div>
          </div>
  );
}

/**
 * The Overview's right-hand column: the newest three board posts and the tail
 * of the chat, each a press away from the whole thing.
 */
export function TeamConversations({
  team,
  posts,
  thread,
}: {
  team: { id: string };
  posts: BoardPost[];
  thread: ThreadData;
}) {
  const overviewThread = thread;
  const { messages: chatMessages, unread: chatUnread } = chatTail(thread);
  const overviewPosts = posts;
  return (
    <>
                <Card className="overflow-hidden">
                  <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b py-4">
                    <CardTitle className="text-base">Team Lobby</CardTitle>
                    <Link
                      href={`/teams/${team.id}?tab=board`}
                      className="inline-flex min-h-[44px] items-center text-xs text-primary hover:underline lg:min-h-0"
                    >
                      All posts
                    </Link>
                  </CardHeader>
                  <CardContent className="p-0">
                    {overviewPosts.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-muted-foreground">
                        Nothing on the board yet.
                      </p>
                    ) : (
                      overviewPosts.map((post, index) => (
                        <div
                          key={post.postId}
                          className={
                            "px-4 py-3" +
                            (index > 0 ? " border-t" : "") +
                            (post.pinned ? " bg-primary/5" : "")
                          }
                        >
                          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {post.pinned && (
                              <span className="font-display text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                                Pinned
                              </span>
                            )}
                            {post.audience === "club" ? "Club-wide" : post.authorName}
                            {" · "}
                            {new Date(post.createdAt).toLocaleDateString("en-GB", {
                              timeZone: "Europe/London",
                              day: "numeric",
                              month: "short",
                            })}
                          </p>
                          <p className="mt-1 text-sm font-semibold">{post.title}</p>
                          {post.pinned && post.body && (
                            <p className="mt-1 line-clamp-3 max-w-[52ch] text-sm text-muted-foreground">
                              {post.body}
                            </p>
                          )}
                          <p className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
                            <span>
                              {post.readCount} of {post.readOf} read
                            </span>
                            <span>
                              {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
                            </span>
                          </p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {overviewThread && (
                  <Card className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4">
                      <CardTitle className="text-base">Team chat</CardTitle>
                      {chatUnread > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {chatUnread > 9 ? "9+" : chatUnread}
                        </span>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3 bg-secondary/30 p-4">
                      {chatMessages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No messages yet.</p>
                      ) : (
                        chatMessages.map((message) => {
                          const mine = message.sender_person_id === overviewThread.personId;
                          const senderName =
                            overviewThread.nameMap[message.sender_person_id] ??
                            overviewThread.unnamedLabel;
                          return (
                            <div
                              key={message.id}
                              className={"flex gap-2.5" + (mine ? " flex-row-reverse" : "")}
                            >
                              <span
                                className={
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                                  (mine
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground")
                                }
                              >
                                {initialsOf(senderName)}
                              </span>
                              <div className={"min-w-0" + (mine ? " text-right" : "")}>
                                <p className="text-[11px] text-muted-foreground">
                                  {senderName} · {chatTime(message.created_at)}
                                </p>
                                <p
                                  className={
                                    "mt-1 inline-block max-w-[38ch] rounded-lg px-3 py-2 text-left text-sm " +
                                    (mine
                                      ? "bg-foreground text-background"
                                      : "border bg-card")
                                  }
                                >
                                  {message.body}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <Link
                        href={`/teams/${team.id}?tab=board`}
                        className="flex min-h-[44px] items-center pt-1 text-xs text-primary hover:underline lg:block lg:min-h-0"
                      >
                        Open the chat
                      </Link>
                    </CardContent>
                  </Card>
                )}
    </>
  );
}
