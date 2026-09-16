import { describe, expect, it } from "vitest";

import { buildMonthRange, parseYm, statusTag } from "./bookings-calendar";
import {
  bookingSwatch,
  deskCellMode,
  deskClashes,
  deskSummary,
  openingWeek,
  shiftWeek,
  weekDays,
  weekStartOf,
  type ClashCandidate,
  type DeskBooking,
} from "./desk-shared";

describe("parseYm", () => {
  it("reads a YYYY-MM string as numbers", () => {
    expect(parseYm("2027-07")).toEqual({ year: 2027, month: 7 });
    expect(parseYm("2026-01")).toEqual({ year: 2026, month: 1 });
  });

  it("falls back to the current month only for malformed input", () => {
    const now = new Date();
    expect(parseYm("nope")).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
    expect(parseYm("dddd-dd")).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
  });
});

describe("buildMonthRange", () => {
  it("walks month by month across a year boundary", () => {
    expect(buildMonthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("is a single month when from and to agree", () => {
    expect(buildMonthRange("2027-07", "2027-07")).toEqual(["2027-07"]);
  });
});

describe("statusTag", () => {
  it("marks everything that does not hold the room", () => {
    expect(statusTag("confirmed")).toBe("");
    expect(statusTag("pending")).toBe(" (PENDING)");
    expect(statusTag("enquiry")).toBe(" (ENQUIRY)");
    expect(statusTag("quoted")).toBe(" (QUOTED)");
  });
});

// ---------------------------------------------------------------------------
// A cell → a door
// ---------------------------------------------------------------------------

describe("deskCellMode", () => {
  it("opens the sheet on the door the booking's next action names", () => {
    expect(deskCellMode("quote")).toBe("quote");
    expect(deskCellMode("confirm")).toBe("confirm");
    expect(deskCellMode("chase")).toBe("chase");
    expect(deskCellMode("security")).toBe("security");
  });

  it("falls back to the ledger for the booker's own doors and for nothing", () => {
    // `accept`, `pay` and `view` are /portal's, not the desk's.
    expect(deskCellMode("accept")).toBe("payment");
    expect(deskCellMode("pay")).toBe("payment");
    expect(deskCellMode("view")).toBe("payment");
    expect(deskCellMode(undefined)).toBe("payment");
    expect(deskCellMode(null)).toBe("payment");
    expect(deskCellMode("nonsense")).toBe("payment");
  });
});

describe("bookingSwatch", () => {
  it("gives only confirmed the green, and dashes what is not holding the room", () => {
    expect(bookingSwatch("confirmed", "hire").bg).toBe("#dcfce7");
    expect(bookingSwatch("enquiry", "hire").dashed).toBe(true);
    expect(bookingSwatch("quoted", "hire").dashed).toBe(true);
    expect(bookingSwatch("pending", "hire").dashed).toBeUndefined();
  });

  it("paints a block as blocked whatever its status says", () => {
    expect(bookingSwatch("confirmed", "block")).toEqual(bookingSwatch("cancelled", "block"));
  });
});

// ---------------------------------------------------------------------------
// Clashes, the way booking_conflicts() decides them
// ---------------------------------------------------------------------------

function candidate(over: Partial<ClashCandidate> & { id: string }): ClashCandidate {
  return {
    resource_id: "room-1",
    status: "confirmed",
    blocked_from: "2026-11-14T19:00:00.000Z",
    blocked_until: "2026-11-15T00:00:00.000Z",
    ...over,
  };
}

describe("deskClashes", () => {
  const held = candidate({ id: "held" });

  it("finds an overlap on the same room that is holding it", () => {
    const enquiry = candidate({
      id: "asking",
      status: "enquiry",
      blocked_from: "2026-11-14T20:00:00.000Z",
      blocked_until: "2026-11-14T23:00:00.000Z",
    });
    expect(deskClashes([held, enquiry], enquiry)).toEqual([{ id: "held", status: "confirmed" }]);
  });

  it("ignores another room, a quote, and the booking itself", () => {
    const otherRoom = candidate({ id: "elsewhere", resource_id: "room-2" });
    const quoted = candidate({ id: "quoted", status: "quoted" });
    expect(deskClashes([held, otherRoom, quoted], held)).toEqual([]);
  });

  it("does not count a booking that starts as this one ends", () => {
    const after = candidate({
      id: "after",
      blocked_from: "2026-11-15T00:00:00.000Z",
      blocked_until: "2026-11-15T03:00:00.000Z",
    });
    expect(deskClashes([held, after], held)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The status bar
// ---------------------------------------------------------------------------

function deskBooking(
  id: string,
  over: { status?: string; key?: string; createdAt?: string; date?: string } = {},
): DeskBooking {
  return {
    id,
    createdAt: over.createdAt ?? "2026-08-01T09:00:00.000Z",
    item: {
      id,
      resource_id: "room-1",
      date: over.date ?? "2026-11-14",
      start_time: "19:00",
      end_time: "00:00",
      booker_name: "Jane Metcalfe",
      booker_email: "jane@example.com",
      booker_phone: null,
      occasion: null,
      estimated_guests: null,
      status: (over.status ?? "enquiry") as DeskBooking["item"]["status"],
      payment_status: "unpaid",
      total_pence: null,
      kind: "hire",
      recurrence_group_id: null,
    },
    roomName: "The Function Room",
    next: {
      key: (over.key ?? "send-quote") as DeskBooking["next"]["key"],
      label: "Send a quote",
      why: "Nobody has priced it yet.",
      tone: "waiting",
    },
    sheet: {} as DeskBooking["sheet"],
  };
}

describe("deskSummary", () => {
  it("counts what is waiting and what is late, and opens the oldest", () => {
    const summary = deskSummary([
      deskBooking("new", { createdAt: "2026-08-20T09:00:00.000Z" }),
      deskBooking("old", { createdAt: "2026-08-02T09:00:00.000Z", status: "pending" }),
      deskBooking("late", { status: "confirmed", key: "chase-deposit" }),
    ]);
    expect(summary.status).toBe("2 waiting on the desk · 1 deposit overdue");
    expect(summary.oldestId).toBe("old");
    expect(summary.tone).toBe("error");
  });

  it("names a late balance when nothing is waiting, and opens that", () => {
    const summary = deskSummary([
      deskBooking("balance", { status: "confirmed", key: "chase-balance" }),
      deskBooking("settled", { status: "confirmed", key: "paid-in-full" }),
    ]);
    expect(summary.status).toBe("1 balance overdue");
    expect(summary.oldestId).toBe("balance");
  });

  it("goes quiet when the desk owes nobody anything", () => {
    const summary = deskSummary([deskBooking("settled", { status: "confirmed", key: "paid-in-full" })]);
    expect(summary.tone).toBe("done");
    expect(summary.oldestId).toBeNull();
    expect(summary.status).toBe("Nothing is waiting on the desk");
  });
});

// ---------------------------------------------------------------------------
// The phone's week
// ---------------------------------------------------------------------------

describe("the week a phone opens on", () => {
  it("starts weeks on Monday", () => {
    // 2026-11-14 is a Saturday; 2026-11-16 a Monday.
    expect(weekStartOf("2026-11-14")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
  });

  it("gives seven days in order, and steps a week at a time", () => {
    expect(weekDays("2026-11-09")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(shiftWeek("2026-11-09", 1)).toBe("2026-11-16");
    expect(shiftWeek("2026-11-09", -1)).toBe("2026-11-02");
  });

  it("opens on today's week in this month, and on the first week of any other", () => {
    expect(openingWeek("2026-11", "2026-11-14")).toBe("2026-11-09");
    expect(openingWeek("2026-12", "2026-11-14")).toBe("2026-11-30");
  });
});
