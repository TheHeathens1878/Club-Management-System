/**
 * One fixture as the desk holds it: read from `matchday_fixtures()` and
 * formatted ONCE, on the server (`page.tsx`), so the grid, the sheet, the
 * print table and the CSV all say the same words about the same match.
 *
 * It lives in a plain module rather than beside the grid because
 * `lib/fixture-grid.ts` is pure and both the server page and the `"use
 * client"` grid import it — a type exported from a `"use client"` file would
 * drag that file's directive along behind it.
 */
export type DeskRow = {
  id: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  /** `teams.age_group` — the desk's age-order sort. */
  ageGroup: string | null;
  opponent: string;
  isHome: boolean;
  competition: string;
  status: string;
  /** "Sat 6 Sep" / "10:30" — London wall clock, formatted by the server. */
  date: string;
  time: string;
  /** "2026-09-06", for the date-range filter. */
  dateIso: string;
  /** "Banky Lane 1" | "Unallocated" | "Away" — or the central venue's name. */
  pitch: string;
  /** Booking exists — or the team plays at a central venue, which is just as settled. */
  allocated: boolean;
  /** The ground: "Ashton Park" | "Unallocated" | "Away" | a central venue. */
  venue: string;
  venueText: string | null;
  accepted: number;
  declined: number;
  squad: number;
};
