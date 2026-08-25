"use client";

/**
 * The administrator's desk (gap 3, deliverable 2).
 *
 * Declining captures a reason and keeps it in `internal_notes`, because "no"
 * without a reason is the thing coaches complain about in the legacy app —
 * there, reject was a single unexplained click. Confirming can still fail: a
 * pending row only meets `bookings_no_overlap` when it becomes confirmed, so
 * the exclusion constraint can refuse at exactly that moment and the message
 * says so.
 */

import Link from "next/link";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import {
  formatSlot,
  kindLabel,
  statusLabel,
  statusVariant,
  type PitchBookingItem,
} from "@/lib/pitch-booking";

import {
  cancelPitchBooking,
  confirmPitchBooking,
  declinePitchBooking,
} from "../booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "../booking-feedback";

function BookingSummary({ item }: { item: PitchBookingItem }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">
          {item.label ?? item.teamName ?? "Pitch booking"}
        </span>
        <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
        <Badge variant="muted">{kindLabel(item.kind)}</Badge>
        {item.recurrenceGroupId && <Badge variant="outline">Weekly series</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatSlot(item)} · {item.resourceName}
        {item.teamName ? ` · ${item.teamName}` : ""}
      </p>
      {(item.bookerName || item.bookerEmail) && (
        <p className="text-xs text-muted-foreground">
          Requested by {item.bookerName ?? "a coach"}
          {item.bookerEmail ? ` · ${item.bookerEmail}` : ""}
        </p>
      )}
      {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
      {item.internalNotes && (
        <p className="whitespace-pre-line text-xs text-amber-800">{item.internalNotes}</p>
      )}
    </div>
  );
}

function DeclineForm({
  item,
  action,
  pending,
}: {
  item: PitchBookingItem;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 flex-1 lg:h-9 lg:flex-none"
        onClick={() => setOpen(true)}
      >
        Decline
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2 rounded-lg border bg-secondary/40 p-3">
      <input type="hidden" name="booking_id" value={item.id} />
      <input type="hidden" name="team_id" value={item.teamId ?? ""} />
      <Textarea
        name="reason"
        required
        maxLength={500}
        placeholder="Why is this being declined? The coach is told this."
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          className="h-11 flex-1 lg:h-9 lg:flex-none"
          disabled={pending}
        >
          {pending ? "Declining…" : "Decline request"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 flex-1 lg:h-9 lg:flex-none"
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}

export function PendingRequests({ items }: { items: PitchBookingItem[] }) {
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmPitchBooking,
    EMPTY_BOOKING_STATE,
  );
  const [declineState, declineAction, declining] = useActionState(
    declinePitchBooking,
    EMPTY_BOOKING_STATE,
  );

  return (
    <div className="space-y-3">
      <BookingFeedback state={confirmState} />
      <BookingFeedback state={declineState} />

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing waiting. Every pitch request has been dealt with.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <BookingSummary item={item} />
              <div className="flex flex-wrap items-start gap-2">
                <form action={confirmAction} className="flex-1 lg:flex-none">
                  <input type="hidden" name="booking_id" value={item.id} />
                  <input type="hidden" name="team_id" value={item.teamId ?? ""} />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-11 w-full lg:h-9 lg:w-auto"
                    disabled={confirming}
                  >
                    Confirm
                  </Button>
                </form>
                <DeclineForm item={item} action={declineAction} pending={declining} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UpcomingBookings({ items }: { items: PitchBookingItem[] }) {
  const [state, action, pending] = useActionState(cancelPitchBooking, EMPTY_BOOKING_STATE);

  return (
    <div className="space-y-3">
      <BookingFeedback state={state} />
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing on the pitches for that filter.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <BookingSummary item={item} />
              {/* A fixture's booking belongs to `allocate_fixture()`. Cancelling
                  it here would leave `fixtures.booking_id` pointing at a dead
                  slot, so the fixture is sent to the allocation screen instead. */}
              {item.kind === "fixture" ? (
                <Link
                  href="/pitches"
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) +
                    " h-11 w-full lg:h-9 lg:w-auto"
                  }
                >
                  Unallocate on Pitches
                </Link>
              ) : (
                item.status !== "cancelled" && (
                  <form action={action}>
                    <input type="hidden" name="booking_id" value={item.id} />
                    <input type="hidden" name="team_id" value={item.teamId ?? ""} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="h-11 w-full lg:h-9 lg:w-auto"
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                  </form>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
