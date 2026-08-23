import { useCallback, useEffect, useState } from "react";

import {
  groupByConversation,
  otherParticipantIds,
  toConversationSummaries,
  type ConversationSummary,
  type MessageRow,
  type MyParticipantRow,
  type ParticipantRow,
} from "./messaging";
import { displayNames } from "./use-household";
import { getSupabase } from "./supabase";

/**
 * The conversation list.
 *
 * Read entirely through the user client: the participant-scoped RLS policies
 * from P5.2 mean the query "my participant rows, with their conversations"
 * cannot return a room I am not in, and there is no admin read path on a
 * device (SG-9 oversight is a `SECURITY DEFINER` accessor on the server).
 *
 * PostgREST cannot give "the last message per conversation" in one query, so
 * one recent page of messages across my rooms is fetched and reduced on the
 * client. That page is also what the unread counts are computed from, which is
 * why a room quiet for a long time shows zero unread rather than a stale one.
 */

const PARTICIPANT_SELECT =
  "conversation_id, last_read_message_id, left_at, muted_until, conversations:conversation_id (id, title, type, supervised_by_lead, closed_at, team_id, updated_at, teams:team_id (id, name))";

const MESSAGE_SELECT =
  "id, conversation_id, sender_person_id, body, created_at, deleted_at, redacted_at, reply_to_id";

/** How many recent messages to reduce the list from. */
const RECENT_MESSAGE_LIMIT = 400;

export interface ConversationsState {
  conversations: ConversationSummary[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useConversations(personId: string | null): ConversationsState {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!personId) {
      setConversations([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const { data: myRows, error: myError } = await supabase
          .from("conversation_participants")
          .select(PARTICIPANT_SELECT)
          .eq("person_id", personId)
          .is("left_at", null);
        if (myError) throw myError;
        if (!active) return;

        const participantRows = (myRows ?? []) as unknown as MyParticipantRow[];
        const conversationIds = participantRows
          .map((row) => row.conversation_id)
          .filter((id) => id.length > 0);

        if (conversationIds.length === 0) {
          setConversations([]);
          setError(null);
          return;
        }

        const [
          { data: messageRows, error: messageError },
          { data: otherRows, error: otherError },
        ] = await Promise.all([
          supabase
            .from("messages")
            .select(MESSAGE_SELECT)
            .in("conversation_id", conversationIds)
            .order("created_at", { ascending: false })
            .limit(RECENT_MESSAGE_LIMIT),
          supabase
            .from("conversation_participants")
            .select("conversation_id, person_id, left_at")
            .in("conversation_id", conversationIds),
        ]);
        if (messageError) throw messageError;
        if (otherError) throw otherError;
        if (!active) return;

        const others = otherParticipantIds(
          (otherRows ?? []) as ParticipantRow[],
          personId,
        );
        const names = await displayNames([...others.values()].flat());
        if (!active) return;

        const namesByConversation: Record<string, string[]> = {};
        for (const [conversationId, ids] of others) {
          namesByConversation[conversationId] = ids.map(
            (id) => names[id] ?? "A club member",
          );
        }

        setConversations(
          toConversationSummaries(
            participantRows,
            groupByConversation((messageRows ?? []) as MessageRow[]),
            namesByConversation,
            personId,
          ),
        );
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your messages.",
        );
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [personId, nonce]);

  return { conversations, loading, refreshing, error, refresh };
}
