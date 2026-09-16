"use client";

/**
 * One person, opened in a panel (P8.3b).
 *
 * The record used to be a column of nine cards and a two-tab bar: to change a
 * phone number you scrolled past the roles, the guardianships and every team
 * the person had ever been in. Now the page is the person — a status line, a
 * band of facts, their teams — and everything you CHANGE opens here, over it.
 *
 * Three rules this component keeps:
 *
 *   1. **The mode is the URL.** `?sheet=details` is what opens it, so a
 *      half-finished edit survives a refresh, a colleague can be sent the
 *      exact panel, and a server action re-rendering the page underneath does
 *      not slam the sheet shut. Switching mode is a `<Link>`, which is also
 *      what keeps the expensive reads lazy: the family tree, the subscriptions
 *      and the payments are fetched by the server only for the mode that wants
 *      them.
 *   2. **The sheet never works out the hat.** `canEdit`, `canAdmin` and
 *      `isSuperUser` arrive as props. `/people/[id]` is committee-only and
 *      hands over what it already computed; `/teams/[id]`'s squad and
 *      `/family` have different answers and will hand over theirs. A component
 *      that decided for itself would be wrong on two screens out of three, and
 *      the database would be the only thing left saying no.
 *   3. **The body is the caller's.** Every mode's content arrives as
 *      `children`, already rendered on the server with the caller's own
 *      client. This component draws the chrome — the panel, the mode strip,
 *      the way out — and knows nothing about people.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChipLink } from "@/components/ui/toggle-chip";
import { Sheet } from "@/components/ui/sheet";
import type { PersonSheetMode } from "@/lib/person-record-state";

import {
  PERSON_SHEET_CAPTIONS,
  PERSON_SHEET_LABELS,
  PERSON_SHEET_MODES,
} from "./person-sheet-modes";

export type PersonSheetProps = {
  /** The person the panel is about. Their name is its accessible name. */
  personName: string;
  /** `?sheet=` as the caller parsed it. `null` draws nothing at all. */
  mode: PersonSheetMode | null;
  /** The record without `?sheet=` — where Close and the scrim go. */
  closeHref: string;
  /** One href per mode, built by the caller so `from` and the rest survive. */
  modeHrefs: Record<PersonSheetMode, string>;
  /** May change this person's own details and emergency contacts. */
  canEdit: boolean;
  /** Club administrator: roles, guardianships and retiring are offered. */
  canAdmin: boolean;
  /** The one account that is offered a permanent delete. */
  isSuperUser: boolean;
  /** The body for `mode`, rendered by the caller on the server. */
  children: React.ReactNode;
};

/** Which modes a given hat is offered. Reading is never the question here. */
function modesFor(canEdit: boolean, canAdmin: boolean): PersonSheetMode[] {
  return PERSON_SHEET_MODES.filter((mode) => {
    if (mode === "details" || mode === "contacts") return canEdit;
    if (mode === "roles" || mode === "guardianships" || mode === "danger") return canAdmin;
    return true;
  });
}

export function PersonSheet({
  personName,
  mode,
  closeHref,
  modeHrefs,
  canEdit,
  canAdmin,
  isSuperUser,
  children,
}: PersonSheetProps) {
  const router = useRouter();
  const modes = modesFor(canEdit, canAdmin);

  // Nine chips do not fit in a 520px drawer, so the one you are on has to be
  // brought to you: without this, opening the record at `?sheet=money` shows a
  // strip whose first chip is Details and no sign that Money is the chip that
  // is lit. `inline` only — `block: "nearest"` keeps the page behind still.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mode) return;
    strip.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [mode]);

  return (
    <Sheet
      open={!!mode}
      onClose={() => router.push(closeHref)}
      title={personName}
      subtitle={mode ? PERSON_SHEET_CAPTIONS[mode] : undefined}
      width={520}
      footer={
        <div className="flex justify-end">
          <Link
            href={closeHref}
            className={buttonVariants({ variant: "outline", size: "touch" })}
          >
            Done
          </Link>
        </div>
      }
    >
      {/* The mode strip is inside the body, not the header: on a phone the
          header is already a title, a caption and a close button, and a
          scrolling row of nine chips on top of that leaves no room for the
          thing you came to change. */}
      <div ref={strip} className="mb-4">
        <ChipStrip>
          {modes.map((key) => (
            <ToggleChipLink key={key} size="sm" href={modeHrefs[key]} active={key === mode}>
              {PERSON_SHEET_LABELS[key]}
            </ToggleChipLink>
          ))}
        </ChipStrip>
      </div>

      {children}

      {/* A super user is the only account offered a permanent delete, and the
          note belongs where the delete is rather than on the record behind. */}
      {mode === "danger" && !isSuperUser && (
        <p className="mt-3 text-xs text-muted-foreground">
          Retiring is the club&apos;s answer. A permanent deletion is offered only to the super
          user, and <code>purge_person()</code> would refuse anyone else in any case.
        </p>
      )}
    </Sheet>
  );
}
