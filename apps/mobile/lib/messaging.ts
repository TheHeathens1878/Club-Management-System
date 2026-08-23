import type { Enums } from "@club/db";

import { previewText, shortAgo } from "./format";

/**
 * Shaping for the messaging tabs. Pure — tested in lib/messaging.test.ts.
 *
 * SAFEGUARDING.md SG-9: any conversation flagged `supervised_by_lead` shows a
 * persistent banner to every participant saying so, and "a conversation that
 * is monitored without the banner is a defect, not a cosmetic issue". That is
 * an acceptance criterion of P6.3, so the wording lives here as a constant and
 * the thread screen renders it above the message list — never behind a
 * disclosure, never dismissible.
 */
export const SUPERVISED_BANNER =
  "The club's safeguarding lead can read and export this conversation. It is monitored because a young person is taking part without a guardian in the room.";

/** Shown on the conversation list so the banner is not a surprise on open. */
export const SUPERVISED_BADGE = "Safeguarding lead can read this";

export interface ConversationRow {
  id: string;
  title: string | null;
  type: Enums<"conversation_type">;
  supervised_by_lead: boolean;
  closed_at: string | null;
  team_id: string | null;
  updated_at: string;
  teams: { id: string; name: string } | null;
}

/** My own `conversation_participants` row for a conversation. */
export interface MyParticipantRow {
  conversation_id: string;
  last_read_message_id: string | null;
  left_at: string | null;
  muted_until: string | null;
  conversations: ConversationRow | null;
}

/** Any participant row, used to name a one-to-one. */
export interface ParticipantRow {
  conversation_id: string;
  person_id: string;
  left_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_person_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  redacted_at: string | null;
  reply_to_id: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  type: Enums<"conversation_type">;
  supervised: boolean;
  closed: boolean;
  muted: boolean;
  /** Empty when nothing has been said yet. */
  preview: string;
  lastMessageAt: string | null;
  /** "3h" — relative age of the last message. */
  lastMessageAgo: string;
  unreadCount: number;
}

export const DELETED_BODY = "Message deleted";
export const REDACTED_BODY = "Message removed by the safeguarding lead";

/** What to render for a message body, honouring soft delete and redaction. */
export function messageBody(row: MessageRow): string {
  if (row.deleted_at) return DELETED_BODY;
  if (row.redacted_at) return REDACTED_BODY;
  return row.body;
}

/** A deleted or redacted message cannot be reported or deleted again. */
export function isWithdrawn(row: MessageRow): boolean {
  return row.deleted_at !== null || row.redacted_at !== null;
}

/**
 * What to call a conversation. A team room takes the team's name, a group its
 * title; a one-to-one is named after the other person, because "Conversation"
 * tells nobody anything.
 */
export function conversationTitle(
  conversation: ConversationRow,
  otherNames: string[],
): string {
  const explicit = conversation.title?.trim();
  if (explicit) return explicit;

  const team = conversation.teams?.name?.trim();
  if (team) {
    return conversation.type === "announcement" ? `${team} announcements` : team;
  }

  const named = otherNames.filter((name) => name.trim().length > 0);
  if (named.length > 0) return named.join(", ");

  return conversation.type === "dm" ? "Direct message" : "Conversation";
}

/**
 * Unread count for one conversation.
 *
 * `last_read_message_id` is a pointer, not a timestamp, so "unread" means
 * every message after that one in this conversation's own ordering. Messages I
 * sent myself never count. When the pointer is null nothing has been read, so
 * everything from someone else is unread.
 */
export function unreadCount(
  messages: MessageRow[],
  lastReadMessageId: string | null,
  myPersonId: string,
): number {
  const ordered = [...messages].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const readIndex = lastReadMessageId
    ? ordered.findIndex((message) => message.id === lastReadMessageId)
    : -1;

  // A pointer we cannot find (the message it names fell outside the page we
  // fetched) means everything we hold is older than it: nothing unread here.
  if (lastReadMessageId && readIndex === -1) return 0;

  return ordered
    .slice(readIndex + 1)
    .filter((message) => message.sender_person_id !== myPersonId).length;
}

/** Groups a flat page of messages by conversation, oldest first within each. */
export function groupByConversation(
  messages: MessageRow[],
): Map<string, MessageRow[]> {
  const grouped = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const bucket = grouped.get(message.conversation_id);
    if (bucket) bucket.push(message);
    else grouped.set(message.conversation_id, [message]);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return grouped;
}

export function isMuted(
  mutedUntil: string | null,
  now: Date = new Date(),
): boolean {
  if (!mutedUntil) return false;
  const until = new Date(mutedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

/**
 * The conversation list. Rooms I have left drop out; the rest sort by the last
 * thing said, with never-used rooms falling to the bottom.
 */
export function toConversationSummaries(
  participantRows: MyParticipantRow[],
  messagesByConversation: Map<string, MessageRow[]>,
  otherNamesByConversation: Readonly<Record<string, string[]>>,
  myPersonId: string,
  now: Date = new Date(),
): ConversationSummary[] {
  return participantRows
    .flatMap<ConversationSummary>((row) => {
      const conversation = row.conversations;
      if (!conversation) return [];
      if (row.left_at !== null) return [];

      const messages = messagesByConversation.get(conversation.id) ?? [];
      const last = messages.at(-1) ?? null;

      return [
        {
          id: conversation.id,
          title: conversationTitle(
            conversation,
            otherNamesByConversation[conversation.id] ?? [],
          ),
          type: conversation.type,
          supervised: conversation.supervised_by_lead,
          closed: conversation.closed_at !== null,
          muted: isMuted(row.muted_until, now),
          preview: last ? previewText(messageBody(last)) : "",
          lastMessageAt: last?.created_at ?? null,
          lastMessageAgo: shortAgo(last?.created_at ?? null, now),
          unreadCount: unreadCount(messages, row.last_read_message_id, myPersonId),
        },
      ];
    })
    .sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );
}

/** Other active participants per conversation, for naming a one-to-one. */
export function otherParticipantIds(
  rows: ParticipantRow[],
  myPersonId: string,
): Map<string, string[]> {
  const byConversation = new Map<string, string[]>();
  for (const row of rows) {
    if (row.person_id === myPersonId) continue;
    if (row.left_at !== null) continue;
    const bucket = byConversation.get(row.conversation_id);
    if (bucket) {
      if (!bucket.includes(row.person_id)) bucket.push(row.person_id);
    } else {
      byConversation.set(row.conversation_id, [row.person_id]);
    }
  }
  return byConversation;
}

/** The newest message, i.e. the one `last_read_message_id` should point at. */
export function newestMessageId(messages: MessageRow[]): string | null {
  let newest: MessageRow | null = null;
  for (const message of messages) {
    if (!newest || message.created_at.localeCompare(newest.created_at) > 0) {
      newest = message;
    }
  }
  return newest?.id ?? null;
}

/** Merges a realtime row into the thread, in place of any earlier copy. */
export function mergeMessage(
  messages: MessageRow[],
  incoming: MessageRow,
): MessageRow[] {
  const without = messages.filter((message) => message.id !== incoming.id);
  without.push(incoming);
  without.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return without;
}

/** A report needs a reason: `report_message()` rejects a blank one. */
export function isUsableReportReason(reason: string): boolean {
  return reason.trim().length >= 3;
}
