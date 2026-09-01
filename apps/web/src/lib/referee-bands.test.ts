import { describe, expect, it } from "vitest";

import { refereeBandLabel, refereeBandSummary } from "./referee-bands";

/**
 * The three states, and the two that look alike.
 *
 * A referee with no ceiling takes everything; a referee whose date of birth
 * the club has not got takes nothing. Both arrive here with `max_band` null,
 * and telling them apart is the only job this module has.
 */
describe("refereeBandLabel", () => {
  const base = { personId: "p1" };

  it("gives a young referee their own band and the one below", () => {
    expect(
      refereeBandLabel({ ...base, dobKnown: true, ownBand: 15, unlimited: false, maxBand: 14 }),
    ).toEqual({ own: "U15", takes: "U14 and below", needsDob: false });
  });

  it("gives an adult referee no ceiling", () => {
    expect(
      refereeBandLabel({ ...base, dobKnown: true, ownBand: 24, unlimited: true, maxBand: null }),
    ).toEqual({ own: "U24", takes: "Any age group", needsDob: false });
  });

  it("does not read an unknown date of birth as no ceiling", () => {
    const label = refereeBandLabel({
      ...base,
      dobKnown: false,
      ownBand: null,
      unlimited: false,
      maxBand: null,
    });
    expect(label.needsDob).toBe(true);
    expect(label.own).toBeNull();
    expect(label.takes).toMatch(/date of birth/i);
  });

  it("summarises on one line, and drops the band when there is none", () => {
    expect(
      refereeBandSummary({ ...base, dobKnown: true, ownBand: 15, unlimited: false, maxBand: 14 }),
    ).toBe("U15 · U14 and below");
    expect(
      refereeBandSummary({ ...base, dobKnown: false, ownBand: null, unlimited: false, maxBand: null }),
    ).not.toContain("·");
  });
});
