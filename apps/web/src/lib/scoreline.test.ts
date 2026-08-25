import { describe, expect, it } from "vitest";

import { effectiveScore, scoreSourceLabel, scorelineLabel } from "./scoreline";

const NONE = {
  homeScore: null,
  awayScore: null,
  coachHomeScore: null,
  coachAwayScore: null,
};

describe("effectiveScore", () => {
  it("is null when nobody has given the match a result", () => {
    expect(effectiveScore(NONE)).toBeNull();
  });

  it("uses Full-Time's pair when only Full-Time has one", () => {
    expect(effectiveScore({ ...NONE, homeScore: 2, awayScore: 1 })).toEqual({
      home: 2,
      away: 1,
      source: "fulltime",
    });
  });

  it("uses the coach's pair when only the coach has one (U12 and below)", () => {
    expect(effectiveScore({ ...NONE, coachHomeScore: 4, coachAwayScore: 0 })).toEqual({
      home: 4,
      away: 0,
      source: "coach",
    });
  });

  it("lets the coach override Full-Time — Adam's rule", () => {
    expect(
      effectiveScore({ homeScore: 2, awayScore: 2, coachHomeScore: 3, coachAwayScore: 1 }),
    ).toEqual({ home: 3, away: 1, source: "coach" });
  });

  it("keeps a nil-nil, which is a result, not a missing one", () => {
    expect(effectiveScore({ ...NONE, coachHomeScore: 0, coachAwayScore: 0 })).toEqual({
      home: 0,
      away: 0,
      source: "coach",
    });
  });

  it("treats a half-filled pair as no score rather than as a zero", () => {
    expect(effectiveScore({ ...NONE, coachHomeScore: 3 })).toBeNull();
    expect(effectiveScore({ ...NONE, homeScore: 3 })).toBeNull();
    expect(effectiveScore({ homeScore: 2, awayScore: 1, coachHomeScore: 3, coachAwayScore: null }))
      .toEqual({ home: 2, away: 1, source: "fulltime" });
  });

  it("ignores nonsense — negatives and NaN are not scores", () => {
    expect(effectiveScore({ ...NONE, coachHomeScore: -1, coachAwayScore: 2 })).toBeNull();
    expect(effectiveScore({ ...NONE, homeScore: Number.NaN, awayScore: 0 })).toBeNull();
  });

  it("copes with undefined as well as null", () => {
    expect(
      effectiveScore({
        homeScore: undefined,
        awayScore: undefined,
        coachHomeScore: undefined,
        coachAwayScore: undefined,
      }),
    ).toBeNull();
  });
});

describe("scorelineLabel", () => {
  it("puts us first at home", () => {
    expect(scorelineLabel({ ...NONE, coachHomeScore: 3, coachAwayScore: 1, isHome: true })).toEqual({
      us: 3,
      them: 1,
      text: "3–1",
      outcome: "win",
      source: "coach",
    });
  });

  it("turns the score round away from home", () => {
    expect(scorelineLabel({ ...NONE, homeScore: 3, awayScore: 1, isHome: false })).toEqual({
      us: 1,
      them: 3,
      text: "1–3",
      outcome: "loss",
      source: "fulltime",
    });
  });

  it("calls a draw a draw", () => {
    expect(scorelineLabel({ ...NONE, coachHomeScore: 2, coachAwayScore: 2, isHome: true })?.outcome)
      .toBe("draw");
  });

  it("is null when there is no score at all", () => {
    expect(scorelineLabel({ ...NONE, isHome: true })).toBeNull();
  });
});

describe("scoreSourceLabel", () => {
  it("names where the number came from", () => {
    expect(scoreSourceLabel("coach")).toBe("Entered by the coach");
    expect(scoreSourceLabel("fulltime")).toBe("From Full-Time");
  });
});
