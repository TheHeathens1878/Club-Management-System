import { describe, expect, it } from "vitest";

import { cardColourway, cardValidity, chargeRef, formatCardRef, formatMemberNo } from "./finance-format";

describe("membership card formatting", () => {
  it("prints the five-digit number and letter", () => {
    expect(formatMemberNo(1)).toBe("00001");
    expect(formatMemberNo(12345)).toBe("12345");
    expect(formatCardRef(2, "C")).toBe("00002C");
    expect(chargeRef(1042)).toBe("CHG-1042");
  });

  it("rotates the colourway each membership year, and repeats on a cycle", () => {
    const y2026 = cardColourway(2026);
    const y2027 = cardColourway(2027);
    expect(y2026).not.toBe(y2027);
    // Six colourways: the same look comes back round six years later, never sooner.
    expect(cardColourway(2032)).toBe(y2026);
    for (let year = 2027; year < 2032; year++) {
      expect(cardColourway(year)).not.toBe(y2026);
    }
  });

  it("prints the membership year's validity span", () => {
    expect(cardValidity("2026-07-01", "2027-06-30")).toBe("1 Jul 2026 – 30 Jun 2027");
  });
});
