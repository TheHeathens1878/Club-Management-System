"use client";

/**
 * The pitch calendar's week and list views (gap 6).
 *
 * Filtering — the tabs and the "My teams" toggle — is done on the server and
 * carried in the URL, so a week is a link somebody can send to a coach. The
 * only state here is which block is open: that has to be client-side, because
 * a popover is the whole point of clicking one.
 *
 * The grid is the wide view and the stacked list is the narrow one, chosen by
 * a media query rather than a toggle: a phone gets the list without anyone
 * having to pick it, and both are rendered from the same entries so they can
 * never disagree.
 */

import Link from "next/link";
import { useActionState, useState } from "react";
import { CalendarX2, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PitchOption } from "@/lib/pitch-booking";
import {
  blockClasses,
  blockGeometry,
  CALENDAR_GROUP_LABELS,
  DAY_HOURS,
  dayHeading,
  dayHeadingLong,
  entriesByDate,
  HOUR_HEIGHT,
  hourLabel,
  type CalendarEntry,
} from "@/lib/pitch-calendar";

import { cancelPitchClosure, type ClosureActionState } from "./closure-actions";
import { EMPTY_CLOSURE_STATE } from "./closure-feedback";

const GRID_HEIGHT = (DAY_HOURS.length - 1) * HOUR_HEIGHT;

export type CalendarPermissions = {
  isAdmin: boolean;
  /** Teams the caller is coach / assistant coach / manager of. */
  staffTeamIds: string[];
};

/** Where a block's "manage this" link should point, or null for read-only. */
function manageLink(
  entry: CalendarEntry,
  permissions: CalendarPermissions,
): { href: string; label: string } | null {
  if (permissions.isAdmin) {
    if (entry.group === "fixture") {
      return { href: "/pitches", label: "Allocate fixtures" };
    }
    return { href: "/pitches/requests", label: "Manage in pitch requests" };
  }
  if (entry.teamId && permissions.staffTeamIds.includes(entry.teamId)) {
    return { href: "/pitches/mine", label: "Manage in my pitch bookings" };
  }
  return null;
}

function timeRange(entry: CalendarEntry): string {
  return `${entry.startTime}–${entry.endTime}`;
}

function EntryMeta({ entry }: { entry: CalendarEntry }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {timeRange(entry)} · {entry.resourceName}
      </p>
      {entry.teamName && <p className="text-xs text-muted-foreground">{entry.teamName}</p>}
      {entry.group === "fixture" && entry.opponent && (
        <p className="text-xs text-muted-foreground">
          {entry.isHome === false ? "Away to" : "At home to"} {entry.opponent}
        </p>
      )}
      {entry.sharedTeamNames.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Users className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Shared with {entry.sharedTeamNames.join(", ")}</span>
        </p>
      )}
    </>
  );
}

/**
 * The read-only detail, plus whatever the caller is allowed to do about it.
 *
 * A club administrator can lift a closure straight from here — the same
 * `bookings` update the requests desk makes, refused by RLS for anyone else.
 */
function EntryPopover({
  entry,
  permissions,
  onClose,
}: {
  entry: CalendarEntry;
  permissions: CalendarPermissions;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ClosureActionState, FormData>(
    cancelPitchClosure,
    EMPTY_CLOSURE_STATE,
  );
  const manage = manageLink(entry, permissions);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-foreground/20"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.label}
        className="relative w-full max-w-sm space-y-3 rounded-xl border bg-card p-4 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">{entry.label}</p>
            <p className="text-xs text-muted-foreground">{dayHeadingLong(entry.date)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted">{CALENDAR_GROUP_LABELS[entry.group]}</Badge>
          {entry.status === "pending" && <Badge variant="warning">Not yet confirmed</Badge>}
        </div>

        <div className="space-y-1">
          <EntryMeta entry={entry} />
        </div>

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        {state.notice && <p className="text-xs text-emerald-700">{state.notice}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {entry.group !== "closed" && (
            <Link
              href={`/pitches/${entry.bookingId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Details
            </Link>
          )}
          {manage && (
            <Link
              href={manage.href}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {manage.label}
            </Link>
          )}
          {permissions.isAdmin && entry.group === "closed" && entry.status !== "cancelled" && (
            <form action={action}>
              <input type="hidden" name="booking_id" value={entry.bookingId} />
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                Re-open the pitch
              </Button>
            </form>
          )}
          {!manage && !permissions.isAdmin && (
            <p className="text-xs text-muted-foreground">
              This is the club&apos;s diary — ask the team&apos;s coach or a club administrator to
              change it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DayGrid({
  date,
  pitches,
  entries,
  onSelect,
}: {
  date: string;
  pitches: PitchOption[];
  entries: CalendarEntry[];
  onSelect: (entry: CalendarEntry) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[36rem]"
        style={{
          gridTemplateColumns: `3.25rem repeat(${Math.max(pitches.length, 1)}, minmax(7rem, 1fr))`,
        }}
      >
        <div className="border-b px-2 pb-1 text-[11px] font-medium text-muted-foreground">
          {dayHeading(date)}
        </div>
        {pitches.map((pitch) => (
          <div
            key={pitch.id}
            className="truncate border-b border-l px-2 pb-1 text-[11px] font-medium"
            title={pitch.name}
          >
            {pitch.name}
          </div>
        ))}

        {/* The hour gutter */}
        <div className="relative" style={{ height: GRID_HEIGHT }}>
          {DAY_HOURS.slice(0, -1).map((hour, index) => (
            <div
              key={hour}
              className="absolute left-0 right-0 pr-1 text-right text-[10px] leading-none text-muted-foreground"
              style={{ top: index * HOUR_HEIGHT + 2 }}
            >
              {hourLabel(hour)}
            </div>
          ))}
        </div>

        {pitches.map((pitch) => {
          const column = entries.filter((entry) => entry.resourceId === pitch.id);
          return (
            <div
              key={pitch.id}
              className="relative border-l"
              style={{ height: GRID_HEIGHT }}
            >
              {DAY_HOURS.slice(1, -1).map((hour, index) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-t border-dashed border-border/60"
                  style={{ top: (index + 1) * HOUR_HEIGHT }}
                />
              ))}
              {column.map((entry) => {
                const geometry = blockGeometry(entry);
                return (
                  <button
                    key={entry.bookingId}
                    type="button"
                    onClick={() => onSelect(entry)}
                    title={`${entry.label} · ${timeRange(entry)}`}
                    className={
                      "absolute left-0.5 right-0.5 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[10px] leading-tight hover:brightness-95 " +
                      blockClasses(entry)
                    }
                    style={{ top: `${geometry.topPct}%`, height: `${geometry.heightPct}%` }}
                  >
                    <span className="block truncate font-medium">{entry.label}</span>
                    <span className="block truncate opacity-80">{timeRange(entry)}</span>
                    {entry.teamName && (
                      <span className="block truncate opacity-80">{entry.teamName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayList({
  date,
  entries,
  onSelect,
}: {
  date: string;
  entries: CalendarEntry[];
  onSelect: (entry: CalendarEntry) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{dayHeadingLong(date)}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing booked.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.bookingId}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className={
                  "w-full space-y-1 rounded-lg border px-3 py-2 text-left hover:brightness-95 " +
                  blockClasses(entry)
                }
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{entry.label}</span>
                  {entry.status === "pending" && (
                    <span className="rounded-full border border-current px-1.5 text-[10px]">
                      Pending
                    </span>
                  )}
                </span>
                <span className="block text-xs opacity-80">
                  {timeRange(entry)} · {entry.resourceName}
                  {entry.teamName ? ` · ${entry.teamName}` : ""}
                </span>
                {entry.sharedTeamNames.length > 0 && (
                  <span className="block text-xs opacity-80">
                    Shared with {entry.sharedTeamNames.join(", ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WeekCalendar({
  days,
  pitches,
  entries,
  permissions,
}: {
  days: string[];
  pitches: PitchOption[];
  entries: CalendarEntry[];
  permissions: CalendarPermissions;
}) {
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const byDate = entriesByDate(entries);

  return (
    <>
      {/* Wide: the pitch-by-hour grid, one block per day that has anything. */}
      <div className="hidden space-y-6 md:block">
        {days.map((date) => {
          const dayEntries = byDate.get(date) ?? [];
          if (dayEntries.length === 0) {
            return (
              <div key={date} className="flex items-baseline gap-3 border-b pb-2">
                <span className="text-sm font-medium">{dayHeading(date)}</span>
                <span className="text-xs text-muted-foreground">Nothing booked.</span>
              </div>
            );
          }
          return (
            <DayGrid
              key={date}
              date={date}
              pitches={pitches}
              entries={dayEntries}
              onSelect={setSelected}
            />
          );
        })}
      </div>

      {/* Narrow: the same week, stacked. */}
      <div className="space-y-5 md:hidden">
        {days.map((date) => (
          <DayList
            key={date}
            date={date}
            entries={byDate.get(date) ?? []}
            onSelect={setSelected}
          />
        ))}
      </div>

      {entries.length === 0 && (
        <p className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
          <CalendarX2 className="h-4 w-4" /> Nothing on the pitches this week.
        </p>
      )}

      {selected && (
        <EntryPopover
          entry={selected}
          permissions={permissions}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
