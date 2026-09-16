import { describe, expect, it } from "vitest";

import {
  matchSlotLabel,
  matchSlotRefusal,
  type CalendarEntry,
} from "./pitch-calendar";

const SERVER_WORDS =
  "This slot belongs to a match, so deleting the booking on its own would leave the match with nowhere to play. Free the pitch by unallocating the match on Pitches — or, if the match itself is off, cancel or delete it on the match, which gives the pitch back at the same time.";

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  bookingId: "b1",
  resourceId: "p1",
  resourceName: "Pitch 1",
  kind: "fixture",
  group: "fixture",
  status: "confirmed",
  startsAt: "2026-10-03T09:00:00Z",
  endsAt: "2026-10-03T10:30:00Z",
  date: "2026-10-03",
  startTime: "10:00",
  endTime: "11:30",
  startMinutes: 600,
  endMinutes: 690,
  label: "U12 Reds v Broadheath",
  teamId: "t1",
  teamName: "U12 Reds",
  fixtureId: "f1",
  opponent: "Broadheath",
  isHome: true,
  sharedTeamIds: [],
  sharedTeamNames: [],
  recurrenceGroupId: null,
  ...over,
});

describe("matchSlotRefusal", () => {
  it("keeps the server's words for somebody who cannot manage matches", () => {
    const refusal = matchSlotRefusal({
      message: SERVER_WORDS,
      fixtureId: "f1",
      canManageMatches: false,
    });
    expect(refusal.doors).toBe(false);
    expect(refusal.text).toBe(SERVER_WORDS);
  });

  it("keeps the server's words when the booking names no match", () => {
    const refusal = matchSlotRefusal({
      message: SERVER_WORDS,
      fixtureId: null,
      canManageMatches: true,
    });
    expect(refusal.doors).toBe(false);
    expect(refusal.text).toBe(SERVER_WORDS);
  });

  it("offers the doors, and stops sending an administrator elsewhere", () => {
    const refusal = matchSlotRefusal({
      message: SERVER_WORDS,
      fixtureId: "f1",
      canManageMatches: true,
    });
    expect(refusal.doors).toBe(true);
    expect(refusal.text).not.toBe(SERVER_WORDS);
    // The whole point of the reword: no "go to Pitches" when the buttons are
    // in the same panel.
    expect(refusal.text).not.toMatch(/on Pitches/);
  });
});

describe("matchSlotLabel", () => {
  it("names the two teams, the day and the kick-off", () => {
    expect(matchSlotLabel(entry({}))).toBe("U12 Reds v Broadheath · Sat 3 Oct · 10:00");
  });

  it("says away to for an away match", () => {
    expect(matchSlotLabel(entry({ isHome: false }))).toBe(
      "U12 Reds away to Broadheath · Sat 3 Oct · 10:00",
    );
  });

  it("falls back to the booking's own label when there is no opponent", () => {
    expect(matchSlotLabel(entry({ opponent: null, label: "Cup game" }))).toBe(
      "Cup game · Sat 3 Oct · 10:00",
    );
  });
});
