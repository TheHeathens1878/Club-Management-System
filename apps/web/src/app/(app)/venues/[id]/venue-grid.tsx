"use client";

/**
 * What the club has booked at this ground, as a grid (P8.8) — the same shape
 * the winter-training block page uses, and for the same reason: a season of
 * hire is a weekly timetable, and a timetable is read, not scrolled.
 *
 *   · a STATUS BAR saying what the season comes to and offering the one
 *     thing to do about it — "2026/27 · 3 slots booked · £1,840 for the
 *     season" → Add a booking; nothing booked → Book this ground for
 *     2026/27, a door that used to be four hundred lines down the page;
 *   · the GRID: a row for every pitch on the ground, a column for every day
 *     something is booked on, each slot a card that says the hours, how much
 *     of the pitch is ours and what a session costs. An empty cell's "+"
 *     opens the new-slot panel with that pitch and that day filled in;
 *   · the seasons BEFORE this one, folded, each saying what it held and what
 *     it cost — pressing one opens its own grid;
 *   · and the SHEET over the lot, keyed on `?sheet=` so the refresh every
 *     server action causes puts it back where it was.
 *
 * On a phone the week will not fit, so the grid opens on the busiest day and
 * the chips move between days — again as the block page does.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarClock, Plus } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { FoldCard } from "@/components/ui/fold-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  busiestDay,
  shareWord,
  timeRange,
  weekdayLabel,
  type TimetableBooking,
  type TimetableRow,
} from "@/lib/training-plan";
import { formatCurrency } from "@/lib/utils";
import { slotCost, type DateRange } from "@/lib/venue-hire";
import {
  venueGridDays,
  venueGridRows,
  venueSeasonGroups,
  venueSeasonLine,
  venueSheetParam,
  type VenueAction,
  type VenueSeasonGroup,
  type VenueSheetState,
} from "@/lib/venue-season";

import { VenueSlotSheet } from "./venue-slot-sheet";
import type { PitchChoice, SeasonOption, VenueBookingRow, VenueGridSlot } from "./types";

/** The season's slots, flattened onto the ground so the grid can lay them out. */
function gridSlots(bookings: VenueBookingRow[], venueId: string, venueName: string): VenueGridSlot[] {
  return bookings.flatMap((booking) =>
    booking.slots.map((slot) => ({
      ...slot,
      venueId,
      venueName,
      bookingId: booking.id,
      bookingStartsOn: booking.startsOn,
      bookingEndsOn: booking.endsOn,
    })),
  );
}

export function VenueGrid({
  venueId,
  venueName,
  action,
  bookings,
  seasons,
  pitches,
  uncharged,
  currentSeasonId,
  initialSheet,
}: {
  venueId: string;
  venueName: string;
  /** `venueNextAction()`, worked out on the server. */
  action: VenueAction;
  /** Every booking at this ground, current season first. */
  bookings: VenueBookingRow[];
  seasons: SeasonOption[];
  /** The ground's pitches (active) — the grid's rows. */
  pitches: PitchChoice[];
  /** Dates off the venue does not charge for — off every total here. */
  uncharged: DateRange[];
  currentSeasonId: string | null;
  /** `?sheet=`, parsed on the server so the panel is up on the first paint. */
  initialSheet: VenueSheetState | null;
}) {
  const [sheet, setSheet] = useState<VenueSheetState | null>(initialSheet);
  /** null = the whole week. */
  const [weekday, setWeekday] = useState<number | null>(null);

  const groups = useMemo(() => venueSeasonGroups(bookings, currentSeasonId), [bookings, currentSeasonId]);
  const open = groups[0] ?? null;
  const later = groups.slice(1);
  const openSlots = useMemo(
    () => (open ? gridSlots(open.bookings, venueId, venueName) : []),
    [open, venueId, venueName],
  );

  // A phone cannot show the week: open on the busiest day there.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setWeekday(busiestDay(openSlots));
    // Only on mount — after that the chips are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The panel's state is local so a card opens the instant it is pressed,
   * and mirrored into `?sheet=` so a refresh — which is what every server
   * action on this page causes — puts it back. `history.replaceState` rather
   * than `router.replace`: the page is `force-dynamic`, so a replace would
   * fetch the whole thing again just to write a query string.
   */
  const show = useCallback((next: VenueSheetState | null) => {
    setSheet(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("sheet", venueSheetParam(next));
    else url.searchParams.delete("sheet");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  // The panel follows the data: a slot or a booking removed under it closes it.
  useEffect(() => {
    if (!sheet) return;
    const gone =
      sheet.kind === "slot"
        ? !bookings.some((b) => b.slots.some((s) => s.id === sheet.slotId))
        : sheet.kind === "add"
          ? !bookings.some((b) => b.id === sheet.bookingId)
          : sheet.bookingId !== null && !bookings.some((b) => b.id === sheet.bookingId);
    if (gone) show(null);
  }, [bookings, sheet, show]);

  /** Which booking a new slot in this season joins: the one already on that pitch, else the first. */
  const bookingFor = (group: VenueSeasonGroup<VenueBookingRow>, pitchId: string | null): string | null =>
    group.bookings.find((b) => b.slots.some((s) => (s.pitchId ?? "") === (pitchId ?? "")))?.id ??
    group.bookings[0]?.id ??
    null;

  const dayCount = (day: number) => openSlots.filter((slot) => slot.weekday === day).length;

  return (
    <section className="space-y-4">
      <ActionBar
        icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
        tone={action.mode === "book" ? "waiting" : "idle"}
        status={action.detail}
        detail={
          action.mode === "book"
            ? "The dates, the weekly slots, which pitch and how much of it is ours. A training block picks its slots from these."
            : `${venueName} · a training block picks its slots from these${later.length > 0 ? ` · ${later.length} earlier season${later.length === 1 ? "" : "s"} below` : ""}`
        }
        action={
          <Button type="button" size="touch" onClick={() => show({ kind: "booking", bookingId: null })}>
            <Plus className="h-4 w-4" aria-hidden /> {action.label}
          </Button>
        }
      />

      {/* The day chips. One line that scrolls on a phone rather than a ladder
          of wrapped rows, so the grid itself starts higher up the screen. */}
      <ChipStrip>
        <ToggleChip on={weekday === null} onClick={() => setWeekday(null)} className="hidden lg:inline-flex">
          Week
        </ToggleChip>
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <ToggleChip key={day} on={weekday === day} count={dayCount(day)} onClick={() => setWeekday(day)}>
            {weekdayLabel(day, true)}
          </ToggleChip>
        ))}
      </ChipStrip>

      {open ? (
        <SeasonGrid
          title={open.name}
          slots={openSlots}
          venueId={venueId}
          venueName={venueName}
          pitches={pitches}
          bookings={open.bookings}
          uncharged={uncharged}
          weekday={weekday}
          onOpenSlot={(slotId) => show({ kind: "slot", slotId })}
          onAdd={(pitchId, day) => {
            const bookingId = bookingFor(open, pitchId);
            show(bookingId ? { kind: "add", bookingId, pitchId, weekday: day } : { kind: "booking", bookingId: null });
          }}
        />
      ) : (
        <EmptyGrid
          venueId={venueId}
          venueName={venueName}
          pitches={pitches}
          weekday={weekday}
          onBook={() => show({ kind: "booking", bookingId: null })}
        />
      )}

      {later.length > 0 ? (
        <div className="space-y-2 pt-2">
          {later.map((group) => (
            <FoldCard
              key={group.key}
              icon={<CalendarClock className="h-4 w-4" aria-hidden />}
              title={group.name}
              summary={venueSeasonLine(group.bookings, uncharged)}
            >
              <SeasonGrid
                title={group.name}
                slots={gridSlots(group.bookings, venueId, venueName)}
                venueId={venueId}
                venueName={venueName}
                pitches={pitches}
                bookings={group.bookings}
                uncharged={uncharged}
                weekday={weekday}
                bare
                onOpenSlot={(slotId) => show({ kind: "slot", slotId })}
                onAdd={(pitchId, day) => {
                  const bookingId = bookingFor(group, pitchId);
                  show(
                    bookingId ? { kind: "add", bookingId, pitchId, weekday: day } : { kind: "booking", bookingId: null },
                  );
                }}
              />
            </FoldCard>
          ))}
        </div>
      ) : null}

      <VenueSlotSheet
        venueId={venueId}
        venueName={venueName}
        state={sheet}
        bookings={bookings}
        seasons={seasons}
        pitches={pitches}
        uncharged={uncharged}
        currentSeasonId={currentSeasonId}
        onClose={() => show(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// One season, as a grid of pitch × day
// ---------------------------------------------------------------------------

function SeasonGrid({
  title,
  slots,
  venueId,
  venueName,
  pitches,
  bookings,
  uncharged,
  weekday,
  bare = false,
  onOpenSlot,
  onAdd,
}: {
  title: string;
  slots: VenueGridSlot[];
  venueId: string;
  venueName: string;
  pitches: PitchChoice[];
  bookings: VenueBookingRow[];
  uncharged: DateRange[];
  weekday: number | null;
  /** Inside a fold, which supplies its own border. */
  bare?: boolean;
  onOpenSlot: (slotId: string) => void;
  onAdd: (pitchId: string | null, weekday: number) => void;
}) {
  const rows = useMemo(
    () => venueGridRows(slots, { id: venueId, name: venueName, pitches }),
    [slots, venueId, venueName, pitches],
  );
  const allDays = useMemo(() => venueGridDays(rows), [rows]);
  const days = weekday === null || !allDays.includes(weekday) ? allDays : [weekday];

  return (
    <div className="space-y-2">
      {bare ? null : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-row font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            {bookings.length === 1 ? "One booking" : `${bookings.length} bookings`} ·{" "}
            {venueSeasonLine(bookings, uncharged)}
          </p>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: `minmax(120px, 150px) repeat(${days.length}, minmax(180px, 1fr))` }}
        >
          <div className="sticky left-0 z-10 border-b bg-card" />
          {days.map((day) => (
            <div key={day} className="border-b border-l px-3 py-2 text-list font-semibold">
              {weekdayLabel(day)}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {slots.filter((slot) => slot.weekday === day).length || ""}
              </span>
            </div>
          ))}

          {rows.map((row) => (
            <PitchRow
              key={row.key}
              row={row}
              days={days}
              bookings={bookings}
              uncharged={uncharged}
              onOpenSlot={onOpenSlot}
              onAdd={onAdd}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PitchRow({
  row,
  days,
  bookings,
  uncharged,
  onOpenSlot,
  onAdd,
}: {
  row: TimetableRow<VenueGridSlot, TimetableBooking>;
  days: number[];
  bookings: VenueBookingRow[];
  uncharged: DateRange[];
  onOpenSlot: (slotId: string) => void;
  onAdd: (pitchId: string | null, weekday: number) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5">
        <p className="text-list font-semibold leading-tight">{row.pitchName ?? "The ground"}</p>
        <p className="text-2xs text-muted-foreground">
          {row.slots.length === 0 ? "Nothing booked" : row.slots.length === 1 ? "1 slot" : `${row.slots.length} slots`}
        </p>
      </div>
      {days.map((day) => {
        const here = row.slots.filter((slot) => slot.weekday === day);
        return (
          <div key={day} className="flex flex-col gap-1.5 border-b border-l p-1.5">
            {here.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                booking={bookings.find((b) => b.id === slot.bookingId)}
                uncharged={uncharged}
                onClick={() => onOpenSlot(slot.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => onAdd(row.pitchId, day)}
              aria-label={`Note a slot on ${row.pitchName ?? "the ground"} on ${weekdayLabel(day)}s`}
              title="Note a slot here"
              className={
                "touch inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity hover:border-primary/50 hover:text-primary lg:min-h-[28px] " +
                (here.length === 0 ? "opacity-70" : "opacity-40 hover:opacity-100 focus-visible:opacity-100")
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {here.length === 0 ? "Note a slot" : null}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** "18:00–19:00 · ⅔ pitch · £28" — one hired slot. */
function SlotCard({
  slot,
  booking,
  uncharged,
  onClick,
}: {
  slot: VenueGridSlot;
  booking: VenueBookingRow | undefined;
  uncharged: DateRange[];
  onClick: () => void;
}) {
  const cost = booking ? slotCost(booking, slot, uncharged) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${weekdayLabel(slot.weekday)} ${timeRange(slot.startTime, slot.endTime)}${
        slot.pitchName ? ` on ${slot.pitchName}` : ""
      } — ${shareWord(slot.parts, slot.shares)}, ${
        slot.pricePence === null ? "no price yet" : `${formatCurrency(slot.pricePence)} a session`
      }`}
      className="touch w-full rounded-lg border border-border bg-card p-2 text-left text-xs transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0"
    >
      <span className="block font-semibold">{timeRange(slot.startTime, slot.endTime)}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-muted-foreground">
        <span>{shareWord(slot.parts, slot.shares)}</span>
        <span aria-hidden>·</span>
        <span className={slot.pricePence === null ? "font-medium text-warning" : "font-medium text-foreground"}>
          {slot.pricePence === null ? "unpriced" : formatCurrency(slot.pricePence)}
        </span>
      </span>
      {cost && cost.uncharged > 0 ? (
        <span className="mt-0.5 block text-2xs text-muted-foreground">{cost.uncharged} not charged</span>
      ) : null}
    </button>
  );
}

/** Nothing booked here at all: the pitches, and a press on any cell books them. */
function EmptyGrid({
  venueId,
  venueName,
  pitches,
  weekday,
  onBook,
}: {
  venueId: string;
  venueName: string;
  pitches: PitchChoice[];
  weekday: number | null;
  onBook: () => void;
}) {
  const rows = useMemo(
    () => venueGridRows<VenueGridSlot>([], { id: venueId, name: venueName, pitches }),
    [venueId, venueName, pitches],
  );
  const allDays = venueGridDays(rows);
  const days = weekday === null || !allDays.includes(weekday) ? allDays : [weekday];
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Nothing booked here yet. When the venue confirms the season&rsquo;s dates and slots, note them
        — press a cell for the pitch and the day, or start with the button above.
      </p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: `minmax(120px, 150px) repeat(${days.length}, minmax(180px, 1fr))` }}
        >
          <div className="sticky left-0 z-10 border-b bg-card" />
          {days.map((day) => (
            <div key={day} className="border-b border-l px-3 py-2 text-list font-semibold">
              {weekdayLabel(day)}
            </div>
          ))}
          {rows.map((row) => (
            <PitchRow
              key={row.key}
              row={row}
              days={days}
              bookings={[]}
              uncharged={[]}
              onOpenSlot={() => {}}
              onAdd={onBook}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
