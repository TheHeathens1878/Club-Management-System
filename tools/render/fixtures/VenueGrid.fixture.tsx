/**
 * One ground's season, as a grid (P8.8) — the venue page's working half.
 *
 * Three pitches down the side, the days of the week across the top and a
 * priced card in every booked cell; the status bar above it; last season
 * folded beneath. `empty` is the other branch of the status bar: a ground
 * with nothing booked for the current season, which is the door that used
 * to be four hundred lines down the page.
 *
 * At 390 the component opens on the busiest day on its own — the same
 * `matchMedia` effect the block page's planner uses — so the phone shots
 * are the day view without the fixture doing anything.
 *
 * `VenueGrid` pulls in `VenueSlotSheet`, which imports the venue's
 * `"use server"` actions; the bundler swaps them for the no-op shim, so
 * every control renders and nothing writes.
 */

import { VenueGrid } from "@/app/(app)/venues/[id]/venue-grid";
import type { PitchChoice, SeasonOption, VenueBookingRow } from "@/app/(app)/venues/[id]/types";
import { venueNextAction } from "@/lib/venue-season";

import type { Fixture } from "./contract";

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const SEASON = { id: "season-2627", name: "2026/27" };
const LAST = { id: "season-2526", name: "2025/26" };

const PITCHES: PitchChoice[] = [
  { id: "pitch-1", name: "Pitch 1" },
  { id: "pitch-2", name: "Pitch 2" },
  { id: "pitch-3", name: "Pitch 3" },
];

const SEASONS: SeasonOption[] = [
  { id: SEASON.id, name: SEASON.name, isCurrent: true },
  { id: LAST.id, name: LAST.name, isCurrent: false },
];

function slot(
  id: string,
  pitch: PitchChoice | null,
  weekday: number,
  startTime: string,
  endTime: string,
  parts: number,
  shares: number,
  pricePence: number | null,
) {
  return {
    id,
    weekday,
    startTime,
    endTime,
    pitchId: pitch?.id ?? null,
    pitchName: pitch?.name ?? null,
    parts,
    shares,
    pricePence,
  };
}

/** A season of hire: three pitches, five evenings, most of them priced. */
const THIS_SEASON: VenueBookingRow = {
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
    slot("s1", PITCHES[0]!, 1, "18:00", "19:00", 3, 2, 2800),
    slot("s2", PITCHES[0]!, 1, "19:00", "20:00", 1, 1, 4500),
    slot("s3", PITCHES[0]!, 3, "18:00", "19:30", 2, 1, 3200),
    slot("s4", PITCHES[1]!, 2, "18:30", "20:00", 1, 1, 5000),
    slot("s5", PITCHES[1]!, 4, "18:00", "19:00", 3, 1, 2000),
    slot("s6", PITCHES[1]!, 5, "17:30", "18:30", 2, 1, null),
    slot("s7", PITCHES[2]!, 4, "19:00", "20:30", 1, 1, 5500),
  ],
};

const LAST_SEASON: VenueBookingRow = {
  id: "booking-2526",
  seasonId: LAST.id,
  seasonName: LAST.name,
  seasonStartsOn: "2025-08-01",
  seasonCurrent: false,
  startsOn: "2025-10-06",
  endsOn: "2026-03-23",
  reference: "LHS-0311",
  notes: null,
  slots: [
    slot("o1", PITCHES[0]!, 1, "18:00", "19:00", 3, 2, 2600),
    slot("o2", PITCHES[1]!, 2, "18:30", "20:00", 1, 1, 4800),
    slot("o3", PITCHES[1]!, 4, "18:00", "19:00", 3, 1, 1900),
  ],
};

/** One evening only — what a ground with a single booked night looks like. */
const ONE_NIGHT: VenueBookingRow = {
  ...THIS_SEASON,
  slots: THIS_SEASON.slots.filter((s) => s.weekday === 1),
};

const UNCHARGED = [{ startsOn: "2026-12-21", endsOn: "2027-01-04" }];

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:p-6">{children}</div>;
}

function Ground({
  bookings,
  sheet = null,
}: {
  bookings: VenueBookingRow[];
  sheet?: Parameters<typeof VenueGrid>[0]["initialSheet"];
}) {
  return (
    <Frame>
      <VenueGrid
        venueId={VENUE_ID}
        venueName="Banky Lane"
        action={venueNextAction({ name: "Banky Lane" }, bookings, SEASON, UNCHARGED)}
        bookings={bookings}
        seasons={SEASONS}
        pitches={PITCHES}
        uncharged={UNCHARGED}
        currentSeasonId={SEASON.id}
        initialSheet={sheet}
      />
    </Frame>
  );
}

const fixture: Fixture = {
  cases: {
    /** Three pitches across five days, priced — the season in one screen. */
    season: () => <Ground bookings={[THIS_SEASON, LAST_SEASON]} />,

    /** One evening booked: the grid narrows to the day that has something in it. */
    day: () => <Ground bookings={[ONE_NIGHT]} />,

    /** Nothing booked for the current season — "Book this ground for 2026/27". */
    empty: () => <Ground bookings={[]} />,

    /** Last season only: the status bar still asks for this one to be booked. */
    onlyLastSeason: () => <Ground bookings={[LAST_SEASON]} />,

    /** A card pressed: the slot panel up on the first paint, from `?sheet=`. */
    sheetOpen: () => <Ground bookings={[THIS_SEASON, LAST_SEASON]} sheet={{ kind: "slot", slotId: "s1" }} />,
  },
};

export default fixture;
