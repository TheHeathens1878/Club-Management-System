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
import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  formatSlot,
  kindLabel,
  statusLabel,
  statusVariant,
  type PitchBookingItem,
} from "@/lib/pitch-booking";

import { cancelPitchBooking } from "../../pitches/booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "../../pitches/booking-feedback";

export function TeamPitchBookings({
  teamId,
  items,
  canManage,
}: {
  teamId: string;
  items: PitchBookingItem[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(cancelPitchBooking, EMPTY_BOOKING_STATE);

  return (
    <div className="space-y-3">
      <BookingFeedback state={state} />

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
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Details
              </Link>
              {/* A fixture's slot is `allocate_fixture()`'s to move, not this
                  card's — cancelling it here would orphan `fixtures.booking_id`. */}
              {canManage &&
                !item.calendarOnly &&
                item.kind !== "fixture" &&
                item.status !== "cancelled" && (
                <form action={action}>
                  <input type="hidden" name="booking_id" value={item.id} />
                  <input type="hidden" name="team_id" value={teamId} />
                  <Button type="submit" variant="outline" size="sm" disabled={pending}>
                    Cancel
                  </Button>
                </form>
              )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/pitches/book?team=${teamId}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Book a pitch for this team
      </Link>
    </div>
  );
}
