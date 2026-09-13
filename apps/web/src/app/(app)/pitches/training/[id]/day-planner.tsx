"use client";

/**
 * The day planner (Adam, 2026-09-13: "choose the day and then drag the teams
 * on to a calendar view for our training venues on that day").
 *
 * Pick a weekday; the block's venues are drawn as a diary — one column per
 * venue, the evening down the side, each slot a box from its start to its end
 * holding the teams in it. A venue with no slot that day is still a column,
 * with a nudge to add one. The teams stand to the left: the ones whose
 * default training day is this day first, then the rest.
 *
 * Drop a team on a slot and, if more than one part of OUR share is free, a
 * strip above the diary asks how much of the slot the team takes — a
 * quarter, half — before anything is written (Adam: "when I drag a team on,
 * I need to be able to say what fraction(s) they have"). One part free and
 * the drop just takes it. Drag a team that is already in a slot to another
 * and it moves, asked the same question. The database's guard still has the
 * last word — a full slot refuses, and says so here.
 *
 * Native HTML drag and drop, so no library rides into the bundle. Every drop
 * is a server action followed by a refresh, so what is drawn is always what
 * the database holds. Dragging needs a pointer; on a phone the slot rows
 * below with their "Add a team" pickers do the same job.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, GripVertical, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  WEEKDAYS,
  oursLabel,
  partsFree,
  shareChip,
  shareLabel,
  slotCapacity,
  timeRange,
  weekdayLabel,
} from "@/lib/training-plan";

import { allocateTeamToSlot, moveAllocation } from "../actions";
import type { SlotRow, TeamOption, VenueOption } from "./slots-section";

/** Pixels per hour in the grid — a 1-hour slot is a comfortable box. */
const HOUR_PX = 72;
/** The evening when a day has no slots yet. */
const DEFAULT_FROM = 17 * 60;
const DEFAULT_TO = 21 * 60;

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hourLabel(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

type Drag = { teamId: string; teamName: string; allocationId?: string; fromSlotId?: string; shares?: number };

/** A drop waiting on "how much?". */
type Asking = { slot: SlotRow; drag: Drag; free: number };

export function DayPlanner({
  blockId,
  slots,
  teams,
  venues,
}: {
  blockId: string;
  slots: SlotRow[];
  teams: TeamOption[];
  /** The block's venues, in order — every one is a column. */
  venues: VenueOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);

  // Open on the day with the most slots — the day being planned — else Monday.
  const initialDay = useMemo(() => {
    const counts = new Map<number, number>();
    for (const slot of slots) counts.set(slot.weekday, (counts.get(slot.weekday) ?? 0) + 1);
    let best = 1;
    let bestCount = -1;
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const n = counts.get(day) ?? 0;
      if (n > bestCount) {
        best = day;
        bestCount = n;
      }
    }
    return best;
  }, [slots]);
  const [weekday, setWeekday] = useState(initialDay);

  const daySlots = slots.filter((slot) => slot.weekday === weekday);
  // Columns: the block's venues, then any venue a slot names that the block
  // has not listed (it cannot happen after 20260913130000, but a column is
  // cheaper than a missing slot).
  const columns: { key: string; name: string; venue: VenueOption | null }[] = venues.map((venue) => ({
    key: venue.id,
    name: venue.name,
    venue,
  }));
  for (const slot of daySlots) {
    if (!columns.some((c) => (slot.venueId ? c.key === slot.venueId : c.name === slot.venueName))) {
      columns.push({ key: slot.venueId ?? slot.venueName, name: slot.venueName, venue: null });
    }
  }
  const slotsIn = (column: { key: string; name: string }) =>
    daySlots.filter((slot) => (slot.venueId ? slot.venueId === column.key : slot.venueName === column.name));

  const from = daySlots.length ? Math.min(...daySlots.map((s) => minutes(s.startTime))) : DEFAULT_FROM;
  const to = daySlots.length ? Math.max(...daySlots.map((s) => minutes(s.endTime))) : DEFAULT_TO;
  const gridFrom = Math.floor(from / 60) * 60;
  const gridTo = Math.ceil(to / 60) * 60;
  const gridHeight = ((gridTo - gridFrom) / 60) * HOUR_PX;
  const hours: number[] = [];
  for (let t = gridFrom; t < gridTo; t += 60) hours.push(t);

  const placed = new Set(daySlots.flatMap((slot) => slot.allocations.map((a) => a.teamId)));
  const onThisDay = teams.filter((team) => team.trainingDay === weekday);
  const others = teams.filter((team) => team.trainingDay !== weekday);

  function run(work: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  function place(slot: SlotRow, drag: Drag, shares: number) {
    setAsking(null);
    if (drag.allocationId) {
      run(() => moveAllocation({ blockId, allocationId: drag.allocationId!, slotId: slot.id, shares }));
    } else {
      run(() => allocateTeamToSlot({ blockId, slotId: slot.id, teamId: drag.teamId, shares }));
    }
  }

  function onDrop(slot: SlotRow, event: React.DragEvent) {
    event.preventDefault();
    setOver(null);
    let drag: Drag;
    try {
      drag = JSON.parse(event.dataTransfer.getData("application/x-training-team")) as Drag;
    } catch {
      return;
    }
    if (drag.fromSlotId === slot.id) return;
    const free = partsFree(slotCapacity(slot), slot.allocations);
    if (free === 0) {
      setError(
        `${slot.venueName} ${timeRange(slot.startTime, slot.endTime)} is full — ${
          slotCapacity(slot) < slot.parts ? "the club's share of it is all allocated" : "every part is allocated"
        }.`,
      );
      return;
    }
    if (free === 1) {
      place(slot, drag, 1);
      return;
    }
    setAsking({ slot, drag, free });
  }

  function startDrag(event: React.DragEvent, drag: Drag) {
    event.dataTransfer.setData("application/x-training-team", JSON.stringify(drag));
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <Card>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="text-base">Plan a day</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose the evening, then drag a team onto a slot. Where more than one part is free you are
          asked how much of the slot the team takes; drag it between slots to move it. Slots themselves
          are added and cloned in the list below.
        </p>
        <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const n = slots.filter((slot) => slot.weekday === day).length;
            const on = day === weekday;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setWeekday(day);
                  setAsking(null);
                }}
                aria-pressed={on}
                className={
                  "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors lg:min-h-[36px] " +
                  (on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary")
                }
              >
                {weekdayLabel(day)}
                {n > 0 ? (
                  <span
                    className={
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none " +
                      (on ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-muted-foreground")
                    }
                  >
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
        {error ? (
          <p className="mb-3 flex items-start gap-1.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {pending ? (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
          </p>
        ) : null}

        {/* "How much?" — the drop, waiting on a share. */}
        {asking ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
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
                  className="min-h-[44px] lg:min-h-0"
                  onClick={() => place(asking.slot, asking.drag, n)}
                >
                  {shareLabel(n, asking.slot.parts).replace(" of the pitch", "")}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" className="min-h-[44px] lg:min-h-0" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </span>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* The teams to place */}
          <div className="space-y-4">
            <TeamList
              title={`Train on ${WEEKDAYS.find((d) => d.value === weekday)?.label ?? weekdayLabel(weekday)}s`}
              teams={onThisDay}
              placed={placed}
              empty="No team has this as its default training day yet — set one on the Teams table."
              onDragStart={startDrag}
            />
            <TeamList title="Other teams" teams={others} placed={placed} onDragStart={startDrag} />
          </div>

          {/* The diary */}
          {columns.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
              No venues in this block yet. Add the venues it trains at below, then a slot at each.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[520px]"
                style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(180px, 1fr))` }}
              >
                <div />
                {columns.map((column) => (
                  <div key={column.key} className="min-w-0 px-2 pb-2" title={column.name}>
                    <p className="truncate text-[13px] font-semibold">{column.name}</p>
                    {column.venue && column.venue.trainingParts > 1 ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {column.venue.trainingShares >= column.venue.trainingParts
                          ? "whole pitch ours"
                          : `${shareChip(column.venue.trainingShares, column.venue.trainingParts)} of the pitch ours`}
                      </p>
                    ) : null}
                  </div>
                ))}
                {/* The hours down the side */}
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((h) => (
                    <span
                      key={h}
                      className="absolute -translate-y-1/2 pr-2 text-[11px] text-muted-foreground"
                      style={{ top: ((h - gridFrom) / 60) * HOUR_PX }}
                    >
                      {hourLabel(h)}
                    </span>
                  ))}
                </div>
                {columns.map((column) => {
                  const here = slotsIn(column);
                  return (
                    <div key={column.key} className="relative border-l border-border/60" style={{ height: gridHeight }}>
                      {hours.map((h) => (
                        <div
                          key={h}
                          className="absolute inset-x-0 border-t border-border/40"
                          style={{ top: ((h - gridFrom) / 60) * HOUR_PX }}
                        />
                      ))}
                      {here.length === 0 ? (
                        <p className="absolute inset-x-2 top-2 rounded-lg border border-dashed p-2 text-center text-[11px] text-muted-foreground">
                          No slot on {weekdayLabel(weekday)}s — add one below
                        </p>
                      ) : null}
                      {here.map((slot) => {
                        const top = ((minutes(slot.startTime) - gridFrom) / 60) * HOUR_PX;
                        const height = ((minutes(slot.endTime) - minutes(slot.startTime)) / 60) * HOUR_PX;
                        const capacity = slotCapacity(slot);
                        const free = partsFree(capacity, slot.allocations);
                        const ours = oursLabel(slot);
                        const isOver = over === slot.id;
                        return (
                          <div
                            key={slot.id}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              if (over !== slot.id) setOver(slot.id);
                            }}
                            onDragLeave={() => setOver((current) => (current === slot.id ? null : current))}
                            onDrop={(event) => onDrop(slot, event)}
                            className={
                              "absolute inset-x-1 overflow-hidden rounded-lg border p-1.5 text-xs transition-colors " +
                              (isOver
                                ? "border-primary bg-primary/10"
                                : free === 0
                                  ? "border-emerald-200 bg-emerald-50/70"
                                  : "border-border bg-card")
                            }
                            style={{ top, height: Math.max(height, 44) }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium">
                                {timeRange(slot.startTime, slot.endTime)}
                                {ours ? <span className="ml-1 font-normal text-muted-foreground">· {ours}</span> : null}
                              </span>
                              <Badge variant={free === 0 ? "success" : "warning"} className="text-[10px]">
                                {capacity === 1 ? (free === 0 ? "Taken" : "Free") : free === 0 ? "Full" : `${free} of ${capacity} free`}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {slot.allocations.map((allocation) => (
                                <span
                                  key={allocation.id}
                                  draggable
                                  onDragStart={(event) =>
                                    startDrag(event, {
                                      teamId: allocation.teamId,
                                      teamName: allocation.teamName,
                                      allocationId: allocation.id,
                                      fromSlotId: slot.id,
                                      shares: allocation.shares,
                                    })
                                  }
                                  className="inline-flex cursor-grab items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary active:cursor-grabbing"
                                  title={`${allocation.teamName} · drag to move`}
                                >
                                  <GripVertical className="h-3 w-3 opacity-60" aria-hidden />
                                  {allocation.teamName}
                                  {slot.parts > 1 ? (
                                    <span className="opacity-70">· {shareChip(allocation.shares, slot.parts)}</span>
                                  ) : null}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamList({
  title,
  teams,
  placed,
  empty,
  onDragStart,
}: {
  title: string;
  teams: TeamOption[];
  placed: Set<string>;
  empty?: string;
  onDragStart: (event: React.DragEvent, drag: Drag) => void;
}) {
  return (
    <div>
      <p className="font-display mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      {teams.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{empty ?? "None."}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:flex-nowrap">
          {teams.map((team) => {
            const on = placed.has(team.id);
            return (
              <li
                key={team.id}
                draggable
                onDragStart={(event) => onDragStart(event, { teamId: team.id, teamName: team.name })}
                className={
                  "flex min-h-[36px] cursor-grab items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium active:cursor-grabbing " +
                  (on ? "border-emerald-200 bg-emerald-50/70 text-emerald-900" : "bg-card")
                }
                title={on ? `${team.name} is in a slot on this day — drag to add it to another` : `Drag ${team.name} onto a slot`}
              >
                <GripVertical className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                {on ? <span className="text-[10px] uppercase tracking-wide text-emerald-700">placed</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
