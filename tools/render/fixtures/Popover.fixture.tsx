/**
 * The anchored menu, hanging off each edge of its trigger.
 *
 * Unlike a Sheet, a Popover stays inside the page, so the harness measures it
 * as well as photographs it: `right`-anchored is the case that would push the
 * page sideways at 390 if the width clamp were wrong, which is exactly the bug
 * the assertions exist to catch.
 */

import { useEffect } from "react";
import { Users } from "lucide-react";

import { ParticipantsButton } from "@/app/(app)/messages/[id]/participants-button";
import { Popover } from "@/components/ui/popover";

import type { Fixture } from "./contract";

const noop = () => {};

/** A migrated popover opens on a press; the harness presses for it. */
function OpenOnMount({ selector }: { selector: string }) {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>(selector)?.click();
  }, [selector]);
  return null;
}

const PEOPLE = ["Adam Wareing", "Leanne Minto", "Jane Smith", "A parent with a very long name indeed"];

function Trigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded
      className="touch inline-flex items-center gap-1 rounded-md border px-3 text-sm text-muted-foreground"
    >
      <Users className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}

function List() {
  return (
    <div className="p-3">
      <p className="mb-2 text-sm font-semibold">In this conversation</p>
      <ul className="space-y-1">
        {PEOPLE.map((person) => (
          <li key={person} className="flex min-h-[36px] items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{person}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    // The crest drawer's anchoring: left edge, a wide panel, rows to the edges.
    left: () => (
      <div className="p-4">
        <div className="relative">
          <Trigger label="Menu" />
          <Popover open onClose={noop} label="Menu" anchor="left" width={292}>
            {PEOPLE.map((person) => (
              <button
                key={person}
                type="button"
                className="touch flex w-full items-center gap-3 border-t px-4 py-2 text-left text-sm first-of-type:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate">{person}</span>
              </button>
            ))}
          </Popover>
        </div>
      </div>
    ),

    // Hung off the right edge of a trigger sitting at the right of the page —
    // the members button in a conversation header.
    right: () => (
      <div className="p-4">
        <div className="flex justify-end">
          <div className="relative">
            <Trigger label="Members (4)" />
            <Popover open onClose={noop} label="Members of this conversation" anchor="right" width={320}>
              <List />
            </Popover>
          </div>
        </div>
      </div>
    ),

    // With the page dimmed behind it.
    withScrim: () => (
      <div className="p-4">
        <div className="relative">
          <Trigger label="Menu" />
          <Popover open onClose={noop} label="Menu" anchor="left" width={292} scrim>
            <List />
          </Popover>
        </div>
      </div>
    ),

    // ---- a migrated popover, as the app builds it -------------------------

    /**
     * "Members" on a conversation, opened by pressing it.
     *
     * `canOpenContacts` is off here, which is the view most people get: with
     * it on each name becomes a 20px link, a tap-target debt this PR did not
     * create and the messages screen's own makeover owns. The crest drawer is
     * the Popover's other call site and has no case here, because `AppTopBar`
     * loads `/crest.png` and a `file://` harness cannot find it, so every run
     * would report a console error that means nothing.
     */
    participants: () => (
      <div className="flex justify-end p-4">
        <ParticipantsButton
          participants={[
            { personId: "p1", name: "Adam Wareing", isSelf: true, left: false, labels: ["Admin"] },
            { personId: "p2", name: "Leanne Minto", isSelf: false, left: false, labels: ["Coach U14 Mavericks"] },
            { personId: "p3", name: "Jane Smith", isSelf: false, left: false },
          ]}
          canOpenContacts={false}
        />
        <OpenOnMount selector='[aria-haspopup="dialog"]' />
      </div>
    ),
  },
};

export default fixture;
