"use client";

/**
 * What the club has booked at this venue, season by season (Adam,
 * 2026-09-13: "note booking dates for each season against each training
 * venue"). A list grouped by season with a remove on each row, and an add
 * form beneath it — the same shape as a block's dates off.
 */

import { useActionState, useState } from "react";
import { CalendarCheck, Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import { addVenueBooking, removeVenueBooking } from "../venue-booking-actions";
import { VenueFeedback } from "../venue-forms";

export type VenueBookingRow = {
  id: string;
  seasonId: string | null;
  seasonName: string | null;
  startsOn: string;
  endsOn: string;
  whenText: string | null;
  reference: string | null;
  notes: string | null;
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
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}

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
            What the club has booked here, season by season — the hire itself. The training block says
            what happens in it.
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="booking-when">When</Label>
                <Input id="booking-when" name="when_text" placeholder="e.g. Tuesdays 19:00–20:00" maxLength={120} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="booking-ref">Reference</Label>
                <Input id="booking-ref" name="reference" placeholder="The venue's booking reference or invoice" maxLength={80} />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
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
            No bookings noted yet. When the venue confirms the season&rsquo;s dates, note them here.
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
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">
                        {bookingSpanLabel(booking.startsOn, booking.endsOn)}
                        {booking.whenText ? <span className="font-normal text-muted-foreground"> · {booking.whenText}</span> : null}
                      </p>
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
