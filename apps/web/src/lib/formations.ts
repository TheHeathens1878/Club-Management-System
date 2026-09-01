/**
 * The formations a team may line up in, per playing format (Adam, 2026-08-25:
 * "The formations available will depend on the playing format"; later that
 * evening: "We also need much more formations at 11 a side and other
 * formats").
 *
 * Code, not data: the FA's shapes are a reference table, not club records, so
 * they live here beside `fa-formats.ts` — a team's format is derived from its
 * age group, never stored, and a new shape is a pull request rather than a
 * migration. The database only keeps the chosen formation's name and which
 * person stands on which slot key.
 *
 * Coordinates are percentages of a PORTRAIT pitch, `y` counted from the top:
 * y = 0 is the opponents' goal line and y = 100 is your own, so the goalkeeper
 * sits at the bottom and the strikers at the top — the way a coach holds a
 * tactics board. Slot keys are shared across shapes on purpose ("GK", "CB1",
 * "LM" …): changing formation keeps everyone whose key survives. The keys
 * follow the position's usual name — LB/RB, LWB/RWB, CB1–3, DM1–2, CM1–3,
 * AM1–2, LM/RM, LW/RW, ST1–2 — so a left-back stays a left-back whether the
 * shape has four at the back or five.
 *
 * Shapes are built from LINES (see `shape()`): a line is a number of players
 * at one depth, spread evenly across the pitch, with keys and labels chosen
 * for that line's role. The names follow the convention the FA and every
 * coaching manual use — outfield players from the back, the goalkeeper
 * implied — which is also the shape `fixture_lineups.formation`'s CHECK
 * constraint admits (`^[0-9]+(-[0-9]+){1,4}$`).
 *
 * Plain module, no server imports — a client component reads it too.
 */

import { faFormatFor } from "./fa-formats";

/** The four formats the club fields a shaped side in. */
export type PlayingFormat = "5v5" | "7v7" | "9v9" | "11v11";

export type FormationSlot = {
  /** Stable across formations — "CB1", "LM", "ST2". Persisted. */
  key: string;
  /** What the position is called under an empty circle. */
  label: string;
  /** Percentage across the pitch, 0 = left touchline. */
  x: number;
  /** Percentage down the pitch, 0 = opponents' goal line. */
  y: number;
};

export type Formation = {
  /** "4-4-2" — persisted as `fixture_lineups.formation`. */
  name: string;
  slots: readonly FormationSlot[];
};

/**
 * The roles a line can play, from the back. Each names its keys/labels for
 * one, two, three, four or five players across — the wide players first take
 * the wide keys (LB/RB, LM/RM, LW/RW) and the middle ones the numbered
 * central keys, so a 3 and a 5 at the back share CB1..CB3 and a 4-4-2's LB is
 * the 5-3-2's LB too.
 */
type LineRole = "defence" | "holding" | "midfield" | "attackingMid" | "attack";

const LINE_KEYS: Record<LineRole, Record<number, readonly [string, string][]>> = {
  defence: {
    1: [["CB1", "CB"]],
    2: [["CB1", "CB"], ["CB2", "CB"]],
    3: [["LB", "LB"], ["CB1", "CB"], ["RB", "RB"]],
    4: [["LB", "LB"], ["CB1", "CB"], ["CB2", "CB"], ["RB", "RB"]],
    5: [["LWB", "LWB"], ["CB1", "CB"], ["CB2", "CB"], ["CB3", "CB"], ["RWB", "RWB"]],
  },
  holding: {
    1: [["DM1", "DM"]],
    2: [["DM1", "DM"], ["DM2", "DM"]],
    3: [["LM", "LM"], ["DM1", "DM"], ["RM", "RM"]],
    4: [["LM", "LM"], ["DM1", "DM"], ["DM2", "DM"], ["RM", "RM"]],
    5: [["LM", "LM"], ["DM1", "DM"], ["CM1", "CM"], ["DM2", "DM"], ["RM", "RM"]],
  },
  midfield: {
    1: [["CM1", "CM"]],
    2: [["CM1", "CM"], ["CM2", "CM"]],
    3: [["CM1", "CM"], ["CM2", "CM"], ["CM3", "CM"]],
    4: [["LM", "LM"], ["CM1", "CM"], ["CM2", "CM"], ["RM", "RM"]],
    5: [["LM", "LM"], ["CM1", "CM"], ["CM2", "CM"], ["CM3", "CM"], ["RM", "RM"]],
  },
  attackingMid: {
    1: [["AM1", "AM"]],
    2: [["AM1", "AM"], ["AM2", "AM"]],
    3: [["LW", "LW"], ["AM1", "AM"], ["RW", "RW"]],
    4: [["LW", "LW"], ["AM1", "AM"], ["AM2", "AM"], ["RW", "RW"]],
    5: [["LW", "LW"], ["AM1", "AM"], ["CM2", "CM"], ["AM2", "AM"], ["RW", "RW"]],
  },
  attack: {
    1: [["ST1", "ST"]],
    2: [["ST1", "ST"], ["ST2", "ST"]],
    3: [["LW", "LW"], ["ST1", "ST"], ["RW", "RW"]],
    4: [["LW", "LW"], ["ST1", "ST"], ["ST2", "ST"], ["RW", "RW"]],
    5: [["LW", "LW"], ["ST1", "ST"], ["ST2", "ST"], ["ST3", "ST"], ["RW", "RW"]],
  },
};

/** How far in from the touchlines a line of N players spreads. */
function spread(count: number): number[] {
  if (count === 1) return [50];
  const inset = count >= 4 ? 14 : count === 3 ? 20 : 32;
  const step = (100 - inset * 2) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(inset + step * i));
}

/**
 * The depths the lines sit at, from the goalkeeper's y upwards, spread across
 * the pitch between the back line and the front line so a shape with five
 * lines does not bunch and a shape with three does not gape.
 */
function depths(lineCount: number, gkY: number): number[] {
  const back = gkY - 18;
  const front = 18;
  if (lineCount === 1) return [Math.round((back + front) / 2)];
  const step = (back - front) / (lineCount - 1);
  return Array.from({ length: lineCount }, (_, i) => Math.round(back - step * i));
}

type LineSpec = { role: LineRole; count: number };

/**
 * Build a formation from its lines, back to front. Wide players in a line
 * stand a touch higher than the central ones (x = the touchline players'
 * columns, y − 3) — the way a back four is drawn, full-backs slightly
 * advanced of the centre-backs — so the board reads like a coach's.
 */
function shape(name: string, lines: LineSpec[], gkY = 92): Formation {
  const ys = depths(lines.length, gkY);
  const slots: FormationSlot[] = [{ key: "GK", label: "GK", x: 50, y: gkY }];
  lines.forEach((line, lineIndex) => {
    const keys = LINE_KEYS[line.role][line.count];
    if (!keys) throw new Error(`No key layout for ${line.count} ${line.role} players (${name})`);
    const xs = spread(line.count);
    keys.forEach(([key, label], i) => {
      const wide = line.count >= 3 && (i === 0 || i === line.count - 1);
      slots.push({ key, label, x: xs[i]!, y: ys[lineIndex]! - (wide ? 3 : 0) });
    });
  });
  return { name, slots };
}

const D = (count: number): LineSpec => ({ role: "defence", count });
const H = (count: number): LineSpec => ({ role: "holding", count });
const M = (count: number): LineSpec => ({ role: "midfield", count });
const A = (count: number): LineSpec => ({ role: "attackingMid", count });
const F = (count: number): LineSpec => ({ role: "attack", count });

/** Non-empty by construction — every format has at least one shape to fall back on. */
export const FORMATIONS: Record<PlayingFormat, readonly [Formation, ...Formation[]]> = {
  "11v11": [
    shape("4-4-2", [D(4), M(4), F(2)]),
    shape("4-3-3", [D(4), M(3), F(3)]),
    shape("4-2-3-1", [D(4), H(2), A(3), F(1)]),
    shape("4-1-4-1", [D(4), H(1), M(4), F(1)]),
    shape("4-4-1-1", [D(4), M(4), A(1), F(1)]),
    shape("4-3-1-2", [D(4), M(3), A(1), F(2)]),
    shape("4-1-2-1-2", [D(4), H(1), M(2), A(1), F(2)]),
    shape("4-5-1", [D(4), M(5), F(1)]),
    shape("4-2-2-2", [D(4), H(2), A(2), F(2)]),
    shape("3-5-2", [D(3), M(5), F(2)]),
    shape("3-4-3", [D(3), M(4), F(3)]),
    shape("3-4-1-2", [D(3), M(4), A(1), F(2)]),
    shape("3-4-2-1", [D(3), M(4), A(2), F(1)]),
    shape("5-3-2", [D(5), M(3), F(2)]),
    shape("5-4-1", [D(5), M(4), F(1)]),
    shape("5-2-3", [D(5), M(2), F(3)]),
  ],
  "9v9": [
    shape("3-3-2", [D(3), M(3), F(2)]),
    shape("3-2-3", [D(3), M(2), F(3)]),
    shape("2-4-2", [D(2), M(4), F(2)]),
    shape("3-4-1", [D(3), M(4), F(1)]),
    shape("3-1-3-1", [D(3), H(1), M(3), F(1)]),
    shape("3-2-2-1", [D(3), M(2), A(2), F(1)]),
    shape("2-3-3", [D(2), M(3), F(3)]),
    shape("2-3-2-1", [D(2), M(3), A(2), F(1)]),
    shape("4-3-1", [D(4), M(3), F(1)]),
    shape("4-2-2", [D(4), M(2), F(2)]),
    shape("3-1-2-2", [D(3), H(1), M(2), F(2)]),
  ],
  "7v7": [
    shape("2-3-1", [D(2), M(3), F(1)], 90),
    shape("3-2-1", [D(3), M(2), F(1)], 90),
    shape("2-2-2", [D(2), M(2), F(2)], 90),
    shape("3-1-2", [D(3), M(1), F(2)], 90),
    shape("2-1-2-1", [D(2), H(1), M(2), F(1)], 90),
    shape("1-3-2", [D(1), M(3), F(2)], 90),
    shape("2-1-3", [D(2), M(1), F(3)], 90),
    shape("3-3", [D(3), F(3)], 90),
    shape("1-2-2-1", [D(1), M(2), A(2), F(1)], 90),
  ],
  "5v5": [
    shape("1-2-1", [D(1), M(2), F(1)], 88),
    shape("2-1-1", [D(2), M(1), F(1)], 88),
    shape("1-1-2", [D(1), M(1), F(2)], 88),
    shape("2-2", [D(2), F(2)], 88),
    shape("1-3", [D(1), F(3)], 88),
    shape("3-1", [D(3), F(1)], 88),
  ],
};

export const PLAYING_FORMATS = Object.keys(FORMATIONS) as PlayingFormat[];

/**
 * The format a team's lineup board is drawn for, from `teams.age_group`.
 *
 * The FA table is the authority (U12–U13 are 9v9, U14 up is 11v11, …). Two of
 * its rows name no shaped side at all — U6 "Festival / development" and U7
 * "3v3 (carousel)" — and those age groups are played as rotating festivals
 * with no fixed formation; they get the 5v5 board, the smallest one we draw,
 * rather than nothing. An age group we cannot read at all falls back to 11v11.
 */
export function playingFormatFor(ageGroup: string | null | undefined): PlayingFormat {
  const format = faFormatFor(ageGroup)?.format;
  if (format === "5v5" || format === "7v7" || format === "9v9" || format === "11v11") {
    return format;
  }
  if (format) return "5v5";
  return "11v11";
}

/** The shapes on offer for a format. Never empty. */
export function formationsFor(format: PlayingFormat): readonly Formation[] {
  return FORMATIONS[format];
}

/**
 * One shape by name within a format, falling back to the format's first shape
 * when the stored name belongs to a format the team has since moved off (the
 * end-of-season rollover bumps age groups, so a U13's 3-2-3 becomes a U14's
 * problem).
 */
export function formationByName(format: PlayingFormat, name: string | null | undefined): Formation {
  const list = FORMATIONS[format];
  return list.find((f) => f.name === name) ?? list[0];
}

/** "GK", "CB1" … in the order they are drawn. */
export function slotKeys(formation: Formation): string[] {
  return formation.slots.map((slot) => slot.key);
}

/**
 * The bench (Adam, 2026-08-25: "Should be able to drag and drop players on to
 * the pitch and also substitutes").
 *
 * A substitute is not a second kind of record — it is a slot whose key is
 * "SUB1".."SUB7", stored in `fixture_lineup_slots` beside the pitch slots. The
 * table's two unique keys then say everything the bench needs saying on their
 * own: one player per bench place, and nobody both on the pitch and on the
 * bench. Bench keys are deliberately outside every formation's slot list, so
 * changing shape leaves the bench alone.
 *
 * Seven places, because seven 44px targets are what a 390px phone fits across
 * one strip without a sideways scroll a coach cannot reach mid-drag, and no
 * format the club fields names more. If a league ever wants more, raise this —
 * but it must stay a single digit, because the column's CHECK admits
 * `^[A-Z]{2,4}[0-9]?$` and would refuse "SUB10".
 */
export const BENCH_SIZE = 7;

/** "SUB1" … "SUB7", in bench order. */
export function benchKeys(): string[] {
  return Array.from({ length: BENCH_SIZE }, (_, index) => `SUB${index + 1}`);
}

/** True for a bench slot key this app issues — "SUB1".."SUB7" and no other. */
export function isBenchKey(key: string): boolean {
  const match = /^SUB([1-9])$/.exec(key);
  return match !== null && Number(match[1]) <= BENCH_SIZE;
}

/** "Substitute 3" — what a bench place is called in a sheet or a label. */
export function benchLabel(key: string): string {
  return `Substitute ${key.slice(3)}`;
}
