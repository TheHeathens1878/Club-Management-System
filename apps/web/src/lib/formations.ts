/**
 * The formations a team may line up in, per playing format (Adam, 2026-08-25:
 * "The formations available will depend on the playing format").
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
 * "LM" …): changing formation keeps everyone whose key survives.
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

const GK = (y = 92): FormationSlot => ({ key: "GK", label: "GK", x: 50, y });

/** Non-empty by construction — every format has at least one shape to fall back on. */
export const FORMATIONS: Record<PlayingFormat, readonly [Formation, ...Formation[]]> = {
  "11v11": [
    {
      name: "4-4-2",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 15, y: 72 },
        { key: "CB1", label: "CB", x: 38, y: 75 },
        { key: "CB2", label: "CB", x: 62, y: 75 },
        { key: "RB", label: "RB", x: 85, y: 72 },
        { key: "LM", label: "LM", x: 15, y: 47 },
        { key: "CM1", label: "CM", x: 38, y: 50 },
        { key: "CM2", label: "CM", x: 62, y: 50 },
        { key: "RM", label: "RM", x: 85, y: 47 },
        { key: "ST1", label: "ST", x: 37, y: 20 },
        { key: "ST2", label: "ST", x: 63, y: 20 },
      ],
    },
    {
      name: "4-3-3",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 15, y: 72 },
        { key: "CB1", label: "CB", x: 38, y: 75 },
        { key: "CB2", label: "CB", x: 62, y: 75 },
        { key: "RB", label: "RB", x: 85, y: 72 },
        { key: "CM1", label: "CM", x: 25, y: 50 },
        { key: "CM2", label: "CM", x: 50, y: 54 },
        { key: "CM3", label: "CM", x: 75, y: 50 },
        { key: "LW", label: "LW", x: 18, y: 22 },
        { key: "ST1", label: "ST", x: 50, y: 16 },
        { key: "RW", label: "RW", x: 82, y: 22 },
      ],
    },
    {
      name: "3-5-2",
      slots: [
        GK(),
        { key: "CB1", label: "CB", x: 25, y: 74 },
        { key: "CB2", label: "CB", x: 50, y: 77 },
        { key: "CB3", label: "CB", x: 75, y: 74 },
        { key: "LM", label: "LM", x: 12, y: 48 },
        { key: "CM1", label: "CM", x: 33, y: 52 },
        { key: "CM2", label: "CM", x: 50, y: 44 },
        { key: "CM3", label: "CM", x: 67, y: 52 },
        { key: "RM", label: "RM", x: 88, y: 48 },
        { key: "ST1", label: "ST", x: 37, y: 18 },
        { key: "ST2", label: "ST", x: 63, y: 18 },
      ],
    },
    {
      name: "4-5-1",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 15, y: 72 },
        { key: "CB1", label: "CB", x: 38, y: 75 },
        { key: "CB2", label: "CB", x: 62, y: 75 },
        { key: "RB", label: "RB", x: 85, y: 72 },
        { key: "LM", label: "LM", x: 12, y: 46 },
        { key: "CM1", label: "CM", x: 33, y: 50 },
        { key: "CM2", label: "CM", x: 50, y: 42 },
        { key: "CM3", label: "CM", x: 67, y: 50 },
        { key: "RM", label: "RM", x: 88, y: 46 },
        { key: "ST1", label: "ST", x: 50, y: 17 },
      ],
    },
  ],
  "9v9": [
    {
      name: "3-3-2",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 20, y: 72 },
        { key: "CB1", label: "CB", x: 50, y: 76 },
        { key: "RB", label: "RB", x: 80, y: 72 },
        { key: "LM", label: "LM", x: 20, y: 47 },
        { key: "CM1", label: "CM", x: 50, y: 50 },
        { key: "RM", label: "RM", x: 80, y: 47 },
        { key: "ST1", label: "ST", x: 36, y: 20 },
        { key: "ST2", label: "ST", x: 64, y: 20 },
      ],
    },
    {
      name: "3-2-3",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 20, y: 72 },
        { key: "CB1", label: "CB", x: 50, y: 76 },
        { key: "RB", label: "RB", x: 80, y: 72 },
        { key: "CM1", label: "CM", x: 35, y: 50 },
        { key: "CM2", label: "CM", x: 65, y: 50 },
        { key: "LW", label: "LW", x: 20, y: 22 },
        { key: "ST1", label: "ST", x: 50, y: 17 },
        { key: "RW", label: "RW", x: 80, y: 22 },
      ],
    },
    {
      name: "2-4-2",
      slots: [
        GK(),
        { key: "CB1", label: "CB", x: 35, y: 74 },
        { key: "CB2", label: "CB", x: 65, y: 74 },
        { key: "LM", label: "LM", x: 15, y: 48 },
        { key: "CM1", label: "CM", x: 38, y: 51 },
        { key: "CM2", label: "CM", x: 62, y: 51 },
        { key: "RM", label: "RM", x: 85, y: 48 },
        { key: "ST1", label: "ST", x: 36, y: 20 },
        { key: "ST2", label: "ST", x: 64, y: 20 },
      ],
    },
    {
      name: "3-4-1",
      slots: [
        GK(),
        { key: "LB", label: "LB", x: 20, y: 72 },
        { key: "CB1", label: "CB", x: 50, y: 76 },
        { key: "RB", label: "RB", x: 80, y: 72 },
        { key: "LM", label: "LM", x: 15, y: 47 },
        { key: "CM1", label: "CM", x: 38, y: 50 },
        { key: "CM2", label: "CM", x: 62, y: 50 },
        { key: "RM", label: "RM", x: 85, y: 47 },
        { key: "ST1", label: "ST", x: 50, y: 19 },
      ],
    },
  ],
  "7v7": [
    {
      name: "2-3-1",
      slots: [
        GK(90),
        { key: "LB", label: "LB", x: 32, y: 72 },
        { key: "RB", label: "RB", x: 68, y: 72 },
        { key: "LM", label: "LM", x: 20, y: 46 },
        { key: "CM1", label: "CM", x: 50, y: 49 },
        { key: "RM", label: "RM", x: 80, y: 46 },
        { key: "ST1", label: "ST", x: 50, y: 19 },
      ],
    },
    {
      name: "3-2-1",
      slots: [
        GK(90),
        { key: "LB", label: "LB", x: 22, y: 71 },
        { key: "CB1", label: "CB", x: 50, y: 75 },
        { key: "RB", label: "RB", x: 78, y: 71 },
        { key: "CM1", label: "CM", x: 35, y: 47 },
        { key: "CM2", label: "CM", x: 65, y: 47 },
        { key: "ST1", label: "ST", x: 50, y: 19 },
      ],
    },
    {
      name: "2-2-2",
      slots: [
        GK(90),
        { key: "LB", label: "LB", x: 32, y: 72 },
        { key: "RB", label: "RB", x: 68, y: 72 },
        { key: "CM1", label: "CM", x: 32, y: 48 },
        { key: "CM2", label: "CM", x: 68, y: 48 },
        { key: "ST1", label: "ST", x: 35, y: 20 },
        { key: "ST2", label: "ST", x: 65, y: 20 },
      ],
    },
  ],
  "5v5": [
    {
      name: "1-2-1",
      slots: [
        GK(88),
        { key: "CB1", label: "CB", x: 50, y: 70 },
        { key: "LM", label: "LM", x: 27, y: 45 },
        { key: "RM", label: "RM", x: 73, y: 45 },
        { key: "ST1", label: "ST", x: 50, y: 20 },
      ],
    },
    {
      name: "2-1-1",
      slots: [
        GK(88),
        { key: "LB", label: "LB", x: 30, y: 70 },
        { key: "RB", label: "RB", x: 70, y: 70 },
        { key: "CM1", label: "CM", x: 50, y: 45 },
        { key: "ST1", label: "ST", x: 50, y: 20 },
      ],
    },
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
