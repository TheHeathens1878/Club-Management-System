/**
 * The shapes the ground's page hands its grid and its sheet — plain data,
 * read once on the server and drawn by the client components. Kept apart
 * from any `"use client"` module so the page can import them without
 * pulling a component along (the same arrangement the training block page
 * uses next door).
 */

export type VenueBookingSlotRow = {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  /** Which of the venue's pitches; null = the only one. */
  pitchId: string | null;
  pitchName: string | null;
  parts: number;
  shares: number;
  /** Per session, in pence; null = not priced yet. */
  pricePence: number | null;
};

export type PitchChoice = { id: string; name: string };

export type VenueBookingRow = {
  id: string;
  seasonId: string | null;
  seasonName: string | null;
  /** The season's own first date, for ordering; "" when there is no season. */
  seasonStartsOn: string;
  seasonCurrent: boolean;
  startsOn: string;
  endsOn: string;
  reference: string | null;
  notes: string | null;
  slots: VenueBookingSlotRow[];
};

export type SeasonOption = { id: string; name: string; isCurrent: boolean };

/**
 * One cell of the grid: a booked slot with the ground and the booking it
 * belongs to bolted on, which is what makes it `TimetableSlot`-shaped and so
 * what lets `timetableRows()` lay this page out as well as the block page.
 */
export type VenueGridSlot = VenueBookingSlotRow & {
  venueId: string;
  venueName: string;
  bookingId: string;
  /** The booking's span — what the slot's sessions are counted across. */
  bookingStartsOn: string;
  bookingEndsOn: string;
};

/** "6 Oct 2026 – 23 Mar 2027" — a booking runs across the new year. */
export function bookingSpanLabel(startsOn: string, endsOn: string): string {
  const fmt = (date: string): string =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}
