/**
 * The ground's panel, in each of its modes (P8.8).
 *
 * A Sheet is portalled to <body> so that everything else in the document can
 * be made `inert` while it is open — which means the harness's assertions,
 * scoped to `#root`, do not see inside it. These cases are here for the
 * SCREENSHOTS and for the console-error check: what a drawer looks like at
 * 1440 against what it looks like at 390 is the point, and a portal that
 * fails to mount shows up as an empty page.
 *
 * `edit` is the one worth reading twice. `venue_booking_slots` carries an
 * insert and a delete and nothing between, so the panel offers the corrected
 * slot as a new one and says why rather than pretending to save in place.
 */

import { VenueSlotSheet } from "@/app/(app)/venues/[id]/venue-slot-sheet";
import type { PitchChoice, SeasonOption, VenueBookingRow } from "@/app/(app)/venues/[id]/types";

import type { Fixture } from "./contract";

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const SEASON = { id: "season-2627", name: "2026/27" };

const PITCHES: PitchChoice[] = [
  { id: "pitch-1", name: "Pitch 1" },
  { id: "pitch-2", name: "Pitch 2" },
];

const SEASONS: SeasonOption[] = [
  { id: SEASON.id, name: SEASON.name, isCurrent: true },
  { id: "season-2526", name: "2025/26", isCurrent: false },
];

const BOOKING: VenueBookingRow = {
  id: "booking-2627",
  seasonId: SEASON.id,
  seasonName: SEASON.name,
  seasonStartsOn: "2026-08-01",
  seasonCurrent: true,
  startsOn: "2026-10-05",
  endsOn: "2027-03-22",
  reference: "LHS-0412",
  notes: "Paid to Christmas; second half invoiced in January.",
  slots: [
    {
      id: "s1",
      weekday: 1,
      startTime: "18:00",
      endTime: "19:00",
      pitchId: "pitch-1",
      pitchName: "Pitch 1",
      parts: 3,
      shares: 2,
      pricePence: 2800,
    },
    {
      id: "s2",
      weekday: 4,
      startTime: "18:00",
      endTime: "19:00",
      pitchId: "pitch-2",
      pitchName: "Pitch 2",
      parts: 2,
      shares: 1,
      pricePence: null,
    },
  ],
};

const UNCHARGED = [{ startsOn: "2026-12-21", endsOn: "2027-01-04" }];

function Page() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Banky Lane</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">2026/27 · 2 slots booked · £742.00 for the season</p>
        <p className="text-list text-muted-foreground">Pitch 1 · Monday 18:00–19:00</p>
      </div>
    </div>
  );
}

const noop = () => {};

function Panel({ state }: { state: Parameters<typeof VenueSlotSheet>[0]["state"] }) {
  return (
    <>
      <Page />
      <VenueSlotSheet
        venueId={VENUE_ID}
        venueName="Banky Lane"
        state={state}
        bookings={[BOOKING]}
        seasons={SEASONS}
        pitches={PITCHES}
        uncharged={UNCHARGED}
        currentSeasonId={SEASON.id}
        onClose={noop}
      />
    </>
  );
}

const fixture: Fixture = {
  cases: {
    /** A card pressed: the slot, what it costs, and its two doors. */
    slot: () => <Panel state={{ kind: "slot", slotId: "s1" }} />,

    /** An unpriced slot — the warning token, not a £0.00. */
    unpricedSlot: () => <Panel state={{ kind: "slot", slotId: "s2" }} />,

    /** An empty cell's "+": the pitch and the day already filled in. */
    addSlot: () => <Panel state={{ kind: "add", bookingId: BOOKING.id, pitchId: "pitch-2", weekday: 3 }} />,

    /** The status bar's button: a whole season typed in one go. */
    newBooking: () => <Panel state={{ kind: "booking", bookingId: null }} />,

    /** The booking itself: its dates, its reference, its notes and its remove. */
    booking: () => <Panel state={{ kind: "booking", bookingId: BOOKING.id }} />,
  },
};

export default fixture;
