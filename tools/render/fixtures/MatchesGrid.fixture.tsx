/**
 * The fixture desk as a grid (P8.4).
 *
 * The cases are the three things worth photographing: a club-sized weekend at
 * a desk (six teams, three days — the width claim), the same rows with the
 * unplaced ones dashed and asking for a pitch, and what a phone gets, which is
 * one day. The phone's own opening day is chosen in a `useEffect` reading
 * `matchMedia`, which the harness cannot wait for reliably, so `day` hands the
 * component a single day's rows instead.
 *
 * `MatchesGrid` pulls in `FixtureSheet` and the add form, both of which import
 * `"use server"` modules; the bundler swaps them for the no-op shim, so every
 * control renders and nothing writes.
 */

import { MatchesGrid } from "@/app/(app)/matches/matches-grid";
import type { DeskRow } from "@/app/(app)/matches/types";
import type { FixtureGridTeam, MatchesAction } from "@/lib/fixture-grid";

import type { Fixture } from "./contract";

// A Friday, a Saturday and a Sunday — the days the desk is about. August, not
// September: en-GB abbreviates September as "Sept" in some ICU builds.
const FRI = "2026-08-21";
const SAT = "2026-08-22";
const SUN = "2026-08-23";

const DAY_LABELS: Record<string, string> = {
  [FRI]: "Fri 21 Aug",
  [SAT]: "Sat 22 Aug",
  [SUN]: "Sun 23 Aug",
};

const TEAMS: FixtureGridTeam[] = [
  { id: "t-u7", name: "U7 Comets", ageGroup: "U7" },
  { id: "t-u9", name: "U9 Rockets", ageGroup: "U9" },
  { id: "t-u11", name: "U11 Venus", ageGroup: "U11", centralVenueName: "Platt Lane" },
  { id: "t-u12", name: "U12 Mercury", ageGroup: "U12" },
  { id: "t-u14", name: "U14 Mavericks", ageGroup: "U14" },
  { id: "t-vets", name: "Vets", ageGroup: "Vets" },
];

const PITCHES = [
  { id: "p1", name: "Banky Lane 1" },
  { id: "p2", name: "Banky Lane 2" },
  { id: "p3", name: "Ashton Park 1" },
];

let seq = 0;

function row(over: Partial<DeskRow> & { teamId: string; dateIso: string }): DeskRow {
  const team = TEAMS.find((t) => t.id === over.teamId);
  seq += 1;
  return {
    id: `fx-${seq}`,
    eventId: `ev-${seq}`,
    teamName: team?.name ?? "A team",
    ageGroup: team?.ageGroup ?? null,
    opponent: "Sale Utd",
    isHome: true,
    competition: "League",
    status: "scheduled",
    date: DAY_LABELS[over.dateIso] ?? over.dateIso,
    time: "10:30",
    pitch: "Banky Lane 1",
    allocated: true,
    venue: "Banky Lane",
    venueText: null,
    accepted: 9,
    declined: 2,
    squad: 14,
    ...over,
  };
}

const ROWS: DeskRow[] = [
  row({ teamId: "t-u7", dateIso: SAT, time: "09:00", opponent: "Altrincham Jnrs" }),
  row({ teamId: "t-u7", dateIso: SAT, time: "11:30", opponent: "Timperley", isHome: false, pitch: "Away", venue: "Away", venueText: "Riddings Lane" }),
  row({ teamId: "t-u9", dateIso: SAT, time: "10:00", opponent: "Sale Utd", pitch: "Banky Lane 2" }),
  row({ teamId: "t-u9", dateIso: SUN, time: "10:00", opponent: "Wythenshawe", accepted: 3, declined: 1 }),
  row({ teamId: "t-u11", dateIso: SAT, time: "10:30", opponent: "Chorlton", pitch: "Platt Lane", venue: "Platt Lane" }),
  row({ teamId: "t-u12", dateIso: FRI, time: "18:45", opponent: "Didsbury", competition: "Cup" }),
  row({ teamId: "t-u12", dateIso: SAT, time: "12:00", opponent: "Stretford", accepted: 12, declined: 0 }),
  row({ teamId: "t-u14", dateIso: SAT, time: "14:00", opponent: "Northenden", status: "cancelled", accepted: 0, declined: 0 }),
  row({ teamId: "t-u14", dateIso: SUN, time: "11:00", opponent: "Urmston", isHome: false, pitch: "Away", venue: "Away" }),
  row({ teamId: "t-vets", dateIso: SUN, time: "13:00", opponent: "Old Boys", pitch: "Ashton Park 1", venue: "Ashton Park" }),
];

/** The same weekend with three home games still waiting for a ground. */
const UNPLACED: DeskRow[] = ROWS.map((r, index) =>
  r.isHome && index % 3 === 0 ? { ...r, allocated: false, pitch: "Unallocated", venue: "Unallocated" } : r,
);

const PLACED_ACTION: MatchesAction = {
  label: "Add a fixture",
  detail: "10 fixtures, every one placed",
  action: "add",
  fixtureIds: [],
};

const UNPLACED_ACTION: MatchesAction = {
  label: "Allocate the unplaced",
  detail: "3 to place, 2 short of replies",
  action: "allocate",
  fixtureIds: UNPLACED.filter((r) => !r.allocated).map((r) => r.id),
};

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:p-6">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    /** Six teams, three days: the claim that a club weekend fits under 1280. */
    week: () => (
      <Frame>
        <MatchesGrid
          rows={ROWS}
          teams={TEAMS}
          dayLabels={DAY_LABELS}
          nextAction={PLACED_ACTION}
          canManage
          pitches={PITCHES}
          addableTeams={TEAMS.map(({ id, name }) => ({ id, name }))}
          focusFirst
        />
      </Frame>
    ),

    /** The dashed "Needs a pitch · Place it" card, and the bar that offers all three. */
    needsPitch: () => (
      <Frame>
        <MatchesGrid
          rows={UNPLACED}
          teams={TEAMS}
          dayLabels={DAY_LABELS}
          nextAction={UNPLACED_ACTION}
          canManage
          pitches={PITCHES}
          addableTeams={TEAMS.map(({ id, name }) => ({ id, name }))}
          focusFirst
        />
      </Frame>
    ),

    /** What a phone opens on: the busiest day, on its own. */
    day: () => (
      <Frame>
        <MatchesGrid
          rows={UNPLACED.filter((r) => r.dateIso === SAT)}
          teams={TEAMS}
          dayLabels={DAY_LABELS}
          nextAction={UNPLACED_ACTION}
          canManage
          pitches={PITCHES}
          addableTeams={TEAMS.map(({ id, name }) => ({ id, name }))}
          focusFirst
        />
      </Frame>
    ),

    /** A coach: no ticks, no four forms, and the desk still reads. */
    coach: () => (
      <Frame>
        <MatchesGrid
          rows={ROWS.filter((r) => r.teamId === "t-u14")}
          teams={TEAMS.filter((t) => t.id === "t-u14")}
          dayLabels={DAY_LABELS}
          nextAction={PLACED_ACTION}
          canManage={false}
          pitches={[]}
          addableTeams={[{ id: "t-u14", name: "U14 Mavericks" }]}
          focusFirst
        />
      </Frame>
    ),
  },
};

export default fixture;
