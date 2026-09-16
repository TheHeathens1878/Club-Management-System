/**
 * The team's Squad tab: the roster as one list, and a member opened over it
 * (P8.7a).
 *
 * Three things are worth photographing. The LIST — that the dense table at
 * 1440 and the stack of cards at 390 are the same rows, and that the columns
 * a reader is not entitled to (Subs, and the next match's answer) are absent
 * rather than empty. The SHEET — open, because `SquadTab` takes its mode and
 * its person as props, so no click is needed to get it on screen. And the
 * COACH case, where the sheet holds "this player has left" instead of the
 * role, the shirt and End.
 *
 * `SquadTab` draws only; `squad-data.ts` does the reading, which is what lets
 * this file hand it a roster without a Supabase client anywhere near it.
 *
 * KNOWN, AND NOT THIS SCREEN'S TO FIX: the harness measures tap targets
 * inside a CLOSED fold, so the person picker's 40px box and `RecruitingPanel`'s
 * 40px selects and 36px Save are reported on every case. Both are shared
 * controls behind a shut disclosure — the same debt `SettingsFolds.fixture.tsx`
 * records for P8.10 — and P8.7 leaves the panel bodies as they are. Every row,
 * every chip and every control in the sheet itself is 44px.
 */

import { SquadTab, type SquadTeam } from "@/app/(app)/teams/[id]/squad-tab";
import type { SquadTabData } from "@/app/(app)/teams/[id]/squad-data";
import type { SquadSheetMode } from "@/app/(app)/teams/[id]/squad-sheet-modes";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl p-4">{children}</div>;
}

const team: SquadTeam = {
  id: "t1",
  name: "U14 Mavericks",
  age_group: "U14",
  recruiting: true,
  gender: "mixed",
  join_type: "trial",
  join_instructions: "Come to a Tuesday session and say hello to Dave.",
  session_details: "Tuesdays 18:00–19:30, Banky Lane 1",
  contact_name: "Dave Hulme",
  contact_email: "dave@example.com",
  contact_phone: "07700 900001",
  show_coach_contact: true,
};

const NAMES = [
  "Amelia Wareing",
  "Ben Okoro",
  "Chloe Hartley",
  "Dev Patel",
  "Erin Kavanagh",
  "Freddie Mistry",
  "Grace Nnamdi",
  "Harry Bramhall",
  "Isla Fitzgerald",
  "Jonah Pemberton-Wills",
];

const members: SquadTabData["members"] = [
  {
    id: "m0",
    personId: "p0",
    name: "Dave Hulme",
    role: "coach",
    shirtNumber: null,
    joinedAt: "2024-08-01",
    isMinor: false,
    photoUrl: null,
    emergencyContacts: [],
  },
  ...NAMES.map((name, index) => ({
    id: `m${index + 1}`,
    personId: `p${index + 1}`,
    name,
    role: "player" as const,
    shirtNumber: index + 2,
    joinedAt: "2026-08-01",
    isMinor: true,
    photoUrl: null,
    // Two players with nobody to ring — the thing the tab exists to surface.
    emergencyContacts:
      index === 3 || index === 7
        ? []
        : [`${name.split(" ")[1]} (parent) · 07700 9000${index}0 · Mother`],
  })),
];

const availability: SquadTabData["availability"] = {
  fixtureLabel: "Sat 19 Sep, 10:30",
  dayLabel: "Saturday",
  statusByPerson: Object.fromEntries(
    members
      .filter((member) => member.role === "player")
      .map((member, index) => [
        member.personId,
        index % 4 === 0 ? "available" : index % 4 === 1 ? null : index % 4 === 2 ? "unavailable" : "maybe",
      ]),
  ),
};

const subs: SquadTabData["subs"] = {
  byPerson: Object.fromEntries(
    members
      .filter((member) => member.role === "player")
      .map((member, index) => [
        member.personId,
        index % 3 === 0
          ? { status: "active", amountDuePence: null }
          : index % 3 === 1
            ? { status: "past_due", amountDuePence: 4500 }
            : { status: null, amountDuePence: null },
      ]),
  ),
};

const data: SquadTabData = {
  members,
  pending: [],
  squadLeave: { canRequest: false, pendingMembershipIds: ["m5"] },
  availability,
  subs,
  season: { id: "s1", name: "2026/27" },
};

function href(mode: SquadSheetMode | null, personId?: string | null): string {
  return mode && personId ? `/teams/t1?tab=squad&sheet=${mode}&person=${personId}` : "/teams/t1?tab=squad";
}

function Tab({
  data: rows,
  sheet = null,
  personId = null,
  canEdit = true,
}: {
  data: SquadTabData;
  sheet?: SquadSheetMode | null;
  personId?: string | null;
  canEdit?: boolean;
}) {
  return (
    <Frame>
      <SquadTab
        team={team}
        data={rows}
        sheet={sheet}
        personId={personId}
        sheetHref={href}
        canEdit={canEdit}
        canExportPortal={canEdit}
      />
    </Frame>
  );
}

const fixture: Fixture = {
  cases: {
    /** A club administrator: every column, the add fold, both exports. */
    list: () => <Tab data={data} />,

    /**
     * A coach on a team with no fixture ahead and no entitlement to subs:
     * two columns fewer, and no add fold. An absent column is honest where
     * an empty one would not be.
     */
    coach: () => <Tab data={{ ...data, availability: null, subs: null }} canEdit={false} />,

    /** The panel, on the mode a pressed row opens. */
    sheet: () => <Tab data={data} sheet="details" personId="p2" />,

    /** The same panel for a coach: they ask, they do not do. */
    sheetCoach: () => (
      <Tab
        data={{ ...data, squadLeave: { canRequest: true, pendingMembershipIds: [] } }}
        sheet="details"
        personId="p2"
        canEdit={false}
      />
    ),

    /** Nobody to ring, said in the panel that can do something about it. */
    sheetContacts: () => <Tab data={data} sheet="contacts" personId="p4" />,

    /** An empty roster still says what to do about it. */
    empty: () => (
      <Tab data={{ ...data, members: [], availability: null, subs: null }} />
    ),
  },
};

export default fixture;
