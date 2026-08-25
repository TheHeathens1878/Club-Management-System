"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Columns, ChevronDown, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { deleteBooking, deleteBookings, deleteBookingsByGroup } from "./actions";
import { BookingsExportButtons } from "./bookings-export";
import { formatBookingDateShort } from "@/lib/booking-time";
import type { BookingKind, BookingListItem } from "@/lib/booking-types";

type ColKey = "room" | "time" | "booker" | "email" | "mobile" | "occasion" | "guests" | "amount";

const TOGGLE_COLS: { key: ColKey; label: string }[] = [
  { key: "room", label: "Room" },
  { key: "time", label: "Time" },
  { key: "booker", label: "Booker" },
  { key: "email", label: "Email" },
  { key: "mobile", label: "Mobile" },
  { key: "occasion", label: "Occasion" },
  { key: "guests", label: "No. people" },
  { key: "amount", label: "Amount" },
];

const DEFAULT_VISIBLE: ColKey[] = ["room", "time", "booker", "mobile", "occasion", "guests", "amount"];
const STORAGE_KEY = "rb-col-vis-v2";

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
}: {
  bookings: BookingListItem[];
  roomName: Record<string, string>;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState<ColKey[]>(DEFAULT_VISIBLE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const show = (k: ColKey) => visible.includes(k);

  const allSelected = bookings.length > 0 && bookings.every((b) => selected.has(b.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(bookings.map((b) => b.id)));
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Distinct recurrence group IDs across the selection
  const selectedGroupIds = [...new Set(
    Array.from(selected)
      .map((id) => bookings.find((b) => b.id === id)?.recurrence_group_id)
      .filter((g): g is string => !!g)
  )];

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} booking${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    const res = await deleteBookings(ids);
    setDeleting(false);
    if (res?.error) { setError(res.error); return; }
    setSelected(new Set());
    router.refresh();
  }

  async function handleDeleteSeries() {
    if (!selectedGroupIds.length) return;
    const seriesCount = selectedGroupIds.length;
    if (!confirm(`Delete ALL bookings in ${seriesCount === 1 ? "this series" : `these ${seriesCount} series`} (including past and future occurrences)? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    for (const groupId of selectedGroupIds) {
      const res = await deleteBookingsByGroup(groupId);
      if (res?.error) { setError(res.error); setDeleting(false); return; }
    }
    setDeleting(false);
    setSelected(new Set());
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

  const someSelected = selected.size > 0;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {canDelete && someSelected && (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={handleDeleteSelected}
                className="min-h-[44px] lg:min-h-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selected.size} selected
              </Button>
              {selectedGroupIds.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={handleDeleteSeries}
                  className="min-h-[44px] lg:min-h-0"
                >
                  <Repeat className="h-3.5 w-3.5" />
                  Delete whole series
                </Button>
              )}
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto">
          <BookingsExportButtons bookings={bookings} roomName={roomName} visibleCols={visible} />

          {/* Column picker — governs the table columns on lg+ and the export
              column set everywhere. */}
          <div className="relative" ref={pickerRef}>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen((v) => !v)} className="min-h-[44px] lg:min-h-0">
              <Columns className="h-3.5 w-3.5" /> Columns <ChevronDown className="h-3 w-3 ml-0.5 opacity-60" />
            </Button>
            {pickerOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border bg-popover shadow-lg">
                <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase text-muted-foreground tracking-wide">
                  Toggle columns
                </p>
                {TOGGLE_COLS.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
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
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
          No bookings match the current filters.
        </div>
      ) : (
        <>
        {/* Phone: one card per booking — the row's fields as title, muted
            second line and a right-aligned status pill. */}
        <div className="space-y-2 lg:hidden">
          {bookings.map((b) => {
            const detail = [
              b.occasion,
              b.estimated_guests === null ? null : `${b.estimated_guests} guests`,
              b.total_pence ? formatCurrency(b.total_pence) : null,
            ].filter(Boolean).join(" · ");
            return (
              <div
                key={b.id}
                className={`flex items-start gap-2 rounded-xl border bg-card p-3 ${selected.has(b.id) ? "border-primary/40 bg-primary/5" : ""}`}
              >
                {canDelete && (
                  <label className="flex min-h-[44px] shrink-0 items-center pr-1">
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleRow(b.id)}
                      aria-label={`Select booking for ${b.booker_name}`}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                )}
                <Link href={`/room-bookings/${b.id}`} className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      {formatBookingDateShort(b.date)}
                      {b.recurrence_group_id && (
                        <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Repeating booking" />
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={statusVariant(b.status, b.kind)} className="capitalize">
                        {b.kind === "block" ? "Blocked" : b.status}
                      </Badge>
                      {b.kind !== "block" && b.payment_status === "paid" && (
                        <Badge variant="success" className="text-[10px]">Paid</Badge>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {roomName[b.resource_id] ?? "—"} · {b.start_time}–{b.end_time}
                  </p>
                  <p className="mt-1 truncate text-sm">{b.booker_name}</p>
                  {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
                </Link>
                {canDelete && (
                  <button
                    onClick={() => handleDeleteOne(b.id)}
                    disabled={deleting}
                    title="Delete booking"
                    className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden rounded-lg border overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                {canDelete && (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Date</th>
                {show("room") && <th className="px-4 py-3">Room</th>}
                {show("time") && <th className="px-4 py-3">Time</th>}
                {show("booker") && <th className="px-4 py-3">Booker</th>}
                {show("email") && <th className="px-4 py-3 hidden md:table-cell">Email</th>}
                {show("mobile") && <th className="px-4 py-3 hidden md:table-cell">Mobile</th>}
                {show("occasion") && <th className="px-4 py-3 hidden md:table-cell">Occasion</th>}
                {show("guests") && <th className="px-4 py-3 hidden lg:table-cell text-right">Guests</th>}
                {show("amount") && <th className="px-4 py-3 hidden lg:table-cell text-right">Amount</th>}
                <th className="px-4 py-3">Status</th>
                {canDelete && <th className="px-2 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y bg-background">
              {bookings.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => router.push(`/room-bookings/${b.id}`)}
                  className={`hover:bg-muted/30 transition-colors cursor-pointer ${selected.has(b.id) ? "bg-primary/5" : ""}`}
                >
                  {canDelete && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={() => toggleRow(b.id)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap font-medium" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <Link href={`/room-bookings/${b.id}`} className="hover:underline text-primary">
                        {formatBookingDateShort(b.date)}
                      </Link>
                      {b.recurrence_group_id && (
                        <Repeat className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Repeating booking" />
                      )}
                    </div>
                  </td>
                  {show("room") && (
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {roomName[b.resource_id] ?? "—"}
                    </td>
                  )}
                  {show("time") && (
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                      {b.start_time}–{b.end_time}
                    </td>
                  )}
                  {show("booker") && (
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[140px]">{b.booker_name}</p>
                    </td>
                  )}
                  {show("email") && (
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs truncate max-w-[160px]">
                      {b.booker_email}
                    </td>
                  )}
                  {show("mobile") && (
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs whitespace-nowrap">
                      {b.booker_phone ?? "—"}
                    </td>
                  )}
                  {show("occasion") && (
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground truncate max-w-[140px]">
                      {b.occasion ?? "—"}
                    </td>
                  )}
                  {show("guests") && (
                    <td className="px-4 py-3 hidden lg:table-cell text-right tabular-nums text-muted-foreground">
                      {b.estimated_guests ?? "—"}
                    </td>
                  )}
                  {show("amount") && (
                    <td className="px-4 py-3 hidden lg:table-cell text-right tabular-nums">
                      {b.total_pence ? formatCurrency(b.total_pence) : "—"}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge
                        variant={statusVariant(b.status, b.kind)}
                        className="w-fit capitalize"
                      >
                        {b.kind === "block" ? "Blocked" : b.status}
                      </Badge>
                      {b.kind !== "block" && b.payment_status === "paid" && (
                        <Badge variant="success" className="w-fit text-[10px]">Paid</Badge>
                      )}
                    </div>
                  </td>
                  {canDelete && (
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDeleteOne(b.id)}
                        disabled={deleting}
                        title="Delete booking"
                        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
