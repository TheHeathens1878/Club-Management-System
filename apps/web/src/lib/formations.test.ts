import { describe, expect, it } from "vitest";

import { FORMATIONS, formationByName, playingFormatFor, type PlayingFormat } from "./formations";

const PLAYERS: Record<PlayingFormat, number> = { "5v5": 5, "7v7": 7, "9v9": 9, "11v11": 11 };

/** The CHECK constraint on `fixture_lineups.formation`. */
const NAME_SHAPE = /^[0-9]+(-[0-9]+){1,4}$/;

describe("formations", () => {
  for (const [format, list] of Object.entries(FORMATIONS) as [PlayingFormat, typeof FORMATIONS[PlayingFormat]][]) {
    describe(format, () => {
      it("offers more than one shape", () => {
        expect(list.length).toBeGreaterThan(1);
      });

      for (const formation of list) {
        it(`${formation.name} fields exactly ${PLAYERS[format]} including the keeper`, () => {
          expect(formation.slots).toHaveLength(PLAYERS[format]);
        });

        it(`${formation.name} is named the way the database admits`, () => {
          expect(formation.name).toMatch(NAME_SHAPE);
          const outfield = formation.name.split("-").reduce((sum, n) => sum + Number(n), 0);
          expect(outfield).toBe(PLAYERS[format] - 1);
        });

        it(`${formation.name} gives every player their own slot key on the pitch`, () => {
          const keys = formation.slots.map((slot) => slot.key);
          expect(new Set(keys).size).toBe(keys.length);
          expect(keys[0]).toBe("GK");
          for (const slot of formation.slots) {
            expect(slot.x).toBeGreaterThanOrEqual(0);
            expect(slot.x).toBeLessThanOrEqual(100);
            expect(slot.y).toBeGreaterThan(0);
            expect(slot.y).toBeLessThan(100);
          }
          // No two players drawn on top of each other.
          const spots = new Set(formation.slots.map((slot) => `${slot.x},${slot.y}`));
          expect(spots.size).toBe(formation.slots.length);
        });
      }

      it("has no two shapes with the same name", () => {
        expect(new Set(list.map((f) => f.name)).size).toBe(list.length);
      });
    });
  }

  it("keeps the shapes the first release shipped, so stored lineups still resolve", () => {
    for (const [format, names] of [
      ["11v11", ["4-4-2", "4-3-3", "3-5-2", "4-5-1"]],
      ["9v9", ["3-3-2", "3-2-3", "2-4-2", "3-4-1"]],
      ["7v7", ["2-3-1", "3-2-1", "2-2-2"]],
      ["5v5", ["1-2-1", "2-1-1"]],
    ] as const) {
      for (const name of names) {
        expect(formationByName(format, name).name).toBe(name);
      }
    }
  });

  it("falls back to the format's first shape for a name from another format", () => {
    expect(formationByName("7v7", "4-4-2").name).toBe("2-3-1");
  });

  it("reads the playing format off the age group", () => {
    expect(playingFormatFor("U8")).toBe("5v5");
    expect(playingFormatFor("U10")).toBe("7v7");
    expect(playingFormatFor("U12")).toBe("9v9");
    expect(playingFormatFor("U15")).toBe("11v11");
    expect(playingFormatFor(null)).toBe("11v11");
  });

  /**
   * Adam, 2026-09-02: "one of our adult women's teams plays 9 a side." No age
   * group can say that — Senior means 11v11 in the FA table and always will —
   * so `teams.playing_format` overrides it outright (20260902150000).
   */
  it("lets the club's own answer win over the age group", () => {
    expect(playingFormatFor("Open Age", "9v9")).toBe("9v9");
    expect(playingFormatFor("U15", "7v7")).toBe("7v7");
  });

  it("falls back to the age group when the club has set nothing, or nonsense", () => {
    expect(playingFormatFor("U12", null)).toBe("9v9");
    expect(playingFormatFor("U12", "")).toBe("9v9");
    // Not one of the four shapes the club fields a side in: ignored rather
    // than trusted, because there is no formation set behind it.
    expect(playingFormatFor("U12", "3v3 (carousel)")).toBe("9v9");
  });
});
