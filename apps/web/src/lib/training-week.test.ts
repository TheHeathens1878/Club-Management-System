import { describe, expect, it } from "vitest";

import {
  dayWord,
  sessionLine,
  sessionNextAction,
  trainingWeekDays,
  trainingWeekRows,
  type TrainingWeekSession,
  type TrainingWeekTeam,
} from "@/lib/training-week";

// 2026-09-16 is a Wednesday, in British Summer Time: 17:00Z is 18:00 in
// Manchester, which is when the club trains.
const TODAY = "2026-09-16";
const TOMORROW = "2026-09-17";
const WEEK = trainingWeekDays(TODAY);

function session(
  overrides: Partial<TrainingWeekSession> & { bookingId: string; teamId: string },
): TrainingWeekSession {
  return {
    eventId: `event-${overrides.bookingId}`,
    teamName: "U14 Mavericks",
    startsAt: `${TODAY}T17:00:00Z`,
    pitchName: "Banky Lane 1",
    status: "confirmed",
    accepted: 11,
    declined: 1,
    squad: 14,
    ...overrides,
  };
}

const TEAMS: TrainingWeekTeam[] = [
  { id: "mavericks", name: "U14 Mavericks", ageGroup: "U14" },
  { id: "comets", name: "U7 Comets", ageGroup: "U7" },
];

describe("the week's columns", () => {
  it("is seven days from today, whatever is booked", () => {
    expect(WEEK).toEqual([
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ]);
  });
});

describe("the training grid", () => {
  it("puts the teams in age order and reads the London wall clock", () => {
    const rows = trainingWeekRows(
      [
        session({ bookingId: "a", teamId: "mavericks" }),
        session({ bookingId: "b", teamId: "comets", teamName: "U7 Comets", startsAt: `${TOMORROW}T17:30:00Z` }),
      ],
      TEAMS,
      WEEK,
    );
    expect(rows.map((row) => row.teamName)).toEqual(["U7 Comets", "U14 Mavericks"]);
    expect(rows[1]?.byDay[TODAY]?.[0]?.time).toBe("18:00");
    expect(rows[0]?.byDay[TOMORROW]?.[0]?.time).toBe("18:30");
  });

  it("says the attendance, the pitch and what is still awaiting confirmation", () => {
    const rows = trainingWeekRows(
      [
        session({ bookingId: "a", teamId: "mavericks", status: "pending", pitchName: null }),
      ],
      TEAMS,
      WEEK,
    );
    const card = rows.find((row) => row.teamId === "mavericks")?.byDay[TODAY]?.[0];
    expect(card?.attendance).toBe("11/14");
    expect(card?.pitch).toBe("No pitch");
    expect(card?.awaitingPitch).toBe(true);
    expect(card?.marked).toBe(false);
  });

  it("counts the registers still to take, and leaves out a session beyond the week", () => {
    const rows = trainingWeekRows(
      [
        session({ bookingId: "a", teamId: "mavericks", marked: true }),
        session({ bookingId: "b", teamId: "mavericks", startsAt: `${TOMORROW}T17:00:00Z` }),
        session({ bookingId: "c", teamId: "mavericks", startsAt: "2026-10-01T17:00:00Z" }),
      ],
      TEAMS,
      WEEK,
    );
    const mavericks = rows.find((row) => row.teamId === "mavericks");
    expect(mavericks?.cards).toHaveLength(2);
    expect(mavericks?.unmarked).toBe(1);
  });
});

describe("how a coach says a day", () => {
  it("calls an evening tonight and an afternoon today", () => {
    expect(dayWord(TODAY, "18:00", TODAY)).toBe("Tonight");
    expect(dayWord(TODAY, "10:30", TODAY)).toBe("Today");
    expect(dayWord(TOMORROW, "18:00", TODAY)).toBe("Tomorrow");
    expect(dayWord("2026-09-19", "10:30", TODAY)).toBe("Saturday");
    expect(dayWord("2026-09-15", "18:00", TODAY)).toBe("Yesterday");
  });

  it("adds the date once a weekday alone would be ambiguous", () => {
    expect(dayWord("2026-09-26", "10:30", TODAY)).toBe("Saturday 26 Sept");
  });

  it("puts a session in one line", () => {
    const rows = trainingWeekRows([session({ bookingId: "a", teamId: "mavericks" })], TEAMS, WEEK);
    const card = rows.find((row) => row.teamId === "mavericks")?.byDay[TODAY]?.[0];
    expect(card && sessionLine(card, TODAY)).toBe("Tonight 18:00 · Banky Lane 1 · 11 of 14 coming");
  });
});

describe("what the training bar offers", () => {
  it("names tonight's session and opens the register", () => {
    const action = sessionNextAction(
      [
        session({ bookingId: "tonight", teamId: "mavericks" }),
        session({ bookingId: "tomorrow", teamId: "comets", teamName: "U7 Comets", startsAt: `${TOMORROW}T17:00:00Z` }),
      ],
      TODAY,
    );
    expect(action.detail).toBe("Tonight 18:00 · U14 Mavericks · Banky Lane 1 · 11 of 14 coming");
    expect(action.label).toBe("Take the register");
    expect(action.mode).toBe("register");
    expect(action.bookingId).toBe("tonight");
  });

  it("moves on to tomorrow once tonight's register is taken", () => {
    const action = sessionNextAction(
      [
        session({ bookingId: "tonight", teamId: "mavericks", marked: true }),
        session({ bookingId: "tomorrow", teamId: "comets", teamName: "U7 Comets", startsAt: `${TOMORROW}T17:00:00Z` }),
      ],
      TODAY,
    );
    expect(action.bookingId).toBe("tomorrow");
    expect(action.detail).toBe("Tomorrow 18:00 · U7 Comets · Banky Lane 1 · 11 of 14 coming");
  });

  it("offers the marked register back when every one is done", () => {
    const action = sessionNextAction(
      [session({ bookingId: "tonight", teamId: "mavericks", marked: true })],
      TODAY,
    );
    expect(action.label).toBe("See the register");
    expect(action.bookingId).toBe("tonight");
  });

  it("looks past yesterday's unmarked register", () => {
    const action = sessionNextAction(
      [
        session({ bookingId: "yesterday", teamId: "mavericks", startsAt: "2026-09-15T17:00:00Z" }),
        session({ bookingId: "tomorrow", teamId: "comets", teamName: "U7 Comets", startsAt: `${TOMORROW}T17:00:00Z` }),
      ],
      TODAY,
    );
    expect(action.bookingId).toBe("tomorrow");
  });

  it("asks for a pitch when nothing is booked at all", () => {
    expect(sessionNextAction([], TODAY)).toEqual({
      label: "Book a pitch",
      detail: "No training booked for the next seven days",
      mode: "book",
      bookingId: null,
      eventId: null,
    });
  });
});
