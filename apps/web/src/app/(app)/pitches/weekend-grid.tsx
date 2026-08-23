"use client";

/**
 * The weekend pitch grid: columns are pitches, rows are half hours 08:00–20:00
 * Europe/London, and every live booking in the window fills the cells it
 * occupies. Buffers — the minutes either side that `bookings_no_overlap`
 * treats as taken — are shown in a lighter shade, because a pitch that looks
 * free at 12:00 but refuses an allocation is the confusing case this screen
 * exists to remove.
 *
 * Clicking a fixture cell opens a "Move to…" panel rather than starting a
 * drag. Dragging is nicer to demo; a select is what an admin can use on a
 * phone at the side of a pitch, and both paths end in the same
 * `allocate_fixture()` call, so a move gets the same named-conflict answer as
 * an allocation.
 */

import { useState } from "react";
import { cellAt, slotBounds, slotTimes, type GridCell, type GridEntry } from "@/lib/pitch-grid";
import { AllocateControl, type PitchOption } from "./allocate-control";
import { X } from "lucide-react";

export type GridDay = { date: string; label: string };

type Selection = {
  fixtureId: string;
  label: string;
  resourceId: string;
  /** The fixture's team's home pitch, so a move offers it labelled "(home)". */
  homeResourceId: string | null;
  when: string;
};

const TIMES = slotTimes();

function cellClasses(cell: GridCell): string {
  if (cell.state === "buffer") return "bg-muted/60 text-muted-foreground";
  if (cell.entry.fixtureId !== null) return "bg-primary/15 text-primary";
  if (cell.entry.kind === "hire") return "bg-emerald-100 text-emerald-900";
  return "bg-slate-200 text-slate-700";
}

export function WeekendPitchGrid({
  days,
  pitches,
  entries,
  homePitchByTeam,
}: {
  days: GridDay[];
  pitches: PitchOption[];
  /** Live bookings in the window, keyed by pitch id. */
  entries: Record<string, GridEntry[]>;
  /** `teams.home_resource_id` by team id; a team without one is simply absent. */
  homePitchByTeam: Record<string, string>;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);

  if (pitches.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No active pitches yet — add one under Room Bookings → Rooms &amp; resources.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {selected && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{selected.label}</p>
              <p className="text-xs text-muted-foreground">{selected.when}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <AllocateControl
            key={selected.fixtureId}
            fixtureId={selected.fixtureId}
            pitches={pitches}
            currentResourceId={selected.resourceId}
            homeResourceId={selected.homeResourceId}
            allowUnallocate
            compact
          />
        </div>
      )}

      {days.map((day) => (
        <DayTable
          key={day.date}
          day={day}
          pitches={pitches}
          entries={entries}
          homePitchByTeam={homePitchByTeam}
          onSelect={setSelected}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-primary/15" /> Fixture
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-emerald-100" /> Hire
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-slate-200" /> Block / maintenance
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-muted/60" /> Buffer
        </span>
        <span>Click a fixture to move it.</span>
      </div>
    </div>
  );
}

function DayTable({
  day,
  pitches,
  entries,
  homePitchByTeam,
  onSelect,
}: {
  day: GridDay;
  pitches: PitchOption[];
  entries: Record<string, GridEntry[]>;
  homePitchByTeam: Record<string, string>;
  onSelect: (selection: Selection) => void;
}) {
  // The label goes in the first cell an entry occupies on this day, so a
  // 90-minute fixture reads as one block rather than three repetitions.
  const labelled = new Set<string>();
  const rows = TIMES.map((time) => {
    const { startMs, endMs } = slotBounds(day.date, time);
    const cells = pitches.map((pitch) => {
      const cell = cellAt(entries[pitch.id] ?? [], startMs, endMs);
      if (cell === null) return { cell, showLabel: false };
      const key = `${pitch.id}:${cell.entry.bookingId}:${cell.state}`;
      const showLabel = !labelled.has(key);
      labelled.add(key);
      return { cell, showLabel };
    });
    return { time, cells };
  });

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{day.label}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-14 border-b px-1 py-1.5 text-left font-medium">Time</th>
              {pitches.map((pitch) => (
                <th key={pitch.id} className="border-b px-1 py-1.5 text-left font-medium">
                  {pitch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.time}>
                <td className="whitespace-nowrap border-b py-0 pr-2 align-top text-[11px] text-muted-foreground">
                  {row.time.endsWith(":00") ? row.time : ""}
                </td>
                {row.cells.map(({ cell, showLabel }, index) => {
                  const pitch = pitches[index];
                  if (pitch === undefined) return null;
                  if (cell === null) {
                    return <td key={pitch.id} className="h-6 border-b border-l px-1 py-0" />;
                  }
                  const fixtureId = cell.entry.fixtureId;
                  return (
                    <td
                      key={pitch.id}
                      className={`h-6 border-b border-l px-1 py-0 align-top ${cellClasses(cell)}`}
                      title={
                        cell.state === "buffer"
                          ? `Buffer for ${cell.entry.label}`
                          : `${cell.entry.label} (${cell.entry.kind})`
                      }
                    >
                      {showLabel && cell.state === "booked" && (
                        <span className="block truncate text-[11px] leading-6">
                          {fixtureId !== null ? (
                            <button
                              type="button"
                              className="underline-offset-2 hover:underline"
                              onClick={() =>
                                onSelect({
                                  fixtureId,
                                  label: cell.entry.label,
                                  resourceId: pitch.id,
                                  homeResourceId:
                                    cell.entry.teamId === null
                                      ? null
                                      : homePitchByTeam[cell.entry.teamId] ?? null,
                                  when: `${day.label} · on ${pitch.name}`,
                                })
                              }
                            >
                              {cell.entry.label}
                            </button>
                          ) : (
                            cell.entry.label
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
