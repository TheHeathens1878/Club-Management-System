/**
 * The coach's training week — the bar, the day chips and the grid.
 *
 * The dates are fixed so the screenshots are the same every run: `TODAY` is a
 * Tuesday in October (September is avoided — Node's en-GB ICU abbreviates it
 * "Sept" and the tests that share these helpers would wobble), and the seven
 * columns run from it.
 *
 * At 390 the grid opens on today by itself, from a `matchMedia` read in a
 * `useEffect` the harness cannot wait for reliably; the `today` case is the
 * same grid handed a one-day week, which is what a phone actually draws.
 *
 * `TrainingGrid` pulls in `SessionSheet`, which imports the `"use server"`
 * register read; the bundler swaps it for the no-op shim, so every control
 * renders and nothing is fetched.
 */

import { TrainingGrid } from "@/app/(app)/training/training-grid";
import type { SessionMeta } from "@/app/(app)/training/training-reads";
import {
  sessionNextAction,
  trainingWeekDays,
  trainingWeekRows,
  type TrainingWeekSession,
  type TrainingWeekTeam,
} from "@/lib/training-week";

import type { Fixture } from "./contract";

const TODAY = "2026-10-06";
const DAYS = trainingWeekDays(TODAY);

const TEAMS: TrainingWeekTeam[] = [
  { id: "t1", name: "U11 Venus", ageGroup: "U11" },
  { id: "t2", name: "U12 Mercury", ageGroup: "U12" },
  { id: "t3", name: "U13 Saturn", ageGroup: "U13" },
  { id: "t4", name: "U14 Mavericks", ageGroup: "U14" },
];

/** 18:00 London on an October evening is 17:00Z — the clocks go back on the 25th. */
function evening(day: string, time: string): string {
  const [h = "18", m = "00"] = time.split(":");
  return `${day}T${String(Number(h) - 1).padStart(2, "0")}:${m}:00.000Z`;
}

function session(
  bookingId: string,
  teamId: string,
  teamName: string,
  day: string,
  time: string,
  pitchName: string | null,
  extra: Partial<TrainingWeekSession> = {},
): TrainingWeekSession {
  return {
    bookingId,
    eventId: `e-${bookingId}`,
    teamId,
    teamName,
    startsAt: evening(day, time),
    pitchName,
    status: "confirmed",
    accepted: 11,
    declined: 1,
    squad: 14,
    marked: false,
    ...extra,
  };
}

const WEEK: TrainingWeekSession[] = [
  // Tonight: the register nobody has taken — what the bar is about.
  session("b1", "t4", "U14 Mavericks", DAYS[0]!, "18:00", "Banky Lane 1"),
  session("b2", "t1", "U11 Venus", DAYS[0]!, "17:30", "Banky Lane 2", {
    accepted: 8,
    squad: 12,
    marked: true,
  }),
  session("b3", "t2", "U12 Mercury", DAYS[1]!, "18:00", "Banky Lane 1", { accepted: 9, squad: 13 }),
  // Booked but not confirmed: the warning chip.
  session("b4", "t3", "U13 Saturn", DAYS[2]!, "19:00", "Ashton Park 3", {
    status: "pending",
    accepted: 6,
    squad: 15,
  }),
  session("b5", "t4", "U14 Mavericks", DAYS[3]!, "18:00", null, { accepted: 0, squad: 14 }),
  session("b6", "t1", "U11 Venus", DAYS[5]!, "10:00", "Banky Lane 2", {
    accepted: 12,
    squad: 12,
    marked: true,
  }),
];

const META: Record<string, SessionMeta> = Object.fromEntries(
  WEEK.map((row) => [row.bookingId, { bookedBy: "Adam Wareing", status: row.status }]),
);

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:p-6">{children}</div>;
}

function Week({
  sessions,
  days = DAYS,
  canMark = true,
}: {
  sessions: TrainingWeekSession[];
  days?: string[];
  canMark?: boolean;
}) {
  return (
    <Frame>
      <TrainingGrid
        rows={trainingWeekRows(sessions, TEAMS, days)}
        days={days}
        today={TODAY}
        next={sessionNextAction(sessions, TODAY)}
        meta={META}
        canMark={canMark}
      />
    </Frame>
  );
}

const fixture: Fixture = {
  cases: {
    /** Four teams, seven days, tonight's register still to take. */
    week: () => <Week sessions={WEEK} />,

    /** Every register taken: the bar goes quiet and offers the last one back. */
    allMarked: () => <Week sessions={WEEK.map((row) => ({ ...row, marked: true }))} />,

    /** What a phone draws: one day, today, with the primary above the grid. */
    today: () => <Week sessions={WEEK} days={[DAYS[0]!]} />,

    /** Nothing booked at all — the bar asks for a pitch instead. */
    empty: () => <Week sessions={[]} />,

    /** A member view: the cards open on what they are, not on a register. */
    memberView: () => <Week sessions={WEEK} canMark={false} />,
  },
};

export default fixture;
