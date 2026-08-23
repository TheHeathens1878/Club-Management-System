import { describe, expect, it } from "vitest";

import {
  addDays,
  formatBookingDate,
  formatBookingDateNumeric,
  formatBookingDateShort,
  instantToLocal,
  instantsToLocalWindow,
  isValidDateString,
  isValidTimeString,
  legacyWindowToInstants,
  localToInstant,
  londonDayRange,
  londonToday,
  normaliseTime,
} from "./booking-time";

// UK DST in 2026: BST starts 01:00 UTC on Sunday 29 March, ends 01:00 UTC on
// Sunday 25 October.

describe("isValidDateString", () => {
  it("accepts a real calendar day", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
  });
  it("rejects a day that does not exist", () => {
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
  });
  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString("2026-1-1")).toBe(false);
    expect(isValidDateString("15/01/2026")).toBe(false);
  });
});

describe("isValidTimeString / normaliseTime", () => {
  it("accepts HH:mm and HH:mm:ss", () => {
    expect(isValidTimeString("09:00")).toBe(true);
    expect(isValidTimeString("23:59:59")).toBe(true);
  });
  it("rejects out-of-range times", () => {
    expect(isValidTimeString("24:00")).toBe(false);
    expect(isValidTimeString("12:60")).toBe(false);
    expect(isValidTimeString("noon")).toBe(false);
  });
  it("normalises to HH:mm", () => {
    expect(normaliseTime("9:05")).toBe("09:05");
    expect(normaliseTime("19:00:00")).toBe("19:00");
  });
  it("throws on a non-time", () => {
    expect(() => normaliseTime("later")).toThrow(RangeError);
  });
});

describe("localToInstant", () => {
  it("treats a winter wall clock as GMT", () => {
    expect(localToInstant("2026-01-15", "19:00")).toBe("2026-01-15T19:00:00.000Z");
  });

  it("treats a summer wall clock as BST", () => {
    expect(localToInstant("2026-07-15", "19:00")).toBe("2026-07-15T18:00:00.000Z");
  });

  it("is exact either side of the spring-forward transition", () => {
    // 00:30 GMT is still GMT; 02:00 BST is the first wall clock after the gap.
    expect(localToInstant("2026-03-29", "00:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(localToInstant("2026-03-29", "02:00")).toBe("2026-03-29T01:00:00.000Z");
  });

  it("reads a non-existent wall clock with the pre-transition offset", () => {
    // 01:30 on 29 March 2026 does not exist. Postgres's `at time zone` yields
    // 01:30 UTC (= 02:30 BST); so do we.
    expect(localToInstant("2026-03-29", "01:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("resolves an ambiguous wall clock to its first occurrence", () => {
    // 01:30 on 25 October 2026 happens twice. The first is 00:30 UTC (BST).
    expect(localToInstant("2026-10-25", "01:30")).toBe("2026-10-25T00:30:00.000Z");
  });

  it("is exact either side of the autumn fall-back transition", () => {
    expect(localToInstant("2026-10-25", "00:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(localToInstant("2026-10-25", "02:00")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("accepts seconds and single-digit hours", () => {
    expect(localToInstant("2026-01-15", "9:05:30")).toBe("2026-01-15T09:05:30.000Z");
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => localToInstant("15/01/2026", "19:00")).toThrow(RangeError);
    expect(() => localToInstant("2026-01-15", "7pm")).toThrow(RangeError);
  });
});

describe("instantToLocal", () => {
  it("renders a winter instant as GMT wall clock", () => {
    expect(instantToLocal("2026-01-15T19:00:00Z")).toEqual({ date: "2026-01-15", time: "19:00" });
  });

  it("renders a summer instant as BST wall clock", () => {
    expect(instantToLocal("2026-07-15T18:00:00Z")).toEqual({ date: "2026-07-15", time: "19:00" });
  });

  it("rolls the date when the London day differs from the UTC day", () => {
    expect(instantToLocal("2026-07-15T23:30:00Z")).toEqual({ date: "2026-07-16", time: "00:30" });
  });

  it("round-trips every unambiguous wall clock it is given", () => {
    for (const date of ["2026-01-15", "2026-03-28", "2026-06-01", "2026-10-26", "2026-12-31"]) {
      for (const time of ["00:00", "09:30", "13:45", "19:00", "23:59"]) {
        expect(instantToLocal(localToInstant(date, time))).toEqual({ date, time });
      }
    }
  });

  it("rejects a value that is not a timestamp", () => {
    expect(() => instantToLocal("soon")).toThrow(RangeError);
  });
});

describe("legacyWindowToInstants", () => {
  it("keeps a same-day booking on its date", () => {
    expect(legacyWindowToInstants("2026-01-15", "19:00", "23:00")).toEqual({
      startsAt: "2026-01-15T19:00:00.000Z",
      endsAt: "2026-01-15T23:00:00.000Z",
    });
  });

  it("ends the next day when the end time is earlier than the start time", () => {
    expect(legacyWindowToInstants("2026-01-15", "22:00", "02:00")).toEqual({
      startsAt: "2026-01-15T22:00:00.000Z",
      endsAt: "2026-01-16T02:00:00.000Z",
    });
  });

  it("carries the overnight rule across a month end and a DST change", () => {
    expect(legacyWindowToInstants("2026-03-28", "22:00", "02:00")).toEqual({
      startsAt: "2026-03-28T22:00:00.000Z",
      // 02:00 on 29 March is the first wall clock after the gap: 01:00 UTC.
      endsAt: "2026-03-29T01:00:00.000Z",
    });
  });

  it("accepts HH:mm:ss as the database returns it", () => {
    expect(legacyWindowToInstants("2026-07-15", "19:00:00", "23:30:00")).toEqual({
      startsAt: "2026-07-15T18:00:00.000Z",
      endsAt: "2026-07-15T22:30:00.000Z",
    });
  });
});

describe("instantsToLocalWindow", () => {
  it("inverts legacyWindowToInstants for a same-day booking", () => {
    expect(instantsToLocalWindow("2026-01-15T19:00:00Z", "2026-01-15T23:00:00Z")).toEqual({
      date: "2026-01-15",
      startTime: "19:00",
      endTime: "23:00",
    });
  });

  it("reports an overnight booking against its start date", () => {
    expect(instantsToLocalWindow("2026-01-15T22:00:00Z", "2026-01-16T02:00:00Z")).toEqual({
      date: "2026-01-15",
      startTime: "22:00",
      endTime: "02:00",
    });
  });

  it("round-trips through legacyWindowToInstants", () => {
    const cases: [string, string, string][] = [
      ["2026-01-15", "19:00", "23:00"],
      ["2026-07-15", "10:00", "16:30"],
      ["2026-03-28", "22:00", "02:00"],
      ["2026-10-24", "20:00", "01:00"],
    ];
    for (const [date, startTime, endTime] of cases) {
      const { startsAt, endsAt } = legacyWindowToInstants(date, startTime, endTime);
      expect(instantsToLocalWindow(startsAt, endsAt)).toEqual({ date, startTime, endTime });
    }
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
  it("is unaffected by DST", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
  });
});

describe("londonToday", () => {
  it("uses the London day, not the UTC day", () => {
    // 23:30 UTC on 15 July is already 16 July in London (BST).
    expect(londonToday(new Date("2026-07-15T23:30:00Z"))).toBe("2026-07-16");
    expect(londonToday(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });
});

describe("londonDayRange", () => {
  it("covers whole London days, half-open at the end", () => {
    expect(londonDayRange("2026-07-01", "2026-07-31")).toEqual({
      from: "2026-06-30T23:00:00.000Z",
      untilExclusive: "2026-07-31T23:00:00.000Z",
    });
  });

  it("stays exact across a DST boundary", () => {
    expect(londonDayRange("2026-03-28", "2026-03-29")).toEqual({
      from: "2026-03-28T00:00:00.000Z",
      untilExclusive: "2026-03-29T23:00:00.000Z",
    });
  });
});

describe("formatters", () => {
  it("renders the long, short and numeric forms used by the UI", () => {
    expect(formatBookingDate("2026-01-15")).toBe("Thursday, 15 January 2026");
    expect(formatBookingDateShort("2026-01-15")).toBe("Thu, 15 Jan 2026");
    expect(formatBookingDateNumeric("2026-01-15")).toBe("15/01/2026");
  });
  it("does not shift the date near midnight", () => {
    expect(formatBookingDate("2026-07-01")).toBe("Wednesday, 1 July 2026");
  });
});
