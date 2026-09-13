"use client";

/**
 * What the club has booked at this venue, season by season (Adam,
 * 2026-09-13: "note booking dates for each season against each training
 * venue"), each booking with its weekly slots — the day and the hours (Adam,
 * later that day: "slots by days and hours instead of When"). A list grouped
 * by season with a remove on each row, and an add form beneath it — the same
 * shape as a block's dates off.
 */

import { useActionState, useState } from "react";
import { CalendarCheck, Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { WEEKDAYS, timeRange, weekdayLabel } from "@/lib/training-plan";

import {
  addVenueBooking,
  addVenueBookingSlot,
  removeVenueBooking,
  removeVenueBookingSlot,
} from "../venue-booking-actions";
import { VenueFeedback } from "../venue-forms";

export type VenueBookingSlotRow = { id: string; weekday: number; startTime: string; endTime: string };

export type VenueBookingRow = {
  id: string;
  seasonId: string | null;
  seasonName: string | null;
  startsOn: string;
  endsOn: string;
  reference: string | null;
  notes: string | null;
  slots: VenueBookingSlotRow[];
};

export type SeasonOption = { id: string; name: string; isCurrent: boolean };

/** "6 Oct 2026 – 23 Mar 2027" — a booking runs across the new year. */
export function bookingSpanLabel(startsOn: string, endsOn: string): string {
  const fmt = (date: string): string =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

/** Monday first, then by start time. */
function slotOrder(slots: VenueBookingSlotRow[]): VenueBookingSlotRow[] {
  const rank = (d: number) => (d + 6) % 7;
  return [...slots].sort((a, b) => rank(a.weekday) - rank(b.weekday) || a.startTime.localeCompare(b.startTime));
}

// ---------------------------------------------------------------------------
// The slot rows of the add form — day, from, until; add and take away
// ---------------------------------------------------------------------------

type DraftSlot = { key: number; weekday: string; start: string; end: string };

function SlotRowsEditor({ prefix }: { prefix: string }) {
  const [rows, setRows] = useState<DraftSlot[]>([{ key: 1, weekday: "2", start: "19:00", end: "20:00" }]);
  const [nextKey, setNextKey] = useState(2);

  function update(key: number, patch: Partial<DraftSlot>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium leading-none text-foreground">Slots booked</legend>
      <p className="text-xs text-muted-foreground">
        The day and the hours, one row per weekly slot — Tuesdays 19:00 to 20:00, Thursdays 18:00 to 19:30.
      </p>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-2">
            <div className="space-y-1">
              {index === 0 ? <Label htmlFor={`${prefix}-day-${row.key}`} className="text-xs">Day</Label> : null}
              <Select
                id={`${prefix}-day-${row.key}`}
                name="slot_weekday"
                value={row.weekday}
                onChange={(event) => update(row.key, { weekday: event.target.value })}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              {index === 0 ? <Label htmlFor={`${prefix}-start-${row.key}`} className="text-xs">From</Label> : null}
              <Input
                id={`${prefix}-start-${row.key}`}
                type="time"
                name="slot_start"
                value={row.start}
                onChange={(event) => update(row.key, { start: event.target.value })}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              {index === 0 ? <Label htmlFor={`${prefix}-end-${row.key}`} className="text-xs">Until</Label> : null}
              <Input
                id={`${prefix}-end-${row.key}`}
                type="time"
                name="slot_end"
                value={row.end}
                onChange={(event) => update(row.key, { end: event.target.value })}
                className="w-28"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              aria-label="Take this slot off"
              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              className="min-h-[44px] min-w-[44px] text-muted-foreground lg:min-h-0 lg:min-w-0"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const last = rows[rows.length - 1];
          setRows((current) => [
            ...current,
            { key: nextKey, weekday: last?.weekday ?? "2", start: last?.end ?? "19:00", end: last?.end ?? "20:00" },
          ]);
          setNextKey((k) => k + 1);
        }}
        className="min-h-[44px] lg:min-h-0"
      >
        <Plus className="h-4 w-4" aria-hidden /> Another slot
      </Button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// One booking's slots — the list, a remove on each, and "add a slot"
// ---------------------------------------------------------------------------

function RemoveSlot({ venueId, slot }: { venueId: string; slot: VenueBookingSlotRow }) {
  const [state, action, pending] = useActionState(removeVenueBookingSlot, {});
  return (
    <form action={action} className="inline-flex items-center">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      {state.error ? <span className="mr-1 text-xs text-destructive">{state.error}</span> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${weekdayLabel(slot.weekday)} ${timeRange(slot.startTime, slot.endTime)}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </form>
  );
}

function AddSlot({ venueId, bookingId, onDone }: { venueId: string; bookingId: string; onDone: () => void }) {
  const [state, action] = useActionState(addVenueBookingSlot, {});
  const prefix = `slot-${bookingId}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-md border bg-secondary/40 p-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <div className="min-w-0 flex-1 basis-32 space-y-1">
        <Label htmlFor={`${prefix}-day`} className="text-xs">Day</Label>
        <Select id={`${prefix}-day`} name="slot_weekday" defaultValue="2">
          {WEEKDAYS.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-start`} className="text-xs">From</Label>
        <Input id={`${prefix}-start`} type="time" name="slot_start" defaultValue="19:00" className="w-28" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-end`} className="text-xs">Until</Label>
        <Input id={`${prefix}-end`} type="time" name="slot_end" defaultValue="20:00" className="w-28" required />
      </div>
      <SubmitButton size="sm" variant="outline" className="min-h-[44px] lg:min-h-0" pendingLabel="Adding…">
        Add
      </SubmitButton>
      <Button type="button" variant="ghost" size="sm" onClick={onDone} className="min-h-[44px] lg:min-h-0">
        Done
      </Button>
      {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

function BookingSlots({ venueId, booking }: { venueId: string; booking: VenueBookingRow }) {
  const [adding, setAdding] = useState(false);
  const slots = slotOrder(booking.slots);
  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {slots.map((slot) => (
          <li
            key={slot.id}
            className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs font-medium"
          >
            <span>{weekdayLabel(slot.weekday)}</span>
            <span className="font-normal text-muted-foreground">{timeRange(slot.startTime, slot.endTime)}</span>
            <RemoveSlot venueId={venueId} slot={slot} />
          </li>
        ))}
        {slots.length === 0 ? <li className="text-xs text-muted-foreground">No slots noted.</li> : null}
        {!adding ? (
          <li>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden /> Slot
            </button>
          </li>
        ) : null}
      </ul>
      {adding ? <AddSlot venueId={venueId} bookingId={booking.id} onDone={() => setAdding(false)} /> : null}
    </div>
  );
}

function RemoveBooking({ venueId, booking }: { venueId: string; booking: VenueBookingRow }) {
  const [state, action, pending] = useActionState(removeVenueBooking, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="booking_id" value={booking.id} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove the booking ${bookingSpanLabel(booking.startsOn, booking.endsOn)}`}
        className="min-h-[44px] min-w-[44px] text-muted-foreground lg:min-h-0 lg:min-w-0"
        onClick={(event) => {
          if (booking.slots.length > 0 && !window.confirm(`Remove the booking ${bookingSpanLabel(booking.startsOn, booking.endsOn)} and its ${booking.slots.length} ${booking.slots.length === 1 ? "slot" : "slots"}?`)) {
            event.preventDefault();
          }
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function VenueBookingsCard({
  venueId,
  bookings,
  seasons,
}: {
  venueId: string;
  bookings: VenueBookingRow[];
  seasons: SeasonOption[];
}) {
  const [open, setOpen] = useState(bookings.length === 0);
  const [state, action] = useActionState(addVenueBooking, {});
  const current = seasons.find((season) => season.isCurrent);

  // Grouped by season, the current one first; a booking with no season last.
  const groups: { key: string; label: string; rows: VenueBookingRow[] }[] = [];
  for (const booking of bookings) {
    const key = booking.seasonId ?? "none";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: booking.seasonName ?? "No season", rows: [] };
      groups.push(group);
    }
    group.rows.push(booking);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 lg:p-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4 text-primary" aria-hidden /> Bookings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            What the club has booked here, season by season — the dates and the weekly slots. The
            training block says what happens in them.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} className="min-h-[44px] lg:min-h-0">
          <Plus className="h-4 w-4" aria-hidden /> Note a booking
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
        {open ? (
          <form action={action} className="space-y-3 rounded-xl border bg-secondary/40 p-4">
            <VenueFeedback state={state} />
            <input type="hidden" name="venue_id" value={venueId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="booking-season">Season</Label>
                <Select id="booking-season" name="season_id" defaultValue={current?.id ?? ""}>
                  <option value="">No season</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-starts">Booked from</Label>
                <Input id="booking-starts" type="date" name="starts_on" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-ends">Until</Label>
                <Input id="booking-ends" type="date" name="ends_on" required />
              </div>
            </div>

            <SlotRowsEditor prefix="new-booking" />

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="booking-ref">Reference</Label>
                <Input id="booking-ref" name="reference" placeholder="The venue's booking reference" maxLength={80} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="booking-notes">Notes</Label>
                <Textarea
                  id="booking-notes"
                  name="notes"
                  rows={2}
                  maxLength={1000}
                  placeholder="e.g. Paid to Christmas; second half invoiced in January. No session on 20 Feb — school event."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0" pendingLabel="Noting…">
                Note the booking
              </SubmitButton>
              {bookings.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="min-h-[44px] lg:min-h-0">
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookings noted yet. When the venue confirms the season&rsquo;s dates and slots, note them here.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="font-display text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {group.label}
              </p>
              <ul className="divide-y rounded-lg border">
                {group.rows.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-sm font-medium">{bookingSpanLabel(booking.startsOn, booking.endsOn)}</p>
                      <BookingSlots venueId={venueId} booking={booking} />
                      {booking.reference ? <p className="text-xs text-muted-foreground">Ref {booking.reference}</p> : null}
                      {booking.notes ? <p className="whitespace-pre-line text-xs text-muted-foreground">{booking.notes}</p> : null}
                    </div>
                    <RemoveBooking venueId={venueId} booking={booking} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
