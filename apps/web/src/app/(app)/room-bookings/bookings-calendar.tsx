"use client";

/**
 * The desk's month, and what a press on it does (P8.2).
 *
 * The calendar used to be a picture with links in it: every chip navigated to
 * `/room-bookings/[id]`, so answering an enquiry meant leaving the month,
 * doing the thing, and finding your place again. Now a chip opens the booking
 * where it sits — `BookingSheet`, on the door that booking actually needs —
 * and an empty day is a press too: a new booking with that date already in it.
 *
 * Two things this file used to do wrong, both of them about width:
 *
 *   · the month sat in a `min-w-[640px]` box below `lg`, so a phone scrolled
 *     the whole grid sideways to read seven columns 55px wide. A phone gets a
 *     WEEK now — day chips, and the chosen day's bookings full width.
 *   · the chips were painted in raw palette classes. They are the one thing on
 *     this screen that is data rather than tone — a key has to stay legible on
 *     a printer — so the colours moved to `desk-shared.ts` as CSS strings and
 *     everything else on the screen is a token.
 *
 * The print path is unchanged in what it produces: the overlay draws whole
 * months, the legend is the same seven swatches, and "This month" is one month
 * through the same overlay (it used to call `window.print()` against a page the
 * print stylesheet hides, which printed nothing at all).
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Printer, CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { londonToday } from "@/lib/booking-time";
import type { BookingListItem, BookingStatus } from "@/lib/booking-types";

import {
  BOOKING_SWATCH,
  CALENDAR_LEGEND,
  bookingSwatch,
  dayChipLabel,
  dayHeading,
  openingWeek,
  shiftWeek,
  weekDays,
  type BookingSwatch,
} from "./desk-shared";

type AwayEntry = {
  id: string;
  staffId: string;
  staffName: string;
  fromDate: string;
  toDate: string;
  note?: string | null;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number) { return String(n).padStart(2, "0"); }

/**
 * `YYYY-MM` split into definite numbers; falls back to the current month.
 *
 * Exported for its test: from P1.6 until 2026-09-11 the pattern here had lost
 * its backslashes (`d{4}`, matching the letter d), so every month string
 * failed to parse, every render fell back to the current month, and the
 * prev/next buttons appeared to do nothing.
 */
export function parseYm(ym: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const [, year = "", month = ""] = match;
  return { year: Number(year), month: Number(month) };
}

function getCalendarGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startPad = (firstDay.getDay() + 6) % 7;
  const grid: (number | null)[] = Array(startPad).fill(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  return grid;
}

/** The bracketed word after the booker's name on a chip, for anything not holding the room. */
export function statusTag(status: BookingStatus): string {
  if (status === "pending") return " (PENDING)";
  if (status === "enquiry") return " (ENQUIRY)";
  if (status === "quoted") return " (QUOTED)";
  return "";
}

export function buildMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const { year: fy, month: fm } = parseYm(from);
  const { year: ty, month: tm } = parseYm(to);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (months.length > 24) break;
  }
  return months;
}

function awayOnDate(entries: AwayEntry[], ds: string): AwayEntry[] {
  return entries.filter((e) => e.fromDate <= ds && e.toDate >= ds);
}

/** What one booking's chip says, wherever it is drawn. */
function chipLabel(b: BookingListItem, roomName: Record<string, string>): string {
  if (b.kind === "block") return "Blocked";
  const room = roomName[b.resource_id] ?? "";
  return `${b.start_time} ${b.booker_name}${statusTag(b.status)}${room ? ` (${room})` : ""}`;
}

/** A swatch as the inline style a chip wears — the colours are data, not tone. */
function swatchStyle(swatch: BookingSwatch): React.CSSProperties {
  return {
    background: swatch.bg,
    color: swatch.ink,
    borderColor: swatch.edge,
    borderStyle: swatch.dashed ? "dashed" : "solid",
  };
}

/** Where "New booking" on an empty day goes — the date already filled in. */
function newBookingHref(dateIso: string): string {
  return `/room-bookings/new?date=${dateIso}`;
}

function MonthGrid({
  ym,
  byDate,
  today,
  forPrint = false,
  roomName,
  awayEntries = [],
  onOpen,
}: {
  ym: string;
  byDate: Map<string, BookingListItem[]>;
  today: string;
  forPrint?: boolean;
  roomName: Record<string, string>;
  awayEntries?: AwayEntry[];
  /** A press on a chip opens that booking in the desk's sheet. */
  onOpen?: (booking: BookingListItem) => void;
}) {
  const { year, month } = parseYm(ym);
  const label = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const grid = getCalendarGrid(year, month);

  const cellClass = forPrint
    ? "border-b border-r p-1 min-h-[80px]"
    : "group/cell relative min-h-[90px] border-b border-r p-1.5";

  return (
    <div>
      <h2 className={`font-semibold mb-2 ${forPrint ? "text-sm" : "text-base hidden"}`}>
        {label} — Room Bookings
      </h2>
      {/* Seven columns that may shrink to nothing rather than push the page
          wider: `minmax(0, 1fr)` is what stops a long booker name forcing a
          horizontal scrollbar across the whole desk. */}
      <div
        className="grid border border-b-0 overflow-hidden rounded-t-lg"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {DAY_LABELS.map((d) => (
          <div key={d} className="bg-secondary px-2 py-1.5 text-center text-2xs font-medium uppercase text-muted-foreground border-b">
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid border-l border-t rounded-b-lg overflow-hidden"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {grid.map((day, i) => {
          const ds = day ? `${year}-${pad(month)}-${pad(day)}` : null;
          const dayBookings = ds ? (byDate.get(ds) ?? []) : [];
          const isToday = ds === today;
          const isPast = ds ? ds < today : false;
          const dayAway = ds ? awayOnDate(awayEntries, ds) : [];

          return (
            <div
              key={i}
              className={`${cellClass} ${!day ? "bg-muted/40" : isPast && !forPrint ? "bg-muted/20" : ""}`}
            >
              {day && (
                <>
                  <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-2xs font-medium
                    ${isToday && !forPrint ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                    {day}
                  </div>
                  {dayAway.length > 0 && (
                    <div className="mb-0.5 space-y-0.5">
                      {dayAway.map((a) => (
                        <span
                          key={a.id}
                          title={a.note ? `${a.staffName}: ${a.note}` : a.staffName}
                          style={swatchStyle(BOOKING_SWATCH.away)}
                          className="block rounded border px-1 py-0.5 text-2xs leading-tight font-medium truncate"
                        >
                          {a.staffName} away
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {dayBookings.map((b, bi) => {
                      const hidden = bi >= 3 && !forPrint ? " hidden" : "";
                      const chipClass = `cal-chip block w-full rounded border px-1 py-0.5 text-2xs leading-tight font-medium truncate${hidden}`;
                      const style = swatchStyle(bookingSwatch(b.status, b.kind));
                      return forPrint || !onOpen ? (
                        <div key={b.id}>
                          <span className={chipClass} style={style}>
                            {chipLabel(b, roomName)}
                          </span>
                        </div>
                      ) : (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => onOpen(b)}
                          style={style}
                          className={`${chipClass} text-left transition-opacity hover:opacity-80`}
                        >
                          {chipLabel(b, roomName)}
                        </button>
                      );
                    })}
                    {dayBookings.length > 3 && !forPrint && (
                      <p className="cal-no-print px-1 text-2xs text-muted-foreground">+{dayBookings.length - 3} more</p>
                    )}
                    {/* An empty day is a door too: the new-booking form with
                        this date already in it. Quiet until the mouse is on
                        the cell, so a month of them is not a month of plus
                        signs. */}
                    {ds && dayBookings.length === 0 && !forPrint && (
                      <Link
                        href={newBookingHref(ds)}
                        title={`New booking on ${ds}`}
                        className="cal-no-print flex items-center gap-1 rounded border border-dashed px-1 py-0.5 text-2xs text-muted-foreground opacity-0 transition-opacity hover:bg-secondary focus-visible:opacity-100 group-hover/cell:opacity-100"
                      >
                        <Plus className="h-3 w-3" aria-hidden /> New
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What a phone gets: one week, one day at a time.
 *
 * Seven columns cannot usefully compress to 390px — the old month kept its
 * width and scrolled sideways, which is the regression this replaces. The
 * chips are the week's days with their counts; the body is the chosen day's
 * bookings at full width, with the same press as a month cell.
 */
function WeekView({
  weekStart,
  day,
  byDate,
  today,
  roomName,
  awayEntries,
  onDay,
  onWeek,
  onOpen,
}: {
  weekStart: string;
  day: string;
  byDate: Map<string, BookingListItem[]>;
  today: string;
  roomName: Record<string, string>;
  awayEntries: AwayEntry[];
  onDay: (dateIso: string) => void;
  onWeek: (weeks: number) => void;
  onOpen?: (booking: BookingListItem) => void;
}) {
  const days = weekDays(weekStart);
  const dayBookings = byDate.get(day) ?? [];
  const dayAway = awayOnDate(awayEntries, day);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="touch" onClick={() => onWeek(-1)} aria-label="The week before">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <p className="min-w-0 flex-1 text-center text-row font-semibold">{dayHeading(day)}</p>
        <Button variant="outline" size="touch" onClick={() => onWeek(1)} aria-label="The week after">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <ChipStrip>
        {days.map((iso) => (
          <ToggleChip
            key={iso}
            on={iso === day}
            count={(byDate.get(iso) ?? []).length}
            onClick={() => onDay(iso)}
            // Today keeps a ring even when the desk has walked off it, which is
            // the only thing a week of chips cannot say on its own.
            className={iso === today && iso !== day ? "ring-1 ring-primary/40" : undefined}
          >
            {dayChipLabel(iso)}
          </ToggleChip>
        ))}
      </ChipStrip>

      <div className="rounded-xl border bg-card">
        {dayAway.length > 0 && (
          <div className="space-y-1 border-b p-3">
            {dayAway.map((a) => (
              <p
                key={a.id}
                style={swatchStyle(BOOKING_SWATCH.away)}
                className="rounded border px-2 py-1 text-list font-medium"
              >
                {a.staffName} away{a.note ? ` · ${a.note}` : ""}
              </p>
            ))}
          </div>
        )}
        {dayBookings.length === 0 ? (
          <div className="space-y-3 p-4 text-center">
            <p className="text-sm text-muted-foreground">Nothing booked on this day.</p>
            <Link
              href={newBookingHref(day)}
              className="touch inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 text-sm font-medium"
            >
              <Plus className="h-4 w-4" aria-hidden /> New booking on this day
            </Link>
          </div>
        ) : (
          <ul className="divide-y">
            {dayBookings.map((b) => {
              const swatch = bookingSwatch(b.status, b.kind);
              const body = (
                <>
                  <span
                    aria-hidden
                    className="mt-1 h-3 w-3 flex-none rounded-sm border"
                    style={swatchStyle(swatch)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {b.kind === "block" ? "Blocked by the club" : b.booker_name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {b.start_time}–{b.end_time} · {roomName[b.resource_id] ?? "—"} ·{" "}
                      <span className="capitalize">{b.kind === "block" ? "blocked" : b.status}</span>
                    </span>
                  </span>
                </>
              );
              return (
                <li key={b.id}>
                  {onOpen ? (
                    <button
                      type="button"
                      onClick={() => onOpen(b)}
                      className="touch flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                    >
                      {body}
                    </button>
                  ) : (
                    <Link
                      href={`/room-bookings/${b.id}`}
                      className="touch flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function BookingsCalendar({
  bookings,
  roomName,
  initialMonth,
  awayEntries = [],
  onOpen,
}: {
  bookings: BookingListItem[];
  roomName: Record<string, string>;
  initialMonth?: string;
  awayEntries?: AwayEntry[];
  /** A press on a booking. Without one every chip is a link to the record. */
  onOpen?: (booking: BookingListItem) => void;
}) {
  const today = londonToday();
  const [ym, setYm] = useState<string>(() => {
    if (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)) return initialMonth;
    return today.slice(0, 7);
  });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState(ym);
  const [exportTo, setExportTo] = useState(ym);
  const [printMonths, setPrintMonths] = useState<string[] | null>(null);
  const [roomFilter, setRoomFilter] = useState<string>("all");
  // The phone's week and the day it is open on. Set beside the month rather
  // than in an effect, so the two never disagree for a render.
  const [weekStart, setWeekStart] = useState<string>(() => openingWeek(ym, today));
  const [day, setDay] = useState<string>(() => {
    const start = openingWeek(ym, today);
    return weekDays(start).includes(today) ? today : start;
  });

  const { year, month } = parseYm(ym);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const roomIds = useMemo(() => Object.keys(roomName), [roomName]);

  /** Move both the month and the week the phone is showing inside it. */
  function goToMonth(next: string) {
    setYm(next);
    const start = openingWeek(next, today);
    setWeekStart(start);
    setDay(weekDays(start).includes(today) ? today : start);
  }

  function prevMonth() {
    const d = new Date(year, month - 2, 1);
    goToMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  function nextMonth() {
    const d = new Date(year, month, 1);
    goToMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  function stepWeek(weeks: number) {
    const start = shiftWeek(weekStart, weeks);
    setWeekStart(start);
    setDay(start);
    // A week that has walked out of the month on screen takes the month with
    // it, so the desktop grid and the phone's chips stay the same fortnight.
    const startMonth = start.slice(0, 7);
    if (startMonth !== ym) setYm(startMonth);
  }

  const filteredBookings = roomFilter === "all" ? bookings : bookings.filter((b) => b.resource_id === roomFilter);

  const byDate = new Map<string, BookingListItem[]>();
  for (const b of filteredBookings) {
    const existing = byDate.get(b.date);
    if (existing) existing.push(b);
    else byDate.set(b.date, [b]);
  }

  useEffect(() => {
    if (!printMonths) return;
    const t = setTimeout(() => {
      window.print();
      setPrintMonths(null);
      setRangeOpen(false);
    }, 200);
    return () => clearTimeout(t);
  }, [printMonths]);

  function handleMultiExport() {
    const months = buildMonthRange(exportFrom, exportTo);
    if (months.length === 0) return;
    setPrintMonths(months);
  }

  const showRoomFilter = roomIds.length > 1;

  return (
    <div className="space-y-3" id="bookings-calendar-print">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 1cm; }
          body * { visibility: hidden; }
          #multi-month-print, #multi-month-print * { visibility: visible; }
          #multi-month-print { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; background: white; padding: 1cm; }
          #bookings-calendar-print { visibility: hidden !important; }
          .cal-no-print { display: none !important; }
          .cal-chip { white-space: normal !important; overflow: visible !important; }
          .print-page-break { page-break-after: always; break-after: page; margin-bottom: 0; }
        }
      `}</style>

      {/* Multi-month print overlay */}
      {printMonths && (
        <div
          id="multi-month-print"
          style={{ position: "fixed", inset: 0, background: "white", zIndex: 9999, overflow: "auto", padding: "1cm" }}
        >
          {printMonths.map((m, idx) => (
            <div key={m} className={idx < printMonths.length - 1 ? "print-page-break" : ""} style={{ marginBottom: idx < printMonths.length - 1 ? "2rem" : 0 }}>
              <MonthGrid ym={m} byDate={byDate} today={today} forPrint roomName={roomName} awayEntries={awayEntries} />
            </div>
          ))}
          {/* Print legend — the same swatches the screen uses. */}
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "9px", color: "#666", flexWrap: "wrap" }}>
            {CALENDAR_LEGEND.map(({ label, swatch }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: swatch.bg, border: `1px solid ${swatch.edge}`, borderRadius: 2 }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar header. On a phone the month stepper keeps its own row and
          the tools scroll sideways beneath it rather than wrapping. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full items-center justify-between gap-2 cal-no-print lg:w-auto lg:justify-start">
          <Button variant="outline" size="touch" onClick={prevMonth} aria-label="The month before"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <h2 className="min-w-0 flex-1 text-center text-base font-semibold lg:w-40 lg:flex-none">{monthLabel}</h2>
          <Button variant="outline" size="touch" onClick={nextMonth} aria-label="The month after"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>
        <div className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 pb-1 cal-no-print lg:mx-0 lg:w-auto lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
          {showRoomFilter && (
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              aria-label="Which room"
              className="touch shrink-0 rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All rooms</option>
              {roomIds.map((id) => (
                <option key={id} value={id}>{roomName[id]}</option>
              ))}
            </select>
          )}
          <Button variant="outline" size="touch" onClick={() => goToMonth(today.slice(0, 7))} className="shrink-0">Today</Button>
          <Button variant="outline" size="touch" onClick={() => setPrintMonths([ym])} className="shrink-0">
            <Printer className="h-4 w-4" aria-hidden /> This month
          </Button>
          <Button variant="outline" size="touch" onClick={() => { setExportFrom(ym); setExportTo(ym); setRangeOpen((v) => !v); }} className="shrink-0">
            <CalendarRange className="h-4 w-4" aria-hidden /> Multi-month
          </Button>
        </div>
      </div>

      {/* Multi-month range picker */}
      {rangeOpen && (
        <div className="cal-no-print flex flex-col items-stretch gap-3 rounded-lg border bg-muted/30 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4">
          <div className="space-y-1">
            <label htmlFor="cal-export-from" className="text-xs font-medium text-muted-foreground">From</label>
            <input
              id="cal-export-from"
              type="month"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm lg:w-auto"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="cal-export-to" className="text-xs font-medium text-muted-foreground">To</label>
            <input
              id="cal-export-to"
              type="month"
              value={exportTo}
              min={exportFrom}
              onChange={(e) => setExportTo(e.target.value)}
              className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm lg:w-auto"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="touch" onClick={handleMultiExport} disabled={!!printMonths} className="flex-1 lg:flex-none">
              <Printer className="h-4 w-4" aria-hidden />
              {printMonths ? "Preparing…" : `Export ${buildMonthRange(exportFrom, exportTo).length} month${buildMonthRange(exportFrom, exportTo).length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="ghost" size="touch" onClick={() => setRangeOpen(false)} aria-label="Close the export picker">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {buildMonthRange(exportFrom, exportTo).length >= 24 && (
            <p className="text-xs text-warning w-full">Maximum 24 months per export.</p>
          )}
        </div>
      )}

      {/* The month, at a desk. */}
      <div className="hidden lg:block">
        <MonthGrid ym={ym} byDate={byDate} today={today} roomName={roomName} awayEntries={awayEntries} onOpen={onOpen} />
      </div>

      {/* The week, on a phone — the same bookings, nothing sideways. */}
      <div className="lg:hidden">
        <WeekView
          weekStart={weekStart}
          day={day}
          byDate={byDate}
          today={today}
          roomName={roomName}
          awayEntries={awayEntries}
          onDay={setDay}
          onWeek={stepWeek}
          onOpen={onOpen}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1 cal-no-print">
        {CALENDAR_LEGEND.map(({ label, swatch }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-3 w-3 rounded border" style={swatchStyle(swatch)} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
