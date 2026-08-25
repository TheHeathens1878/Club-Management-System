import { describe, expect, it } from "vitest";

import {
  isOppositionSide,
  kindLabel,
  matchLabel,
  nextSuggestedLabel,
  PITCH_BOOKING_KIND_LABELS,
  PITCH_BOOKING_KINDS,
} from "./pitch-booking";

/**
 * The match label (Adam, 2026-08-25, asks 3 and 4).
 *
 * The rule worth pinning down is not the string — it is that a suggestion
 * never eats something a person typed. `nextSuggestedLabel` is the whole of
 * that rule, and the booking form is only its caller.
 */

describe("matchLabel", () => {
  it("names both sides the way the pitch diary shows them", () => {
    expect(matchLabel("U14 Mavericks", "U18 Cobras")).toBe("U14 Mavericks v U18 Cobras");
    expect(matchLabel("U14 Mavericks", "Sale Sharks")).toBe("U14 Mavericks v Sale Sharks");
  });

  it("has nothing to say until both sides are known", () => {
    expect(matchLabel("U14 Mavericks", "")).toBe("");
    expect(matchLabel("", "Sale Sharks")).toBe("");
    expect(matchLabel(null, null)).toBe("");
    expect(matchLabel("U14 Mavericks", undefined)).toBe("");
    // A half-typed opponent is not a label: "U14 Mavericks v " helps nobody.
    expect(matchLabel("U14 Mavericks", "   ")).toBe("");
  });

  it("trims what was typed around it", () => {
    expect(matchLabel("  U14 Mavericks ", " Sale Sharks  ")).toBe("U14 Mavericks v Sale Sharks");
  });
});

describe("nextSuggestedLabel", () => {
  it("fills an empty box", () => {
    expect(nextSuggestedLabel("", "", "U14 Mavericks v U18 Cobras")).toBe(
      "U14 Mavericks v U18 Cobras",
    );
    expect(nextSuggestedLabel("   ", "", "U14 Mavericks v U18 Cobras")).toBe(
      "U14 Mavericks v U18 Cobras",
    );
  });

  it("replaces its own previous suggestion when the opposition changes", () => {
    expect(
      nextSuggestedLabel("U14 Mavericks v U18 Cobras", "U14 Mavericks v U18 Cobras", "U14 Mavericks v Sale Sharks"),
    ).toBe("U14 Mavericks v Sale Sharks");
  });

  it("never overwrites a label somebody typed themselves", () => {
    expect(
      nextSuggestedLabel("Cup semi-final", "U14 Mavericks v U18 Cobras", "U14 Mavericks v Sale Sharks"),
    ).toBe("Cup semi-final");
    // Even an edit of the suggestion is theirs now.
    expect(
      nextSuggestedLabel(
        "U14 Mavericks v U18 Cobras (cup)",
        "U14 Mavericks v U18 Cobras",
        "U14 Mavericks v Sale Sharks",
      ),
    ).toBe("U14 Mavericks v U18 Cobras (cup)");
  });

  it("clears its own suggestion when there is no longer one to make", () => {
    // Switching Match back to Training: the label it put there goes with it.
    expect(nextSuggestedLabel("U14 Mavericks v U18 Cobras", "U14 Mavericks v U18 Cobras", "")).toBe(
      "",
    );
  });

  it("leaves a hand-typed label alone when there is no suggestion", () => {
    expect(nextSuggestedLabel("Tuesday training", "", "")).toBe("Tuesday training");
  });
});

describe("what a coach may ask a pitch for", () => {
  it("offers a match, and calls the fixture kind by its human name", () => {
    expect(PITCH_BOOKING_KINDS).toContain("fixture");
    expect(PITCH_BOOKING_KIND_LABELS.fixture).toBe("Match");
    // The pitch diary's own word for the same enum value stays as it was.
    expect(kindLabel("fixture")).toBe("Fixture");
  });
});

describe("isOppositionSide", () => {
  it("admits only the two answers the form asks for", () => {
    expect(isOppositionSide("internal")).toBe(true);
    expect(isOppositionSide("external")).toBe(true);
    expect(isOppositionSide("someone else")).toBe(false);
    expect(isOppositionSide(null)).toBe(false);
    expect(isOppositionSide(undefined)).toBe(false);
  });
});
