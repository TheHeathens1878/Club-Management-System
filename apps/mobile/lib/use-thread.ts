import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { signedUrlFor } from "./attachments";
import {
  mergeMessage,
  newestMessageId,
  type ConversationRow,
  type MessageRow,
  type ParticipantRow,
} from "./messaging";
import { displayNames } from "./use-household";
import { getSupabase } from "./supabase";

/**
 * One conversation: its messages, who said them, its attachments, and a live
 * subscription so a reply lands without a pull-to-refresh.
 *
 * Realtime is a Postgres-changes subscription filtered to this conversation.
 * It is RLS-filtered server side, so it can only ever deliver rows the signed-
 * in participant could have selected anyway. **The `messages` table must be in
 * the `supabase_realtime` publication for this to fire** — no migration adds
 * it, so it is one of the things Adam has to switch on. Until then the poll
 * below keeps the thread honest.
 */

const MESSAGE_SELECT =
  "id, conversation_id, sender_person_id, body, created_at, deleted_at, redacted_at, reply_to_id";

const CONVERSATION_SELECT =
  "id, title, type, supervised_by_lead, closed_at, team_id, updated_at, teams:team_id (id, name)";

const PAGE_SIZE = 100;

/** Backstop for a project where `messages` is not in the realtime publication. */
const POLL_MS = 20_000;

export interface ThreadAttachment {
  id: string;
  messageId: string;
  path: string;
  contentType: string | null;
  /** Null when the user client may not sign a URL for the object. */
  url: string | null;
}

export interface ThreadState {
  conversation: ConversationRow | null;
  messages: MessageRow[];
  /** person_id → display name, for message authorship. */
  names: Record<string, string>;
  attachments: ThreadAttachment[];
  loading: boolean;
  error: string | null;
  sending: boolean;
  /** True when at least one attachment could not be signed for reading. */
  attachmentsUnreadable: boolean;
  send: (body: string, attach?: AttachHandler) => Promise<boolean>;
  softDelete: (messageId: string) => Promise<boolean>;
  report: (messageId: string, reason: string) => Promise<boolean>;
  reload: () => void;
}

/** Called with the id of the just-inserted message, to hang an upload off it. */
export type AttachHandler = (
  messageId: string,
) => Promise<{ ok: boolean; error?: string }>;

export function useThread(
  conversationId: string | null,
  myPersonId: string | null,
  userId: string | undefined,
): ThreadState {
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const markedRef = useRef<string | null>(null);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  // ---------------------------------------------------------------- load ---
  useEffect(() => {
    if (!conversationId || !myPersonId) {
      setLoading(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const [
          { data: conversationRow, error: conversationError },
          { data: messageRows, error: messageError },
          { data: participantRows, error: participantError },
        ] = await Promise.all([
          supabase
            .from("conversations")
            .select(CONVERSATION_SELECT)
            .eq("id", conversationId)
            .maybeSingle(),
          supabase
            .from("messages")
            .select(MESSAGE_SELECT)
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("conversation_participants")
            .select("conversation_id, person_id, left_at")
            .eq("conversation_id", conversationId),
        ]);
        if (conversationError) throw conversationError;
        if (messageError) throw messageError;
        if (participantError) throw participantError;
        if (!active) return;

        const page = ((messageRows ?? []) as MessageRow[])
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at));

        setConversation(
          (conversationRow ?? null) as unknown as ConversationRow | null,
        );
        setMessages(page);

        const personIds = ((participantRows ?? []) as ParticipantRow[]).map(
          (row) => row.person_id,
        );
        const resolved = await displayNames([
          ...personIds,
          ...page.map((message) => message.sender_person_id),
        ]);
        if (!active) return;
        setNames(resolved);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not open that conversation.",
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [conversationId, myPersonId, nonce]);

  // ---------------------------------------------------------- attachments ---
  const messageIds = messages.map((message) => message.id).join(",");

  useEffect(() => {
    if (messageIds.length === 0) {
      setAttachments([]);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      const { data, error: attachmentError } = await supabase
        .from("message_attachments")
        .select("id, message_id, storage_path, content_type")
        .in("message_id", messageIds.split(","));
      if (attachmentError || !data || !active) return;

      const rows = data as {
        id: string;
        message_id: string;
        storage_path: string;
        content_type: string | null;
      }[];

      const signed = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          messageId: row.message_id,
          path: row.storage_path,
          contentType: row.content_type,
          url: await signedUrlFor(row.storage_path),
        })),
      );
      if (active) setAttachments(signed);
    })();

    return () => {
      active = false;
    };
  }, [messageIds]);

  // ------------------------------------------------------------- realtime ---
  useEffect(() => {
    if (!conversationId) return;

    const supabase = getSupabase();
    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow | undefined;
          if (!row?.id) return;
          setMessages((current) => mergeMessage(current, row));
        },
      )
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // --------------------------------------------------------------- poll ----
  useEffect(() => {
    if (!conversationId) return;
    const timer = setInterval(() => setNonce((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId]);

  // ----------------------------------------------------------- mark read ---
  useEffect(() => {
    if (!conversationId || !myPersonId) return;
    const newest = newestMessageId(messages);
    if (!newest || markedRef.current === newest) return;
    markedRef.current = newest;

    void getSupabase()
      .from("conversation_participants")
      .update({ last_read_message_id: newest })
      .eq("conversation_id", conversationId)
      .eq("person_id", myPersonId);
  }, [conversationId, myPersonId, messages]);

  // ------------------------------------------------------------- actions ---
  const send = useCallback(
    async (body: string, attach?: AttachHandler): Promise<boolean> => {
      if (!conversationId || !myPersonId) return false;
      const trimmed = body.trim();
      if (!trimmed && !attach) return false;

      setSending(true);
      try {
        const { data, error: insertError } = await getSupabase()
          .from("messages")
          .insert({
            conversation_id: conversationId,
            sender_person_id: myPersonId,
            // An image on its own still needs a body: `messages.body` is NOT
            // NULL and the export has to read as a transcript.
            body: trimmed || "📎 Photo",
          })
          .select(MESSAGE_SELECT)
          .single();
        if (insertError) throw insertError;

        const inserted = data as unknown as MessageRow;
        setMessages((current) => mergeMessage(current, inserted));

        if (attach) {
          const result = await attach(inserted.id);
          if (!result.ok) {
            setError(result.error ?? "The photo could not be attached.");
            return false;
          }
          reload();
        }

        setError(null);
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "That message could not be sent.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId, myPersonId, reload],
  );

  const softDelete = useCallback(
    async (messageId: string): Promise<boolean> => {
      try {
        // Soft delete only: P5.2 revokes DELETE on `messages` from everyone, so
        // a withdrawn message stays in the safeguarding export (SG-2).
        const { error: updateError } = await getSupabase()
          .from("messages")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: userId ?? null,
          })
          .eq("id", messageId);
        if (updateError) throw updateError;
        reload();
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "That message could not be deleted.",
        );
        return false;
      }
    },
    [reload, userId],
  );

  const report = useCallback(
    async (messageId: string, reason: string): Promise<boolean> => {
      try {
        // `report_message()` (P5.6) raises a safeguarding concern through
        // SG-3's `report_concern()` and audits it. The app never writes to
        // `safeguarding_concerns` itself — it has no grant to.
        const { error: rpcError } = await getSupabase().rpc("report_message", {
          p_message_id: messageId,
          p_reason: reason.trim(),
        });
        if (rpcError) throw rpcError;
        setError(null);
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "That report could not be sent.",
        );
        return false;
      }
    },
    [],
  );

  return {
    conversation,
    messages,
    names,
    attachments,
    loading,
    error,
    sending,
    attachmentsUnreadable: attachments.some(
      (attachment) => attachment.url === null,
    ),
    send,
    softDelete,
    report,
    reload,
  };
}
