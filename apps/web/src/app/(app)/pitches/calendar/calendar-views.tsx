"use client";

/**
 * The pitch calendar's grid, list and day views (gap 6 → legacy parity).
 *
 * Filtering — tabs, team, venue, weekends, "My teams" — is done on the server
 * and carried in the URL, so a week is a link somebody can send to a coach.
 * Client state is: which block is open, and which page of pitches each grid
 * shows (the legacy app capped visible pitches at 1/3/5 by viewport with a
 * mobile pitch navigator; so does this one).
 *
 * Two legacy behaviours live here besides the pagination:
 *   · clicking EMPTY grid space starts a booking — the click's height picks
 *     the half-hour, and /pitches/book opens prefilled (staff and admins
 *     only; everyone else's click does nothing, exactly like a paper diary);
 *   · a club administrator confirms, declines (with the reason the coach is
 *     told) or cancels a booking straight from the popover — the same server
 *     actions the requests desk uses, refused by RLS for anyone else.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Repeat2, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { PitchOption } from "@/lib/pitch-booking";
import {
  blockClasses,
  blockGeometry,
  CALENDAR_GROUP_LABELS,
  DAY_HOURS,
  DAY_START_MINUTES,
  DAY_END_MINUTES,
  dayHeading,
  dayHeadingLong,
  entriesByDate,
  HOUR_HEIGHT,
  hourLabel,
  type CalendarEntry,
} from "@/lib/pitch-calendar";

import {
  cancelPitchBooking,
  confirmPitchBooking,
  declinePitchBooking,
  deletePitchBooking,
  type PitchBookingActionState,
} from "../booking-actions";
import { cancelPitchClosure, type ClosureActionState } from "./closure-actions";
import { EMPTY_CLOSURE_STATE } from "./closure-feedback";

const GRID_HEIGHT = (DAY_HOURS.length - 1) * HOUR_HEIGHT;
const EMPTY_ACTION_STATE: PitchBookingActionState = {};

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
    return null; // admins act right here in the popover now
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
      {entry.recurrenceGroupId && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Repeat2 className="h-3 w-3 shrink-0" /> Part of a weekly series
        </p>
      )}
      {entry.internalMatch && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
          🟢 Internal match — two of the club&apos;s own teams.
        </p>
      )}
      {entry.consecutiveWeeks && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          ⚠️ This team has this pitch two or more weeks in a row.
        </p>
      )}
    </>
  );
}

/** The tile prefix: every flag the legacy calendar drew on a booking. */
function flagPrefix(entry: CalendarEntry): string {
  let prefix = "";
  if (entry.recurrenceGroupId) prefix += "🔁 ";
  if (entry.internalMatch) prefix += "🟢 ";
  if (entry.consecutiveWeeks) prefix += "⚠️ ";
  return prefix;
}

/**
 * The read-only detail, plus whatever the caller is allowed to do about it:
 * closures can be lifted, pending bookings confirmed or declined, confirmed
 * ones cancelled — administrators only, and RLS is the rule either way.
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
  const [closureState, closureAction, closurePending] = useActionState<
    ClosureActionState,
    FormData
  >(cancelPitchClosure, EMPTY_CLOSURE_STATE);
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmPitchBooking,
    EMPTY_ACTION_STATE,
  );
  const [declineState, declineAction, declining] = useActionState(
    declinePitchBooking,
    EMPTY_ACTION_STATE,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelPitchBooking,
    EMPTY_ACTION_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deletePitchBooking,
    EMPTY_ACTION_STATE,
  );
  const [showDecline, setShowDecline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const manage = manageLink(entry, permissions);
  const isClosure = entry.group === "closed";
  const canAct = permissions.isAdmin && !isClosure;
  // A coach may cancel their own team's pending request right here — the
  // legacy app's floating Edit/Cancel bar, in the popover.
  const staffOwn =
    !permissions.isAdmin &&
    entry.teamId !== null &&
    permissions.staffTeamIds.includes(entry.teamId) &&
    entry.group !== "fixture";

  const feedback = [closureState, confirmState, declineState, cancelState, deleteState];
  const error = feedback.map((s) => s.error).find(Boolean);
  const notice = feedback.map((s) => s.notice).find(Boolean);

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
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary sm:h-auto sm:w-auto sm:p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted">{CALENDAR_GROUP_LABELS[entry.group]}</Badge>
          {entry.status === "pending" && <Badge variant="warning">Not yet confirmed</Badge>}
          {entry.recurrenceGroupId && <Badge variant="outline">Weekly series</Badge>}
        </div>

        <div className="space-y-1">
          <EntryMeta entry={entry} />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {notice && <p className="text-xs text-emerald-700">{notice}</p>}

        {/* Every action in the sheet is a 44px target on a phone. */}
        <div className="flex flex-wrap items-center gap-2 pt-1 [&_a]:h-11 [&_button]:h-11 sm:[&_a]:h-9 sm:[&_button]:h-9">
          {!isClosure && (
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

          {canAct && entry.status === "pending" && (
            <form action={confirmAction}>
              <input type="hidden" name="booking_id" value={entry.bookingId} />
              <input type="hidden" name="team_id" value={entry.teamId ?? ""} />
              <Button type="submit" size="sm" disabled={confirming}>
                {confirming ? "Confirming…" : "Confirm"}
              </Button>
            </form>
          )}
          {canAct && entry.status === "pending" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDecline((value) => !value)}
            >
              Decline…
            </Button>
          )}
          {canAct && entry.status === "confirmed" && entry.group !== "fixture" && (
            <form action={cancelAction}>
              <input type="hidden" name="booking_id" value={entry.bookingId} />
              <input type="hidden" name="team_id" value={entry.teamId ?? ""} />
              <Button type="submit" variant="ghost" size="sm" disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel booking"}
              </Button>
            </form>
          )}
          {staffOwn && entry.status === "pending" && (
            <form action={cancelAction}>
              <input type="hidden" name="booking_id" value={entry.bookingId} />
              <input type="hidden" name="team_id" value={entry.teamId ?? ""} />
              <Button type="submit" variant="outline" size="sm" disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel my request"}
              </Button>
            </form>
          )}
          {canAct && !confirmDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete…
            </Button>
          )}

          {permissions.isAdmin && isClosure && entry.status !== "cancelled" && (
            <form action={closureAction}>
              <input type="hidden" name="booking_id" value={entry.bookingId} />
              <Button type="submit" variant="ghost" size="sm" disabled={closurePending}>
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

        {canAct && confirmDelete && (
          <form action={deleteAction} className="space-y-2 rounded-lg border border-destructive/30 p-3">
            <input type="hidden" name="booking_id" value={entry.bookingId} />
            <input type="hidden" name="team_id" value={entry.teamId ?? ""} />
            <p className="text-xs text-muted-foreground">
              Deleting removes the booking and its history outright — cancelling is the everyday
              path. A fixture&apos;s slot cannot be deleted here; unallocate it on Pitches.
            </p>
            <div className="flex gap-2 [&_button]:h-11 sm:[&_button]:h-9">
              <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
                {deleting ? "Deleting…" : "Delete booking"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          </form>
        )}

        {canAct && entry.status === "pending" && showDecline && (
          <form action={declineAction} className="space-y-2 rounded-lg border p-3">
            <input type="hidden" name="booking_id" value={entry.bookingId} />
            <input type="hidden" name="team_id" value={entry.teamId ?? ""} />
            <Textarea
              name="reason"
              rows={2}
              required
              placeholder="Why is it declined? The coach is told this."
              className="text-xs"
            />
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={declining}
            >
              {declining ? "Declining…" : "Confirm decline"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Snap a click inside a column to the half-hour it landed in. */
function minutesFromClick(offsetY: number): number {
  const minutes = DAY_START_MINUTES + (offsetY / HOUR_HEIGHT) * 60;
  const snapped = Math.floor(minutes / 30) * 30;
  return Math.min(Math.max(snapped, DAY_START_MINUTES), DAY_END_MINUTES - 60);
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function DayGrid({
  date,
  pitches,
  entries,
  canBook,
  onSelect,
}: {
  date: string;
  pitches: PitchOption[];
  entries: CalendarEntry[];
  canBook: boolean;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto">
      <div
        className="grid"
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
              className={"relative border-l " + (canBook ? "cursor-copy" : "")}
              style={{ height: GRID_HEIGHT }}
              title={canBook ? "Click an empty slot to book this pitch" : undefined}
              onClick={(event) => {
                if (!canBook || event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const start = minutesFromClick(event.clientY - rect.top);
                const end = Math.min(start + 60, DAY_END_MINUTES);
                const query = new URLSearchParams({
                  pitch: pitch.id,
                  date,
                  start: timeOf(start),
                  end: timeOf(end),
                });
                router.push(`/pitches/book?${query.toString()}`);
              }}
            >
              {DAY_HOURS.slice(1, -1).map((hour, index) => (
                <div
                  key={hour}
                  className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border/60"
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
                    <span className="block truncate font-medium">
                      {flagPrefix(entry)}
                      {entry.label}
                    </span>
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
                  "min-h-[44px] w-full space-y-1 rounded-lg border px-3 py-2 text-left hover:brightness-95 " +
                  blockClasses(entry)
                }
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {flagPrefix(entry)}
                    {entry.label}
                  </span>
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

/** 1 pitch below 640px, 3 below 1024px, 5 from 1024px — the legacy caps. */
function pitchesPerPage(width: number): number {
  if (width < 640) return 1;
  if (width < 1024) return 3;
  return 5;
}

export function WeekCalendar({
  days,
  pitches,
  entries,
  permissions,
  canBook,
  mode = "auto",
}: {
  days: string[];
  pitches: PitchOption[];
  entries: CalendarEntry[];
  permissions: CalendarPermissions;
  /** Staff or admin — a click on empty grid space starts a booking. */
  canBook: boolean;
  /** "auto": grid on desktop, list on phones. "list": the list, everywhere. */
  mode?: "auto" | "list";
}) {
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [perPage, setPerPage] = useState(5);
  const [offset, setOffset] = useState(0);
  const byDate = entriesByDate(entries);

  useEffect(() => {
    const update = () => setPerPage(pitchesPerPage(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const pages = Math.max(1, Math.ceil(pitches.length / perPage));
  const page = Math.min(offset, pages - 1);
  const visiblePitches = pitches.slice(page * perPage, page * perPage + perPage);
  const paged = pitches.length > perPage;

  const pager = paged ? (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-secondary/50 px-2 py-1 print:hidden">
      <button
        type="button"
        onClick={() => setOffset(Math.max(0, page - 1))}
        disabled={page === 0}
        className="inline-flex min-h-[44px] items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-40 sm:min-h-0"
        aria-label="Previous pitches"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Prev
      </button>
      <span className="truncate text-xs text-muted-foreground">
        {perPage === 1
          ? (visiblePitches[0]?.name ?? "")
          : `Pitches ${page * perPage + 1}–${Math.min((page + 1) * perPage, pitches.length)} of ${pitches.length}`}
        {perPage === 1 ? ` · ${page + 1} of ${pages}` : ""}
      </span>
      <button
        type="button"
        onClick={() => setOffset(Math.min(pages - 1, page + 1))}
        disabled={page >= pages - 1}
        className="inline-flex min-h-[44px] items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-40 sm:min-h-0"
        aria-label="Next pitches"
      >
        Next <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  const listView = (
    <div className="space-y-5">
      {days.map((date) => (
        <DayList
          key={date}
          date={date}
          entries={byDate.get(date) ?? []}
          onSelect={setSelected}
        />
      ))}
    </div>
  );

  return (
    <>
      {mode === "list" ? (
        listView
      ) : (
        <>
          {/* Wide: the pitch-by-hour grid, one block per day that has anything. */}
          <div className="hidden space-y-4 md:block">
            {pager}
            {days.map((date) => {
              const dayEntries = byDate.get(date) ?? [];
              if (dayEntries.length === 0 && !canBook) {
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
                  pitches={visiblePitches}
                  entries={dayEntries}
                  canBook={canBook}
                  onSelect={setSelected}
                />
              );
            })}
          </div>

          {/* Narrow: pitch navigator + the same days as grids one pitch wide. */}
          <div className="space-y-4 md:hidden">
            {pager}
            {canBook ? (
              days.map((date) => (
                <DayGrid
                  key={date}
                  date={date}
                  pitches={visiblePitches}
                  entries={(byDate.get(date) ?? []).filter((entry) =>
                    visiblePitches.some((pitch) => pitch.id === entry.resourceId),
                  )}
                  canBook={canBook}
                  onSelect={setSelected}
                />
              ))
            ) : (
              listView
            )}
          </div>
        </>
      )}

      {entries.length === 0 && (
        <p className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
          <CalendarX2 className="h-4 w-4" /> Nothing on these pitches in this view.
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
