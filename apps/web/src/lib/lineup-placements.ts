/**
 * What a placement gesture does to the board — the rules, with no React and no
 * pixels, so they can be read and tested on their own.
 *
 * The board is one flat map of slot key → person id, holding both the pitch
 * slots ("GK", "CB1") and the bench ("SUB1".."SUB7"). That is exactly the row
 * set `fixture_lineup_slots` stores, which is why the same two rules the
 * database's unique keys enforce are the only rules here: a slot holds one
 * person, and a person stands in one slot.
 *
 * Everything a coach can do is one of three moves:
 *
 *   dropOnSlot   — put a player on a slot. If they came from another slot and
 *                  the target is taken, the two SWAP; that is what a drag from
 *                  one shirt onto another looks like it should do. Dropping
 *                  someone from the unplaced list onto a taken slot displaces
 *                  the occupant, who goes back to the list — the same thing
 *                  tapping a filled slot and picking a new name has always
 *                  done.
 *   removePlayer — take a player off the board, wherever they were.
 *   clearSlot    — empty one slot.
 *
 * Every function returns a NEW map and never mutates its argument.
 */

export type Placements = Record<string, string>;

/** The slot a person currently occupies, or null. */
export function slotOf(placements: Placements, personId: string): string | null {
  for (const [slot, id] of Object.entries(placements)) {
    if (id === personId) return slot;
  }
  return null;
}

/**
 * Put `personId` on `targetSlot`.
 *
 * Swaps when the player was already on the board and the target is taken;
 * otherwise the target's occupant (if any) is unplaced.
 */
export function dropOnSlot(
  placements: Placements,
  targetSlot: string,
  personId: string,
): Placements {
  const from = slotOf(placements, personId);
  if (from === targetSlot) return placements;

  const occupant = placements[targetSlot];
  const next: Placements = { ...placements };
  delete next[targetSlot];
  if (from) delete next[from];

  next[targetSlot] = personId;
  // A swap only makes sense between two slots: someone coming off the unplaced
  // list has no seat to offer in return, so the occupant simply steps off.
  if (occupant && occupant !== personId && from) next[from] = occupant;
  return next;
}

/** Take someone off the board entirely. */
export function removePlayer(placements: Placements, personId: string): Placements {
  const from = slotOf(placements, personId);
  if (!from) return placements;
  const next = { ...placements };
  delete next[from];
  return next;
}

/** Empty one slot. */
export function clearSlot(placements: Placements, slotKey: string): Placements {
  if (!(slotKey in placements)) return placements;
  const next = { ...placements };
  delete next[slotKey];
  return next;
}

/**
 * A stable string for "this board, in this shape" — key order sorted, so
 * moving a player away and back again is recognised as no change at all and
 * the Save button goes quiet.
 */
export function boardSignature(formationName: string, placements: Placements): string {
  const entries = Object.entries(placements).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([formationName, entries]);
}

/** The first key in `keys` nobody is standing on, or null when all are taken. */
export function firstFreeSlot(placements: Placements, keys: readonly string[]): string | null {
  return keys.find((key) => !placements[key]) ?? null;
}

/**
 * Drop the placements whose slot key the new shape does not have, keeping the
 * bench (whose keys belong to no formation) untouched.
 */
export function keepSlots(
  placements: Placements,
  keep: (slotKey: string) => boolean,
): Placements {
  const next: Placements = {};
  for (const [slot, personId] of Object.entries(placements)) {
    if (keep(slot)) next[slot] = personId;
  }
  return next;
}
