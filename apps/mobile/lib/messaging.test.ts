import { describe, expect, it } from "vitest";

import {
  conversationTitle,
  DELETED_BODY,
  groupByConversation,
  isMuted,
  isUsableReportReason,
  isWithdrawn,
  mergeMessage,
  messageBody,
  newestMessageId,
  otherParticipantIds,
  REDACTED_BODY,
  SUPERVISED_BADGE,
  SUPERVISED_BANNER,
  toConversationSummaries,
  unreadCount,
  clockLabelLondon,
  dayKeyLondon,
  dayLabelLondon,
  isReadByAllOthers,
  lastReadAtByPerson,
  reactionChips,
  type ConversationRow,
  type MessageRow,
  type MyParticipantRow,
  type ParticipantRow,
} from "./messaging";

function conversation(
  overrides: Partial<ConversationRow> = {},
): ConversationRow {
  return {
    id: "conversation-1",
    title: null,
    type: "dm",
    supervised_by_lead: false,
    closed_at: null,
    team_id: null,
    updated_at: "2026-09-01T10:00:00Z",
    teams: null,
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    sender_person_id: "them",
    body: "Training is on",
    created_at: "2026-09-01T10:00:00Z",
    deleted_at: null,
    redacted_at: null,
    reply_to_id: null,
    ...overrides,
  };
}

/**
 * SAFEGUARDING SG-9. The banner is an acceptance criterion of P6.3, so the
 * wording is pinned here: it has to name the safeguarding lead and say the
 * conversation can be read, in plain words a child would understand.
 */
describe("the SG-9 supervision banner", () => {
  it("names who can read the conversation", () => {
    expect(SUPERVISED_BANNER).toContain("safeguarding lead");
    expect(SUPERVISED_BANNER.toLowerCase()).toContain("read");
  });

  it("says the conversation can be exported, not just read", () => {
    expect(SUPERVISED_BANNER.toLowerCase()).toContain("export");
  });

  it("has a short form for the conversation list", () => {
    expect(SUPERVISED_BADGE.toLowerCase()).toContain("safeguarding lead");
  });
});

describe("messageBody", () => {
  it("shows the body of an ordinary message", () => {
    expect(messageBody(message())).toBe("Training is on");
  });

  it("hides the body of a soft-deleted message", () => {
    const deleted = message({ deleted_at: "2026-09-01T11:00:00Z" });
    expect(messageBody(deleted)).toBe(DELETED_BODY);
    expect(isWithdrawn(deleted)).toBe(true);
  });

  it("hides the body of a redacted message", () => {
    const redacted = message({ redacted_at: "2026-09-01T11:00:00Z" });
    expect(messageBody(redacted)).toBe(REDACTED_BODY);
    expect(isWithdrawn(redacted)).toBe(true);
  });
});

describe("conversationTitle", () => {
  it("prefers an explicit title", () => {
    expect(conversationTitle(conversation({ title: "Kit run" }), [])).toBe(
      "Kit run",
    );
  });

  it("uses the team name for a team room", () => {
    expect(
      conversationTitle(
        conversation({ type: "team", teams: { id: "t", name: "U12s" } }),
        [],
      ),
    ).toBe("U12s");
  });

  it("marks an announcement room", () => {
    expect(
      conversationTitle(
        conversation({ type: "announcement", teams: { id: "t", name: "U12s" } }),
        [],
      ),
    ).toBe("U12s announcements");
  });

  it("names a one-to-one after the other person", () => {
    expect(conversationTitle(conversation(), ["Sam Coach"])).toBe("Sam Coach");
  });

  it("falls back rather than showing a blank card", () => {
    expect(conversationTitle(conversation(), [])).toBe("Direct message");
    expect(conversationTitle(conversation({ type: "group" }), [""])).toBe(
      "Conversation",
    );
  });
});

describe("unreadCount", () => {
  const thread = [
    message({ id: "a", created_at: "2026-09-01T10:00:00Z" }),
    message({ id: "b", created_at: "2026-09-01T11:00:00Z" }),
    message({ id: "c", created_at: "2026-09-01T12:00:00Z" }),
  ];

  it("counts everything after the read pointer", () => {
    expect(unreadCount(thread, "a", "me")).toBe(2);
  });

  it("counts everything when nothing has been read", () => {
    expect(unreadCount(thread, null, "me")).toBe(3);
  });

  it("counts nothing when the pointer is the newest message", () => {
    expect(unreadCount(thread, "c", "me")).toBe(0);
  });

  it("never counts my own messages as unread", () => {
    const mine = [
      ...thread,
      message({ id: "d", created_at: "2026-09-01T13:00:00Z", sender_person_id: "me" }),
    ];
    expect(unreadCount(mine, "c", "me")).toBe(0);
  });

  it("treats a pointer outside the fetched page as fully read", () => {
    expect(unreadCount(thread, "older-than-the-page", "me")).toBe(0);
  });
});

describe("groupByConversation", () => {
  it("buckets by conversation, oldest first", () => {
    const grouped = groupByConversation([
      message({ id: "b", created_at: "2026-09-01T11:00:00Z" }),
      message({ id: "a", created_at: "2026-09-01T10:00:00Z" }),
      message({ id: "x", conversation_id: "conversation-2" }),
    ]);
    expect(grouped.get("conversation-1")?.map((m) => m.id)).toEqual(["a", "b"]);
    expect(grouped.get("conversation-2")).toHaveLength(1);
  });
});

describe("isMuted", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("is muted while the mute is in the future", () => {
    expect(isMuted("2026-09-02T12:00:00Z", now)).toBe(true);
  });

  it("is not muted once the mute has lapsed, or was never set", () => {
    expect(isMuted("2026-08-31T12:00:00Z", now)).toBe(false);
    expect(isMuted(null, now)).toBe(false);
  });
});

describe("toConversationSummaries", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  function participantRow(
    overrides: Partial<MyParticipantRow> = {},
  ): MyParticipantRow {
    return {
      conversation_id: "conversation-1",
      last_read_message_id: null,
      left_at: null,
      muted_until: null,
      conversations: conversation(),
      ...overrides,
    };
  }

  it("summarises a room with its last message and unread count", () => {
    const [summary] = toConversationSummaries(
      [participantRow()],
      groupByConversation([
        message({ id: "a", created_at: "2026-09-01T10:00:00Z" }),
        message({
          id: "b",
          body: "Bring boots",
          created_at: "2026-09-01T11:00:00Z",
        }),
      ]),
      { "conversation-1": ["Sam Coach"] },
      "me",
      now,
    );

    expect(summary?.title).toBe("Sam Coach");
    expect(summary?.preview).toBe("Bring boots");
    expect(summary?.unreadCount).toBe(2);
    expect(summary?.lastMessageAgo).toBe("1h");
  });

  it("carries the supervision flag onto the list", () => {
    const [summary] = toConversationSummaries(
      [
        participantRow({
          conversations: conversation({ supervised_by_lead: true }),
        }),
      ],
      new Map(),
      {},
      "me",
      now,
    );
    expect(summary?.supervised).toBe(true);
  });

  it("drops a room I have left", () => {
    const summaries = toConversationSummaries(
      [participantRow({ left_at: "2026-08-01T00:00:00Z" })],
      new Map(),
      {},
      "me",
      now,
    );
    expect(summaries).toHaveLength(0);
  });

  it("sorts the most recent conversation first", () => {
    const summaries = toConversationSummaries(
      [
        participantRow({
          conversation_id: "quiet",
          conversations: conversation({ id: "quiet" }),
        }),
        participantRow({
          conversation_id: "busy",
          conversations: conversation({ id: "busy" }),
        }),
      ],
      groupByConversation([
        message({ id: "q", conversation_id: "quiet", created_at: "2026-08-01T10:00:00Z" }),
        message({ id: "b", conversation_id: "busy", created_at: "2026-09-01T10:00:00Z" }),
      ]),
      {},
      "me",
      now,
    );
    expect(summaries.map((summary) => summary.id)).toEqual(["busy", "quiet"]);
  });
});

describe("otherParticipantIds", () => {
  it("excludes me and anyone who has left", () => {
    const rows: ParticipantRow[] = [
      { conversation_id: "c1", person_id: "me", left_at: null },
      { conversation_id: "c1", person_id: "them", left_at: null },
      { conversation_id: "c1", person_id: "gone", left_at: "2026-08-01" },
    ];
    expect(otherParticipantIds(rows, "me").get("c1")).toEqual(["them"]);
  });
});

describe("newestMessageId and mergeMessage", () => {
  it("finds the newest message to point last_read at", () => {
    expect(
      newestMessageId([
        message({ id: "a", created_at: "2026-09-01T10:00:00Z" }),
        message({ id: "b", created_at: "2026-09-01T11:00:00Z" }),
      ]),
    ).toBe("b");
    expect(newestMessageId([])).toBeNull();
  });

  it("replaces an existing copy rather than duplicating it", () => {
    const initial = [message({ id: "a" })];
    const merged = mergeMessage(initial, message({ id: "a", body: "Edited" }));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("Edited");
  });

  it("keeps the thread in time order", () => {
    const merged = mergeMessage(
      [message({ id: "b", created_at: "2026-09-01T11:00:00Z" })],
      message({ id: "a", created_at: "2026-09-01T10:00:00Z" }),
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("isUsableReportReason", () => {
  it("rejects a blank or near-blank reason", () => {
    expect(isUsableReportReason("")).toBe(false);
    expect(isUsableReportReason("   ")).toBe(false);
    expect(isUsableReportReason("no")).toBe(false);
  });

  it("accepts a real reason", () => {
    expect(isUsableReportReason("This is abusive towards my son.")).toBe(true);
  });
});

describe("WhatsApp-style thread helpers", () => {
  const msg = (id: string, at: string, sender = "p1"): MessageRow => ({
    id,
    conversation_id: "c1",
    sender_person_id: sender,
    body: `m-${id}`,
    created_at: at,
    deleted_at: null,
    redacted_at: null,
    reply_to_id: null,
  });

  it("reactionChips groups by emoji, counts, and marks mine", () => {
    const reactions = [
      { id: "r1", message_id: "m1", person_id: "p1", emoji: "👍" },
      { id: "r2", message_id: "m1", person_id: "p2", emoji: "👍" },
      { id: "r3", message_id: "m1", person_id: "p2", emoji: "❤️" },
      { id: "r4", message_id: "m2", person_id: "p2", emoji: "😂" },
    ];
    expect(reactionChips(reactions, "m1", "p1")).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "❤️", count: 1, mine: false },
    ]);
    expect(reactionChips(reactions, "m2", "p1")).toEqual([{ emoji: "😂", count: 1, mine: false }]);
    expect(reactionChips(reactions, "m3", "p1")).toEqual([]);
  });

  it("day keys and labels are London days", () => {
    // 23:30 UTC on 5 July is 00:30 on 6 July in London (BST).
    expect(dayKeyLondon("2026-07-05T23:30:00Z")).toBe("2026-07-06");
    expect(dayKeyLondon("2026-01-05T23:30:00Z")).toBe("2026-01-05");
    const now = new Date("2026-09-06T12:00:00Z");
    expect(dayLabelLondon("2026-09-06T08:00:00Z", now)).toBe("Today");
    expect(dayLabelLondon("2026-09-05T08:00:00Z", now)).toBe("Yesterday");
    expect(dayLabelLondon("2026-08-30T08:00:00Z", now)).toBe("Sunday 30 August 2026");
  });

  it("clockLabelLondon is the London wall clock", () => {
    expect(clockLabelLondon("2026-07-05T13:05:00Z")).toBe("14:05");
    expect(clockLabelLondon("2026-01-05T13:05:00Z")).toBe("13:05");
    expect(clockLabelLondon("nonsense")).toBe("");
  });

  it("read-by-all requires every active other participant to have caught up", () => {
    const a = msg("a", "2026-09-06T10:00:00Z", "me");
    const b = msg("b", "2026-09-06T10:05:00Z", "me");
    const messages = [a, b];
    const participants = [
      { person_id: "me", left_at: null, last_read_message_id: "b" },
      { person_id: "p2", left_at: null, last_read_message_id: "b" },
      { person_id: "p3", left_at: null, last_read_message_id: "a" },
      { person_id: "gone", left_at: "2026-09-01T00:00:00Z", last_read_message_id: null },
    ];
    const { otherIds, readAt } = lastReadAtByPerson(participants, messages, "me");
    expect(otherIds.sort()).toEqual(["p2", "p3"]);
    expect(isReadByAllOthers(a, otherIds, readAt)).toBe(true);
    expect(isReadByAllOthers(b, otherIds, readAt)).toBe(false);
  });

  it("a pointer outside the window under-reports, never over-reports", () => {
    const b = msg("b", "2026-09-06T10:05:00Z", "me");
    const participants = [{ person_id: "p2", left_at: null, last_read_message_id: "ancient" }];
    const { otherIds, readAt } = lastReadAtByPerson(participants, [b], "me");
    expect(isReadByAllOthers(b, otherIds, readAt)).toBe(false);
  });

  it("with nobody else active there is no read tick", () => {
    const b = msg("b", "2026-09-06T10:05:00Z", "me");
    expect(isReadByAllOthers(b, [], {})).toBe(false);
  });
});
