/**
 * A team's week: the bar and the grid (P8.7b).
 *
 * Two rows, seven days. What is worth photographing is that the matches row
 * and the training row are the SAME cards `/matches` and `/training` draw —
 * this screen invented no third shape — and that the bar names one thing,
 * not four: allocate a pitch, remind the quiet ones, or open the register,
 * in the club's own order.
 *
 * At 390 the grid opens on today and the chips move between days. Seven
 * columns at 1440 must not push the page sideways, which every case proves.
 *
 * `FixtureSheet` is the same sheet `/matches` opens; `FixtureSheet.fixture.tsx`
 * photographs its five modes, so `sheet` here only proves it opens from a
 * card on this grid.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { TeamOverviewGrid } from "@/app/(app)/teams/[id]/team-overview-grid";
import type { FixtureGridFixture, FixtureGridTeam } from "@/lib/fixture-grid";
import type { TeamAction } from "@/lib/team-next-action";
import type { TrainingWeekSession } from "@/lib/training-week";

import type { Fixture } from "./contract";

const TODAY = "2026-10-06";
const DAYS = [
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
  "2026-10-12",
];
const CHIPS: Record<string, string> = {
  "2026-10-06": "Today",
  "2026-10-07": "Tomorrow",
  "2026-10-08": "Thu 8",
  "2026-10-09": "Fri 9",
  "2026-10-10": "Sat 10",
  "2026-10-11": "Sun 11",
  "2026-10-12": "Mon 12",
};
const LABELS: Record<string, string> = {
  "2026-10-06": "Tue 6 Oct",
  "2026-10-07": "Wed 7 Oct",
  "2026-10-08": "Thu 8 Oct",
  "2026-10-09": "Fri 9 Oct",
  "2026-10-10": "Sat 10 Oct",
  "2026-10-11": "Sun 11 Oct",
  "2026-10-12": "Mon 12 Oct",
};

const team: FixtureGridTeam = {
  id: "t1",
  name: "U14 Mavericks",
  ageGroup: "U14",
  centralVenueName: null,
};

const base = {
  teamId: "t1",
  teamName: "U14 Mavericks",
  ageGroup: "U14",
  eventId: "e1",
} as const;

/** Saturday's league game, waiting for a pitch, and Sunday's cup tie away. */
const fixtures: FixtureGridFixture[] = [
  {
    ...base,
    id: "f1",
    opponent: "Sale United",
    isHome: true,
    status: "scheduled",
    time: "10:30",
    dateIso: "2026-10-10",
    pitch: "Unallocated",
    allocated: false,
    accepted: 6,
    declined: 2,
    squad: 14,
  },
  {
    ...base,
    id: "f2",
    eventId: "e2",
    opponent: "Timperley Rangers",
    isHome: false,
    status: "scheduled",
    time: "14:00",
    dateIso: "2026-10-11",
    pitch: "Away",
    allocated: true,
    accepted: 11,
    declined: 1,
    squad: 14,
  },
];

const sessions: TrainingWeekSession[] = [
  {
    bookingId: "b1",
    eventId: null,
    teamId: "t1",
    teamName: "U14 Mavericks",
    startsAt: "2026-10-06T17:00:00.000Z",
    pitchName: "Banky Lane 1",
    status: "confirmed",
    accepted: 11,
    declined: 2,
    squad: 14,
    marked: false,
  },
  {
    bookingId: "b2",
    eventId: null,
    teamId: "t1",
    teamName: "U14 Mavericks",
    startsAt: "2026-10-08T17:00:00.000Z",
    pitchName: null,
    status: "pending",
    accepted: 0,
    declined: 0,
    squad: 14,
    marked: false,
  },
];

const allocate: TeamAction = {
  label: "Allocate a pitch",
  detail: "Saturday 10:30 v Sale United · no pitch · 8 of 14 replied",
  mode: "pitch",
  fixtureId: "f1",
  eventId: "e1",
  bookingId: null,
};

const remind: TeamAction = {
  label: "Remind the quiet ones",
  detail: "Sunday 14:00 v Timperley Rangers (away) · 12 of 14 replied",
  mode: "remind",
  fixtureId: "f2",
  eventId: "e2",
  bookingId: null,
};

const register: TeamAction = {
  label: "Open the register",
  detail: "Tonight 18:00 · Banky Lane 1 · 11 of 14 coming",
  mode: "register",
  fixtureId: null,
  eventId: null,
  bookingId: "b1",
};

const quiet: TeamAction = {
  label: "Add a fixture",
  detail: "Nothing booked for this team yet",
  mode: "none",
  fixtureId: null,
  eventId: null,
  bookingId: null,
};

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl p-4">{children}</div>;
}

function Week({
  next = allocate,
  canManage = true,
  rows = fixtures,
  slots = sessions,
  canTakeRegister = true,
}: {
  next?: TeamAction;
  canManage?: boolean;
  rows?: FixtureGridFixture[];
  slots?: TrainingWeekSession[];
  canTakeRegister?: boolean;
}) {
  return (
    <Frame>
      <TeamOverviewGrid
        team={team}
        fixtures={rows}
        sessions={slots}
        days={DAYS}
        dayLabels={LABELS}
        dayChips={CHIPS}
        today={TODAY}
        next={next}
        canManage={canManage}
        pitches={[
          { id: "r1", name: "Banky Lane 1" },
          { id: "r2", name: "Banky Lane 2" },
        ]}
        canTakeRegister={canTakeRegister}
      />
    </Frame>
  );
}

const fixture: Fixture = {
  cases: {
    /** The whole week: a match waiting for a pitch, and two evenings booked. */
    week: () => <Week />,

    /** Everyone has answered and the pitch is sorted: the register is next. */
    register: () => <Week next={register} />,

    /** The bar's second rung, for a squad that has gone quiet. */
    remind: () => <Week next={remind} />,

    /** A coach: no ticks, no Place it, no four forms — the week to read. */
    coach: () => <Week next={remind} canManage={false} canTakeRegister={false} />,

    /** Nothing on: every empty evening is a one-press booking. */
    emptyWeek: () => <Week next={quiet} rows={[]} slots={[]} />,

    /**
     * A card pressed. The sheet opens itself on mount by clicking the card,
     * the way `Sheet.fixture.tsx` does — it is portalled to <body> and only
     * renders when something opens it.
     */
    sheet: () => <OpensItself />,
  },
};

function OpensItself() {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The first card in the grid; `role=button` is what a fixture card is.
    const card = box.current?.querySelector<HTMLElement>('[role="button"]');
    card?.click();
    setReady(true);
  }, []);

  return (
    <div ref={box} data-ready={ready}>
      <Week />
    </div>
  );
}

export default fixture;
