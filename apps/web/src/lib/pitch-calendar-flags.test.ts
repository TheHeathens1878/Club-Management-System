import { describe, expect, it } from "vitest";

import {
  clubNameSet,
  consecutiveWeekIds,
  isInternalMatch,
  type CalendarEntry,
} from "./pitch-calendar";

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  bookingId: "b1",
  resourceId: "p1",
  resourceName: "Pitch 1",
  kind: "fixture",
  group: "fixture",
  status: "confirmed",
  startsAt: "2026-09-05T09:00:00Z",
  endsAt: "2026-09-05T10:30:00Z",
  date: "2026-09-05",
  startTime: "10:00",
  endTime: "11:30",
  startMinutes: 600,
  endMinutes: 690,
  label: "U12 Reds v Somebody",
  teamId: "t1",
  teamName: "U12 Reds",
  fixtureId: "f1",
  opponent: "Somebody FC",
  isHome: true,
  sharedTeamIds: [],
  sharedTeamNames: [],
  recurrenceGroupId: null,
  ...over,
});

describe("isInternalMatch", () => {
  const clubTeams = clubNameSet(["U12 Reds", "U12  Blues ", "U14 Mavericks"]);

  it("flags a fixture whose opponent is one of ours, whitespace-insensitively", () => {
    expect(isInternalMatch(entry({ opponent: "U12 Blues" }), clubTeams)).toBe(true);
    expect(isInternalMatch(entry({ opponent: "  u12   blues " }), clubTeams)).toBe(true);
  });

  it("does not flag external opponents, training, or missing opponents", () => {
    expect(isInternalMatch(entry({ opponent: "Sale United U12" }), clubTeams)).toBe(false);
    expect(
      isInternalMatch(entry({ group: "training", kind: "training", opponent: "U12 Blues" }), clubTeams),
    ).toBe(false);
    expect(isInternalMatch(entry({ opponent: null }), clubTeams)).toBe(false);
  });
});

describe("consecutiveWeekIds", () => {
  it("flags the same team on the same pitch in adjacent weeks, both weeks", () => {
    const flagged = consecutiveWeekIds([
      entry({ bookingId: "a", date: "2026-09-05" }),
      entry({ bookingId: "b", date: "2026-09-12" }),
      entry({ bookingId: "c", date: "2026-09-26" }), // a fortnight later — not adjacent
    ]);
    expect(flagged).toEqual(new Set(["a", "b"]));
  });

  it("different pitch or different team is not consecutive; training never flags", () => {
    const flagged = consecutiveWeekIds([
      entry({ bookingId: "a", date: "2026-09-05" }),
      entry({ bookingId: "b", date: "2026-09-12", resourceId: "p2" }),
      entry({ bookingId: "c", date: "2026-09-12", teamId: "t2" }),
      entry({ bookingId: "d", date: "2026-09-12", group: "training", kind: "training" }),
    ]);
    expect(flagged.size).toBe(0);
  });
});
