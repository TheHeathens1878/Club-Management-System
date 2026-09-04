import { describe, expect, it } from "vitest";

import { reallocationLines } from "./fixture-reallocation-email";

describe("reallocationLines", () => {
  it("names the game, the old pitch and the new one", () => {
    const lines = reallocationLines([
      {
        fixtureId: "f1",
        opponent: "Timperley FC",
        kickoffAt: "2026-09-05T08:30:00Z",
        fromPitch: "Ashton Park – Pitch 1 (Dumber Lane)",
        toPitch: "Dainewell Park – Pitch 2 (Near Park)",
        kickoffChanged: false,
      },
    ]);
    expect(lines).toEqual([
      "Sat, 5 Sept 2026, 09:30 v Timperley FC — Ashton Park – Pitch 1 (Dumber Lane) → Dainewell Park – Pitch 2 (Near Park)",
    ]);
  });

  it("says a re-timed game on the same pitch moved its kick-off", () => {
    const lines = reallocationLines([
      {
        fixtureId: "f2",
        opponent: "Sale United",
        kickoffAt: "2026-09-05T10:00:00Z",
        fromPitch: "Ashton Park – Pitch 1 (Dumber Lane)",
        toPitch: "Ashton Park – Pitch 1 (Dumber Lane)",
        kickoffChanged: true,
      },
    ]);
    expect(lines[0]).toContain("now on Ashton Park – Pitch 1 (Dumber Lane)");
    expect(lines[0]).toContain("(kick-off moved to 11:00)");
  });
});
