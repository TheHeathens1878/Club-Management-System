/**
 * The readiness grid — `/family`'s body (P8.6).
 *
 * The case that matters is `household`: three children by four columns, at
 * 1440, with every cell stating its state in words. That is the claim the
 * screen makes — a parent can see what the club is waiting for without opening
 * anything — and it is only true if all twelve cells are legible in one shot.
 *
 * The same case at 390 is the other half: the column headers go, each cell
 * carries its own label, the chips appear and only the chosen child's four
 * cells are on screen.
 *
 * `empty` is the household with nobody in it, which is where a new parent
 * lands: one sentence and one press.
 */

import { FamilyGrid, type FamilyGridRow } from "@/app/(app)/family/family-grid";
import { ActionBar } from "@/components/ui/action-bar";
import { buttonVariants } from "@/components/ui/button";
import type { ChildReadiness } from "@/lib/family-readiness";

import type { Fixture } from "./contract";

function href(mode: string, id: string) {
  return `/family?child=${id}&sheet=${mode}`;
}

function row(
  id: string,
  name: string,
  ageGroup: string,
  teams: string[],
  readiness: ChildReadiness,
  registrationDoor: "register" | "registrations" = "registrations",
): FamilyGridRow {
  return {
    personId: id,
    name,
    ageGroup,
    isMinor: true,
    relationship: "parent",
    teams: teams.map((label, index) => ({ id: `${id}-t${index}`, label })),
    readiness,
    hrefs: {
      details: href("details", id),
      contacts: href("contacts", id),
      access: href("access", id),
      registration: href(registrationDoor, id),
    },
    chipHref: `/family?child=${id}`,
  };
}

const ROWS: FamilyGridRow[] = [
  row(
    "c1",
    "Amelia Wareing",
    "U11",
    ["U11 Venus · player"],
    {
      details: { state: "ok", text: "On file" },
      contacts: { state: "ok", text: "2 on file" },
      access: { state: "pending", text: "From age 13" },
      registration: { state: "missing", text: "Not registered" },
    },
    "register",
  ),
  row("c2", "Ben Wareing", "U14", ["U14 Mavericks · player"], {
    details: { state: "ok", text: "On file" },
    contacts: { state: "ok", text: "1 on file" },
    access: { state: "waiting", text: "Waiting on you" },
    registration: { state: "ok", text: "Approved — U14 Mavericks" },
  }),
  row("c3", "Chloe Wareing", "U9", [], {
    details: { state: "missing", text: "None yet" },
    contacts: { state: "missing", text: "None yet" },
    access: { state: "pending", text: "From age 13" },
    registration: { state: "pending", text: "Pending" },
  }),
];

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:p-6">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    // The whole screen above the folds: the one line the household owes, and
    // the grid under it.
    household: () => (
      <Frame>
        <ActionBar
          status="Chloe has no emergency contact"
          detail="The club holds nobody to ring for Chloe. Add a contact before their next session."
          tone="error"
          action={
            <a href="/family?child=c3&sheet=contacts" className={buttonVariants({ size: "touch" })}>
              Add a contact
            </a>
          }
        />
        <FamilyGrid rows={ROWS} focusedId="c3" />
      </Frame>
    ),

    // One child, so the chip strip is not drawn at all — a filter with one
    // option is a control that does nothing.
    oneChild: () => (
      <Frame>
        <FamilyGrid rows={[ROWS[1]!]} focusedId="c2" />
      </Frame>
    ),

    // Nobody on the account yet: the first thing a new parent sees.
    empty: () => (
      <Frame>
        <ActionBar
          status="Add a child"
          detail="The club has no children recorded against your account yet. Adding one creates their record and records you as their guardian in one step."
          tone="pending"
          action={
            <a href="#add-a-child" className={buttonVariants({ size: "touch" })}>
              Add a child
            </a>
          }
        />
        <FamilyGrid rows={[]} focusedId={null} />
      </Frame>
    ),
  },
};

export default fixture;
