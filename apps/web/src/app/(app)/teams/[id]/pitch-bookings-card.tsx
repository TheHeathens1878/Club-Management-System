"use client";

/**
 * This team's pitch bookings, on the team page (gap 3, deliverable 4).
 *
 * The rows arrive already narrowed by RLS: a coach or an administrator gets
 * them straight from `bookings`, and anyone else the team page admits gets the
 * same sessions through `pitch_calendar()` — no booker PII, and flagged
 * `calendarOnly` so no cancel button is offered for a row the caller could not
 * write to anyway.
 */

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  formatSlot,
  kindLabel,
  statusLabel,
  statusVariant,
  type PitchBookingItem,
} from "@/lib/pitch-booking";

import type { Headcount } from "@/lib/headcount";

import { HeadcountChips } from "./fixtures-list";
import { CancelPitchBookingButton } from "../../pitches/cancel-booking-button";

export function TeamPitchBookings({
  teamId,
  items,
  canManage,
  headcounts = {},
}: {
  teamId: string;
  items: PitchBookingItem[];
  canManage: boolean;
  /** Squad availability per booking id — staff view (gap: attendance markers). */
  headcounts?: Record<string, Headcount>;
}) {
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No pitch bookings for this team yet.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {item.label ?? item.teamName ?? "Pitch booking"}
                  </span>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                  <Badge variant="muted">{kindLabel(item.kind)}</Badge>
                  {item.teamId !== teamId && <Badge variant="outline">Shared session</Badge>}
                  {headcounts[item.id] && <HeadcountChips headcount={headcounts[item.id]!} />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatSlot(item)} · {item.resourceName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              {/* Gap 8: availability and the attendance sheet for this session.
                  Offered to everyone the card is shown to — `/pitches/[id]`
                  reads as the caller and 404s if they may not see it. */}
              <Link
                href={`/pitches/${item.id}`}
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
                }
              >
                Details
              </Link>
              {/* The same page, opened at the sheet: team staff and
                  administrators come here to mark who turned up, and should not
                  have to know that "Details" is where attendance lives. The
                  page still reads as the caller — the button is a shortcut, not
                  a permission. */}
              {canManage && (
                <Link
                  href={`/pitches/${item.id}#attendance`}
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
                  }
                >
                  Attendance
                </Link>
              )}
              {/* Cancelling, with the second look a released pitch deserves
                  (Adam, 2026-08-25: "allow coaches to cancel bookings").
                  `fixtureId`, not `kind`, is the test now that a coach can ask
                  for a MATCH: a requested match is a `fixture`-kind booking
                  with no link and is theirs to cancel, while an ALLOCATED
                  fixture's slot is `allocate_fixture()`'s to move — cancelling
                  that here would orphan `fixtures.booking_id`, and
                  `bookings_team_guard()` refuses it anyway. */}
              {canManage &&
                !item.calendarOnly &&
                item.fixtureId === null &&
                item.status !== "cancelled" && (
                  <CancelPitchBookingButton
                    bookingId={item.id}
                    teamId={teamId}
                    slot={formatSlot(item)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/pitches/book?team=${teamId}`}
        className={
          buttonVariants({ variant: "outline", size: "sm" }) +
          " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        }
      >
        Book a pitch for this team
      </Link>
    </div>
  );
}
