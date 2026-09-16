"use client";

/**
 * The timetable (Adam, 2026-09-14: "only see the venues where we have slots
 * … clicking on the slot card … taking you to that slot details … only
 * showing a maximum of 2 teams on each card … minimising clicks and
 * scrolling").
 *
 * One grid for the whole block: a row for each venue and pitch that has a
 * slot (or a booking the block has not used yet — never a venue with
 * neither), a column for each day with something in it. A cell holds that
 * row's slots on that day, stacked by time, each a card that shows EVERY
 * team in it with its share. The row heights fit the cards, so nothing is
 * clipped. Above lg it is the week; on a phone it opens on the busiest day
 * and the chips move between days.
 *
 * Getting a team in:
 *   · drag it from the rail onto a card (a desk), or between cards to move;
 *   · tap a team, then tap a card (a phone, or one hand) — the same thing;
 *   · or open the card and use its picker.
 * Where more than one part of OUR share is free, a strip asks how much the
 * team takes before anything is written. The database's guard has the last
 * word — a full slot refuses, and says so here.
 *
 * Getting a slot in: an empty cell's "+" opens the new-slot panel with the
 * venue, pitch and day filled; a booking the club has at a block venue and
 * has not planned yet sits in its cell as a dashed card — "Use it" writes
 * the slot in one press, hours and share included. Clicking a card opens
 * the slot panel: its teams, add, edit, clone, remove.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, GripVertical, Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ChipStrip } from "@/components/ui/chip-strip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  WEEKDAYS,
  busiestDay,
  oursLabel,
  partsFree,
  shareChip,
  shareLabel,
  slotCapacity,
  timeRange,
  timetableDays,
  timetableRows,
  weekdayLabel,
  type TimetableRow,
} from "@/lib/training-plan";

import { addSlotFromBooking, allocateTeamToSlot, moveAllocation } from "../actions";
import { SlotSheet, type SheetState } from "./slot-sheet";
import type { BookedSlot, SlotPrefill, SlotRow, TeamOption, VenueOption } from "./types";

type Drag = { teamId: string; teamName: string; allocationId?: string; fromSlotId?: string; shares?: number };

/** A drop (or tap) waiting on "how much?". */
type Asking = { slot: SlotRow; drag: Drag; free: number };

const DRAG_TYPE = "application/x-training-team";

/** "19:00" → "20:00", stopping at midnight. */
function hourAfter(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const next = Math.min((h ?? 0) + 1, 23);
  return `${String(next).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

export function Planner({
  blockId,
  slots,
  teams,
  venues,
  blockVenueIds,
}: {
  blockId: string;
  slots: SlotRow[];
  teams: TeamOption[];
  venues: VenueOption[];
  blockVenueIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  /** A team tapped in the rail, waiting for a card to be tapped. */
  const [armed, setArmed] = useState<Drag | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** null = the whole week. */
  const [weekday, setWeekday] = useState<number | null>(null);

  const rows = useMemo(() => timetableRows(slots, venues, blockVenueIds), [slots, venues, blockVenueIds]);
  const allDays = useMemo(() => timetableDays(rows), [rows]);
  const days = weekday === null ? allDays : [weekday];
  const shownRows =
    weekday === null
      ? rows
      : rows.filter((row) => row.slots.some((s) => s.weekday === weekday) || row.unplanned.some((b) => b.weekday === weekday));

  // A phone cannot show the week: open on the busiest day there.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setWeekday(busiestDay(slots));
    // Only on mount — after that the chips are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The panel follows the data: a slot removed under it closes it.
  useEffect(() => {
    if (sheet?.kind === "slot" && !slots.some((s) => s.id === sheet.id)) setSheet(null);
  }, [slots, sheet]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const openSlot = useCallback((id: string) => setSheet({ kind: "slot", id }), []);
  const openNew = (prefill: SlotPrefill) => setSheet({ kind: "new", prefill });

  const placedTeams = useMemo(() => {
    const ids = new Set<string>();
    for (const slot of slots) {
      if (weekday !== null && slot.weekday !== weekday) continue;
      for (const a of slot.allocations) ids.add(a.teamId);
    }
    return ids;
  }, [slots, weekday]);

  function run(work: () => Promise<{ error?: string; slotId?: string }>, then?: (result: { slotId?: string }) => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      else then?.(result);
      router.refresh();
    });
  }

  function place(slot: SlotRow, drag: Drag, shares: number) {
    setAsking(null);
    setArmed(null);
    if (drag.allocationId) {
      run(() => moveAllocation({ blockId, allocationId: drag.allocationId!, slotId: slot.id, shares }));
    } else {
      run(() => allocateTeamToSlot({ blockId, slotId: slot.id, teamId: drag.teamId, shares }));
    }
  }

  /** A team arriving at a slot, by drag or by tap. */
  function arrive(slot: SlotRow, drag: Drag) {
    if (drag.fromSlotId === slot.id) return;
    if (slot.allocations.some((a) => a.teamId === drag.teamId)) {
      setError(`${drag.teamName} is already in ${slot.venueName} ${timeRange(slot.startTime, slot.endTime)}.`);
      setArmed(null);
      return;
    }
    const free = partsFree(slotCapacity(slot), slot.allocations);
    if (free === 0) {
      setError(
        `${slot.venueName} ${timeRange(slot.startTime, slot.endTime)} is full — ${
          slotCapacity(slot) < slot.parts ? "the club's share of it is all allocated" : "every part is allocated"
        }.`,
      );
      setArmed(null);
      return;
    }
    if (free === 1) {
      place(slot, drag, 1);
      return;
    }
    setAsking({ slot, drag, free });
  }

  function onDrop(slot: SlotRow, event: React.DragEvent) {
    event.preventDefault();
    setOver(null);
    let drag: Drag;
    try {
      drag = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as Drag;
    } catch {
      return;
    }
    arrive(slot, drag);
  }

  function startDrag(event: React.DragEvent, drag: Drag) {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(drag));
    event.dataTransfer.effectAllowed = "move";
    setArmed(null);
  }

  function onCardClick(slot: SlotRow) {
    if (armed) arrive(slot, armed);
    else openSlot(slot.id);
  }

  function planBooking(row: { venueId: string | null }, booking: BookedSlot) {
    if (!row.venueId) return;
    run(
      () =>
        addSlotFromBooking({
          blockId,
          venueId: row.venueId!,
          pitchId: booking.pitchId,
          weekday: booking.weekday,
          startTime: booking.startTime,
          endTime: booking.endTime,
          parts: booking.parts,
          shares: booking.shares,
        }),
      (result) => {
        if (result.slotId) openSlot(result.slotId);
      },
    );
  }

  const sheetSlot = sheet?.kind === "slot" ? slots.find((s) => s.id === sheet.id) : undefined;
  const dayCount = (day: number) => slots.filter((slot) => slot.weekday === day).length;

  return (
    <section className="space-y-3">
      {/* The day chips and the one add button. The chips are one line that
          scrolls on a phone rather than a ladder of wrapped rows, so the
          timetable itself starts higher up the screen. */}
      <div className="flex items-center gap-2">
        {/* The strip bleeds left into the page's padding so the first chip
            starts at the text margin, but its right edge stops at the button:
            without that the chips scroll on underneath it. */}
        <ChipStrip className="mr-0 min-w-0 flex-1 pr-0">
          <ToggleChip on={weekday === null} onClick={() => setWeekday(null)} className="hidden lg:inline-flex">
            Week
          </ToggleChip>
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <ToggleChip
              key={day}
              on={weekday === day}
              count={dayCount(day)}
              onClick={() => {
                setWeekday(day);
                setAsking(null);
              }}
            >
              {weekdayLabel(day, true)}
            </ToggleChip>
          ))}
        </ChipStrip>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => openNew({ weekday: weekday ?? undefined, venueId: blockVenueIds[0] })}
          className="flex-none"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a slot
        </Button>
      </div>

      {/* Polite, not assertive: a refused drop is worth hearing about, but
          not worth interrupting whatever is being read. */}
      <div aria-live="polite" className="empty:hidden">
        {error ? <Callout tone="danger" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>{error}</Callout> : null}
      </div>

      {/* "How much?" — the drop, waiting on a share. */}
      {asking ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <span>
            <span className="font-medium">{asking.drag.teamName}</span> in {asking.slot.venueName}{" "}
            {timeRange(asking.slot.startTime, asking.slot.endTime)} — how much of the slot?
          </span>
          <span className="flex flex-wrap gap-1.5">
            {Array.from({ length: asking.free }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={n === (asking.drag.shares ?? 1) ? "default" : "outline"}
                className="touch"
                onClick={() => place(asking.slot, asking.drag, n)}
              >
                {shareLabel(n, asking.slot.parts).replace(" of the pitch", "")}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="touch" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </span>
        </div>
      ) : armed ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{armed.teamName}</span> — now tap the slot it goes in.
          </span>
          <Button type="button" size="sm" variant="ghost" className="ml-auto touch" onClick={() => setArmed(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <TeamRail teams={teams} weekday={weekday} placed={placedTeams} armed={armed} onArm={setArmed} onDragStart={startDrag} />

        <div className="min-w-0">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              <p>No slots yet.</p>
              <p className="mt-1">
                Add the first one — the venue, the day and the hour — and the timetable builds itself from there.
                {blockVenueIds.length === 0 ? " A venue picked on a slot joins the block on its own." : ""}
              </p>
              <Button type="button" size="sm" className="mt-3 touch" onClick={() => openNew({ venueId: blockVenueIds[0] })}>
                <Plus className="h-4 w-4" aria-hidden /> Add a slot
              </Button>
            </div>
          ) : shownRows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              <p>Nothing on {weekdayLabel(weekday ?? 1)}s yet.</p>
              <Button type="button" size="sm" variant="outline" className="mt-3 touch" onClick={() => openNew({ weekday: weekday ?? undefined, venueId: blockVenueIds[0] })}>
                <Plus className="h-4 w-4" aria-hidden /> Add a slot on {weekdayLabel(weekday ?? 1)}s
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <div
                className="grid min-w-max"
                style={{ gridTemplateColumns: `minmax(132px, 160px) repeat(${days.length}, minmax(200px, 1fr))` }}
              >
                {/* Header row */}
                <div className="sticky left-0 z-10 border-b bg-card" />
                {days.map((day) => (
                  <div key={day} className="border-b border-l px-3 py-2 text-list font-semibold">
                    {weekdayLabel(day)}
                    <span className="ml-1.5 font-normal text-muted-foreground">{dayCount(day) || ""}</span>
                  </div>
                ))}

                {shownRows.map((row) => {
                  const venue = venues.find((v) => v.id === row.venueId);
                  return (
                    <RowCells
                      key={row.key}
                      row={row}
                      venue={venue}
                      days={days}
                      over={over}
                      selected={sheet?.kind === "slot" ? sheet.id : null}
                      armed={armed !== null}
                      onCardClick={onCardClick}
                      onDragOver={(slot, event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (over !== slot.id) setOver(slot.id);
                      }}
                      onDragLeave={(slot) => setOver((current) => (current === slot.id ? null : current))}
                      onDrop={onDrop}
                      onChipDrag={startDrag}
                      onAdd={(day) => {
                        // The next hour after the row's last slot that day.
                        const after = row.slots.filter((s) => s.weekday === day).map((s) => s.endTime.slice(0, 5)).sort().pop();
                        openNew({
                          venueId: row.venueId ?? undefined,
                          pitchId: row.pitchId,
                          weekday: day,
                          startTime: after,
                          endTime: after ? hourAfter(after) : undefined,
                        });
                      }}
                      onUseBooking={(booking) => planBooking(row, booking)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
              </>
            ) : (
              "Drag a team onto a card, or tap a team then a card. Click a card for its details."
            )}
          </p>
        </div>
      </div>

      <SlotSheet
        blockId={blockId}
        state={sheet}
        slot={sheetSlot}
        teams={teams}
        venues={venues}
        blockVenueIds={blockVenueIds}
        onClose={closeSheet}
        onOpenSlot={openSlot}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// One row of the timetable
// ---------------------------------------------------------------------------

type Row = TimetableRow<SlotRow, BookedSlot>;

function RowCells({
  row,
  venue,
  days,
  over,
  selected,
  armed,
  onCardClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onChipDrag,
  onAdd,
  onUseBooking,
}: {
  row: Row;
  venue: VenueOption | undefined;
  days: number[];
  over: string | null;
  selected: string | null;
  armed: boolean;
  onCardClick: (slot: SlotRow) => void;
  onDragOver: (slot: SlotRow, event: React.DragEvent) => void;
  onDragLeave: (slot: SlotRow) => void;
  onDrop: (slot: SlotRow, event: React.DragEvent) => void;
  onChipDrag: (event: React.DragEvent, drag: Drag) => void;
  onAdd: (weekday: number) => void;
  onUseBooking: (booking: BookedSlot) => void;
}) {
  const share =
    venue && venue.trainingParts > 1
      ? venue.trainingShares >= venue.trainingParts
        ? "whole pitch ours"
        : `${shareChip(venue.trainingShares, venue.trainingParts)} of the pitch ours`
      : null;
  return (
    <>
      <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5">
        <p className="text-list font-semibold leading-tight">{row.venueName}</p>
        {row.pitchName ? (
          <p className="text-xs font-medium text-primary">{row.pitchName}</p>
        ) : venue && venue.pitches.length > 0 ? (
          <p className="text-2xs text-muted-foreground">No pitch named</p>
        ) : null}
        {share ? <p className="text-2xs text-muted-foreground">{share}</p> : null}
      </div>
      {days.map((day) => {
        const here = row.slots.filter((slot) => slot.weekday === day);
        const unused = row.unplanned.filter((booking) => booking.weekday === day);
        return (
          <div key={day} className="flex flex-col gap-1.5 border-b border-l p-1.5">
            {here.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                isOver={over === slot.id}
                isSelected={selected === slot.id}
                armed={armed}
                onClick={() => onCardClick(slot)}
                onDragOver={(event) => onDragOver(slot, event)}
                onDragLeave={() => onDragLeave(slot)}
                onDrop={(event) => onDrop(slot, event)}
                onChipDrag={onChipDrag}
              />
            ))}
            {unused.map((booking) => (
              <div
                key={`${booking.pitchId ?? "none"}|${booking.startTime}|${booking.endTime}`}
                className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2 text-xs"
              >
                <p className="font-medium">
                  {timeRange(booking.startTime, booking.endTime)}
                  <span className="ml-1 font-normal text-muted-foreground">
                    · booked{booking.parts > 1 && booking.shares < booking.parts ? `, ${shareChip(booking.shares, booking.parts)} pitch` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">Not in the plan yet.</p>
                <Button type="button" size="sm" variant="outline" className="mt-1.5 h-8 w-full touch" onClick={() => onUseBooking(booking)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Use it
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onAdd(day)}
              aria-label={`Add a slot at ${row.venueName}${row.pitchName ? ` ${row.pitchName}` : ""} on ${weekdayLabel(day)}s`}
              title="Add a slot here"
              className={
                "touch inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity hover:border-primary/50 hover:text-primary lg:min-h-[28px] " +
                (here.length + unused.length === 0 ? "opacity-70" : "opacity-40 hover:opacity-100 focus-visible:opacity-100")
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {here.length + unused.length === 0 ? "Add a slot" : null}
            </button>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// A slot card — every team in it, clickable, a drop target
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  isOver,
  isSelected,
  armed,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onChipDrag,
}: {
  slot: SlotRow;
  isOver: boolean;
  isSelected: boolean;
  armed: boolean;
  onClick: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent) => void;
  onChipDrag: (event: React.DragEvent, drag: Drag) => void;
}) {
  const capacity = slotCapacity(slot);
  const free = partsFree(capacity, slot.allocations);
  const ours = oursLabel(slot);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label={`${weekdayLabel(slot.weekday)} ${timeRange(slot.startTime, slot.endTime)} at ${slot.venueName}${slot.pitchName ? ` ${slot.pitchName}` : ""} — ${
        slot.allocations.length === 0 ? "no teams" : slot.allocations.map((a) => a.teamName).join(", ")
      }`}
      className={
        "cursor-pointer rounded-lg border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (isOver
          ? "border-primary bg-primary/10"
          : isSelected
            ? "border-primary ring-2 ring-primary/30"
            : armed && free > 0
              ? "border-primary/50 bg-primary/5 hover:bg-primary/10"
              : free === 0
                ? "border-success/30 bg-success-tint hover:border-success/60"
                : "border-border bg-card hover:border-primary/50")
      }
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">
          {timeRange(slot.startTime, slot.endTime)}
          {ours ? <span className="ml-1 font-normal text-muted-foreground">· {ours}</span> : null}
        </span>
        <Badge variant={free === 0 ? "success" : "muted"} className="px-1.5 text-2xs">
          {capacity === 1 ? (free === 0 ? "Taken" : "Free") : free === 0 ? "Full" : `${free} of ${capacity} free`}
        </Badge>
      </div>
      {slot.allocations.length === 0 ? (
        <p className="mt-1 text-2xs italic text-muted-foreground">No teams yet</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {slot.allocations.map((allocation) => (
            <li
              key={allocation.id}
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                onChipDrag(event, {
                  teamId: allocation.teamId,
                  teamName: allocation.teamName,
                  allocationId: allocation.id,
                  fromSlotId: slot.id,
                  shares: allocation.shares,
                });
              }}
              className="flex cursor-grab items-center gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary active:cursor-grabbing"
              title={`${allocation.teamName} · drag to move`}
            >
              <GripVertical className="h-3 w-3 flex-none opacity-60" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{allocation.teamName}</span>
              {slot.parts > 1 ? <span className="flex-none opacity-70">{shareChip(allocation.shares, slot.parts)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The teams to place
// ---------------------------------------------------------------------------

function TeamRail({
  teams,
  weekday,
  placed,
  armed,
  onArm,
  onDragStart,
}: {
  teams: TeamOption[];
  weekday: number | null;
  placed: Set<string>;
  armed: Drag | null;
  onArm: (drag: Drag | null) => void;
  onDragStart: (event: React.DragEvent, drag: Drag) => void;
}) {
  // A day: that day's teams first, then the rest. The week: grouped by evening.
  const groups: { title: string; teams: TeamOption[]; empty?: string }[] =
    weekday !== null
      ? [
          {
            title: `Train on ${weekdayLabel(weekday)}s`,
            teams: teams.filter((team) => team.trainingDay === weekday),
            empty: "No team has this as its evening yet — set it on the Teams table.",
          },
          { title: "Other teams", teams: teams.filter((team) => team.trainingDay !== weekday) },
        ]
      : [
          ...WEEKDAYS.map((day) => ({ title: `${day.label}s`, teams: teams.filter((team) => team.trainingDay === day.value) })).filter(
            (group) => group.teams.length > 0,
          ),
          { title: "No evening set", teams: teams.filter((team) => team.trainingDay === null) },
        ].filter((group) => group.teams.length > 0);

  return (
    <div className="space-y-3 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
      {groups.map((group) => (
        <div key={group.title}>
          <Eyebrow className="mb-1 px-1">{group.title}</Eyebrow>
          {group.teams.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{group.empty ?? "None."}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:flex-nowrap">
              {group.teams.map((team) => {
                const on = placed.has(team.id);
                const isArmed = armed?.teamId === team.id && !armed.allocationId;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => onDragStart(event, { teamId: team.id, teamName: team.name })}
                      onClick={() => onArm(isArmed ? null : { teamId: team.id, teamName: team.name })}
                      aria-pressed={isArmed}
                      className={
                        "touch flex w-full cursor-grab items-center gap-1.5 rounded-md border px-2.5 text-left text-list font-medium active:cursor-grabbing lg:min-h-[34px] " +
                        (isArmed
                          ? "border-primary bg-primary text-primary-foreground"
                          : on
                            ? "border-success/30 bg-success-tint text-success"
                            : "bg-card hover:border-primary/40")
                      }
                      title={on ? `${team.name} is in a slot${weekday !== null ? " on this day" : ""} — drag or tap to add it to another` : `Drag ${team.name} onto a slot, or tap it then a slot`}
                    >
                      <GripVertical className={"h-3.5 w-3.5 flex-none " + (isArmed ? "opacity-80" : "text-muted-foreground")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{team.name}</span>
                      {on && !isArmed ? <span className="text-2xs uppercase tracking-wide text-success">placed</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

