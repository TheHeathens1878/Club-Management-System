"use client";

/**
 * The team bulletin board (spec §2.4 Communications / §3.2).
 *
 * Rendering rules straight from the spec: pinned first with the PINNED
 * eyebrow and tinted background and an inline Unpin for whoever may manage
 * it; a post pushed from the club lobby carries a grey Club-wide chip and a
 * read count with no reply count — its replies belong to the lobby post, so
 * the thread link goes there and that is the whole one-thread rule as the
 * reader experiences it. Team posts count reads as "N of M" where M is the
 * audience the database resolved (players plus staff, guardians standing in
 * for minors).
 *
 * Who may do what is the database's decision: the RPCs refuse and the refusal
 * is shown verbatim. `canPost` only decides whether the compose form is worth
 * rendering.
 */

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, MessageSquareText, Pin, PinOff, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

import {
  postToTeamBoard,
  replyToBoardPost,
  setBoardPostPinned,
  type BoardActionState,
} from "./board-actions";

export type BoardPost = {
  postId: string;
  title: string;
  body: string;
  /** "club" = pushed from the lobby (Club-wide chip, replies live there). */
  audience: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
  readCount: number;
  /** Audience size for team posts; null on a club-wide post ("N read"). */
  readOf: number | null;
  replyCount: number;
  canManage: boolean;
};

const EMPTY: BoardActionState = {};

function postStamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

function Feedback({ state }: { state: BoardActionState }) {
  if (state.error) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="break-words">{state.error}</span>
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> {state.notice}
      </p>
    );
  }
  return null;
}

function ReplyForm({ teamId, postId }: { teamId: string; postId: string }) {
  const [state, action, pending] = useActionState(replyToBoardPost, EMPTY);
  return (
    <form action={action} className="mt-2 space-y-1.5">
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="post_id" value={postId} />
      <div className="flex items-end gap-1.5">
        <Textarea
          name="body"
          rows={1}
          required
          placeholder="Reply…"
          className="min-h-9 flex-1 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending}
          className="min-h-[44px] lg:min-h-0"
        >
          <Send className="h-3.5 w-3.5" />
          {pending ? "…" : "Reply"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

function PinButton({ teamId, post }: { teamId: string; post: BoardPost }) {
  const [state, action, pending] = useActionState(setBoardPostPinned, EMPTY);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="post_id" value={post.postId} />
      <input type="hidden" name="pinned" value={post.pinned ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {post.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        {post.pinned ? "Unpin" : "Pin"}
      </button>
      {state.error && <span className="ml-1 text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

export function BoardPanel({
  teamId,
  posts,
  canPost,
}: {
  teamId: string;
  posts: BoardPost[];
  canPost: boolean;
}) {
  const [state, action, pending] = useActionState(postToTeamBoard, EMPTY);
  const [composing, setComposing] = useState(false);
  const [openReply, setOpenReply] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {canPost &&
        (composing ? (
          <form action={action} className="space-y-2 rounded-lg border border-dashed p-3">
            <input type="hidden" name="team_id" value={teamId} />
            <div className="space-y-1">
              <Label htmlFor={`board-title-${teamId}`}>Headline</Label>
              <Input id={`board-title-${teamId}`} name="title" required maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`board-body-${teamId}`}>Post</Label>
              <Textarea id={`board-body-${teamId}`} name="body" rows={3} required />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                <MessageSquareText className="h-4 w-4" />
                {pending ? "Posting…" : "Post to board"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </Button>
            </div>
            <Feedback state={state} />
          </form>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setComposing(true)}
            className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
          >
            <MessageSquareText className="h-4 w-4" /> Post to board
          </Button>
        ))}

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing on the board yet{canPost ? " — start it with the first post." : "."}
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => {
            const clubWide = post.audience === "club";
            return (
              <li
                key={post.postId}
                className={
                  "rounded-lg border p-3 " +
                  (post.pinned ? "border-accent/40 bg-accent/10" : "bg-card")
                }
              >
                {post.pinned && (
                  <p className="font-display text-[9px] font-medium uppercase tracking-[0.16em] text-accent">
                    Pinned
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{post.authorName}</span>
                  <span>· {postStamp(post.createdAt)}</span>
                  {clubWide && <Badge variant="muted">Club-wide</Badge>}
                </div>
                <p className="mt-1 font-semibold leading-snug">{post.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{post.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {post.readOf === null || clubWide
                      ? `${post.readCount} read`
                      : `${post.readCount} of ${post.readOf} read`}
                  </span>
                  {/* A pushed club post keeps its replies on the lobby thread —
                      no reply count here, just the way in. */}
                  {!clubWide && <span>{post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}</span>}
                  <Link
                    href={`/lobby/${post.postId}`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {clubWide ? "Reply on the club post" : "Open thread"}
                  </Link>
                  {!clubWide && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenReply((current) => (current === post.postId ? null : post.postId))
                      }
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {openReply === post.postId ? "Close reply" : "Reply"}
                    </button>
                  )}
                  {post.canManage && <PinButton teamId={teamId} post={post} />}
                </div>
                {openReply === post.postId && !clubWide && (
                  <ReplyForm teamId={teamId} postId={post.postId} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
