"use client";

/**
 * The live half of a thread (PLAN.md P5.4), WhatsApp-style:
 * grouped bubbles with tails, day chips, sent/read ticks, reply-with-quote,
 * emoji reactions, photo attachments and optimistic sending.
 *
 * Enter does NOT send (Adam, 2026-08-25): it puts a new line in the box like
 * any other textarea, and the Send button is the only thing that posts. A
 * conversation this one can be — a team room, a room a young person is in — is
 * not a place for a message to leave by accident.
 *
 * The browser client is the user's own client, so Realtime and Storage apply
 * the same participant-scoped RLS as the server read did — a subscription
 * cannot leak a conversation the reader is not in, and an upload cannot land
 * outside a conversation the uploader is active in.
 *
 * Typing `@` opens a picker of the people actually in this conversation, and
 * choosing one writes `@First Last` into the box. Arrow keys move, Enter
 * chooses — and, because Enter never sends here, choosing a name is all Enter
 * can ever do — Escape closes, and on a phone the rows are 44px targets. Who
 * was really mentioned is settled on the server against the live participant
 * list; this picker is a convenience, not the authority.
 *
 * Safeguarding shape (P5.1/P5.2): deleted and redacted bodies render as
 * tombstones EVERYWHERE, quotes included, via `visibleBody()`; announcement
 * read-only and the SG-9 banner are handled by the server page; reporting a
 * message opens a real safeguarding case and stays one click away.
 */

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  Clock3,
  CornerUpLeft,
  Flag,
  ImagePlus,
  Loader2,
  MoreVertical,
  Send,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";

import { Textarea } from "@/components/ui/field";
import {
  applyMention,
  filterCandidates,
  findMentionQuery,
  splitMentions,
  type MentionCandidate,
  type MentionQuery,
} from "@/lib/mentions";
import { createClient } from "@/lib/supabase/client";

import {
  deleteMessage,
  markRead,
  openAttachmentMessage,
  reportMessage,
  sendMessage,
  toggleReaction,
  type ActionState,
} from "../actions";
import { clockLabel, dayKey, dayLabel, sameRun, visibleBody } from "./format";
import { MatchPostCard } from "./match-post-card";
import type { MatchPostView } from "./thread-data";

export type ThreadMessage = {
  id: string;
  body: string;
  created_at: string;
  sender_person_id: string;
  deleted_at: string | null;
  redacted_at: string | null;
  reply_to_id: string | null;
};

export type ThreadReaction = { id: string; message_id: string; person_id: string; emoji: string };

/** The identity of a reaction — never its row id, which an optimistic row invents. */
function sameReaction(a: ThreadReaction, b: ThreadReaction): boolean {
  return a.message_id === b.message_id && a.person_id === b.person_id && a.emoji === b.emoji;
}
export type ThreadAttachment = {
  id: string;
  message_id: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string | null;
};
export type ReaderRow = { person_id: string; last_read_message_id: string | null };

const EMPTY: ActionState = {};
const TYPING_TTL_MS = 4000;
const POLL_MS = 15000;
const PAGE_SIZE = 100;
const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type Pending = { id: string; body: string; created_at: string; reply_to_id: string | null };

export function ThreadClient({
  conversationId,
  conversationType,
  myPersonId,
  myName,
  myLastReadId,
  initialMessages,
  initialReactions,
  initialAttachments,
  initialReaders,
  hasEarlier,
  names,
  canPost,
  canReact,
  readOnlyNotice,
  mentionables = [],
  matchPosts = {},
  isReferee = false,
  isRefereesGroup = false,
  isAdmin = false,
}: {
  conversationId: string;
  conversationType: string;
  myPersonId: string;
  myName: string;
  myLastReadId: string | null;
  initialMessages: ThreadMessage[];
  initialReactions: ThreadReaction[];
  initialAttachments: ThreadAttachment[];
  initialReaders: ReaderRow[];
  hasEarlier: boolean;
  names: Record<string, string>;
  canPost: boolean;
  canReact: boolean;
  readOnlyNotice: string | null;
  /** Who `@` may name: the LIVE participants, minus yourself. */
  mentionables?: MentionCandidate[];
  /** The Referees group's game cards, keyed by message id. */
  matchPosts?: Record<string, MatchPostView>;
  isReferee?: boolean;
  /** The Referees group: games are requested through the form, not the chat. */
  isRefereesGroup?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [live, setLive] = useState<ThreadMessage[]>([]);
  const [earlier, setEarlier] = useState<ThreadMessage[]>([]);
  const [moreEarlier, setMoreEarlier] = useState(hasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [reactions, setReactions] = useState<ThreadReaction[]>(initialReactions);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>(initialAttachments);
  const [readers, setReaders] = useState<Record<string, string | null>>(
    () => Object.fromEntries(initialReaders.map((r) => [r.person_id, r.last_read_message_id])),
  );
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [connected, setConnected] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  /** Phone only: which message has its actions open (there is no hover). */
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  /** The half-typed `@…` under the caret, and which row of the picker is armed. */
  const [mentionSpan, setMentionSpan] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sendState, sendAction, sending] = useActionState(sendMessage, EMPTY);
  const [reportState, reportAction] = useActionState(reportMessage, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clientIdRef = useRef<string>(crypto.randomUUID());
  const typingSentAt = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // The message list: server window + pages loaded upward + realtime + pending.
  // ---------------------------------------------------------------------------
  const messages = useMemo(() => {
    const byId = new Map<string, ThreadMessage>();
    for (const m of earlier) byId.set(m.id, m);
    for (const m of initialMessages) byId.set(m.id, m);
    for (const m of live) byId.set(m.id, m);
    for (const p of pending) {
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          id: p.id,
          body: p.body,
          created_at: p.created_at,
          sender_person_id: myPersonId,
          deleted_at: null,
          redacted_at: null,
          reply_to_id: p.reply_to_id,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [earlier, initialMessages, live, pending, myPersonId]);

  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const confirmedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of earlier) ids.add(m.id);
    for (const m of initialMessages) ids.add(m.id);
    for (const m of live) ids.add(m.id);
    return ids;
  }, [earlier, initialMessages, live]);

  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : null;

  // The first message that was unread when the page opened — the divider.
  const firstUnreadId = useMemo(() => {
    if (!myLastReadId) return null;
    const lastRead = messageById.get(myLastReadId);
    if (!lastRead) return null;
    const after = messages.find(
      (m) => m.created_at > lastRead.created_at && m.sender_person_id !== myPersonId,
    );
    return after?.id ?? null;
    // Deliberately frozen to the load-time pointer:
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lastId || pending.some((p) => p.id === lastId)) return;
    void markRead(conversationId, lastId);
  }, [conversationId, lastId, pending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  // ---------------------------------------------------------------------------
  // Realtime: messages, read pointers, reactions, attachments. RLS scopes all.
  // ---------------------------------------------------------------------------
  const refetchExtras = useCallback(async () => {
    const ids = Array.from(new Set([...confirmedIds]));
    if (ids.length === 0) return;
    const [{ data: r }, { data: a }] = await Promise.all([
      supabase.from("message_reactions").select("id,message_id,person_id,emoji").in("message_id", ids),
      supabase
        .from("message_attachments")
        .select("id,message_id,storage_bucket,storage_path,content_type")
        .in("message_id", ids),
    ]);
    if (r) setReactions(r);
    if (a) setAttachments(a);
  }, [supabase, confirmedIds]);

  useEffect(() => {
    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as ThreadMessage | null;
          if (!row?.id) return;
          setLive((prev) => [...prev.filter((m) => m.id !== row.id), row]);
          setPending((prev) => prev.filter((p) => p.id !== row.id));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { person_id?: string; last_read_message_id?: string | null; left_at?: string | null };
          if (!row?.person_id || row.person_id === myPersonId) return;
          if (row.left_at) {
            setReaders((prev) => {
              const next = { ...prev };
              delete next[row.person_id!];
              return next;
            });
            return;
          }
          setReaders((prev) => ({ ...prev, [row.person_id!]: row.last_read_message_id ?? null }));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const row = payload.new as ThreadReaction | null;
          if (!row?.id || !confirmedIds.has(row.message_id)) return;
          // Adam, 2026-08-25: "when I post emojis it is doubling them up". The
          // optimistic row carries a temporary id, so matching on id alone let
          // the real row land beside it. One person, one emoji, one message —
          // that triple is the identity; the server row replaces the guess.
          setReactions((prev) => [...prev.filter((x) => !sameReaction(x, row)), row]);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        () => void refetchExtras(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_attachments" },
        (payload) => {
          const row = payload.new as ThreadAttachment | null;
          if (!row?.id || !confirmedIds.has(row.message_id)) return;
          setAttachments((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, myPersonId, confirmedIds, refetchExtras]);

  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [connected, router]);

  // ---------------------------------------------------------------------------
  // Typing: broadcast only, never stored (P5.1 §6). Keyed by person id.
  // ---------------------------------------------------------------------------
  const typingChannel = useMemo(
    () => supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } }),
    [supabase, conversationId],
  );

  useEffect(() => {
    typingChannel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { person_id?: string; name?: string };
        if (!p?.person_id || p.person_id === myPersonId) return;
        setTyping((prev) => ({ ...prev, [p.person_id!]: { name: p.name ?? "Someone", at: Date.now() } }));
      })
      .subscribe();
    const sweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => now - v.at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => {
      clearInterval(sweep);
      void supabase.removeChannel(typingChannel);
    };
  }, [supabase, typingChannel, myPersonId]);

  const announceTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < 2000) return;
    typingSentAt.current = now;
    void typingChannel.send({
      type: "broadcast",
      event: "typing",
      payload: { person_id: myPersonId, name: myName },
    });
  }, [typingChannel, myPersonId, myName]);

  // ---------------------------------------------------------------------------
  // Sending: optimistic bubble keyed by the same id the server will store.
  // ---------------------------------------------------------------------------
  const onComposerSubmit = useCallback(() => {
    const body = textRef.current?.value.trim() ?? "";
    if (!body) return;
    setActionError(null);
    setPending((prev) => [
      ...prev,
      {
        id: clientIdRef.current,
        body,
        created_at: new Date().toISOString(),
        reply_to_id: replyTo?.id ?? null,
      },
    ]);
  }, [replyTo]);

  const sentOnce = useRef(false);
  useEffect(() => {
    if (sending) {
      sentOnce.current = true;
      return;
    }
    if (!sentOnce.current) return;
    if (sendState.error) {
      // The optimistic bubble was wrong — take it back and say why.
      setPending((prev) => prev.filter((p) => p.id !== clientIdRef.current));
      setActionError(sendState.error);
      return;
    }
    clientIdRef.current = crypto.randomUUID();
    formRef.current?.reset();
    if (textRef.current) textRef.current.style.height = "auto";
    setReplyTo(null);
    if (!connected) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendState, sending]);

  const autoGrow = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // ---------------------------------------------------------------------------
  // @mentions in the composer.
  //
  // The textarea is uncontrolled (the form action reads its value at submit),
  // so the picker reads the caret out of the element and writes the chosen name
  // back into it. Only the *span* being typed lives in React state.
  // ---------------------------------------------------------------------------
  const MENTION_LIMIT = 6;
  const mentionMatches = useMemo(
    () => (mentionSpan ? filterCandidates(mentionables, mentionSpan.query).slice(0, MENTION_LIMIT) : []),
    [mentionSpan, mentionables],
  );

  const closeMentions = useCallback(() => {
    setMentionSpan(null);
    setMentionIndex(0);
  }, []);

  const syncMentions = useCallback(() => {
    const el = textRef.current;
    if (!el || mentionables.length === 0) return;
    const span = findMentionQuery(el.value, el.selectionStart ?? el.value.length);
    setMentionSpan(span);
    setMentionIndex(0);
  }, [mentionables.length]);

  const chooseMention = useCallback(
    (candidate: MentionCandidate) => {
      const el = textRef.current;
      if (!el || !mentionSpan) return;
      const next = applyMention(el.value, mentionSpan, candidate.name);
      el.value = next.text;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      closeMentions();
    },
    [mentionSpan, closeMentions],
  );

  /**
   * Enter chooses a name and NOTHING else. It cannot send: this is a textarea,
   * so Enter's own default is a new line, and Send is the only submit (Adam,
   * 2026-08-25). With the picker open we take that new line away and use the
   * key to pick; with it closed the new line is left exactly as it was.
   */
  const onComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!mentionSpan) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMentions();
        return;
      }
      if (mentionMatches.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        chooseMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)]!);
      }
    },
    [mentionSpan, mentionMatches, mentionIndex, chooseMention, closeMentions],
  );

  /**
   * Who a BUBBLE may show as mentioned: everyone the thread has a name for,
   * people who have since left included — an old message keeps naming whom it
   * named. The server decided long ago who was really mentioned; this only
   * decides where the emphasis goes.
   */
  const renderCandidates = useMemo<MentionCandidate[]>(
    () => Object.entries(names).map(([person_id, name]) => ({ person_id, name })),
    [names],
  );

  // ---------------------------------------------------------------------------
  // Reactions: optimistic toggle, server settles it.
  // ---------------------------------------------------------------------------
  const react = useCallback(
    (messageId: string, emoji: string) => {
      setActionError(null);
      setReactions((prev) => {
        const mine = prev.find(
          (r) => r.message_id === messageId && r.person_id === myPersonId && r.emoji === emoji,
        );
        if (mine) return prev.filter((r) => r.id !== mine.id);
        return [
          ...prev,
          { id: `optimistic-${crypto.randomUUID()}`, message_id: messageId, person_id: myPersonId, emoji },
        ];
      });
      void toggleReaction(conversationId, messageId, emoji).then((res) => {
        if (res.error) {
          setActionError(res.error);
          void refetchExtras();
        }
      });
    },
    [conversationId, myPersonId, refetchExtras],
  );

  // ---------------------------------------------------------------------------
  // Attachments: message row first, then the user's own storage client.
  // ---------------------------------------------------------------------------
  const onPickFile = useCallback(
    async (file: File) => {
      setActionError(null);
      if (!file.type.startsWith("image/")) {
        setActionError("Only images can be attached here for now.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setActionError("That image is over 20 MB — send something smaller.");
        return;
      }
      setUploading(true);
      try {
        const caption = textRef.current?.value.trim() ?? "";
        const opened = await openAttachmentMessage(conversationId, caption);
        if (opened.error || !opened.messageId) {
          setActionError(opened.error ?? "Could not start the photo message.");
          return;
        }
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_") || "photo";
        const path = `${conversationId}/${opened.messageId}/${safeName}`;
        const { error: upError } = await supabase.storage.from("attachments").upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upError) {
          setActionError(`Upload failed: ${upError.message}`);
          return;
        }
        const { error: rowError } = await supabase.from("message_attachments").insert({
          message_id: opened.messageId,
          storage_bucket: "attachments",
          storage_path: path,
          content_type: file.type,
          byte_size: file.size,
        });
        if (rowError) setActionError(rowError.message);
        formRef.current?.reset();
        if (textRef.current) textRef.current.style.height = "auto";
        if (!connected) router.refresh();
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [conversationId, supabase, connected, router],
  );

  // Load an earlier page (keyset on created_at).
  const loadEarlier = useCallback(async () => {
    const oldest = messages.find((m) => confirmedIds.has(m.id));
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const { data } = await supabase
        .from("messages")
        .select("id,body,created_at,sender_person_id,deleted_at,redacted_at,reply_to_id")
        .eq("conversation_id", conversationId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      const rows = (data ?? []) as ThreadMessage[];
      setEarlier((prev) => [...prev, ...rows]);
      setMoreEarlier(rows.length === PAGE_SIZE);
      if (rows.length > 0) {
        const ids = rows.map((m) => m.id);
        const [{ data: r }, { data: a }] = await Promise.all([
          supabase.from("message_reactions").select("id,message_id,person_id,emoji").in("message_id", ids),
          supabase
            .from("message_attachments")
            .select("id,message_id,storage_bucket,storage_path,content_type")
            .in("message_id", ids),
        ]);
        if (r) setReactions((prev) => [...prev.filter((x) => !r.some((y) => sameReaction(x, y))), ...r]);
        if (a) setAttachments((prev) => [...prev.filter((x) => !a.some((y) => y.id === x.id)), ...a]);
      }
    } finally {
      setLoadingEarlier(false);
    }
  }, [messages, confirmedIds, loadingEarlier, supabase, conversationId]);

  // ---------------------------------------------------------------------------
  // Derived per-message display data.
  // ---------------------------------------------------------------------------
  const otherIds = Object.keys(readers);
  const lastReadAt = useMemo(() => {
    const at: Record<string, string> = {};
    for (const [pid, mid] of Object.entries(readers)) {
      if (!mid) continue;
      const m = messageById.get(mid);
      if (m) at[pid] = m.created_at;
    }
    return at;
  }, [readers, messageById]);

  const readByAll = useCallback(
    (m: ThreadMessage) =>
      otherIds.length > 0 && otherIds.every((pid) => (lastReadAt[pid] ?? "") >= m.created_at),
    [otherIds, lastReadAt],
  );

  const reactionsFor = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; mine: boolean }>>();
    const seen = new Set<string>();
    for (const r of reactions) {
      // Count people, not rows — a stray duplicate can never show as two.
      const key = `${r.message_id} ${r.person_id} ${r.emoji}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const per = map.get(r.message_id) ?? new Map();
      const entry = per.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (r.person_id === myPersonId) entry.mine = true;
      per.set(r.emoji, entry);
      map.set(r.message_id, per);
    }
    return map;
  }, [reactions, myPersonId]);

  const attachmentsFor = useMemo(() => {
    const map = new Map<string, ThreadAttachment[]>();
    for (const a of attachments) {
      map.set(a.message_id, [...(map.get(a.message_id) ?? []), a]);
    }
    return map;
  }, [attachments]);

  const typingNames = Object.values(typing).map((t) => t.name);
  const showSenderNames = conversationType !== "dm";

  /**
   * React, reply, delete and — always — report to the safeguarding lead.
   *
   * The desk reveals these on hover in a chip beside the bubble. A phone has no
   * hover, so the same four render under the bubble as 44px targets: reporting
   * a message must stay one tap away on every viewport, which is why this is a
   * second rendering rather than a hover state nobody can reach.
   */
  const messageActions = (message: ThreadMessage, mine: boolean, touch: boolean) => {
    const shape = touch
      ? "flex h-11 w-11 items-center justify-center rounded-full border bg-card text-muted-foreground"
      : "rounded-full p-1 hover:bg-secondary";
    const glyph = touch ? "h-[18px] w-[18px] text-muted-foreground" : "h-3.5 w-3.5 text-muted-foreground";

    return (
      <div
        className={
          touch
            ? `mt-1 flex items-center gap-1.5 lg:hidden ${mine ? "justify-end" : "justify-start"}`
            : "absolute top-0 hidden items-center gap-0.5 rounded-full border bg-card px-1 py-0.5 shadow-sm lg:group-hover:flex " +
              (mine ? "right-full mr-1" : "left-full ml-1")
        }
      >
        {canReact && (
          <details className="relative">
            <summary
              className={`flex cursor-pointer list-none items-center ${shape}`}
              title="React"
            >
              <SmilePlus className={glyph} />
            </summary>
            <div
              className={`absolute z-20 mt-1 flex gap-1 rounded-full border bg-card p-1 shadow-md ${mine ? "right-0" : "left-0"} ${touch ? "bottom-full mb-1 mt-0" : ""}`}
            >
              {QUICK_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={
                    touch
                      ? "flex h-11 w-11 items-center justify-center rounded-full text-xl"
                      : "rounded-full p-0.5 text-base hover:bg-secondary"
                  }
                  onClick={(e) => {
                    react(message.id, emoji);
                    (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </details>
        )}
        {canPost && (
          <button
            type="button"
            className={shape}
            title="Reply"
            onClick={() => {
              setReplyTo(message);
              textRef.current?.focus();
            }}
          >
            <CornerUpLeft className={glyph} />
            {touch && <span className="sr-only">Reply</span>}
          </button>
        )}
        {mine && (
          <button
            type="button"
            className={shape}
            title="Delete for everyone (the record keeps a tombstone)"
            onClick={() => {
              const fd = new FormData();
              fd.set("message_id", message.id);
              fd.set("conversation_id", conversationId);
              void deleteMessage(EMPTY, fd).then((res) => {
                if (res.error) setActionError(res.error);
                else router.refresh();
              });
            }}
          >
            <Trash2 className={glyph} />
            {touch && <span className="sr-only">Delete</span>}
          </button>
        )}
        <button
          type="button"
          className={shape}
          title="Report to the safeguarding lead"
          onClick={() => setReportFor(reportFor === message.id ? null : message.id)}
        >
          <Flag className={glyph} />
          {touch && <span className="sr-only">Report to the safeguarding lead</span>}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-0.5">
        {moreEarlier && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingEarlier}
              className="inline-flex min-h-[44px] items-center rounded-full border bg-card px-4 text-xs text-muted-foreground hover:bg-secondary lg:min-h-0 lg:px-3 lg:py-1"
            >
              {loadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </p>
        )}

        {messages.map((message, i) => {
          const prev = i > 0 ? messages[i - 1]! : null;
          const next = i < messages.length - 1 ? messages[i + 1]! : null;
          const mine = message.sender_person_id === myPersonId;
          const isPending = !confirmedIds.has(message.id);
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(message.created_at);
          const firstOfRun = newDay || !prev || !sameRun(prev, message);
          const lastOfRun = !next || !sameRun(message, next) || dayKey(next.created_at) !== dayKey(message.created_at);
          const body = visibleBody(message);
          const quoted = message.reply_to_id ? messageById.get(message.reply_to_id) : undefined;
          const per = reactionsFor.get(message.id);
          const files = attachmentsFor.get(message.id) ?? [];

          return (
            <div key={message.id}>
              {newDay && (
                <div className="flex justify-center py-3">
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground shadow-sm">
                    {dayLabel(message.created_at)}
                  </span>
                </div>
              )}
              {message.id === firstUnreadId && (
                <div className="flex items-center gap-3 py-2" aria-label="Unread messages">
                  <span className="h-px flex-1 bg-primary/30" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-primary">Unread</span>
                  <span className="h-px flex-1 bg-primary/30" />
                </div>
              )}

              <div className={`group flex ${mine ? "justify-end" : "justify-start"} ${firstOfRun ? "pt-2" : "pt-0.5"}`}>
                {mine && body.state === "ok" && !isPending && (
                  <MessageKebab
                    open={actionsFor === message.id}
                    onToggle={() => setActionsFor(actionsFor === message.id ? null : message.id)}
                  />
                )}
                <div className={`relative max-w-[75%] min-w-0 ${mine ? "items-end" : "items-start"}`}>
                  <div
                    className={
                      "rounded-2xl border px-3 py-1.5 text-sm shadow-sm " +
                      (mine ? "bg-primary/15 border-primary/20 " : "bg-card ") +
                      (lastOfRun ? (mine ? "rounded-br-md" : "rounded-bl-md") : "")
                    }
                  >
                    {showSenderNames && !mine && firstOfRun && (
                      <p className="text-xs font-semibold text-primary">
                        {names[message.sender_person_id] ?? "Club member"}
                      </p>
                    )}

                    {quoted !== undefined && (
                      <button
                        type="button"
                        onClick={() =>
                          document.getElementById(`msg-${quoted.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
                        }
                        className="mt-0.5 mb-1 block w-full rounded-md border-l-2 border-primary/60 bg-secondary/60 px-2 py-1 text-left"
                      >
                        <span className="block text-[11px] font-medium text-primary">
                          {quoted.sender_person_id === myPersonId
                            ? "You"
                            : (names[quoted.sender_person_id] ?? "Club member")}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {visibleBody(quoted).text}
                        </span>
                      </button>
                    )}
                    {message.reply_to_id && quoted === undefined && (
                      <span className="mt-0.5 mb-1 block rounded-md border-l-2 border-muted bg-secondary/60 px-2 py-1 text-xs italic text-muted-foreground">
                        Earlier message
                      </span>
                    )}

                    {/* A deleted or redacted message keeps none of its
                        pictures: the tombstone is the whole message. The
                        policies refuse the file too, so this is the tidy
                        rendering of a refusal, not the enforcement of it. */}
                    {body.state === "ok" &&
                      files.map((file) => <AttachmentImage key={file.id} attachment={file} />)}

                    {/* A referee game card replaces the body it fell back to —
                        same tombstone rule as the attachments above. */}
                    {body.state === "ok" && matchPosts[message.id] !== undefined ? (
                      <span id={`msg-${message.id}`} className="block">
                        <MatchPostCard
                          post={matchPosts[message.id]!}
                          isReferee={isReferee}
                          myPersonId={myPersonId}
                          isAdmin={isAdmin}
                        />
                      </span>
                    ) : (
                      <p id={`msg-${message.id}`} className="whitespace-pre-wrap break-words">
                        {body.state === "ok" ? (
                          <MentionText
                            text={body.text}
                            candidates={renderCandidates}
                            myPersonId={myPersonId}
                          />
                        ) : (
                          <span className="italic text-muted-foreground">{body.text}</span>
                        )}
                      </p>
                    )}

                    <span className="float-right ml-2 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {clockLabel(message.created_at)}
                      {mine &&
                        body.state === "ok" &&
                        (isPending ? (
                          <Clock3 className="h-3 w-3" aria-label="Sending" />
                        ) : readByAll(message) ? (
                          <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Read by everyone" />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-label="Sent" />
                        ))}
                    </span>
                  </div>

                  {per && per.size > 0 && (
                    <div className={`-mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"} relative z-10`}>
                      {Array.from(per.entries()).map(([emoji, info]) => (
                        <button
                          key={emoji}
                          type="button"
                          disabled={!canReact}
                          onClick={() => react(message.id, emoji)}
                          className={
                            "rounded-full border bg-card px-1.5 py-0.5 text-xs shadow-sm " +
                            (info.mine ? "border-primary/50 bg-primary/10" : "")
                          }
                          title={info.mine ? "Tap to remove your reaction" : "React too"}
                        >
                          {emoji}
                          {info.count > 1 && <span className="ml-0.5 text-[10px]">{info.count}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Hover actions on the desk; on a phone the kebab beside the
                      bubble opens the same set. */}
                  {body.state === "ok" && !isPending && (
                    <>
                      {messageActions(message, mine, false)}
                      {actionsFor === message.id && messageActions(message, mine, true)}
                    </>
                  )}

                  {reportFor === message.id && (
                    <form
                      action={reportAction}
                      className="mt-1 space-y-2 rounded-lg border bg-card p-2 shadow-sm"
                      onSubmit={() => setReportFor(null)}
                    >
                      <input type="hidden" name="message_id" value={message.id} />
                      <Textarea
                        name="reason"
                        required
                        rows={2}
                        placeholder="What is the concern? This opens a safeguarding case."
                        className="text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="inline-flex min-h-[44px] items-center rounded-md border px-3 text-[11px] font-medium hover:bg-secondary lg:min-h-0 lg:px-2 lg:py-1"
                        >
                          Send report
                        </button>
                        <button
                          type="button"
                          onClick={() => setReportFor(null)}
                          className="inline-flex min-h-[44px] items-center rounded-md px-3 text-[11px] text-muted-foreground hover:bg-secondary lg:min-h-0 lg:px-2 lg:py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
                {!mine && body.state === "ok" && !isPending && (
                  <MessageKebab
                    open={actionsFor === message.id}
                    onToggle={() => setActionsFor(actionsFor === message.id ? null : message.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {actionError && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
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
        /* On a phone the composer is pinned to the bottom of the thread, clear
           of the tab bar and its home-indicator inset; on the desk it is the
           last block of the panel, exactly as it was. */
        <form
          ref={formRef}
          action={sendAction}
          onSubmit={onComposerSubmit}
          className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 space-y-2 rounded-t-xl border-t bg-background pb-2 pt-2 lg:static lg:rounded-none lg:border-t-0 lg:pb-0 lg:pt-0"
        >
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input type="hidden" name="client_id" value={clientIdRef.current} />
          <input type="hidden" name="reply_to" value={replyTo?.id ?? ""} />

          {replyTo && (
            <div className="flex items-start gap-2 rounded-lg border-l-4 border-primary/60 bg-secondary/60 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-primary">
                  Replying to{" "}
                  {replyTo.sender_person_id === myPersonId
                    ? "yourself"
                    : (names[replyTo.sender_person_id] ?? "Club member")}
                </p>
                <p className="truncate text-muted-foreground">{visibleBody(replyTo).text}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Adam, 2026-08-25: the chat is not the way to ask for a referee —
              the structured Post a game form above is, and it says so where
              the eye lands before typing. */}
          {isRefereesGroup && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              If you want to request a referee, use the form above.
            </p>
          )}

          <div className="relative flex items-end gap-2">
            {mentionSpan && mentionMatches.length > 0 && (
              /* Above the box, never over the thread's last line: the member is
                 looking at what they are typing. Rows are 44px so a thumb can
                 land on one; the armed row is named by aria-activedescendant so
                 a screen reader hears the same arrow-key move a sighted user
                 sees. */
              <ul
                id="mention-picker"
                role="listbox"
                aria-label="Mention someone in this conversation"
                className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border bg-card py-1 shadow-lg"
              >
                {mentionMatches.map((candidate, i) => (
                  <li key={candidate.person_id}>
                    <button
                      id={`mention-option-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === mentionIndex}
                      // Keep the caret in the box: without this the mousedown
                      // blurs the textarea and the span we are about to replace
                      // is gone before the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseMention(candidate)}
                      onMouseEnter={() => setMentionIndex(i)}
                      className={
                        "flex min-h-[44px] w-full items-center px-3 text-left text-sm " +
                        (i === mentionIndex ? "bg-secondary font-semibold" : "hover:bg-secondary/60")
                      }
                    >
                      <span className="mr-1 text-muted-foreground">@</span>
                      {candidate.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border text-muted-foreground hover:bg-secondary lg:h-9 lg:w-9"
              title="Attach a photo"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickFile(file);
                }}
              />
            </label>
            <Textarea
              ref={textRef}
              name="body"
              rows={1}
              required
              placeholder={
                mentionables.length > 0 ? "Write a message… (@ to mention someone)" : "Write a message…"
              }
              className="max-h-40 min-h-[44px] flex-1 resize-none lg:min-h-[2.25rem]"
              role={mentionSpan && mentionMatches.length > 0 ? "combobox" : undefined}
              aria-expanded={mentionSpan !== null && mentionMatches.length > 0}
              aria-controls={mentionSpan && mentionMatches.length > 0 ? "mention-picker" : undefined}
              aria-activedescendant={
                mentionSpan && mentionMatches.length > 0 ? `mention-option-${mentionIndex}` : undefined
              }
              aria-autocomplete="list"
              onChange={() => {
                announceTyping();
                syncMentions();
              }}
              onInput={autoGrow}
              onKeyDown={onComposerKeyDown}
              onKeyUp={syncMentions}
              onClick={syncMentions}
              onBlur={closeMentions}
            />
            <button
              type="submit"
              disabled={sending || uploading}
              aria-label="Send"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 lg:h-9 lg:w-9"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Enter starts a new line — Send is the only thing that sends ·{" "}
            {connected ? "Live" : "Reconnecting — messages refresh every few seconds"}
          </p>
        </form>
      ) : null}
    </div>
  );
}

/**
 * A message body with its `@mentions` picked out.
 *
 * Emphasis, not a link. A conversation can name someone whose member page the
 * reader is not allowed to open, and a mention that turned into a route would
 * be telling every reader that such a page exists. The chip is bold with a
 * tinted pill — weight and shape carry it, so it is not a colour-only signal —
 * and being mentioned YOURSELF is marked out further, and said aloud for a
 * screen reader, because that is the one a member is scanning for.
 */
function MentionText({
  text,
  candidates,
  myPersonId,
}: {
  text: string;
  candidates: MentionCandidate[];
  myPersonId: string;
}) {
  const segments = useMemo(() => splitMentions(text, candidates), [text, candidates]);
  if (segments.length === 1 && segments[0]!.person_id === null) return <>{text}</>;
  return (
    <>
      {segments.map((segment, i) =>
        segment.person_id === null ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <strong
            key={i}
            className={
              "rounded px-1 font-semibold " +
              (segment.person_id === myPersonId
                ? "bg-primary/25 text-primary underline decoration-primary/60 underline-offset-2"
                : "bg-primary/10 text-primary")
            }
          >
            {segment.text}
            {segment.person_id === myPersonId && <span className="sr-only"> (this mentions you)</span>}
          </strong>
        ),
      )}
    </>
  );
}

/**
 * The phone's way in to a message's actions — react, reply, delete, and report
 * to the safeguarding lead. It exists because the desk's set is revealed by
 * hover, and a touch screen never hovers; nothing about what the actions do
 * changes with the viewport.
 */
function MessageKebab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-11 w-11 flex-none items-center justify-center self-end text-muted-foreground lg:hidden"
    >
      <MoreVertical className="h-4 w-4" />
      <span className="sr-only">{open ? "Hide message actions" : "Message actions"}</span>
    </button>
  );
}

/** An image attachment, resolved to a short-lived signed URL on the reader's own client. */
function AttachmentImage({ attachment }: { attachment: ThreadAttachment }) {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.storage
      .from(attachment.storage_bucket)
      .createSignedUrl(attachment.storage_path, 300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, attachment.storage_bucket, attachment.storage_path]);

  if (failed) {
    return (
      <p className="mb-1 rounded-md border bg-secondary/50 px-2 py-1 text-xs italic text-muted-foreground">
        Attachment unavailable
      </p>
    );
  }
  if (!url) {
    return <div className="mb-1 h-32 w-48 animate-pulse rounded-lg bg-secondary" aria-label="Loading image" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* Signed, short-lived URL from a private bucket — next/image cannot optimise it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Attachment"
        className="mb-1 max-h-72 max-w-full rounded-lg border object-cover"
        loading="lazy"
      />
    </a>
  );
}
