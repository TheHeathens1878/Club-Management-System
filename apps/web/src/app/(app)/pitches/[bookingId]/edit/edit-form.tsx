"use client";

/**
 * Moving a pending pitch booking (gap 3, deliverable 3).
 *
 * Time, pitch and label only. The team is fixed: changing it would be a
 * different booking, and `bookings_team_staff_update` would in any case only
 * accept a team the caller also staffs, so offering the control would promise
 * more than the policy allows. The new slot is checked against the pitch
 * ignoring this booking's own row, which is what `excludeBookingId` is for.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import type { PitchBookingItem, PitchOption } from "@/lib/pitch-booking";

import { updatePitchBooking } from "../../booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "../../booking-feedback";

export function EditBookingForm({
  booking,
  pitches,
}: {
  booking: PitchBookingItem;
  pitches: PitchOption[];
}) {
  const [state, action, pending] = useActionState(updatePitchBooking, EMPTY_BOOKING_STATE);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="booking_id" value={booking.id} />
      <input type="hidden" name="team_id" value={booking.teamId ?? ""} />

      <div className="space-y-1">
        <Label htmlFor="resource_id">Pitch</Label>
        <Select id="resource_id" name="resource_id" required defaultValue={booking.resourceId}>
          {pitches.map((pitch) => (
            <option key={pitch.id} value={pitch.id}>
              {pitch.name}
            </option>
          ))}
          {!pitches.some((pitch) => pitch.id === booking.resourceId) && (
            <option value={booking.resourceId}>{booking.resourceName}</option>
          )}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" required defaultValue={booking.date} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="start_time">Start</Label>
          <Input
            id="start_time"
            name="start_time"
            type="time"
            required
            defaultValue={booking.startTime}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="end_time">End</Label>
          <Input id="end_time" name="end_time" type="time" required defaultValue={booking.endTime} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="occasion">Label</Label>
        <Input
          id="occasion"
          name="occasion"
          maxLength={120}
          defaultValue={booking.label ?? ""}
          placeholder="e.g. Tuesday training"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" maxLength={500} defaultValue={booking.notes ?? ""} />
      </div>

      <BookingFeedback state={state} />

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Checking the pitch…" : "Save changes"}
        </Button>
        <Link href="/pitches/mine" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Back to my bookings
        </Link>
      </div>
    </form>
  );
}
