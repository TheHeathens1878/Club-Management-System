"use client";

/**
 * The training week: a row for every team, a column for each of the next seven
 * days, and the one thing the coach is here to do above it.
 *
 * The columns do NOT drop out when a day is empty — an empty Thursday is the
 * answer to "when could we train?", and its `+` books a pitch for that team on
 * that date with both already filled in. A card is the session: the hour, the
 * pitch, how many are coming, and whether the register has been taken.
 * Clicking one opens the sheet, so taking a register is a press rather than
 * two navigations.
 *
 * Above lg it is the whole week. A phone cannot hold seven columns, so it
 * opens on today and the chips move between days — the same shape as the
 * winter-training timetable, which is the screen this one is copied from.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, ClipboardCheck, Plus } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  dayWord,
  londonWeekday,
  type SessionAction,
  type SessionCard,
  type TrainingWeekRow,
} from "@/lib/training-week";
import { weekdayLabel } from "@/lib/training-plan";

import { SessionSheet, type SessionSheetMode, type SheetState } from "./session-sheet";
import type { SessionMeta } from "./training-reads";

export function TrainingGrid({
  rows,
  days,
  today,
  next,
  meta,
  canMark,
}: {
  rows: TrainingWeekRow[];
  /** Seven ISO days, today first. */
  days: string[];
  today: string;
  /** What the bar says and what its button opens. */
  next: SessionAction;
  /** Per booking: who booked it, and its status. */
  meta: Record<string, SessionMeta>;
  /** `(staff || admin) && !isMemberView(view)` — the register gate, computed on the server. */
  canMark: boolean;
}) {
  /** null = the whole week (lg only). */
  const [day, setDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  // A phone gets one day, and the day it gets is today.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setDay(days[0] ?? null);
    // Only on mount — after that the chips are the coach's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => rows.flatMap((row) => row.cards), [rows]);
  const shownDays = day === null ? days : [day];
  const dayCount = (iso: string) => cards.filter((card) => card.dayIso === iso).length;

  const open = (bookingId: string, mode: SessionSheetMode) => setSheet({ bookingId, mode });
  const openCard = (card: SessionCard) =>
    open(card.bookingId, canMark ? "register" : "view");

  const sheetCard = sheet ? cards.find((card) => card.bookingId === sheet.bookingId) : undefined;
  // The session the bar is about, so the bar can say what it would do to it.
  const chosen = next.bookingId ? cards.find((card) => card.bookingId === next.bookingId) : undefined;

  return (
    <section className="space-y-3">
      <ActionBar
        icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
        tone={next.mode === "book" ? "idle" : chosen?.marked ? "done" : "waiting"}
        status={next.detail}
        detail={
          next.mode === "book"
            ? "Nothing is on the pitch this week — book one and the session follows."
            : chosen?.marked
              ? "The register is taken. Open it to change a mark."
              : "Nobody has been marked yet."
        }
        action={
          next.mode === "book" || !next.bookingId ? (
            <Link href="/pitches/book" className={buttonVariants({ size: "touch" })}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> {next.label}
            </Link>
          ) : (
            <Button type="button" size="touch" onClick={() => open(next.bookingId!, "register")}>
              <ClipboardCheck className="h-4 w-4" aria-hidden /> {next.label}
            </Button>
          )
        }
      />

      {/* The days. "Week" is a desk luxury: seven columns do not fit a phone. */}
      <ChipStrip>
        <ToggleChip on={day === null} onClick={() => setDay(null)} className="hidden lg:inline-flex">
          Week
        </ToggleChip>
        {days.map((iso) => (
          <ToggleChip key={iso} on={day === iso} count={dayCount(iso)} onClick={() => setDay(iso)}>
            {chipLabel(iso, today)}
          </ToggleChip>
        ))}
      </ChipStrip>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p>No teams to show yet.</p>
          <p className="mt-1">
            A team appears here as soon as it has a session in the next seven days, or as soon as
            you are its coach.
          </p>
          <Link href="/pitches/book" className={buttonVariants({ variant: "outline", size: "sm" }) + " mt-3 touch"}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Book a pitch
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <div
            className="grid min-w-max"
            // Seven columns and the team names have to fit a 1440 desk without
            // the grid scrolling under itself, which is what sets the 150.
            style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${shownDays.length}, minmax(150px, 1fr))` }}
          >
            <div className="sticky left-0 z-10 border-b bg-card" />
            {shownDays.map((iso) => (
              <div key={iso} className="border-b border-l px-3 py-2 text-list font-semibold">
                {chipLabel(iso, today)}
                <span className="ml-1.5 font-normal text-muted-foreground">{dayCount(iso) || ""}</span>
              </div>
            ))}

            {rows.map((row) => (
              <TeamRow
                key={row.teamId}
                row={row}
                days={shownDays}
                today={today}
                selected={sheet?.bookingId ?? null}
                onOpen={openCard}
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {canMark
          ? "Tap a session to take its register. An empty evening books a pitch for that team on that day."
          : "Tap a session for who is coming. An empty evening books a pitch for that team on that day."}
      </p>

      {sheet ? (
        <SessionSheet
          card={sheetCard}
          meta={sheetCard ? meta[sheetCard.bookingId] : undefined}
          mode={sheet.mode}
          canMark={canMark}
          today={today}
          onMode={(mode) => setSheet((current) => (current ? { ...current, mode } : current))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </section>
  );
}

/** "Today" · "Tomorrow" · "Thu 24" — short enough to be a chip and a column head. */
function chipLabel(dateIso: string, today: string): string {
  const word = dayWord(dateIso, "00:00", today);
  if (word === "Today" || word === "Tomorrow") return word;
  return `${weekdayLabel(londonWeekday(dateIso), true)} ${Number(dateIso.slice(8, 10))}`;
}

// ---------------------------------------------------------------------------
// One team's week
// ---------------------------------------------------------------------------

function TeamRow({
  row,
  days,
  today,
  selected,
  onOpen,
}: {
  row: TrainingWeekRow;
  days: string[];
  today: string;
  selected: string | null;
  onOpen: (card: SessionCard) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5">
        <p className="text-list font-semibold leading-tight">{row.teamName}</p>
        {row.ageGroup && !row.teamName.includes(row.ageGroup) ? (
          <p className="text-2xs text-muted-foreground">{row.ageGroup}</p>
        ) : null}
        {row.unmarked > 0 ? (
          <p className="text-2xs text-muted-foreground">
            {row.unmarked} register{row.unmarked === 1 ? "" : "s"} to take
          </p>
        ) : null}
      </div>
      {days.map((iso) => {
        const here = row.byDay[iso] ?? [];
        return (
          <div key={iso} className="flex flex-col gap-1.5 border-b border-l p-1.5">
            {here.map((card) => (
              <SessionCardTile
                key={card.bookingId}
                card={card}
                today={today}
                isSelected={selected === card.bookingId}
                onClick={() => onOpen(card)}
              />
            ))}
            {/* The empty evening is the point of the fixed columns: one press
                opens the booking form with this team and this date in it. */}
            <Link
              href={`/pitches/book?team=${encodeURIComponent(row.teamId)}&date=${iso}`}
              aria-label={`Book a pitch for ${row.teamName} on ${dayWord(iso, "00:00", today)}`}
              title="Book a pitch here"
              className={
                "touch inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity hover:border-primary/50 hover:text-primary lg:min-h-[28px] " +
                (here.length === 0 ? "opacity-70" : "opacity-40 hover:opacity-100 focus-visible:opacity-100")
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {here.length === 0 ? "Book a pitch" : null}
            </Link>
          </div>
        );
      })}
    </>
  );
}

function SessionCardTile({
  card,
  today,
  isSelected,
  onClick,
}: {
  card: SessionCard;
  today: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${dayWord(card.dayIso, card.time, today)} ${card.time}, ${card.teamName} at ${card.pitch} — ${card.attendance} coming, register ${card.marked ? "taken" : "not taken"}`}
      className={
        "w-full rounded-lg border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (isSelected
          ? "border-primary ring-2 ring-primary/30"
          : card.marked
            ? "border-success/30 bg-success-tint hover:border-success/60"
            : "border-border bg-card hover:border-primary/50")
      }
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">{card.time}</span>
        <Badge variant={card.accepted > 0 ? "success" : "muted"} className="px-1.5 text-2xs">
          {card.attendance}
        </Badge>
      </div>
      <p className="mt-0.5 truncate text-2xs text-muted-foreground">{card.pitch}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge variant={card.marked ? "success" : "muted"} className="px-1.5 text-2xs">
          {card.marked ? "marked" : "not taken"}
        </Badge>
        {card.awaitingPitch ? (
          <Badge variant="warning" className="px-1.5 text-2xs">
            pitch awaiting confirmation
          </Badge>
        ) : null}
      </div>
    </button>
  );
}
