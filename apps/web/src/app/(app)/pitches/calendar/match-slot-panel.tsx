"use client";

/**
 * "This slot belongs to a match" — and here are the two things to do about it.
 *
 * Adam, 2026-09-16: "When I delete a booking in the pitch calendar as admin, I
 * get this message… I should be able to do this by deleting or cancelling the
 * match at the same time." Refusing the booking delete is still right — a
 * fixture's booking cannot go on its own, because `bookings.fixture_id` is ON
 * DELETE SET NULL one way and the fixture would be left with nowhere to play
 * the other. What was wrong was sending him to a different screen to do a
 * thing this panel can offer.
 *
 * NOTHING HERE IS A NEW POWER, AND NOTHING HERE IS RE-IMPLEMENTED. Both doors
 * post to the match actions the fixture desk already uses —
 * `bulkCancelFixtures` and `bulkDeleteFixtures` in
 * `(app)/matches/fixture-admin-actions.ts`, unchanged — which re-check club
 * admin for themselves, write their own audit rows, and let the database do
 * what it always does: cancelling frees the pitch, marks the diary entry and
 * tells everybody who was going; deleting gives the pitch back first
 * (`unallocate_fixture`) and takes the fixture, its mirror and its diary entry
 * with it. `canManageMatches` is the SCREEN's gate, computed on the server as
 * the club-admin capability and `isAdminHat` together — the fixture desk's own
 * pair — and RLS has the last word either way.
 *
 * Delete arms in two presses, the way the fixture page arms it: the first
 * press says what goes, the second does it.
 */

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarX2, Trash2 } from "lucide-react";

import {
  bulkCancelFixtures,
  bulkDeleteFixtures,
  type MatchAdminState,
} from "@/app/(app)/matches/fixture-admin-actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { matchSlotRefusal } from "@/lib/pitch-calendar";

const EMPTY: MatchAdminState = {};

export type MatchSlotPanelProps = {
  /** What the booking delete refused with. Shown verbatim without the doors. */
  message: string;
  /** The match the slot belongs to, when the booking named one. */
  fixtureId: string | null;
  /** The match's own page, when it could be resolved. */
  fixtureHref: string | null;
  /** "U12 Reds v Broadheath · Sat 3 Oct · 10:00" — built on the server side. */
  matchLabel: string;
  /** The club-admin capability and the admin hat, computed on the page. */
  canManageMatches: boolean;
  /** A door was used: the week behind this sheet is stale. */
  onDone: () => void;
};

export function MatchSlotPanel({
  message,
  fixtureId,
  fixtureHref,
  matchLabel,
  canManageMatches,
  onDone,
}: MatchSlotPanelProps) {
  const [cancelState, cancelAction, cancelling] = useActionState(bulkCancelFixtures, EMPTY);
  const [deleteState, deleteAction, deleting] = useActionState(bulkDeleteFixtures, EMPTY);
  const [armed, setArmed] = useState(false);

  const refusal = matchSlotRefusal({ message, fixtureId, canManageMatches });
  const busy = cancelling || deleting;
  const notice = cancelState.notice ?? deleteState.notice;
  const error = cancelState.error ?? deleteState.error;
  const warnings = [...(cancelState.warnings ?? []), ...(deleteState.warnings ?? [])];

  // One of the doors worked, so the grid behind is showing a match that has
  // just been cancelled or deleted. The caller refetches; the doors go, since
  // there is nothing left to press them on.
  useEffect(() => {
    if (!notice) return;
    setArmed(false);
    onDone();
    // `onDone` is an inline arrow at the call site, so depending on it would
    // re-fire this on every render of the sheet above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  return (
    <div className="space-y-2">
      <Callout tone={notice ? "success" : "warning"}>{notice ?? refusal.text}</Callout>

      {error && <Callout tone="danger">{error}</Callout>}
      {warnings.map((warning, index) => (
        <Callout key={index} tone="warning">
          {warning}
        </Callout>
      ))}

      {refusal.doors && fixtureId && !notice && (
        <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
          <p className="text-list font-medium">{matchLabel}</p>

          <form action={cancelAction}>
            <input type="hidden" name="fixture_id" value={fixtureId} />
            <p className="text-xs text-muted-foreground">
              Cancelling keeps the match on record, frees this pitch and tells everybody who was
              going. Putting it back to scheduled re-books the slot.
            </p>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="touch mt-2 w-full sm:w-auto"
              disabled={busy}
            >
              <CalendarX2 className="h-4 w-4" aria-hidden />
              {cancelling ? "Cancelling…" : "Cancel the match and free the pitch"}
            </Button>
          </form>

          <div className="border-t pt-2">
            {!armed ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="touch w-full text-destructive hover:text-destructive sm:w-auto"
                onClick={() => setArmed(true)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete the match and its booking…
              </Button>
            ) : (
              <form
                action={deleteAction}
                className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
              >
                <input type="hidden" name="fixture_id" value={fixtureId} />
                <p className="text-sm font-medium">Delete {matchLabel}?</p>
                <p className="text-xs text-muted-foreground">
                  The pitch is given back first, then the match goes — with its diary entry, the
                  team sheet, everybody&apos;s answers and its stats. Nobody is emailed about a
                  deletion, so if the game is simply off, cancel it instead. This cannot be undone
                  from here.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    className="touch"
                    disabled={busy}
                  >
                    {deleting ? "Deleting…" : "Yes, delete it"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="touch"
                    onClick={() => setArmed(false)}
                    disabled={busy}
                  >
                    Keep it
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Kept whatever the caller may do: the match's own page carries the
          kick-off, the squad and the rest of it. */}
      {fixtureHref && (
        <Link
          href={fixtureHref}
          className="touch inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the match <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
