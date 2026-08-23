"use client";

/**
 * The live half of a thread (PLAN.md P5.4): realtime delivery, read receipts,
 * the typing indicator and the composer.
 *
 * The browser client is the user's own client, so Realtime applies the same
 * participant-scoped RLS as the server read did — a subscription cannot leak a
 * conversation the reader is not in.
 */

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Loader2, Send, Trash2 } from "lucide-react";

import { Textarea } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";

import { deleteMessage, markRead, reportMessage, sendMessage, type ActionState } from "../actions";

export type ThreadMessage = {
  id: string;
  body: string;
  created_at: string;
  sender_person_id: string;
  deleted_at: string | null;
  redacted_at: string | null;
};

const EMPTY: ActionState = {};
/** How long a "…is typing" stays on screen after the last keystroke we heard. */
const TYPING_TTL_MS = 4000;
/** Backstop refresh, used only when the Realtime channel is not connected. */
const POLL_MS = 15000;

function timeLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function ThreadClient({
  conversationId,
  myPersonId,
  myName,
  initialMessages,
  names,
  canPost,
  readOnlyNotice,
}: {
  conversationId: string;
  myPersonId: string;
  myName: string;
  initialMessages: ThreadMessage[];
  names: Record<string, string>;
  canPost: boolean;
  readOnlyNotice: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [live, setLive] = useState<ThreadMessage[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [sendState, sendAction, sending] = useActionState(sendMessage, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteMessage, EMPTY);
  const [reportState, reportAction] = useActionState(reportMessage, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const typingSentAt = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => {
    const byId = new Map<string, ThreadMessage>();
    for (const m of initialMessages) byId.set(m.id, m);
    for (const m of live) byId.set(m.id, m);
    return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [initialMessages, live]);

  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : null;

  // Read receipt: after render, and again whenever the last message changes.
  useEffect(() => {
    if (!lastId) return;
    void markRead(conversationId, lastId);
  }, [conversationId, lastId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  // Live messages. RLS applies to the subscription exactly as it does to a read.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as ThreadMessage | null;
          if (!row?.id) return;
          setLive((prev) => [...prev.filter((m) => m.id !== row.id), row]);
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId]);

  // If Realtime is not available (the publication has to include `messages`),
  // fall back to a slow refresh rather than showing a thread that never moves.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [connected, router]);

  // Typing: broadcast only, never stored (P5.1 §6).
  const typingChannel = useMemo(
    () => supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } }),
    [supabase, conversationId],
  );

  useEffect(() => {
    typingChannel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const who = String((payload as { name?: string })?.name ?? "Someone");
        setTyping((prev) => ({ ...prev, [who]: Date.now() }));
      })
      .subscribe();
    const sweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, at]) => now - at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => {
      clearInterval(sweep);
      void supabase.removeChannel(typingChannel);
    };
  }, [supabase, typingChannel]);

  const announceTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < 2000) return;
    typingSentAt.current = now;
    void typingChannel.send({ type: "broadcast", event: "typing", payload: { name: myName } });
  }, [typingChannel, myName]);

  // A successful send clears the box; the message itself arrives over Realtime,
  // or on the refresh below when Realtime is not connected. The first render is
  // not a send, so it is skipped.
  const sentOnce = useRef(false);
  useEffect(() => {
    if (sending) {
      sentOnce.current = true;
      return;
    }
    if (!sentOnce.current || sendState.error) return;
    formRef.current?.reset();
    if (!connected) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendState, sending]);

  const typingNames = Object.keys(typing);

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        {messages.length === 0 && (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No messages yet.
          </p>
        )}

        {messages.map((message) => {
          const mine = message.sender_person_id === myPersonId;
          const who = names[message.sender_person_id] ?? "Club member";
          return (
            <div key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[85%] rounded-lg border px-3 py-2 text-sm " +
                  (mine ? "bg-primary/10 border-primary/20" : "bg-card")
                }
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{mine ? "You" : who}</span>
                  <span className="text-[11px] text-muted-foreground">{timeLabel(message.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {message.deleted_at ? (
                    <span className="italic text-muted-foreground">Message deleted</span>
                  ) : message.redacted_at ? (
                    <span className="italic text-muted-foreground">
                      [redacted by the safeguarding lead]
                    </span>
                  ) : (
                    message.body
                  )}
                </p>

                {!message.deleted_at && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                    {mine && (
                      <form action={deleteAction}>
                        <input type="hidden" name="message_id" value={message.id} />
                        <input type="hidden" name="conversation_id" value={conversationId} />
                        <button type="submit" className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </form>
                    )}
                    <details>
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
                        <Flag className="h-3 w-3" /> Report
                      </summary>
                      <form action={reportAction} className="mt-2 space-y-2">
                        <input type="hidden" name="message_id" value={message.id} />
                        <Textarea
                          name="reason"
                          required
                          rows={2}
                          placeholder="What is the concern? This opens a safeguarding case."
                          className="text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-secondary"
                        >
                          Send report
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {deleteState.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteState.error}
        </p>
      )}
      {reportState.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {reportState.error}
        </p>
      )}
      {reportState.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {reportState.notice}
        </p>
      )}

      <p className="h-4 text-xs text-muted-foreground">
        {typingNames.length > 0 &&
          `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`}
      </p>

      {readOnlyNotice ? (
        <p className="rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{readOnlyNotice}</p>
      ) : canPost ? (
        <form ref={formRef} action={sendAction} className="space-y-2">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <Textarea
            name="body"
            rows={3}
            required
            placeholder="Write a message…"
            onChange={announceTyping}
          />
          {sendState.error && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {sendState.error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {connected ? "Live" : "Reconnecting — messages refresh every few seconds"}
            </span>
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
