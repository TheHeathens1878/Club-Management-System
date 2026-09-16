/**
 * The pitch calendar's entry sheet, at the moment deleting the booking is
 * refused because the slot belongs to a match (Adam, 2026-09-16).
 *
 * The panel is the thing worth photographing: an administrator gets the two
 * doors — cancel the match, or delete it and its booking — with the armed
 * second step, and anybody else gets the server's own sentence and the link to
 * the match. The sheet's chrome around it is drawn here the way
 * `calendar-views.tsx` draws it (modal, 384) so the panel is measured in the
 * width it really has.
 *
 * A Sheet is portalled to <body>, so the harness's `#root` assertions do not
 * measure inside it; these cases are for the screenshots and the console-error
 * check. The tap-target selector DOES see the whole document, which is why
 * every control in the panel carries `touch`.
 */

import { useEffect } from "react";

import { MatchSlotPanel } from "@/app/(app)/pitches/calendar/match-slot-panel";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";

import type { Fixture } from "./contract";

const noop = () => {};

const SERVER_WORDS =
  "This slot belongs to a match, so deleting the booking on its own would leave the match with nowhere to play. Free the pitch by unallocating the match on Pitches — or, if the match itself is off, cancel or delete it on the match, which gives the pitch back at the same time.";

const MATCH_LABEL = "U12 Mercury v Broadheath Central · Sat 3 Oct · 10:00";
const FIXTURE_HREF = "/teams/t-u12/fixtures/fx-1";

/** The week behind the sheet, so the scrim has something to sit over. */
function Week() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Pitch calendar</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">Saturday 3 October</p>
        <p className="text-list text-muted-foreground">Banky Lane · Pitch 1 · 10:00–11:30</p>
      </div>
    </div>
  );
}

/** The sheet exactly as `EntryPopover` draws it, with the panel inside. */
function EntrySheet({ canManageMatches }: { canManageMatches: boolean }) {
  return (
    <>
      <Week />
      <Sheet
        open
        onClose={noop}
        title="U12 Mercury v Broadheath Central"
        subtitle="Saturday 3 October"
        side="modal"
        width={384}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="muted">Match</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">10:00–11:30 · Banky Lane Pitch 1</p>
            <p className="text-xs text-muted-foreground">U12 Mercury</p>
            <p className="text-xs text-muted-foreground">At home to Broadheath Central</p>
          </div>
          <MatchSlotPanel
            message={SERVER_WORDS}
            fixtureId="fx-1"
            fixtureHref={FIXTURE_HREF}
            matchLabel={MATCH_LABEL}
            canManageMatches={canManageMatches}
            onDone={noop}
          />
        </div>
      </Sheet>
    </>
  );
}

/**
 * Delete arms on a press, and the harness cannot press. So it presses.
 *
 * The button is inside the Sheet's PORTAL, which only exists after the Sheet's
 * own mount effect has run and re-rendered — a plain effect here fires first
 * and finds nothing. So it keeps looking for a moment.
 */
function PressOnMount({ text }: { text: string }) {
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
        (candidate.textContent ?? "").includes(text),
      );
      if (button) button.click();
      if (button || (tries += 1) > 40) clearInterval(timer);
    }, 25);
    return () => clearInterval(timer);
  }, [text]);
  return null;
}

const fixture: Fixture = {
  cases: {
    /** The administrator's version: the reworded sentence and both doors. */
    refusalWithDoors: () => <EntrySheet canManageMatches />,

    /** The second press of the delete door: what it says goes, and the arm. */
    refusalDeleteArmed: () => (
      <>
        <EntrySheet canManageMatches />
        <PressOnMount text="Delete the match and its booking" />
      </>
    ),

    /** No capability, no hat: the server's own words, and the link. */
    refusalWithoutDoors: () => <EntrySheet canManageMatches={false} />,
  },
};

export default fixture;
