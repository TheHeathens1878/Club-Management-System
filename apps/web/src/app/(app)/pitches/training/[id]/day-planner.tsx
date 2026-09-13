"use client";

/**
 * The day planner (Adam, 2026-09-13: "choose the day and then drag the teams
 * on to a calendar view for our training venues on that day").
 *
 * Pick a weekday; the block's slots for that day are drawn as a diary — one
 * column per training venue, the evening down the side, each slot a box from
 * its start to its end holding the teams in it. The teams stand to the left:
 * the ones whose default training day is this day first, then the rest. Drag
 * a team onto a slot and it takes one part of it; drag a team that is
 * already in a slot to another and it moves. The database's guard still has
 * the last word — a full slot refuses, and says so here.
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WEEKDAYS, partsFree, shareChip, timeRange, weekdayLabel } from "@/lib/training-plan";

import { allocateTeamToSlot, moveAllocation } from "../actions";
import type { SlotRow, TeamOption } from "./slots-section";

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

type Drag = { teamId: string; allocationId?: string; fromSlotId?: string };

export function DayPlanner({ blockId, slots, teams }: { blockId: string; slots: SlotRow[]; teams: TeamOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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
  const venues = Array.from(new Set(daySlots.map((slot) => slot.venueName)));
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
    if (drag.allocationId) {
      run(() => moveAllocation({ blockId, allocationId: drag.allocationId!, slotId: slot.id }));
    } else {
      run(() => allocateTeamToSlot({ blockId, slotId: slot.id, teamId: drag.teamId, shares: 1 }));
    }
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
          Choose the evening, then drag a team onto a slot. A team takes one part of the slot it lands
          on; drag it between slots to move it. Slots themselves are added and cloned in the list below.
        </p>
        <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const n = slots.filter((slot) => slot.weekday === day).length;
            const on = day === weekday;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setWeekday(day)}
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
          {daySlots.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
              No slots on a {weekdayLabel(weekday)} yet. Add one below, or clone one from another day.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[520px]"
                style={{ gridTemplateColumns: `56px repeat(${venues.length}, minmax(180px, 1fr))` }}
              >
                <div />
                {venues.map((venue) => (
                  <div key={venue} className="truncate px-2 pb-2 text-[13px] font-semibold" title={venue}>
                    {venue}
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
                {venues.map((venue) => (
                  <div
                    key={venue}
                    className="relative border-l border-border/60"
                    style={{ height: gridHeight }}
                  >
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/40"
                        style={{ top: ((h - gridFrom) / 60) * HOUR_PX }}
                      />
                    ))}
                    {daySlots
                      .filter((slot) => slot.venueName === venue)
                      .map((slot) => {
                        const top = ((minutes(slot.startTime) - gridFrom) / 60) * HOUR_PX;
                        const height = ((minutes(slot.endTime) - minutes(slot.startTime)) / 60) * HOUR_PX;
                        const free = partsFree(slot.parts, slot.allocations);
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
                              <span className="font-medium">{timeRange(slot.startTime, slot.endTime)}</span>
                              <Badge variant={free === 0 ? "success" : "warning"} className="text-[10px]">
                                {slot.parts === 1 ? (free === 0 ? "Taken" : "Free") : free === 0 ? "Full" : `${free} of ${slot.parts} free`}
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
                                      allocationId: allocation.id,
                                      fromSlotId: slot.id,
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
                ))}
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
                onDragStart={(event) => onDragStart(event, { teamId: team.id })}
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
