/**
 * The shapes the block page hands its panels — plain data, read once on the
 * server and drawn by the client components. Kept apart from any `"use
 * client"` module so the page can import them without pulling a component
 * along.
 */

export type AllocationRow = {
  id: string;
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  shares: number;
};

export type SlotRow = {
  id: string;
  venueId: string | null;
  venueName: string;
  venueAddress: string | null;
  /** Which of the venue's pitches; null = the only one. */
  pitchId: string | null;
  pitchName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  /** How many of `parts` are the club's to hand out; null = all of them. */
  clubParts: number | null;
  notes: string | null;
  allocations: AllocationRow[];
};

export type TeamOption = { id: string; name: string; ageGroup: string | null; trainingDay: number | null };

/** A slot the club has booked at a venue (venue_booking_slots), as a quick pick. */
export type BookedSlot = {
  pitchId: string | null;
  pitchName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  shares: number;
};

export type VenueOption = {
  id: string;
  name: string;
  forTraining: boolean;
  /** How the pitch is divided when the club trains here, 1–6. */
  trainingParts: number;
  /** How many of those parts are the club's. */
  trainingShares: number;
  trainingNotes: string | null;
  /** The venue's pitches (active), for "which pitch" on a slot. */
  pitches: { id: string; name: string }[];
  /** What the club has booked here for this block's dates — the quick picks. */
  bookedSlots: BookedSlot[];
};

/** What a cell's "+" or a booked slot's "Use it" pre-fills on the new-slot form. */
export type SlotPrefill = {
  venueId?: string;
  pitchId?: string | null;
  weekday?: number;
  startTime?: string;
  endTime?: string;
  parts?: number;
  shares?: number;
};
