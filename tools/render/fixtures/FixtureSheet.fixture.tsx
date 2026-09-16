/**
 * The fixture sheet (P8.4) — what a card on the matches grid opens into, and
 * what `/teams/[id]` will open into when P8.7 imports it.
 *
 * Four cases: one fixture at rest, one fixture with the pitch form open, one
 * still waiting for a ground, and the ticked many, whose object is "12
 * fixtures" and whose forms are the identical four. `canManage` false is the
 * fifth: the facts and the door to the event, and nothing else.
 *
 * A Sheet is portalled to <body>, so the harness's assertions — scoped to
 * `#root` — do not measure inside it. These cases are here for the screenshots
 * and the console-error check; a portal that fails to mount shows up as an
 * empty page.
 */

import { FixtureSheet, type FixtureSheetFixture } from "@/components/fixtures/fixture-sheet";

import type { Fixture } from "./contract";

const noop = () => {};

const PITCHES = [
  { id: "p1", name: "Banky Lane 1" },
  { id: "p2", name: "Banky Lane 2" },
  { id: "p3", name: "Ashton Park 1" },
];

const ONE: FixtureSheetFixture = {
  id: "fx-1",
  eventId: "ev-1",
  teamId: "t-u14",
  teamName: "U14 Mavericks",
  opponent: "Sale Utd",
  isHome: true,
  dateLabel: "Sat 22 Aug",
  time: "10:30",
  pitchLabel: "Banky Lane 1",
  venueText: null,
  competition: "League",
  status: "scheduled",
  replies: { in: 9, out: 2, total: 14 },
  needsPitch: false,
};

const UNPLACED: FixtureSheetFixture = {
  ...ONE,
  id: "fx-2",
  pitchLabel: "Needs a pitch",
  needsPitch: true,
  replies: { in: 3, out: 1, total: 14 },
};

const MANY: FixtureSheetFixture[] = Array.from({ length: 12 }, (_, index) => ({
  ...ONE,
  id: `fx-many-${index}`,
  teamName: ["U7 Comets", "U9 Rockets", "U12 Mercury", "U14 Mavericks"][index % 4] ?? "A team",
  opponent: ["Altrincham", "Timperley", "Chorlton", "Stretford"][index % 4] ?? "Sale Utd",
  time: ["09:00", "10:30", "12:00", "14:00"][index % 4] ?? "10:30",
  needsPitch: index % 5 === 0,
  pitchLabel: index % 5 === 0 ? "Needs a pitch" : "Banky Lane 1",
}));

/** The page behind, so the scrim has something to sit over. */
function Page() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Matches</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">Sat 22 Aug · 10:30</p>
        <p className="text-list text-muted-foreground">U14 Mavericks v Sale Utd · Banky Lane 1</p>
      </div>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    /** One fixture, at rest: the facts, the door to its event, the four modes. */
    view: () => (
      <>
        <Page />
        <FixtureSheet open fixtures={[ONE]} mode="view" onMode={noop} onClose={noop} canManage pitches={PITCHES} from="/matches" />
      </>
    ),

    /** "Place it" from a dashed card lands here, with the pitch form already open. */
    pitch: () => (
      <>
        <Page />
        <FixtureSheet open fixtures={[UNPLACED]} mode="pitch" onMode={noop} onClose={noop} canManage pitches={PITCHES} from="/matches" />
      </>
    ),

    /** Delete, armed by typing the count back — the number, not the word "yes". */
    remove: () => (
      <>
        <Page />
        <FixtureSheet open fixtures={[ONE]} mode="delete" onMode={noop} onClose={noop} canManage pitches={PITCHES} from="/matches" />
      </>
    ),

    /** The ticked many: "12 fixtures" is the object, the forms are the same. */
    many: () => (
      <>
        <Page />
        <FixtureSheet open fixtures={MANY} mode="kickoff" onMode={noop} onClose={noop} canManage pitches={PITCHES} from="/matches" />
      </>
    ),

    /** A coach, or anyone wearing a member hat: the facts and the event door. */
    readOnly: () => (
      <>
        <Page />
        <FixtureSheet open fixtures={[ONE]} mode="view" onMode={noop} onClose={noop} canManage={false} pitches={[]} from="/matches" />
      </>
    ),
  },
};

export default fixture;
