/**
 * The overlay, in each of its four shapes.
 *
 * A Sheet is portalled to <body> so that everything else in the document can
 * be made `inert` while it is open — which means the harness's own assertions,
 * scoped to `#root`, do not see inside it. These cases are here for the
 * SCREENSHOTS and for the console-error check: what a drawer looks like at
 * 1440 against what it looks like at 390 is the whole point of the primitive,
 * and a portal that fails to mount shows up as an empty page.
 *
 * The page behind is drawn as a plain card so the scrim, the radius and the
 * elevation have something to sit over.
 */

import { useEffect } from "react";
import { Pencil } from "lucide-react";

import { CommandPalette } from "@/components/command-palette";
import { RoleSwitcherSheet } from "@/components/role-switcher-sheet";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SlotSheet } from "@/app/(app)/pitches/training/[id]/slot-sheet";
import type { SlotRow, TeamOption, VenueOption } from "@/app/(app)/pitches/training/[id]/types";

import type { Fixture } from "./contract";

const noop = () => {};

/**
 * A migrated overlay opens on a press, and the harness cannot press. Rendering
 * one open is worth more than a screenshot of its trigger, so the fixture does
 * the press itself on the first paint — the same event the person would send.
 */
function OpenOnMount({ selector }: { selector: string }) {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>(selector)?.click();
  }, [selector]);
  return null;
}

function Page() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Winter 2026</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">Monday · 18:00–19:00</p>
        <p className="text-list text-muted-foreground">Banky Lane · Pitch 2</p>
      </div>
    </div>
  );
}

function Body() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A slot is one weekly space: the venue, the day, the hour, how the pitch is divided and how
        much of it is ours.
      </p>
      <ul className="space-y-2">
        {["U14 Mavericks", "U12 Comets", "U11 Venus"].map((team) => (
          <li key={team} className="touch flex items-center justify-between gap-2 border-b pb-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{team}</span>
            <span className="text-2xs text-muted-foreground">half the pitch</span>
          </li>
        ))}
      </ul>
      <p className="rounded-lg bg-success-tint px-3 py-2 text-sm text-success">
        Full — every part of this slot is allocated.
      </p>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    // The benchmark's own shape: bottom sheet on a phone, 460px drawer at lg.
    drawer: () => (
      <>
        <Page />
        <Sheet
          open
          onClose={noop}
          title="Monday · 18:00–19:00"
          subtitle="Banky Lane · Pitch 2"
          side="drawer"
          width={460}
        >
          <Body />
        </Sheet>
      </>
    ),

    // A header action and a footer, which nothing migrated in this PR uses —
    // so this is the only place either is drawn before a later screen wants it.
    drawerWithFooter: () => (
      <>
        <Page />
        <Sheet
          open
          onClose={noop}
          title="Monday · 18:00–19:00"
          subtitle="Banky Lane · Pitch 2"
          side="drawer"
          width={460}
          headerAction={
            <Button type="button" variant="outline" size="sm" className="touch">
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Button>
          }
          footer={
            <div className="flex gap-2">
              <Button type="button" size="touch" className="flex-1">
                Save
              </Button>
              <Button type="button" variant="ghost" size="touch" className="flex-1">
                Cancel
              </Button>
            </div>
          }
        >
          <Body />
        </Sheet>
      </>
    ),

    // Bottom sheet on a phone, centred card at lg: the player picker, the
    // calendar's entry, "Viewing as".
    modal: () => (
      <>
        <Page />
        <Sheet open onClose={noop} title="Right back" subtitle="Pick a player for this position." side="modal" width={448}>
          <Body />
        </Sheet>
      </>
    ),

    center: () => (
      <>
        <Page />
        <Sheet open onClose={noop} title="Delete this block?" subtitle="Its slots and allocations go with it." side="center" width={384}>
          <Body />
        </Sheet>
      </>
    ),

    // The command palette's anchoring: centred, a little down from the top.
    top: () => (
      <>
        <Page />
        <Sheet open onClose={noop} title="Search" side="top" width={512}>
          <Body />
        </Sheet>
      </>
    ),

    // ---- the migrated overlays themselves ---------------------------------

    /** The source: `slot-sheet.tsx`, now a `drawer`. */
    slotSheet: () => (
      <>
        <Page />
        <SlotSheet
          blockId="block-1"
          state={{ kind: "slot", id: SLOT.id }}
          slot={SLOT}
          teams={TEAMS}
          venues={VENUES}
          blockVenueIds={[VENUES[0]!.id]}
          onClose={noop}
          onOpenSlot={noop}
        />
      </>
    ),

    /** "Viewing as" — a `modal` with a footer and the `busy` flag wired in. */
    roleSwitcher: () => (
      <>
        <Page />
        <RoleSwitcherSheet options={ROLES} current="admin" trigger="tile" />
        <OpenOnMount selector='[aria-haspopup="dialog"]' />
      </>
    ),

    /** ⌘K — a `top` sheet whose body is the field and the results. */
    palette: () => (
      <>
        <Page />
        <CommandPalette pages={PAGES} />
        <PaletteOpener />
      </>
    ),
  },
};

/** The palette has no trigger of its own: any element may shout at it. */
function PaletteOpener() {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("club:search-open"));
  }, []);
  return null;
}

const SLOT: SlotRow = {
  id: "slot-1",
  venueId: "venue-1",
  venueName: "Banky Lane",
  venueAddress: null,
  pitchId: "pitch-2",
  pitchName: "Pitch 2",
  weekday: 1,
  startTime: "18:00",
  endTime: "19:00",
  parts: 2,
  clubParts: null,
  notes: null,
  allocations: [
    { id: "a1", teamId: "t1", teamName: "U14 Mavericks", ageGroup: "U14", shares: 1 },
    { id: "a2", teamId: "t2", teamName: "U12 Comets", ageGroup: "U12", shares: 1 },
  ],
};

const TEAMS: TeamOption[] = [
  { id: "t1", name: "U14 Mavericks", ageGroup: "U14", trainingDay: 1 },
  { id: "t2", name: "U12 Comets", ageGroup: "U12", trainingDay: 1 },
  { id: "t3", name: "U11 Venus", ageGroup: "U11", trainingDay: 3 },
];

const VENUES: VenueOption[] = [
  {
    id: "venue-1",
    name: "Banky Lane",
    forTraining: true,
    trainingParts: 2,
    trainingShares: 2,
    trainingNotes: null,
    pitches: [
      { id: "pitch-1", name: "Pitch 1" },
      { id: "pitch-2", name: "Pitch 2" },
    ],
    bookedSlots: [],
  },
];

const ROLES = [
  { value: "admin", label: "Club admin", role: "Club admin", scope: "The whole club" },
  { value: "coach:t1", label: "Coach", role: "Coach", scope: "U14 Mavericks" },
  { value: "parent", label: "Parent", role: "Parent", scope: "Two children" },
  { value: "me", label: "Me", role: "Me", scope: "Just my own things" },
];

const PAGES = [
  { label: "Diary", href: "/diary", group: "Go to", keywords: ["calendar"] },
  { label: "People", href: "/people", group: "Go to", keywords: ["members"] },
  { label: "Pay subs", href: "/my-payments", group: "Money", keywords: ["subs", "pay"] },
];

export default fixture;
