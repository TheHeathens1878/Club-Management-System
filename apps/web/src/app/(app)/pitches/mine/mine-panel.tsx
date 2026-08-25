"use client";

/**
 * The coach's own list (gap 3, deliverable 3).
 *
 * Edit is offered only while a booking is pending, because that is the only
 * time `bookings_team_guard()` will accept one — a confirmed slot is the
 * club's diary and moving it is a conversation with the administrator, not a
 * form. Cancel stays available either way: a status change to `cancelled` is
 * the one transition the guard always allows.
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

import { cancelPitchBooking, cancelPitchBookingSeries } from "../booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "../booking-feedback";

export function MyPitchBookings({ items }: { items: PitchBookingItem[] }) {
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelPitchBooking,
    EMPTY_BOOKING_STATE,
  );
  const [seriesState, seriesAction, cancellingSeries] = useActionState(
    cancelPitchBookingSeries,
    EMPTY_BOOKING_STATE,
  );

  if (items.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No upcoming pitch bookings.</p>
        <Link href="/pitches/book" className={buttonVariants({ size: "sm" })}>
          Book a pitch
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <BookingFeedback state={cancelState} />
      <BookingFeedback state={seriesState} />

      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{item.label ?? item.teamName ?? "Pitch booking"}</span>
              <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
              <Badge variant="muted">{kindLabel(item.kind)}</Badge>
              {item.recurrenceGroupId && <Badge variant="outline">Weekly series</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatSlot(item)} · {item.resourceName}
              {item.teamName ? ` · ${item.teamName}` : ""}
            </p>
            {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}

            {/* Every control is a 44px target on a phone (mobile design). */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Gap 8: availability and the attendance sheet for this session. */}
              <Link
                href={`/pitches/${item.id}`}
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) + " h-11 flex-1 lg:h-9 lg:flex-none"
                }
              >
                Details
              </Link>
              {item.status === "pending" && (
                <Link
                  href={`/pitches/${item.id}/edit`}
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) +
                    " h-11 flex-1 lg:h-9 lg:flex-none"
                  }
                >
                  Edit
                </Link>
              )}
              {item.status !== "cancelled" && (
                <form action={cancelAction} className="flex-1 lg:flex-none">
                  <input type="hidden" name="booking_id" value={item.id} />
                  <input type="hidden" name="team_id" value={item.teamId ?? ""} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="h-11 w-full lg:h-9 lg:w-auto"
                    disabled={cancelling}
                  >
                    Cancel
                  </Button>
                </form>
              )}
              {item.recurrenceGroupId && item.status !== "cancelled" && (
                <form action={seriesAction} className="w-full lg:w-auto">
                  <input
                    type="hidden"
                    name="recurrence_group_id"
                    value={item.recurrenceGroupId}
                  />
                  <input type="hidden" name="team_id" value={item.teamId ?? ""} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="h-11 w-full lg:h-9 lg:w-auto"
                    disabled={cancellingSeries}
                  >
                    Cancel whole series
                  </Button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
