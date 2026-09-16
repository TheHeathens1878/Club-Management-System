"use client";

/**
 * The desk as a list (P8.2).
 *
 * Everything that used to be written twice here — a `<table>` for a desk and a
 * stack of cards for a phone, each with its own tick column, its own empty
 * state and its own idea of what a row says — is now `DataListFrame`, which
 * owns the chrome and is handed the cells. What is left in this file is the
 * three things the frame does not know about bookings: what a row says, what
 * the bulk bar does to the ticked ones, and which columns the desk has chosen
 * to see.
 *
 * A row opens the SAME sheet the calendar opens, on the same door, so the desk
 * never has to leave the list to answer an enquiry. The date is still a link
 * to the full record, because a booking's notes, its email log and its clashes
 * live there and a middle-click should still open them in a tab.
 *
 * The ticks are a Select mode, as on the fixture desk: `canDelete` is the
 * super user (delete outright) and `canDecline` the committee (decline a block
 * booking and give its dates back), exactly the two gates this screen has
 * always applied — and every server action re-checks them for itself.
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Trash2, Columns, ChevronDown, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChipStrip } from "@/components/ui/chip-strip";
import { DataListFrame, type DataColumn, type DataItem } from "@/components/ui/data-list";
import { TD } from "@/components/ui/table";
import { ToggleChipLink } from "@/components/ui/toggle-chip";
import { formatCurrency } from "@/lib/utils";
import {
  declineAndDeleteSeries,
  deleteBooking,
  deleteBookings,
  deleteBookingsByGroup,
} from "./actions";
import { BookingsExportButtons } from "./bookings-export";
import { formatBookingDateShort } from "@/lib/booking-time";
import type { BookingKind, BookingListItem } from "@/lib/booking-types";

export type ColKey = "room" | "time" | "booker" | "email" | "mobile" | "occasion" | "guests" | "amount";

export const TOGGLE_COLS: { key: ColKey; label: string }[] = [
  { key: "room", label: "Room" },
  { key: "time", label: "Time" },
  { key: "booker", label: "Booker" },
  { key: "email", label: "Email" },
  { key: "mobile", label: "Mobile" },
  { key: "occasion", label: "Occasion" },
  { key: "guests", label: "No. people" },
  { key: "amount", label: "Amount" },
];

export const DEFAULT_VISIBLE: ColKey[] = ["room", "time", "booker", "mobile", "occasion", "guests", "amount"];
export const COLUMN_STORAGE_KEY = "rb-col-vis-v2";

/** One strip of URL filters — the period, the status or the room. */
export type ChipGroup = {
  key: string;
  label: string;
  options: { key: string; href: string; label: string; count?: number; active: boolean }[];
};

function statusVariant(status: string, kind: BookingKind): "success" | "muted" | "destructive" | "warning" | "default" {
  if (kind === "block") return "warning";
  if (status === "confirmed") return "success";
  if (status === "cancelled") return "destructive";
  return "default";
}

export function BookingsTable({
  bookings,
  roomName,
  canDelete,
  canDecline,
  onOpen,
  chipGroups = [],
  initialQuery = "",
}: {
  bookings: BookingListItem[];
  roomName: Record<string, string>;
  canDelete: boolean;
  /** Committee and above: decline a block booking and clear its dates. */
  canDecline: boolean;
  /** A press on a row. Without one the row is a link to the record page. */
  onOpen?: (booking: BookingListItem) => void;
  /** The page's `?status=&room=&period=` filters, as chips above the list. */
  chipGroups?: ChipGroup[];
  /** What `?q=` held when the page was drawn. */
  initialQuery?: string;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState<ColKey[]>(DEFAULT_VISIBLE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (stored) setVisible(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    if (pickerOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  function toggleCol(key: ColKey) {
    setVisible((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const show = (k: ColKey) => visible.includes(k);

  /** The recurrence groups the ticked rows belong to. */
  function groupsIn(keys: string[]): string[] {
    return [...new Set(
      keys
        .map((id) => bookings.find((b) => b.id === id)?.recurrence_group_id)
        .filter((g): g is string => !!g)
    )];
  }

  async function handleDeleteSelected(keys: string[], clear: () => void) {
    if (!keys.length) return;
    if (!confirm(`Permanently delete ${keys.length} booking${keys.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    const res = await deleteBookings(keys);
    setDeleting(false);
    if (res?.error) { setError(res.error); return; }
    clear();
    router.refresh();
  }

  async function handleDeleteSeries(keys: string[], clear: () => void) {
    const groupIds = groupsIn(keys);
    if (!groupIds.length) return;
    const seriesCount = groupIds.length;
    if (!confirm(`Delete ALL bookings in ${seriesCount === 1 ? "this series" : `these ${seriesCount} series`} (including past and future occurrences)? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    for (const groupId of groupIds) {
      const res = await deleteBookingsByGroup(groupId);
      if (res?.error) { setError(res.error); setDeleting(false); return; }
    }
    setDeleting(false);
    clear();
    router.refresh();
  }

  // Adam, 2026-08-26: "Admins need the ability to decline and delete block
  // bookings in one go." One decision — the club says no and the dates go back
  // on the market — instead of cancelling twenty rows and then deleting them.
  async function handleDeclineSeries(keys: string[], clear: () => void) {
    const groupIds = groupsIn(keys);
    if (!groupIds.length) return;
    const rowsInSeries = bookings.filter(
      (b) => b.recurrence_group_id && groupIds.includes(b.recurrence_group_id),
    ).length;
    const reason = prompt(
      `Decline ${groupIds.length === 1 ? "this block booking" : `these ${groupIds.length} block bookings`} and remove ${rowsInSeries} date${rowsInSeries === 1 ? "" : "s"} from the diary?\n\nSay why — it goes in the record, and it is the only trace left that the club was asked.`,
      "",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Give a reason — it is the only thing left in the record afterwards.");
      return;
    }
    setDeleting(true);
    setError(null);
    for (const groupId of groupIds) {
      const res = await declineAndDeleteSeries(groupId, reason);
      if (res?.error) {
        setError(res.error);
        setDeleting(false);
        return;
      }
    }
    setDeleting(false);
    clear();
    router.refresh();
  }

  async function handleDeleteOne(id: string) {
    if (!confirm("Permanently delete this booking? This cannot be undone.")) return;
    setDeleting(true);
    setError(null);
    const res = await deleteBooking(id);
    setDeleting(false);
    if (res?.error) { setError(res.error); return; }
    router.refresh();
  }

  // The columns the desk has chosen, in the order the table draws them. Date
  // and status are always there: they are what a booking IS.
  const columns: DataColumn[] = [
    { key: "date", label: "Date", weight: 1.2 },
    ...(show("room") ? [{ key: "room", label: "Room", weight: 1 }] : []),
    ...(show("time") ? [{ key: "time", label: "Time", weight: 1 }] : []),
    ...(show("booker") ? [{ key: "booker", label: "Booker", weight: 1.4 }] : []),
    ...(show("email") ? [{ key: "email", label: "Email", weight: 1.6 }] : []),
    ...(show("mobile") ? [{ key: "mobile", label: "Mobile", weight: 1.1 }] : []),
    ...(show("occasion") ? [{ key: "occasion", label: "Occasion", weight: 1.2 }] : []),
    ...(show("guests") ? [{ key: "guests", label: "Guests", weight: 0.7, align: "right" as const }] : []),
    ...(show("amount") ? [{ key: "amount", label: "Amount", weight: 0.9, align: "right" as const }] : []),
    { key: "status", label: "Status", weight: 1 },
    ...(canDelete ? [{ key: "remove", label: "", weight: 0.4 }] : []),
  ];

  /** A cell that opens the booking, which is what a press anywhere on a row does. */
  const openCell = (b: BookingListItem, className: string, children: ReactNode) =>
    onOpen ? (
      <TD className={`${className} cursor-pointer`} onClick={() => onOpen(b)}>
        {children}
      </TD>
    ) : (
      <TD className={className}>{children}</TD>
    );

  function statusPills(b: BookingListItem, wide = false) {
    return (
      <>
        <Badge variant={statusVariant(b.status, b.kind)} className={wide ? "w-fit capitalize" : "capitalize"}>
          {b.kind === "block" ? "Blocked" : b.status}
        </Badge>
        {b.kind !== "block" && b.payment_status === "paid" && (
          <Badge variant="success" className={wide ? "w-fit text-2xs" : "text-2xs"}>Paid</Badge>
        )}
      </>
    );
  }

  const items: DataItem[] = bookings.map((b) => {
    const room = roomName[b.resource_id] ?? "—";
    const detail = [
      b.occasion,
      b.estimated_guests === null ? null : `${b.estimated_guests} guests`,
      b.total_pence ? formatCurrency(b.total_pence) : null,
    ].filter(Boolean).join(" · ");

    return {
      key: b.id,
      haystack: [b.booker_name, b.booker_email, b.booker_phone, b.occasion, room, b.date, b.status]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("en-GB"),
      cells: (
        <>
          <TD className="whitespace-nowrap font-medium">
            <span className="flex items-center gap-1.5">
              {/* Still a link: the record page holds the notes, the emails and
                  the clash, and a middle-click should reach them. */}
              <Link href={`/room-bookings/${b.id}`} className="text-primary hover:underline">
                {formatBookingDateShort(b.date)}
              </Link>
              {b.recurrence_group_id && (
                <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Repeating booking" />
              )}
            </span>
          </TD>
          {show("room") && openCell(b, "whitespace-nowrap text-muted-foreground", room)}
          {show("time") && openCell(b, "whitespace-nowrap tabular-nums text-muted-foreground", `${b.start_time}–${b.end_time}`)}
          {show("booker") && openCell(b, "", <span className="block truncate font-medium">{b.booker_name}</span>)}
          {show("email") && openCell(b, "truncate text-xs text-muted-foreground", b.booker_email)}
          {show("mobile") && openCell(b, "whitespace-nowrap text-xs text-muted-foreground", b.booker_phone ?? "—")}
          {show("occasion") && openCell(b, "truncate text-muted-foreground", b.occasion ?? "—")}
          {show("guests") && openCell(b, "text-right tabular-nums text-muted-foreground", b.estimated_guests ?? "—")}
          {show("amount") && openCell(b, "text-right tabular-nums", b.total_pence ? formatCurrency(b.total_pence) : "—")}
          {openCell(b, "", <span className="flex flex-col gap-1">{statusPills(b, true)}</span>)}
          {canDelete && (
            <TD className="px-2">
              <button
                type="button"
                onClick={() => handleDeleteOne(b.id)}
                disabled={deleting}
                title="Delete booking"
                aria-label={`Delete the booking for ${b.booker_name}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TD>
          )}
        </>
      ),
      card: (
        <span className="flex items-start gap-2 p-3">
          <button
            type="button"
            onClick={onOpen ? () => onOpen(b) : undefined}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                {formatBookingDateShort(b.date)}
                {b.recurrence_group_id && (
                  <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Repeating booking" />
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">{statusPills(b)}</span>
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
              {room} · {b.start_time}–{b.end_time}
            </span>
            <span className="mt-1 block truncate text-sm">{b.booker_name}</span>
            {detail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => handleDeleteOne(b.id)}
              disabled={deleting}
              title="Delete booking"
              aria-label={`Delete the booking for ${b.booker_name}`}
              className="touch flex w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </span>
      ),
    };
  });

  const canTick = canDelete || canDecline;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <DataListFrame
        items={items}
        columns={columns}
        search={{ param: "q", placeholder: "Search bookings", initial: initialQuery }}
        chips={
          chipGroups.length > 0 ? (
            <div className="space-y-1.5">
              {chipGroups.map((group) => (
                <ChipStrip key={group.key} aria-label={group.label}>
                  {group.options.map((option) => (
                    <ToggleChipLink
                      key={option.key}
                      href={option.href}
                      active={option.active}
                      count={option.count}
                      size="sm"
                    >
                      {option.label}
                    </ToggleChipLink>
                  ))}
                </ChipStrip>
              ))}
            </div>
          ) : undefined
        }
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <BookingsExportButtons bookings={bookings} roomName={roomName} visibleCols={visible} />

            {/* Column picker — governs the table columns on lg+ and the export
                column set everywhere. */}
            <div className="relative" ref={pickerRef}>
              <Button variant="outline" size="touch" onClick={() => setPickerOpen((v) => !v)}>
                <Columns className="h-3.5 w-3.5" aria-hidden /> Columns{" "}
                <ChevronDown className="ml-0.5 h-3 w-3 opacity-60" aria-hidden />
              </Button>
              {pickerOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border bg-popover shadow-lg">
                  <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Toggle columns
                  </p>
                  {TOGGLE_COLS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={visible.includes(key)}
                        onChange={() => toggleCol(key)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {label}
                    </label>
                  ))}
                  <div className="h-1.5" />
                </div>
              )}
            </div>
          </div>
        }
        select={
          canTick
            ? {
                label: "Tick this booking",
                bar: (keys, clear) => {
                  const groupIds = groupsIn(keys);
                  return (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        {keys.length} ticked — one press acts on all of them.
                      </span>
                      {canDecline && groupIds.length > 0 && (
                        <Button
                          variant="destructive"
                          size="touch"
                          disabled={deleting}
                          onClick={() => handleDeclineSeries(keys, clear)}
                        >
                          <Repeat className="h-3.5 w-3.5" aria-hidden />
                          Decline &amp; delete{" "}
                          {groupIds.length === 1 ? "block booking" : `${groupIds.length} block bookings`}
                        </Button>
                      )}
                      {canDelete && (
                        <>
                          <Button
                            variant="destructive"
                            size="touch"
                            disabled={deleting}
                            onClick={() => handleDeleteSelected(keys, clear)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Delete {keys.length} selected
                          </Button>
                          {groupIds.length > 0 && (
                            <Button
                              variant="destructive"
                              size="touch"
                              disabled={deleting}
                              onClick={() => handleDeleteSeries(keys, clear)}
                            >
                              <Repeat className="h-3.5 w-3.5" aria-hidden />
                              Delete whole series
                            </Button>
                          )}
                        </>
                      )}
                      <Button type="button" variant="ghost" size="touch" onClick={clear}>
                        Clear
                      </Button>
                    </div>
                  );
                },
              }
            : undefined
        }
        empty={{
          icon: <CalendarDays className="h-5 w-5" aria-hidden />,
          title: "No bookings on the desk yet",
          body: "Every hire the club takes shows up here — the public form fills it, or you can write one in.",
          action: { href: "/room-bookings/new", label: "New booking" },
        }}
        noMatch="No booking matches that search or those filters."
        footerNote={`${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
      />
    </div>
  );
}
