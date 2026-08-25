"use client";

/**
 * The one thread's reply box, and the author/admin controls. Wherever the post
 * was met — lobby or a team board — this is where every reply lands.
 */

import { useActionState, useRef } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { deletePost, replyToPost, setPostPinned, type LobbyActionState } from "../actions";

const EMPTY: LobbyActionState = {};

export function ReplyForm({ postId }: { postId: string }) {
  const [state, action, sending] = useActionState(replyToPost, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        action(formData);
        formRef.current?.reset();
      }}
      className="space-y-2"
    >
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="post_id" value={postId} />
      <textarea
        name="body"
        rows={2}
        required
        maxLength={2000}
        placeholder="Reply to the whole thread…"
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
      />
      <Button type="submit" size="sm" disabled={sending}>
        {sending ? "Sending…" : "Reply"}
      </Button>
    </form>
  );
}

export function PostControls({ postId, pinned }: { postId: string; pinned: boolean }) {
  const [pinState, pinAction, pinning] = useActionState(setPostPinned, EMPTY);
  const [, deleteAction, deleting] = useActionState(deletePost, EMPTY);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={pinAction}>
        <input type="hidden" name="post_id" value={postId} />
        <input type="hidden" name="pinned" value={pinned ? "false" : "true"} />
        <Button type="submit" size="sm" variant="outline" disabled={pinning}>
          {pinned ? (
            <>
              <PinOff className="h-4 w-4" /> Unpin
            </>
          ) : (
            <>
              <Pin className="h-4 w-4" /> Pin
            </>
          )}
        </Button>
      </form>
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (!window.confirm("Remove this post and its replies from every board?")) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="post_id" value={postId} />
        <Button type="submit" size="sm" variant="outline" disabled={deleting}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
      </form>
      {pinState.error ? <span className="text-xs text-destructive">{pinState.error}</span> : null}
    </div>
  );
}
