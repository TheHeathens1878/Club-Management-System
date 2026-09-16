/**
 * The training session's sheet, in each of its three modes.
 *
 * The sheet fetches its roster when it opens, through a `"use server"` read
 * the bundler shims away — so every case here hands it one instead, which is
 * the `register` prop's whole purpose: the app never passes it.
 *
 * A Sheet is portalled to <body>, so most of the harness's measurements (which
 * are scoped to `#root`) do not see inside it. The tap-target check is the
 * exception — its selector list is only scoped on its first entry — so the
 * `register` case reports the two targets `attendance-panel.tsx` has owed
 * since it was written: the member-name link (20px) and the radio itself
 * (13px, inside a 44px label that is the real target). Both are that screen's
 * to fix, not this sheet's: the panel is imported unchanged, so a mark made
 * here and a mark made on the booking cannot disagree.
 */

import { useState } from "react";

import type { RosterRow } from "@/app/(app)/pitches/[bookingId]/attendance-panel";
import type { SessionRegister } from "@/app/(app)/training/training-reads";
import { SessionSheet, type SessionSheetMode } from "@/app/(app)/training/session-sheet";
import { sessionCard } from "@/lib/training-week";

import type { Fixture } from "./contract";

const TODAY = "2026-10-06";

const CARD = sessionCard({
  bookingId: "b1",
  eventId: "e1",
  teamId: "t4",
  teamName: "U14 Mavericks",
  startsAt: `${TODAY}T17:00:00.000Z`,
  pitchName: "Banky Lane 1",
  status: "confirmed",
  accepted: 11,
  declined: 1,
  squad: 14,
  marked: false,
});

const NAMES = [
  "Alfie Barton",
  "Brooke Hallam",
  "Callum Ridge",
  "Daisy Whelan",
  "Elliot Marsh",
  "Freya Quinn",
];

const ROWS: RosterRow[] = NAMES.map((name, index) => ({
  personId: `p${index}`,
  name,
  isMinor: true,
  teamName: "U14 Mavericks",
  role: "player",
  shirtNumber: index + 2,
  availability: index % 3 === 0 ? "available" : index % 3 === 1 ? "maybe" : null,
  availabilityNote: index === 1 ? "Might be late from school" : null,
  attendance: index === 0 ? "present" : index === 2 ? "late" : null,
  attendanceNote: null,
}));

const REGISTER: SessionRegister = { bookingId: "b1", canMark: true, rows: ROWS };

function Page() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Training</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">Tonight · 18:00</p>
        <p className="text-list text-muted-foreground">U14 Mavericks · Banky Lane 1 · 11/14</p>
      </div>
    </div>
  );
}

/** The sheet owns its mode once it is open, exactly as the grid lets it. */
function Open({
  mode: initial,
  canMark = true,
  register = REGISTER,
}: {
  mode: SessionSheetMode;
  canMark?: boolean;
  register?: SessionRegister | null;
}) {
  const [mode, setMode] = useState<SessionSheetMode>(initial);
  return (
    <>
      <Page />
      <SessionSheet
        card={CARD}
        meta={{ bookedBy: "Adam Wareing", status: "confirmed" }}
        mode={mode}
        canMark={canMark}
        today={TODAY}
        register={register}
        onMode={setMode}
        onClose={() => {}}
      />
    </>
  );
}

const fixture: Fixture = {
  cases: {
    /** Tonight's register, open on the week — what used to be two navigations. */
    register: () => <Open mode="register" />,

    /** Who said they are coming. Read only: the answer is the squad's. */
    availability: () => <Open mode="availability" />,

    /** The session itself, and the doors out of it. */
    view: () => <Open mode="view" />,

    /** A parent's hat: no register, and no roster fetched to hide. */
    memberView: () => <Open mode="view" canMark={false} register={null} />,
  },
};

export default fixture;
