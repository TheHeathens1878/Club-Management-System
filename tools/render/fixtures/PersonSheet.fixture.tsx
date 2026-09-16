/**
 * The member record's panel, in the three states that decide its shape.
 *
 * `PersonSheet` draws the chrome and the mode strip; the BODY always arrives
 * from the caller, already rendered on the server. That is exactly what these
 * cases do — each hands it a body of the right shape and length — so what is
 * photographed is the composition the page produces, without a Supabase client
 * anywhere near it.
 *
 * `canEdit` / `canAdmin` / `isSuperUser` are props by design: the sheet never
 * works out the hat. `readOnly` below is the same panel opened by somebody who
 * is not a club administrator, and the strip is shorter because of it — which
 * is the thing worth photographing about that case.
 *
 * Each case opens itself on mount by clicking its own trigger, the way
 * `Sheet.fixture.tsx` does: the sheet is portalled to <body> and only renders
 * when `open`, so there is nothing to shoot until something opens it.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { PersonSheet } from "@/components/person/person-sheet";
import { PERSON_SHEET_MODES } from "@/components/person/person-sheet-modes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { PersonSheetMode } from "@/lib/person-record-state";

import type { Fixture } from "./contract";

const MODE_HREFS = Object.fromEntries(
  PERSON_SHEET_MODES.map((mode) => [mode, `/people/p1?sheet=${mode}`]),
) as Record<PersonSheetMode, string>;

function Opener({
  mode,
  canEdit = true,
  canAdmin = true,
  isSuperUser = false,
  children,
}: {
  mode: PersonSheetMode;
  canEdit?: boolean;
  canAdmin?: boolean;
  isSuperUser?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    trigger.current?.click();
  }, []);

  return (
    <div className="p-4">
      <Button ref={trigger} size="touch" onClick={() => setOpen(true)}>
        Open the record
      </Button>
      <PersonSheet
        personName="Amelia Wareing"
        mode={open ? mode : null}
        closeHref="/people/p1"
        modeHrefs={MODE_HREFS}
        canEdit={canEdit}
        canAdmin={canAdmin}
        isSuperUser={isSuperUser}
      >
        {children}
      </PersonSheet>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    // A child with nobody to ring: the mode the status bar sends you to, with
    // the longest strip (a club administrator sees all nine).
    contactsMissing: () => (
      <Opener mode="contacts">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Up to two, kept on the person&apos;s record rather than on a registration form. Only a
            club administrator can change them here; the person and their guardians change them
            from their own screens.
          </p>
          <Callout tone="warning">
            This is a child&apos;s record and the club holds nobody to ring for them.
          </Callout>
          <Button size="touch" variant="outline">
            Add emergency contacts
          </Button>
        </div>
      </Opener>
    ),

    // The longest body the panel ever holds, so the strip, the scrolling body
    // and the footer have to sit apart from each other properly.
    membershipFull: () => (
      <Opener mode="membership">
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-row font-semibold">Membership number</h3>
            <p className="text-sm text-muted-foreground">
              The household number this person is billed under. Every charge lands on the lead
              member (the bill-payer); each person keeps their own card letter.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xl font-bold tabular-nums">00042B</span>
              <a
                href="/people/p2?sheet=membership"
                className="touch flex items-center text-sm font-medium underline underline-offset-2"
              >
                Billed to the lead member →
              </a>
            </div>
            <ul className="space-y-1 text-sm">
              <li className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">00042A</span>
                <a
                  href="/people/p2?sheet=membership"
                  className="touch flex items-center font-medium underline underline-offset-2"
                >
                  Adam Wareing
                </a>
                <Badge variant="muted">lead</Badge>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">00042B</span>
                <span className="font-medium">Amelia Wareing</span>
              </li>
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="text-row font-semibold">Club membership</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Family membership</Badge>
              <span className="text-sm text-muted-foreground">2026/27 · current season</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Two or more players in the same season is a family membership. One other person is on
              it.
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="text-row font-semibold">Family</h3>
            <p className="text-sm text-muted-foreground">
              Amelia Wareing at the top, the children the club has them down as a guardian for, each
              of those children&apos;s other guardians, and the adults connected to their account.
            </p>
          </section>
        </div>
      </Opener>
    ),

    // The same panel opened by somebody who is not a club administrator: no
    // roles, no guardianships, no retiring. The strip is what changes.
    readOnly: () => (
      <Opener mode="registration" canAdmin={false}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            2026/27 registration, answered 12 Aug 2026 · approved. Read-only here: each new
            registration overwrites these answers, and they are changed by registering again.
          </p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Medical conditions</dt>
              <dd>Asthma — blue inhaler in the kit bag</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">School</dt>
              <dd>Ashton-on-Mersey School</dd>
            </div>
          </dl>
        </div>
      </Opener>
    ),
  },
};

export default fixture;
