"use client";

/**
 * One child, opened in a panel (P8.6).
 *
 * `/family` used to be a column of cards per child — contact details, then
 * emergency contacts, then app access, then the registration form, all of it
 * expanded for every child at once. Three children meant nine screens of
 * scrolling before you reached the thing you came to change. Now the screen is
 * the household: a line saying what it needs, a grid of what each child still
 * owes the club, and everything you CHANGE opens here, over it.
 *
 * The chrome is `PersonSheet`'s, and deliberately so — the same three rules,
 * and the same `Sheet` underneath:
 *
 *   1. **The mode is the URL** (`?sheet=contacts&child=<id>`), so a
 *      half-finished edit survives a refresh, a link can be sent, and a server
 *      action re-rendering the page underneath does not slam the panel shut.
 *      Switching mode is a `<Link>`, which is what keeps the reads lazy: the
 *      registration form's questions and the last form's answers are fetched
 *      only for the mode that wants them.
 *   2. **The sheet never works out the hat.** `canEdit` and `canRegister`
 *      arrive as props.
 *   3. **The body is the caller's** — server-rendered and passed as
 *      `children`.
 *
 * What it does NOT share with `PersonSheet` is the mode list, and that is the
 * safeguarding point rather than a styling one. A parent holds no `people`
 * write policy (P1.2 / SG-4): `update_child_details()` is the whole of their
 * authority, so roles, guardianships, identity documents, money and retiring
 * are not modes here and `canAdmin` is not a prop this component has. A sheet
 * that offered them would be a row of buttons the database refuses.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChipLink } from "@/components/ui/toggle-chip";

import {
  CHILD_SHEET_CAPTIONS,
  CHILD_SHEET_LABELS,
  CHILD_SHEET_MODES,
  type ChildSheetPanelMode,
} from "./child-sheet-modes";

export type ChildSheetProps = {
  /** The child the panel is about. Their name is its accessible name. */
  childName: string;
  /** `?sheet=` as the page parsed it. `null` draws nothing at all. */
  mode: ChildSheetPanelMode | null;
  /** The screen without `?sheet=` — where Done and the scrim go. */
  closeHref: string;
  /** One href per mode, built by the page so `child` and the rest survive. */
  modeHrefs: Record<ChildSheetPanelMode, string>;
  /** The guardian may change this child's contact details and contacts. */
  canEdit: boolean;
  /** The club has a current season, so a registration can be sent at all. */
  canRegister: boolean;
  /** The body for `mode`, rendered by the page on the server. */
  children: React.ReactNode;
};

/** Which modes this hat is offered. Reading is never the question here. */
function modesFor(canEdit: boolean, canRegister: boolean): ChildSheetPanelMode[] {
  return CHILD_SHEET_MODES.filter((mode) => {
    if (mode === "details" || mode === "contacts" || mode === "access") return canEdit;
    if (mode === "register") return canRegister;
    return true;
  });
}

export function ChildSheet({
  childName,
  mode,
  closeHref,
  modeHrefs,
  canEdit,
  canRegister,
  children,
}: ChildSheetProps) {
  const router = useRouter();
  const modes = modesFor(canEdit, canRegister);

  // Six chips do not fit a phone's width, so the one you are on has to be
  // brought to you: opening at `?sheet=registrations` otherwise shows a strip
  // whose first chip is Details and no sign of which chip is lit. `inline`
  // only — `block: "nearest"` leaves the page behind where it was.
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
      title={childName}
      subtitle={mode ? CHILD_SHEET_CAPTIONS[mode] : undefined}
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
          scrolling row of chips on top of that leaves no room for the thing
          the parent came to change. */}
      <div ref={strip} className="mb-4">
        <ChipStrip>
          {modes.map((key) => (
            <ToggleChipLink key={key} size="sm" href={modeHrefs[key]} active={key === mode}>
              {CHILD_SHEET_LABELS[key]}
            </ToggleChipLink>
          ))}
        </ChipStrip>
      </div>

      {children}
    </Sheet>
  );
}
