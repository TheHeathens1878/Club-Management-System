import { describe, expect, it } from "vitest";

import { benchKeys, isBenchKey, BENCH_SIZE, benchLabel } from "./formations";
import {
  boardSignature,
  clearSlot,
  dropOnSlot,
  firstFreeSlot,
  keepSlots,
  removePlayer,
  slotOf,
} from "./lineup-placements";

const board = { GK: "kim", CB1: "ali", ST1: "raj" };

describe("dropOnSlot", () => {
  it("places an unplaced player on an empty slot", () => {
    expect(dropOnSlot(board, "CB2", "sam")).toEqual({ ...board, CB2: "sam" });
  });

  it("swaps two players already on the board", () => {
    expect(dropOnSlot(board, "ST1", "kim")).toEqual({ GK: "raj", CB1: "ali", ST1: "kim" });
  });

  it("moves a placed player to an empty slot, emptying the one they left", () => {
    expect(dropOnSlot(board, "CB2", "kim")).toEqual({ CB1: "ali", ST1: "raj", CB2: "kim" });
  });

  it("displaces the occupant when the newcomer has no slot to offer back", () => {
    const next = dropOnSlot(board, "GK", "sam");
    expect(next).toEqual({ GK: "sam", CB1: "ali", ST1: "raj" });
    expect(slotOf(next, "kim")).toBeNull();
  });

  it("is a no-op when a player is dropped on the slot they already hold", () => {
    expect(dropOnSlot(board, "GK", "kim")).toBe(board);
  });

  it("never leaves a player in two slots", () => {
    const next = dropOnSlot(dropOnSlot(board, "SUB1", "ali"), "ST1", "ali");
    expect(Object.values(next).filter((id) => id === "ali")).toHaveLength(1);
    expect(next.ST1).toBe("ali");
  });

  it("does not mutate what it was given", () => {
    const before = { ...board };
    dropOnSlot(board, "ST1", "kim");
    expect(board).toEqual(before);
  });
});

describe("the bench is just more slots", () => {
  it("moves a starter onto the bench and empties their pitch slot", () => {
    expect(dropOnSlot(board, "SUB1", "kim")).toEqual({ CB1: "ali", ST1: "raj", SUB1: "kim" });
  });

  it("swaps a substitute with a starter", () => {
    const withBench = { ...board, SUB1: "sam" };
    expect(dropOnSlot(withBench, "ST1", "sam")).toEqual({
      GK: "kim",
      CB1: "ali",
      ST1: "sam",
      SUB1: "raj",
    });
  });

  it("names seven places, all single-digit", () => {
    expect(benchKeys()).toHaveLength(BENCH_SIZE);
    expect(benchKeys()[0]).toBe("SUB1");
    expect(benchKeys().every((key) => /^SUB[1-9]$/.test(key))).toBe(true);
  });

  it("knows a bench key from a pitch key", () => {
    expect(isBenchKey("SUB1")).toBe(true);
    expect(isBenchKey("SUB7")).toBe(true);
    expect(isBenchKey("SUB8")).toBe(false);
    expect(isBenchKey("SUB10")).toBe(false);
    expect(isBenchKey("GK")).toBe(false);
    expect(isBenchKey("ST1")).toBe(false);
  });

  it("labels a bench place the way the sheet reads it", () => {
    expect(benchLabel("SUB3")).toBe("Substitute 3");
  });
});

describe("removePlayer / clearSlot", () => {
  it("takes a player off wherever they stood", () => {
    expect(removePlayer(board, "ali")).toEqual({ GK: "kim", ST1: "raj" });
  });

  it("returns the same board when the player is not on it", () => {
    expect(removePlayer(board, "sam")).toBe(board);
  });

  it("empties one slot", () => {
    expect(clearSlot(board, "GK")).toEqual({ CB1: "ali", ST1: "raj" });
    expect(clearSlot(board, "SUB4")).toBe(board);
  });
});

describe("firstFreeSlot", () => {
  it("finds the first key nobody holds", () => {
    expect(firstFreeSlot(board, ["GK", "CB1", "CB2"])).toBe("CB2");
  });

  it("is null when every key is taken", () => {
    expect(firstFreeSlot(board, ["GK", "CB1"])).toBeNull();
  });

  it("fills the bench front to back", () => {
    expect(firstFreeSlot({ SUB1: "kim" }, benchKeys())).toBe("SUB2");
  });
});

describe("boardSignature", () => {
  it("ignores the order the slots were filled in", () => {
    const dragged = dropOnSlot(dropOnSlot(board, "CB2", "kim"), "GK", "kim");
    expect(dragged).not.toBe(board);
    expect(boardSignature("4-4-2", dragged)).toBe(boardSignature("4-4-2", board));
  });

  it("notices a real change", () => {
    expect(boardSignature("4-4-2", board)).not.toBe(
      boardSignature("4-4-2", dropOnSlot(board, "SUB1", "kim")),
    );
    expect(boardSignature("4-4-2", board)).not.toBe(boardSignature("4-3-3", board));
  });
});

describe("keepSlots", () => {
  it("drops the keys the new shape does not have but keeps the bench", () => {
    const withBench = { ...board, SUB1: "sam" };
    const shape = new Set(["GK", "CB1"]);
    expect(keepSlots(withBench, (key) => shape.has(key) || isBenchKey(key))).toEqual({
      GK: "kim",
      CB1: "ali",
      SUB1: "sam",
    });
  });
});
