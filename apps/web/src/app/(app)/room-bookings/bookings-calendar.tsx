"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Printer, CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { londonToday } from "@/lib/booking-time";
import type { BookingKind, BookingListItem, BookingStatus } from "@/lib/booking-types";

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

/** `YYYY-MM` split into definite numbers; falls back to the current month. */
function parseYm(ym: string): { year: number; month: number } {
  const match = /^(d{4})-(d{2})$/.exec(ym);
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

// Status-based colour: green=confirmed, yellow=pending, red=cancelled, amber=blocked
function bookingColor(status: BookingStatus, kind: BookingKind): string {
  if (kind === "block") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "cancelled") return "bg-red-100 text-red-800 border-red-200";
  if (status === "pending") return "bg-amber-50 text-yellow-800 border-yellow-300";
  return "bg-green-100 text-green-800 border-green-200"; // confirmed
}

function buildMonthRange(from: string, to: string): string[] {
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

function MonthGrid({
  ym,
  byDate,
  today,
  forPrint = false,
  roomName,
  awayEntries = [],
}: {
  ym: string;
  byDate: Map<string, BookingListItem[]>;
  today: string;
  forPrint?: boolean;
  roomName: Record<string, string>;
  awayEntries?: AwayEntry[];
}) {
  const { year, month } = parseYm(ym);
  const label = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const grid = getCalendarGrid(year, month);

  const cellClass = forPrint
    ? "border-b border-r p-1 min-h-[80px]"
    : "min-h-[90px] border-b border-r p-1.5";

  return (
    <div>
      <h2 className={`font-semibold mb-2 ${forPrint ? "text-sm" : "text-base hidden"}`}>
        {label} — Room Bookings
      </h2>
      <div className="grid grid-cols-7 border border-b-0 overflow-hidden rounded-t-lg">
        {DAY_LABELS.map((d) => (
          <div key={d} className="bg-gray-100 px-2 py-1.5 text-center text-[10px] font-medium uppercase text-gray-500 border-b">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-t rounded-b-lg overflow-hidden">
        {grid.map((day, i) => {
          const ds = day ? `${year}-${pad(month)}-${pad(day)}` : null;
          const dayBookings = ds ? (byDate.get(ds) ?? []) : [];
          const isToday = ds === today;
          const isPast = ds ? ds < today : false;
          const dayAway = ds ? awayOnDate(awayEntries, ds) : [];

          return (
            <div
              key={i}
              className={`${cellClass} ${!day ? "bg-gray-50" : isPast && !forPrint ? "bg-gray-50/50" : ""}`}
            >
              {day && (
                <>
                  <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium
                    ${isToday && !forPrint ? "bg-blue-600 text-white" : "text-gray-700"}`}>
                    {day}
                  </div>
                  {dayAway.length > 0 && (
                    <div className="mb-0.5 space-y-0.5">
                      {dayAway.map((a) => (
                        <span
                          key={a.id}
                          title={a.note ? `${a.staffName}: ${a.note}` : a.staffName}
                          className="block rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] leading-tight font-medium text-red-700 truncate"
                        >
                          {a.staffName} away
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {dayBookings.map((b, bi) => {
                      const rName = roomName[b.resource_id] ?? "";
                      const isPending = b.status === "pending";
                      const label =
                        b.kind === "block"
                          ? "Blocked"
                          : `${b.start_time} ${b.booker_name}${isPending ? " (PENDING)" : ""} (${rName})`;

                      const chip = (
                        <span className={`cal-chip block rounded border px-1 py-0.5 text-[9px] leading-tight font-medium truncate ${bookingColor(b.status, b.kind)} ${bi >= 3 && !forPrint ? "hidden" : ""}`}>
                          {label}
                        </span>
                      );
                      return forPrint ? (
                        <div key={b.id}>{chip}</div>
                      ) : (
                        <Link key={b.id} href={`/room-bookings/${b.id}`} className="block hover:opacity-80 transition-opacity">
                          {chip}
                        </Link>
                      );
                    })}
                    {dayBookings.length > 3 && !forPrint && (
                      <p className="cal-no-print px-1 text-[9px] text-gray-400">+{dayBookings.length - 3} more</p>
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

export function BookingsCalendar({
  bookings,
  roomName,
  initialMonth,
  awayEntries = [],
}: {
  bookings: BookingListItem[];
  roomName: Record<string, string>;
  initialMonth?: string;
  awayEntries?: AwayEntry[];
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

  const { year, month } = parseYm(ym);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const roomIds = useMemo(() => Object.keys(roomName), [roomName]);

  function prevMonth() {
    const d = new Date(year, month - 2, 1);
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  function nextMonth() {
    const d = new Date(year, month, 1);
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
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
          {/* Print legend */}
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "9px", color: "#666", flexWrap: "wrap" }}>
            {[
              { label: "Confirmed", color: "#dcfce7", border: "#86efac" },
              { label: "Pending", color: "#fefce8", border: "#fde047" },
              { label: "Cancelled", color: "#fee2e2", border: "#fca5a5" },
              { label: "Staff away", color: "#fef2f2", border: "#fca5a5" },
              { label: "Blocked", color: "#fef9c3", border: "#fde047" },
            ].map(({ label, color, border }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: color, border: `1px solid ${border}`, borderRadius: 2 }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 cal-no-print">
          <Button variant="outline" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="text-base font-semibold min-w-[160px] text-center">{monthLabel}</h2>
          <Button variant="outline" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2 cal-no-print flex-wrap">
          {showRoomFilter && (
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All rooms</option>
              {roomIds.map((id) => (
                <option key={id} value={id}>{roomName[id]}</option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={() => setYm(today.slice(0, 7))}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> This month
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setExportFrom(ym); setExportTo(ym); setRangeOpen((v) => !v); }}>
            <CalendarRange className="h-4 w-4" /> Multi-month
          </Button>
        </div>
      </div>

      {/* Multi-month range picker */}
      {rangeOpen && (
        <div className="cal-no-print flex flex-wrap items-end gap-4 rounded-lg border bg-muted/30 px-4 py-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <input
              type="month"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input
              type="month"
              value={exportTo}
              min={exportFrom}
              onChange={(e) => setExportTo(e.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleMultiExport} disabled={!!printMonths}>
              <Printer className="h-4 w-4" />
              {printMonths ? "Preparing…" : `Export ${buildMonthRange(exportFrom, exportTo).length} month${buildMonthRange(exportFrom, exportTo).length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRangeOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {buildMonthRange(exportFrom, exportTo).length >= 24 && (
            <p className="text-xs text-amber-600 w-full">Maximum 24 months per export.</p>
          )}
        </div>
      )}

      {/* Live calendar */}
      <MonthGrid ym={ym} byDate={byDate} today={today} roomName={roomName} awayEntries={awayEntries} />

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1 cal-no-print">
        {[
          { label: "Confirmed", color: "bg-green-100 border-green-200" },
          { label: "Pending", color: "bg-amber-50 border-yellow-300" },
          { label: "Cancelled", color: "bg-red-100 border-red-200" },
          { label: "Staff away", color: "bg-red-50 border-red-200" },
          { label: "Blocked", color: "bg-amber-100 border-amber-200" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-3 w-3 rounded border ${color}`} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
