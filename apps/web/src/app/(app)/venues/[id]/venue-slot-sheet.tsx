"use client";

/**
 * One booked slot — or one booking, or the booking about to be made — in a
 * panel over the grid, the way a training slot opens on the block page next
 * door (P8.8). A drawer from the right on a desk, a sheet from the bottom on
 * a phone, and never a trip to another screen.
 *
 * Four modes, because a ground has four things to say:
 *
 *   · `view`    — a slot: its pitch, its day and hours, how much of the
 *                 pitch is ours, what one session costs and what the season
 *                 of them comes to.
 *   · `edit`    — the slot's fields, filled in, as a NEW slot. The database
 *                 has no update for a booked slot (`venue_booking_slots`
 *                 carries an insert and a delete and nothing between), so
 *                 the panel says so plainly and puts "add the corrected one"
 *                 and "take the old one off" a press apart rather than
 *                 pretending to save in place.
 *   · `remove`  — armed, because a slot comes off a real invoice.
 *   · `booking` — the booking itself: its season, its dates, its reference
 *                 and its notes, with `SlotRowsEditor` for typing a whole
 *                 season's slots in one go when it is new.
 *
 * Which mode is open lives in the page's `?sheet=` (see `parseVenueSheet` in
 * lib/venue-season.ts), so the refresh every server action causes puts the
 * panel back exactly where it was.
 */

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Pencil, Plus, Trash2, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select, Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { SHARE_OPTIONS, WEEKDAYS, shareKey, shareWord, timeRange, weekdayLabel } from "@/lib/training-plan";
import { formatCurrency } from "@/lib/utils";
import { slotCost, type DateRange } from "@/lib/venue-hire";
import { venueSeasonTotal, type VenueSheetState } from "@/lib/venue-season";

import type { VenueActionState } from "../venue-actions";
import {
  addVenueBooking,
  addVenueBookingSlot,
  removeVenueBooking,
  removeVenueBookingSlot,
} from "../venue-booking-actions";
import { bookingSpanLabel, type PitchChoice, type SeasonOption, type VenueBookingRow, type VenueBookingSlotRow } from "./types";

const EMPTY: VenueActionState = {};

/** What the server just said, in the tokens the rest of the makeover uses. */
function Feedback({ state }: { state: VenueActionState }) {
  if (state.error) {
    return (
      <Callout tone="danger" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
        <span className="whitespace-pre-line">{state.error}</span>
      </Callout>
    );
  }
  if (state.notice) {
    return (
      <Callout tone="success" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}>
        {state.notice}
      </Callout>
    );
  }
  return null;
}

function PitchSelect({
  id,
  pitches,
  value,
  onChange,
  defaultValue,
}: {
  id: string;
  pitches: PitchChoice[];
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
}) {
  return (
    <Select
      id={id}
      name="slot_pitch"
      value={value}
      defaultValue={value === undefined ? (defaultValue ?? "") : undefined}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      className="touch"
    >
      <option value="">{pitches.length === 0 ? "The pitch" : "Any / the whole venue"}</option>
      {pitches.map((pitch) => (
        <option key={pitch.id} value={pitch.id}>
          {pitch.name}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// A season's slots, typed in one go — kept from the card this panel replaces
// ---------------------------------------------------------------------------

type DraftSlot = { key: number; pitch: string; weekday: string; start: string; end: string; share: string; price: string };

function SlotRowsEditor({ prefix, pitches }: { prefix: string; pitches: PitchChoice[] }) {
  const [rows, setRows] = useState<DraftSlot[]>([
    { key: 1, pitch: pitches[0]?.id ?? "", weekday: "2", start: "19:00", end: "20:00", share: "1:1", price: "" },
  ]);
  const [nextKey, setNextKey] = useState(2);

  function update(key: number, patch: Partial<DraftSlot>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium leading-none text-foreground">Slots booked</legend>
      <p className="text-xs text-muted-foreground">
        One row per weekly slot: which pitch, the day, the hours, how much of the pitch is ours and
        what one session costs — Pitch 1 Mondays 18:00 to 19:00, half a pitch, £45. The Finance
        report adds the sessions up.
        {pitches.length === 0 ? " Add the ground's pitches below to name them here." : ""}
      </p>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-2 items-end gap-2">
            <div className="space-y-1">
              {index === 0 ? (
                <Label htmlFor={`${prefix}-pitch-${row.key}`} className="text-xs">
                  Pitch
                </Label>
              ) : null}
              <PitchSelect
                id={`${prefix}-pitch-${row.key}`}
                pitches={pitches}
                value={row.pitch}
                onChange={(value) => update(row.key, { pitch: value })}
              />
            </div>
            <div className="space-y-1">
              {index === 0 ? (
                <Label htmlFor={`${prefix}-day-${row.key}`} className="text-xs">
                  Day
                </Label>
              ) : null}
              <Select
                id={`${prefix}-day-${row.key}`}
                name="slot_weekday"
                value={row.weekday}
                onChange={(event) => update(row.key, { weekday: event.target.value })}
                className="touch min-w-0"
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              {index === 0 ? (
                <Label htmlFor={`${prefix}-start-${row.key}`} className="text-xs">
                  From
                </Label>
              ) : null}
              <Input
                id={`${prefix}-start-${row.key}`}
                type="time"
                name="slot_start"
                value={row.start}
                onChange={(event) => update(row.key, { start: event.target.value })}
                className="touch"
              />
            </div>
            <div className="space-y-1">
              {index === 0 ? (
                <Label htmlFor={`${prefix}-end-${row.key}`} className="text-xs">
                  Until
                </Label>
              ) : null}
              <Input
                id={`${prefix}-end-${row.key}`}
                type="time"
                name="slot_end"
                value={row.end}
                onChange={(event) => update(row.key, { end: event.target.value })}
                className="touch"
              />
            </div>
            <div className="space-y-1">
              {index === 0 ? (
                <Label htmlFor={`${prefix}-share-${row.key}`} className="text-xs">
                  Ours
                </Label>
              ) : null}
              <Select
                id={`${prefix}-share-${row.key}`}
                name="slot_share"
                value={row.share}
                onChange={(event) => update(row.key, { share: event.target.value })}
                className="touch min-w-0"
              >
                {SHARE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-1">
              <div className="min-w-0 flex-1 space-y-1">
                {index === 0 ? (
                  <Label htmlFor={`${prefix}-price-${row.key}`} className="text-xs">
                    £ a session
                  </Label>
                ) : null}
                <Input
                  id={`${prefix}-price-${row.key}`}
                  name="slot_price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={row.price}
                  onChange={(event) => update(row.key, { price: event.target.value })}
                  className="touch"
                  placeholder="45.00"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rows.length === 1}
                aria-label="Take this slot off"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                className="touch min-w-[44px] flex-none text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
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
            {
              key: nextKey,
              pitch: last?.pitch ?? "",
              weekday: last?.weekday ?? "2",
              start: last?.end ?? "19:00",
              end: last?.end ?? "20:00",
              share: last?.share ?? "1:1",
              price: last?.price ?? "",
            },
          ]);
          setNextKey((k) => k + 1);
        }}
        className="touch"
      >
        <Plus className="h-4 w-4" aria-hidden /> Another slot
      </Button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The booking about to be made
// ---------------------------------------------------------------------------

function NewBookingForm({
  venueId,
  seasons,
  pitches,
  seasonId,
}: {
  venueId: string;
  seasons: SeasonOption[];
  pitches: PitchChoice[];
  /** The season the status bar was talking about. */
  seasonId: string | null;
}) {
  const [state, action] = useActionState(addVenueBooking, EMPTY);
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="venue_id" value={venueId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="booking-season">Season</Label>
          <Select id="booking-season" name="season_id" defaultValue={seasonId ?? ""} className="touch">
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
          <Input id="booking-starts" type="date" name="starts_on" required className="touch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-ends">Until</Label>
          <Input id="booking-ends" type="date" name="ends_on" required className="touch" />
        </div>
      </div>

      <SlotRowsEditor prefix="new-booking" pitches={pitches} />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="booking-ref">Reference</Label>
          <Input id="booking-ref" name="reference" placeholder="The venue's booking reference" maxLength={80} className="touch" />
        </div>
        <div className="space-y-1.5">
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
      <SubmitButton size="touch" className="w-full lg:w-auto" pendingLabel="Noting…">
        Note the booking
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One more slot on a booking already noted
// ---------------------------------------------------------------------------

function AddSlotForm({
  venueId,
  bookingId,
  pitches,
  pitchId,
  weekday,
  from,
  until,
  share,
  price,
  title,
  note,
}: {
  venueId: string;
  bookingId: string;
  pitches: PitchChoice[];
  pitchId: string | null;
  weekday: number;
  from?: string;
  until?: string;
  share?: string;
  price?: string;
  title: string;
  note?: React.ReactNode;
}) {
  const [state, action] = useActionState(addVenueBookingSlot, EMPTY);
  const prefix = `add-slot-${bookingId}`;
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <p className="text-row font-semibold leading-tight">{title}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`${prefix}-pitch`}>Pitch</Label>
          <PitchSelect id={`${prefix}-pitch`} pitches={pitches} defaultValue={pitchId ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-day`}>Day</Label>
          <Select id={`${prefix}-day`} name="slot_weekday" defaultValue={String(weekday)} className="touch min-w-0">
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-share`}>Ours</Label>
          <Select id={`${prefix}-share`} name="slot_share" defaultValue={share ?? "1:1"} className="touch min-w-0">
            {SHARE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-start`}>From</Label>
          <Input id={`${prefix}-start`} type="time" name="slot_start" defaultValue={from ?? "19:00"} required className="touch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-end`}>Until</Label>
          <Input id={`${prefix}-end`} type="time" name="slot_end" defaultValue={until ?? "20:00"} required className="touch" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`${prefix}-price`}>£ a session</Label>
          <Input
            id={`${prefix}-price`}
            name="slot_price"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={price}
            placeholder="45.00" className="touch"
          />
        </div>
      </div>
      <SubmitButton size="touch" className="w-full lg:w-auto" pendingLabel="Adding…">
        <Plus className="h-4 w-4" aria-hidden /> Add this slot
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// A booking, in full
// ---------------------------------------------------------------------------

function RemoveBooking({ venueId, booking }: { venueId: string; booking: VenueBookingRow }) {
  const [state, action, pending] = useActionState(removeVenueBooking, EMPTY);
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <div className="space-y-2">
        <Feedback state={state} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setArmed(true)}
          className="touch text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Remove this booking
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="booking_id" value={booking.id} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending} className="touch">
        {pending
          ? "Removing…"
          : booking.slots.length > 0
            ? `Remove it and its ${booking.slots.length} ${booking.slots.length === 1 ? "slot" : "slots"}`
            : "Remove the booking"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)} className="touch">
        Keep it
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function BookingDetail({
  venueId,
  booking,
  pitches,
  uncharged,
}: {
  venueId: string;
  booking: VenueBookingRow;
  pitches: PitchChoice[];
  uncharged: DateRange[];
}) {
  const [adding, setAdding] = useState(false);
  const total = venueSeasonTotal(booking.slots, uncharged, booking);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="muted">{booking.slots.length === 1 ? "1 slot" : `${booking.slots.length} slots`}</Badge>
        <Badge variant={total.unpricedSlots > 0 ? "warning" : "muted"}>
          {total.unpricedSlots > 0 && total.costPence === 0 ? "No prices yet" : formatCurrency(total.costPence)}
        </Badge>
        {total.uncharged > 0 ? <Badge variant="outline">{total.uncharged} not charged</Badge> : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Season</dt>
          <dd className="font-medium">{booking.seasonName ?? "No season"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Sessions</dt>
          <dd className="font-medium">{total.sessions}</dd>
        </div>
        {booking.reference ? (
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="font-medium">{booking.reference}</dd>
          </div>
        ) : null}
        {booking.notes ? (
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-line">{booking.notes}</dd>
          </div>
        ) : null}
      </dl>

      {adding ? (
        <section className="space-y-3 rounded-xl border bg-secondary/40 p-3">
          <AddSlotForm
            venueId={venueId}
            bookingId={booking.id}
            pitches={pitches}
            pitchId={pitches[0]?.id ?? null}
            weekday={2}
            title="Another slot on this booking"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} className="touch">
            Done
          </Button>
        </section>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} className="touch">
          <Plus className="h-4 w-4" aria-hidden /> Add a slot
        </Button>
      )}

      <section className="border-t pt-4">
        <RemoveBooking venueId={venueId} booking={booking} />
        <p className="mt-2 text-xs text-muted-foreground">
          Removing a booking removes its slots with it. The grid above and the Finance report both
          stop counting them.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A slot, in full
// ---------------------------------------------------------------------------

function RemoveSlot({ venueId, slot, onGone }: { venueId: string; slot: VenueBookingSlotRow; onGone: () => void }) {
  const [state, action, pending] = useActionState(removeVenueBookingSlot, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending} className="touch">
        {pending ? "Removing…" : "Take this slot off"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onGone} className="touch">
        Keep it
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function SlotDetail({
  venueId,
  slot,
  booking,
  pitches,
  uncharged,
}: {
  venueId: string;
  slot: VenueBookingSlotRow;
  booking: VenueBookingRow;
  pitches: PitchChoice[];
  uncharged: DateRange[];
}) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const cost = slotCost(booking, slot, uncharged);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={slot.shares >= slot.parts ? "success" : "muted"}>{shareWord(slot.parts, slot.shares)}</Badge>
        <Badge variant={slot.pricePence === null ? "warning" : "muted"}>
          {slot.pricePence === null ? "No price yet" : `${formatCurrency(slot.pricePence)} a session`}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Sessions</dt>
          <dd className="font-medium">
            {cost.sessions}
            {cost.uncharged > 0 ? ` · ${cost.uncharged} not charged` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Over the booking</dt>
          <dd className="font-medium">{cost.costPence === null ? "—" : formatCurrency(cost.costPence)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Booked</dt>
          <dd>
            {bookingSpanLabel(booking.startsOn, booking.endsOn)}
            {booking.reference ? ` · ref ${booking.reference}` : ""}
          </dd>
        </div>
      </dl>

      {mode === "edit" ? (
        <section className="space-y-3 rounded-xl border bg-secondary/40 p-3">
          <AddSlotForm
            venueId={venueId}
            bookingId={booking.id}
            pitches={pitches}
            pitchId={slot.pitchId}
            weekday={slot.weekday}
            from={slot.startTime.slice(0, 5)}
            until={slot.endTime.slice(0, 5)}
            share={shareKey(slot.parts, slot.shares)}
            price={slot.pricePence === null ? undefined : (slot.pricePence / 100).toFixed(2)}
            title="The corrected slot"
            note="A booked slot cannot be altered in place — the club's record of a hire is only ever added to or taken off. Add the corrected one here, then take the old one off below."
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")} className="touch">
            Cancel
          </Button>
        </section>
      ) : null}

      <section className="space-y-2 border-t pt-4">
        {mode === "remove" ? (
          <RemoveSlot venueId={venueId} slot={slot} onGone={() => setMode("view")} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
              className="touch"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Change it
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode("remove")}
              className="touch text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Take it off
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet itself
// ---------------------------------------------------------------------------

export function VenueSlotSheet({
  venueId,
  venueName,
  state,
  bookings,
  seasons,
  pitches,
  uncharged,
  currentSeasonId,
  onClose,
}: {
  venueId: string;
  venueName: string;
  state: VenueSheetState | null;
  bookings: VenueBookingRow[];
  seasons: SeasonOption[];
  /** The ground's pitches (active), for "which pitch" on a slot. */
  pitches: PitchChoice[];
  /** Dates off the venue does not charge for — off every total shown here. */
  uncharged: DateRange[];
  currentSeasonId: string | null;
  onClose: () => void;
}) {
  if (!state) return null;

  if (state.kind === "slot") {
    const booking = bookings.find((b) => b.slots.some((s) => s.id === state.slotId));
    const slot = booking?.slots.find((s) => s.id === state.slotId);
    // Removed under the panel, by this user or another: nothing to show.
    if (!booking || !slot) return null;
    return (
      <Sheet
        open
        onClose={onClose}
        title={`${weekdayLabel(slot.weekday)} · ${timeRange(slot.startTime, slot.endTime)}`}
        subtitle={`${venueName}${slot.pitchName ? ` · ${slot.pitchName}` : ""} · ${booking.seasonName ?? "No season"}`}
        side="drawer"
        width={460}
      >
        <SlotDetail venueId={venueId} slot={slot} booking={booking} pitches={pitches} uncharged={uncharged} />
      </Sheet>
    );
  }

  if (state.kind === "add") {
    const booking = bookings.find((b) => b.id === state.bookingId);
    if (!booking) return null;
    return (
      <Sheet
        open
        onClose={onClose}
        title={`New slot on ${weekdayLabel(state.weekday)}s`}
        subtitle={`${venueName} · ${booking.seasonName ?? "No season"} · ${bookingSpanLabel(booking.startsOn, booking.endsOn)}`}
        side="drawer"
        width={460}
      >
        <AddSlotForm
          venueId={venueId}
          bookingId={booking.id}
          pitches={pitches}
          pitchId={state.pitchId}
          weekday={state.weekday}
          title="What is booked here"
          note="The day and the pitch are filled in from the cell you pressed."
        />
      </Sheet>
    );
  }

  const booking = state.bookingId ? bookings.find((b) => b.id === state.bookingId) : undefined;
  if (state.bookingId && !booking) return null;
  const season = seasons.find((s) => s.id === currentSeasonId);
  return (
    <Sheet
      open
      onClose={onClose}
      title={booking ? bookingSpanLabel(booking.startsOn, booking.endsOn) : "A booking at this ground"}
      subtitle={
        booking
          ? `${venueName} · ${booking.seasonName ?? "No season"}`
          : `${venueName} · the dates, the weekly slots and what a session costs`
      }
      side="drawer"
      width={480}
    >
      {booking ? (
        <BookingDetail venueId={venueId} booking={booking} pitches={pitches} uncharged={uncharged} />
      ) : (
        <NewBookingForm venueId={venueId} seasons={seasons} pitches={pitches} seasonId={season?.id ?? null} />
      )}
    </Sheet>
  );
}
