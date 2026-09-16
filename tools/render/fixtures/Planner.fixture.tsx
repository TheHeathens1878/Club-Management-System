/**
 * The winter-training timetable itself — the benchmark this whole programme
 * copies, rewritten in the shared vocabulary (P8.0d).
 *
 * Two cases, because the two widths are two different screens. At 1440 it is
 * the week: rows of venue × pitch, a column per day, the team rail down the
 * left. At 390 the component opens on the busiest day on its own — but that
 * happens in a `useEffect` reading `matchMedia`, which the harness cannot
 * wait for reliably, so `day` is the same grid with a single day's worth of
 * slots to photograph what a phone actually gets.
 *
 * `Planner` pulls in `SlotSheet`, which imports the block's `"use server"`
 * actions; the bundler swaps them for the no-op shim, so every control
 * renders and nothing writes.
 */

import { Planner } from "@/app/(app)/pitches/training/[id]/planner";
import type { SlotRow, TeamOption, VenueOption } from "@/app/(app)/pitches/training/[id]/types";

import type { Fixture } from "./contract";

const BLOCK_ID = "00000000-0000-4000-8000-000000000001";
const VENUE = "venue-banky-lane";
const PITCH_1 = "pitch-1";
const PITCH_2 = "pitch-2";

const TEAMS: TeamOption[] = [
  { id: "t1", name: "U11 Venus", ageGroup: "U11", trainingDay: 2 },
  { id: "t2", name: "U12 Mercury", ageGroup: "U12", trainingDay: 2 },
  { id: "t3", name: "U13 Saturn", ageGroup: "U13", trainingDay: 4 },
  { id: "t4", name: "U14 Mavericks", ageGroup: "U14", trainingDay: 4 },
  { id: "t5", name: "U9 Comets", ageGroup: "U9", trainingDay: null },
];

function slot(
  id: string,
  weekday: number,
  startTime: string,
  endTime: string,
  pitchId: string,
  pitchName: string,
  allocations: { id: string; teamId: string; teamName: string; shares: number }[],
): SlotRow {
  return {
    id,
    venueId: VENUE,
    venueName: "Banky Lane",
    venueAddress: null,
    pitchId,
    pitchName,
    weekday,
    startTime,
    endTime,
    parts: 2,
    clubParts: 2,
    notes: null,
    allocations: allocations.map((a) => ({ ...a, ageGroup: null })),
  };
}

const WEEK: SlotRow[] = [
  slot("s1", 2, "18:00", "19:00", PITCH_1, "Pitch 1", [
    { id: "a1", teamId: "t1", teamName: "U11 Venus", shares: 1 },
    { id: "a2", teamId: "t2", teamName: "U12 Mercury", shares: 1 },
  ]),
  slot("s2", 2, "19:00", "20:00", PITCH_1, "Pitch 1", [{ id: "a3", teamId: "t3", teamName: "U13 Saturn", shares: 1 }]),
  slot("s3", 4, "18:00", "19:00", PITCH_2, "Pitch 2", [{ id: "a4", teamId: "t4", teamName: "U14 Mavericks", shares: 2 }]),
  slot("s4", 4, "19:00", "20:00", PITCH_2, "Pitch 2", []),
];

const VENUES: VenueOption[] = [
  {
    id: VENUE,
    name: "Banky Lane",
    forTraining: true,
    trainingParts: 2,
    trainingShares: 2,
    trainingNotes: null,
    pitches: [
      { id: PITCH_1, name: "Pitch 1" },
      { id: PITCH_2, name: "Pitch 2" },
    ],
    bookedSlots: [
      { pitchId: PITCH_2, pitchName: "Pitch 2", weekday: 2, startTime: "20:00", endTime: "21:00", parts: 2, shares: 1 },
    ],
  },
];

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:p-6">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    week: () => (
      <Frame>
        <Planner blockId={BLOCK_ID} slots={WEEK} teams={TEAMS} venues={VENUES} blockVenueIds={[VENUE]} />
      </Frame>
    ),

    day: () => (
      <Frame>
        <Planner
          blockId={BLOCK_ID}
          slots={WEEK.filter((s) => s.weekday === 2)}
          teams={TEAMS}
          venues={VENUES}
          blockVenueIds={[VENUE]}
        />
      </Frame>
    ),

    // Nothing planned yet: the dashed "add the first one" card, which is the
    // first thing a new block shows.
    empty: () => (
      <Frame>
        <Planner blockId={BLOCK_ID} slots={[]} teams={TEAMS} venues={VENUES} blockVenueIds={[VENUE]} />
      </Frame>
    ),
  },
};

export default fixture;
