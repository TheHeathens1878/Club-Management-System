"use client";

/**
 * The Important information tab (Adam, 2026-09-04: "for groups, they need a
 * message board for important information but the chat should still be
 * prominent"). The chat is the default tab; this is the board beside it —
 * pinned posts first, a plain composer underneath, and the reassurance that
 * posting here rings the room (the chat message and the notifications are the
 * database's doing, not this component's).
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import {
  createConversationPost,
  deleteConversationPost,
  setConversationPostPinned,
  type BoardActionState,
} from "./board-actions";

export type BoardPostItem = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorName: string;
  /** "Mon 1 Sep, 18:04" — formatted by the server, London wall clock. */
  postedAt: string;
  /** The DB re-checks; this only decides whether to draw the buttons. */
  canManage: boolean;
};

const EMPTY: BoardActionState = {};

function Feedback({ state }: { state: BoardActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.notice) return <p className="text-sm text-emerald-700">{state.notice}</p>;
  return null;
}

function PostCard({ post, conversationId }: { post: BoardPostItem; conversationId: string }) {
  const router = useRouter();
  const [pinState, pinAction, pinning] = useActionState(setConversationPostPinned, EMPTY);
  const [delState, delAction, deleting] = useActionState(deleteConversationPost, EMPTY);

  const done = [pinState.notice, delState.notice].filter(Boolean).join("|");
  useEffect(() => {
    if (done !== "") router.refresh();
  }, [done, router]);

  return (
    <article className={"rounded-xl border bg-card p-4" + (post.pinned ? " border-primary/40" : "")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">
            {post.pinned && <Pin className="mr-1 inline h-3.5 w-3.5 text-primary" aria-label="Pinned" />}
            {post.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {post.authorName} · {post.postedAt}
          </p>
        </div>
        {post.canManage && (
          <span className="flex shrink-0 gap-1">
            <form action={pinAction}>
              <input type="hidden" name="post_id" value={post.id} />
              <input type="hidden" name="conversation_id" value={conversationId} />
              <input type="hidden" name="pinned" value={post.pinned ? "false" : "true"} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={pinning || deleting}
                aria-label={post.pinned ? `Unpin ${post.title}` : `Pin ${post.title}`}
              >
                {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </Button>
            </form>
            <form action={delAction}>
              <input type="hidden" name="post_id" value={post.id} />
              <input type="hidden" name="conversation_id" value={conversationId} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={pinning || deleting}
                aria-label={`Remove ${post.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </form>
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{post.body}</p>
      <Feedback state={pinState.error ? pinState : delState} />
    </article>
  );
}

export function InfoBoard({
  conversationId,
  posts,
  canPost,
}: {
  conversationId: string;
  posts: BoardPostItem[];
  /** An active participant in an open conversation; the DB re-checks. */
  canPost: boolean;
}) {
  const router = useRouter();
  const [state, action, posting] = useActionState(createConversationPost, EMPTY);

  useEffect(() => {
    if (state.notice) router.refresh();
  }, [state.notice, router]);

  return (
    <div className="space-y-3 pb-6">
      {posts.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing important yet. A post here stays put — it cannot scroll away like a chat
          message can.
        </p>
      ) : (
        posts.map((post) => (
          <PostCard key={post.id} post={post} conversationId={conversationId} />
        ))
      )}

      {canPost && (
        <form action={action} className="space-y-3 rounded-xl border bg-card p-4">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <div className="space-y-1.5">
            <Label htmlFor="board-title">Title</Label>
            <Input
              id="board-title"
              name="title"
              required
              maxLength={200}
              placeholder="e.g. Winter training times"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="board-body">The information</Label>
            <textarea
              id="board-body"
              name="body"
              required
              rows={4}
              maxLength={8000}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={posting}>
              {posting ? "Posting…" : "Post to the board"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Posting also drops a message in the chat and notifies everyone in the group.
            </p>
          </div>
          <Feedback state={state} />
        </form>
      )}
    </div>
  );
}
