import { describe, expect, it } from "vitest";

import {
  ATTENTION_EVENT_LIMIT,
  attentionItems,
  eventsAwaitingReply,
  nextEvent,
  poundsLabel,
  type AttentionEvent,
} from "@/lib/home-attention";

const now = Date.parse("2026-09-05T09:00:00Z");
const day = 86_400_000;

function event(overrides: Partial<AttentionEvent> & { eventId: string }): AttentionEvent {
  return {
    title: "v Sale United",
    teamName: "U12 Cobras",
    startsAt: new Date(now + day).toISOString(),
    status: "scheduled",
    people: [{ personId: "p-ben", name: "Ben", isSelf: false, response: null, stale: false }],
    ...overrides,
  };
}

const quiet = { now, events: [], outstandingPence: 0, unreadMessages: 0, approvals: 0, registrations: 0 };

describe("what needs my attention", () => {
  it("is empty when nothing is waiting", () => {
    expect(attentionItems(quiet)).toEqual([]);
  });

  it("leads with the replies the team is waiting for, soonest first", () => {
    const later = event({ eventId: "e-later", startsAt: new Date(now + 3 * day).toISOString() });
    const sooner = event({ eventId: "e-sooner" });
    const items = attentionItems({ ...quiet, events: [later, sooner] });
    expect(items.map((item) => item.href)).toEqual(["/events/e-sooner", "/events/e-later"]);
    expect(items[0]!.title).toBe("Reply for Ben");
    expect(items[0]!.detail).toBe("v Sale United · U12 Cobras");
  });

  it("names everyone still to answer, and says 'you' for the caller", () => {
    const both = event({
      eventId: "e-1",
      people: [
        { personId: "p-me", name: "Adam", isSelf: true, response: null, stale: false },
        { personId: "p-ben", name: "Ben", isSelf: false, response: null, stale: false },
        { personId: "p-sam", name: "Sam", isSelf: false, response: "accepted", stale: false },
      ],
    });
    expect(attentionItems({ ...quiet, events: [both] })[0]!.title).toBe("Reply for you and Ben");
  });

  it("drops an event once everyone has answered — a done action leaves the list", () => {
    const answered = event({
      eventId: "e-1",
      people: [{ personId: "p-ben", name: "Ben", isSelf: false, response: "declined", stale: false }],
    });
    expect(attentionItems({ ...quiet, events: [answered] })).toEqual([]);
    // …but an answer given before the details changed is asked again.
    const stale = event({
      eventId: "e-2",
      people: [{ personId: "p-ben", name: "Ben", isSelf: false, response: "accepted", stale: true }],
    });
    expect(eventsAwaitingReply([stale], now)).toHaveLength(1);
  });

  it("ignores cancelled and past events", () => {
    const cancelled = event({ eventId: "e-c", status: "cancelled" });
    const past = event({ eventId: "e-p", startsAt: new Date(now - day).toISOString() });
    expect(attentionItems({ ...quiet, events: [cancelled, past] })).toEqual([]);
    expect(nextEvent([cancelled, past], now)).toBeNull();
  });

  it("caps the reply rows and points at the calendar for the rest", () => {
    const many = Array.from({ length: ATTENTION_EVENT_LIMIT + 2 }, (_, i) =>
      event({ eventId: `e-${i}`, startsAt: new Date(now + (i + 1) * day).toISOString() }),
    );
    const items = attentionItems({ ...quiet, events: many });
    expect(items).toHaveLength(ATTENTION_EVENT_LIMIT + 1);
    expect(items[ATTENTION_EVENT_LIMIT]).toMatchObject({ href: "/events", count: 2 });
  });

  it("then money, messages and the administrator's queues, each opening the exact task", () => {
    const items = attentionItems({
      ...quiet,
      outstandingPence: 4250,
      unreadMessages: 1,
      registrations: 2,
      approvals: 1,
    });
    expect(items.map((item) => item.kind)).toEqual(["pay", "messages", "registrations", "approvals"]);
    expect(items[0]!.title).toBe("£42.50 to pay");
    expect(items[0]!.href).toBe("/my-payments");
    expect(items[1]!.title).toBe("1 unread message");
    expect(items[1]!.href).toBe("/messages?filter=unread");
    // The queues open wearing the admin hat, whatever hat is on now.
    expect(items[2]!.href).toBe("/context?view=admin&next=%2Fregistrations");
    expect(items[3]!.href).toBe("/context?view=admin&next=%2Fapprovals");
  });

  it("prints money the way the rest of the app does", () => {
    expect(poundsLabel(100)).toBe("£1.00");
    expect(poundsLabel(123456)).toBe("£1,234.56");
  });
});
