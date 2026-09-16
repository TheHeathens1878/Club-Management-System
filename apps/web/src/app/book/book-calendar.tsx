"use client";

/**
 * The public availability calendar, and the shell that holds the whole
 * booking flow together (P8.9).
 *
 * The calendar is the grid this screen is about, so it stays on screen and
 * never moves: choosing a date opens the form as a SHEET over it rather than
 * scrolling a 430-line card into view beneath it, which is what the old page
 * did and which on a phone pushed the date you had just chosen off the top.
 *
 * Above the grid is the running answer — "Sat 18 Oct · 19:00–23:00 ·
 * estimated £260" — and the one button that sends it, pinned so it is in
 * reach whatever you have scrolled to. Which button it is follows the
 * enquiry/booking choice made in the sheet, because those are two different
 * things to send and the club's wording for each is a commitment: an enquiry
 * holds NOTHING.
 *
 * The typed draft lives up here rather than in the sheet, so closing the
 * sheet to look at another date does not throw the form away.
 */

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { formatCurrency } from "@/lib/utils";

import {
  BookSheet,
  EMPTY_DRAFT,
  bookModes,
  draftEstimate,
  missingFrom,
  type BookMode,
  type BookRoom,
  type BookingDraft,
} from "./book-sheet";

export type BookedSlot = {
  resource_id: string;
  date: string;
  start_time: string;
  end_time: string;
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Free, partly taken, or gone — a whole working day counts as gone. */
function getDayStatus(slots: BookedSlot[], roomId: string, dateStr: string): "free" | "partial" | "full" {
  const daySlots = slots.filter((s) => s.resource_id === roomId && s.date === dateStr);
  if (daySlots.length === 0) return "free";
  const totalBooked = daySlots.reduce((acc, s) => acc + (toMin(s.end_time) - toMin(s.start_time)), 0);
  return totalBooked >= 8 * 60 ? "full" : "partial";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "Saturday, 18 October 2026" — the sheet's title. */
function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "Sat 18 Oct" — the status bar's half of the running answer. */
function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const DAY_TONE = {
  free: "bg-success-tint hover:bg-success-tint/70",
  partial: "bg-warning-tint hover:bg-warning-tint/70",
  full: "bg-destructive/10 cursor-not-allowed",
} as const;

export function BookFlow({
  rooms,
  bookedSlots,
  teamNames = [],
  memberDiscountPence = 0,
}: {
  rooms: BookRoom[];
  bookedSlots: BookedSlot[];
  teamNames?: string[];
  memberDiscountPence?: number;
}) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const [mode, setMode] = useState<BookMode | null>(null);

  const set = (patch: Partial<BookingDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayStr = dateStr(today);

  const gridDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = (firstDay.getDay() + 6) % 7;
    const days: Date[] = [];
    for (let i = startPad - 1; i >= 0; i--) days.push(new Date(year, month, -i));
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    while (days.length < 42) days.push(new Date(year, month + 1, days.length - lastDay.getDate() - startPad + 1));
    return days;
  }, [year, month]);

  const room = rooms.find((r) => r.id === selectedRoomId);
  const money = draftEstimate(room, draft);
  const gaps = missingFrom(draft);
  const enquiry = draft.intent === "enquiry";

  /** The one button: straight to Review when nothing is missing, else to the gap. */
  function openSheet() {
    if (!selectedDate) return;
    setMode(gaps.length === 0 ? "review" : gaps[0]!.mode);
  }

  function pickDay(iso: string) {
    setSelectedDate(iso);
    setMode(bookModes(room)[0]!);
  }

  return (
    <div className="space-y-4">
      {rooms.length > 1 ? (
        <ChipStrip>
          {rooms.map((r) => (
            <ToggleChip
              key={r.id}
              on={selectedRoomId === r.id}
              onClick={() => {
                setSelectedRoomId(r.id);
                set({ extras: {} });
              }}
            >
              {r.name}
            </ToggleChip>
          ))}
        </ChipStrip>
      ) : null}

      {/* The running answer, pinned under the header. `top-14` is the header's
          own height — the two bands are the only fixed chrome on this page. */}
      <ActionBar
        className="sticky top-14 z-30"
        icon={<CalendarDays className="h-4 w-4" aria-hidden />}
        tone={selectedDate ? "waiting" : "idle"}
        status={
          selectedDate
            ? `${shortDate(selectedDate)} · ${draft.startTime}–${draft.endTime}${
                money.totalPence > 0 ? ` · estimated ${formatCurrency(money.totalPence)}` : ""
              }`
            : "Pick a date to start"
        }
        detail={
          selectedDate
            ? `${room?.name ?? "Function room"} · an estimate, confirmed with your booking. Nothing is held until the club confirms it.`
            : "Green days are free, amber days are partly taken. Tap one to fill in your details."
        }
        action={
          <Button type="button" size="touch" disabled={!selectedDate} onClick={openSheet}>
            {enquiry ? "Send an enquiry" : "Request this date"}
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-2">
          <Button type="button" variant="ghost" size="icon" className="touch" onClick={() => setViewDate(new Date(year, month - 1, 1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="text-row font-semibold">
            {MONTHS[month]} {year}
          </span>
          <Button type="button" variant="ghost" size="icon" className="touch" onClick={() => setViewDate(new Date(year, month + 1, 1))} aria-label="Next month">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="grid grid-cols-7 bg-muted/20">
          {DAYS.map((d) => (
            <div key={d} className="py-2 text-center text-2xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y border-t">
          {gridDays.map((day, i) => {
            const isCurrentMonth = day.getMonth() === month;
            const ds = dateStr(day);
            const isPast = ds < todayStr;
            const status = getDayStatus(bookedSlots, selectedRoomId, ds);
            const open = !isPast && isCurrentMonth && status !== "full";
            const daySlots = bookedSlots
              .filter((s) => s.resource_id === selectedRoomId && s.date === ds)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));

            return (
              <button
                key={i}
                type="button"
                data-day={ds}
                disabled={!open}
                onClick={() => pickDay(ds)}
                aria-label={`${longDate(ds)} — ${status === "free" ? "available" : status === "partial" ? "partly booked" : "fully booked"}`}
                className={
                  "flex h-16 flex-col items-stretch p-1 text-left transition-colors lg:h-20 " +
                  (isCurrentMonth ? "" : "opacity-30 ") +
                  (!isPast && isCurrentMonth ? DAY_TONE[status] + " " : "") +
                  (ds === selectedDate ? "ring-2 ring-inset ring-primary" : "")
                }
              >
                <span
                  className={
                    "flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-medium " +
                    (ds === todayStr
                      ? "bg-primary text-primary-foreground"
                      : isCurrentMonth
                        ? "text-foreground"
                        : "text-muted-foreground")
                  }
                >
                  {day.getDate()}
                </span>
                {isCurrentMonth && !isPast && daySlots.length > 0 ? (
                  <span className="mt-0.5 block min-w-0 space-y-0.5">
                    {daySlots.map((s, j) => (
                      <span key={j} className="block rounded bg-destructive/10 py-0.5 leading-tight text-destructive">
                        <span className="hidden truncate px-0.5 text-2xs font-medium lg:block">
                          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                        </span>
                        <span className="flex justify-center lg:hidden">
                          <span className="my-0.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
                        </span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/10 px-4 py-2 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-success/25 bg-success-tint" />
            Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-warning/25 bg-warning-tint" />
            Partially booked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-destructive/20 bg-destructive/10" />
            Fully booked
          </span>
        </div>
      </div>

      {selectedDate && mode ? (
        <BookSheet
          room={room}
          date={selectedDate}
          dateLabel={longDate(selectedDate)}
          draft={draft}
          set={set}
          mode={mode}
          onMode={setMode}
          onClose={() => setMode(null)}
          teamNames={teamNames}
          memberDiscountPence={memberDiscountPence}
        />
      ) : null}
    </div>
  );
}
