"use client";

/**
 * The matches desk's table (Adam, 2026-09-03: "there should be filters on
 * each of the columns and the ability to export all to a pdf / csv. Rather
 * than a separate manage fixtures tab, we should have the ability to tick by
 * the fixture to amend, cancel or delete it").
 *
 * One component, three jobs:
 *
 *   · FILTERS — one per column, applied client-side over the rows the server
 *     already scoped to the caller (the RPC answers for what they may see;
 *     these only narrow it). The chips above the table keep windowing time.
 *   · EXPORT — CSV and PDF of exactly what the filters show, built in the
 *     browser from the same rows. jspdf ships with the app already (match
 *     sheets); it is loaded on demand so the desk itself stays light.
 *   · TICKS — a checkbox by each fixture instead of the separate "Manage
 *     these matches" drawer. The bar that appears drives the SAME three
 *     server actions as before (`bulkSetKickoffTime`, `bulkCancelFixtures`,
 *     `bulkDeleteFixtures`) — admin-checked server-side, delete armed only by
 *     typing the ticked count back, exactly the safety the drawer had.
 *
 * NOTHING HERE IS A PERMISSION. `canManage` mirrors what the server actions
 * will re-check; filters and export are for everyone the desk answers to.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  bulkAllocatePitch,
  bulkCancelFixtures,
  bulkDeleteFixtures,
  bulkSetKickoffTime,
  type MatchAdminState,
} from "./fixture-admin-actions";

export type DeskRow = {
  id: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  opponent: string;
  isHome: boolean;
  competition: string;
  status: string;
  /** "Sat 6 Sep" / "10:30" — London wall clock, formatted by the server. */
  date: string;
  time: string;
  /** "2026-09-06", for the date-range filter. */
  dateIso: string;
  /** "Banky Lane 1" | "Unallocated" | "Away" — or the central venue's name. */
  pitch: string;
  /** Booking exists — or the team plays at a central venue, which is just as settled. */
  allocated: boolean;
  /** The ground: "Ashton Park" | "Unallocated" | "Away" | a central venue. */
  venue: string;
  venueText: string | null;
  accepted: number;
  declined: number;
  squad: number;
};

const EMPTY: MatchAdminState = {};

type Filters = {
  from: string;
  to: string;
  team: string;
  opponent: string;
  homeAway: "all" | "home" | "away";
  competition: string;
  venue: string;
  pitch: string;
  status: string;
  replies: "all" | "short" | "quiet";
};

const NO_FILTERS: Filters = {
  from: "",
  to: "",
  team: "",
  opponent: "",
  homeAway: "all",
  competition: "",
  venue: "",
  pitch: "",
  status: "",
  replies: "all",
};

function shortOfReplies(row: DeskRow): boolean {
  return row.squad > 0 && row.accepted * 2 < row.squad;
}

function applyFilters(rows: DeskRow[], f: Filters): DeskRow[] {
  const opponent = f.opponent.trim().toLowerCase();
  return rows.filter((row) => {
    if (f.from && row.dateIso < f.from) return false;
    if (f.to && row.dateIso > f.to) return false;
    if (f.team && row.teamName !== f.team) return false;
    if (opponent && !row.opponent.toLowerCase().includes(opponent)) return false;
    if (f.homeAway === "home" && !row.isHome) return false;
    if (f.homeAway === "away" && row.isHome) return false;
    if (f.competition && row.competition !== f.competition) return false;
    if (f.venue && row.venue !== f.venue) return false;
    if (f.pitch && row.pitch !== f.pitch) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.replies === "short" && !shortOfReplies(row)) return false;
    if (f.replies === "quiet" && row.accepted + row.declined > 0) return false;
    return true;
  });
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en-GB"));
}

// ---------------------------------------------------------------------------
// Export — of what the filters show, never more.

const EXPORT_HEAD = [
  "Date",
  "Time",
  "Team",
  "Opponent",
  "H/A",
  "Competition",
  "Venue",
  "Pitch / venue",
  "Status",
  "In",
  "Out",
  "Squad",
];

function exportLine(row: DeskRow): string[] {
  return [
    row.date,
    row.time,
    row.teamName,
    row.opponent,
    row.isHome ? "H" : "A",
    row.competition,
    row.venue,
    row.isHome ? row.pitch : row.venueText || "Away",
    row.status,
    String(row.accepted),
    String(row.declined),
    String(row.squad),
  ];
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function exportCsv(rows: DeskRow[]): void {
  const lines = [EXPORT_HEAD, ...rows.map(exportLine)]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
  // The BOM is what makes Excel read the commas and the accents correctly.
  saveBlob(
    new Blob(["﻿", lines, "\r\n"], { type: "text/csv;charset=utf-8" }),
    `matches-${stamp()}.csv`,
  );
}

async function exportPdf(rows: DeskRow[]): Promise<void> {
  const [{ jsPDF }, autoTable] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable").then((m) => m.default),
  ]);
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(13);
  doc.text("Matches — AoM Sports Club", 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${rows.length} match${rows.length === 1 ? "" : "es"} · exported ${stamp()}`, 14, 20);
  autoTable(doc, {
    head: [EXPORT_HEAD],
    body: rows.map(exportLine),
    startY: 24,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [20, 16, 14] },
  });
  doc.save(`matches-${stamp()}.pdf`);
}

// ---------------------------------------------------------------------------

export function MatchesDesk({
  rows,
  canManage,
  pitches,
  focusFirst,
}: {
  rows: DeskRow[];
  /** Ticks and the action bar — the server actions re-check club admin. */
  canManage: boolean;
  /** Active pitches for the action bar's "Allocate pitch"; empty hides it. */
  pitches: { id: string; name: string }[];
  /** Accent the first row as "next up" (not on Results). */
  focusFirst: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmCount, setConfirmCount] = useState("");

  const [timeState, timeAction, settingTime] = useActionState(bulkSetKickoffTime, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState(bulkCancelFixtures, EMPTY);
  const [deleteState, deleteAction, deleting] = useActionState(bulkDeleteFixtures, EMPTY);
  const [allocState, allocAction, allocating] = useActionState(bulkAllocatePitch, EMPTY);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const filtering = filters !== NO_FILTERS && filtered.length !== rows.length;

  const teamOptions = useMemo(() => distinct(rows.map((r) => r.teamName)), [rows]);
  const competitionOptions = useMemo(() => distinct(rows.map((r) => r.competition)), [rows]);
  const venueOptions = useMemo(() => distinct(rows.map((r) => r.venue)), [rows]);
  const pitchOptions = useMemo(() => distinct(rows.map((r) => r.pitch)), [rows]);
  const statusOptions = useMemo(() => distinct(rows.map((r) => r.status)), [rows]);

  const chosen = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const armed = confirmCount.trim() === String(chosen.length) && chosen.length > 0;
  const busy = settingTime || cancelling || deleting || allocating;

  // A finished action means the rows on screen are stale: refetch them, and
  // put the ticks down — the work they described is done.
  const doneStamp = [timeState.notice, cancelState.notice, deleteState.notice, allocState.notice]
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (doneStamp === "") return;
    setSelected(new Set());
    setConfirmCount("");
    router.refresh();
  }, [doneStamp, router]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmCount("");
  }

  function toggleAllFiltered() {
    setSelected((current) => {
      const everyFiltered = filtered.length > 0 && filtered.every((row) => current.has(row.id));
      const next = new Set(current);
      if (everyFiltered) for (const row of filtered) next.delete(row.id);
      else for (const row of filtered) next.add(row.id);
      return next;
    });
    setConfirmCount("");
  }

  const hiddenIds = chosen.map((row) => (
    <input key={row.id} type="hidden" name="fixture_id" value={row.id} />
  ));

  const filterSelect = (
    value: string,
    onChange: (value: string) => void,
    options: string[],
    allLabel: string,
    label: string,
  ) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="h-8 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );

  const messages = (
    <>
      {[timeState, cancelState, deleteState, allocState].map((state, index) =>
        state.error ? (
          <p key={index} className="text-sm text-destructive">
            {state.error}
          </p>
        ) : state.notice ? (
          <p key={index} className="text-sm text-emerald-700">
            {state.notice}
          </p>
        ) : null,
      )}
      {[timeState, cancelState, deleteState, allocState].flatMap((state, index) =>
        (state.warnings ?? []).map((warning, i) => (
          <p key={`${index}-${i}`} className="text-sm text-amber-700">
            {warning}
          </p>
        )),
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ export + tally */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {filtering
            ? `${filtered.length} of ${rows.length} matches shown`
            : `${rows.length} match${rows.length === 1 ? "" : "es"}`}
        </p>
        {filtering ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={filtered.length === 0}
            onClick={() => exportCsv(filtered)}
          >
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={filtered.length === 0}
            onClick={() => void exportPdf(filtered)}
          >
            Export PDF
          </Button>
        </span>
      </div>

      {/* --------------------------------------------------- action bar */}
      {canManage && chosen.length > 0 && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-3">
          <p className="text-sm font-medium">
            {chosen.length} ticked
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              the ticks survive filtering — this acts on every ticked match
            </span>
          </p>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            {pitches.length > 0 && (
              <form action={allocAction} className="flex flex-wrap items-end gap-2">
                {hiddenIds}
                <label className="space-y-1 text-xs text-muted-foreground">
                  Pitch
                  {/* min-w-0: WebKit will not shrink a select below its longest
                      option without it, and pitch names run long. */}
                  <select
                    name="resource_id"
                    required
                    defaultValue=""
                    aria-label="Pitch to allocate"
                    className="block h-9 w-full min-w-0 max-w-60 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="" disabled>
                      Choose a pitch…
                    </option>
                    {pitches.map((pitch) => (
                      <option key={pitch.id} value={pitch.id}>
                        {pitch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  KO (optional)
                  <Input name="kickoff_time" type="time" className="block h-9 w-28" />
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={busy}>
                  {allocating ? "Allocating…" : "Allocate pitch"}
                </Button>
              </form>
            )}

            <form action={timeAction} className="flex items-end gap-2">
              {hiddenIds}
              <label className="space-y-1 text-xs text-muted-foreground">
                New kick-off time
                <Input name="kickoff_time" type="time" required className="block h-9 w-28" />
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                {settingTime ? "Moving…" : "Set kick-off"}
              </Button>
            </form>

            <form action={cancelAction}>
              {hiddenIds}
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                {cancelling ? "Cancelling…" : "Cancel matches"}
              </Button>
            </form>

            <form action={deleteAction} className="flex items-end gap-2">
              {hiddenIds}
              <label className="space-y-1 text-xs text-muted-foreground">
                Type {chosen.length} to arm delete
                <Input
                  value={confirmCount}
                  onChange={(event) => setConfirmCount(event.target.value)}
                  inputMode="numeric"
                  className="block h-9 w-24"
                />
              </label>
              <Button type="submit" size="sm" variant="destructive" disabled={busy || !armed}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </form>
          </div>
          <p className="text-xs text-muted-foreground">
            Allocating books (or moves) each ticked home match onto the chosen pitch with the same
            clash check as any hire — a blank KO keeps each match&apos;s own time. Cancelling frees
            each match&apos;s pitch and keeps the record; deleting removes the match, its diary
            event and everyone&apos;s answers, and gives the pitch back first.
          </p>
          {messages}
        </div>
      )}
      {canManage && chosen.length === 0 ? messages : null}

      {/* -------------------------------------------------- phone cards */}
      <div className="space-y-3 lg:hidden">
        <details className="rounded-xl border bg-card">
          <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Filter{filtering ? ` · showing ${filtered.length}` : ""}
          </summary>
          <div className="grid grid-cols-2 gap-2 border-t p-3">
            <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" className="h-9" />
            <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" className="h-9" />
            {filterSelect(filters.team, (v) => set("team", v), teamOptions, "All teams", "Team")}
            <select
              value={filters.homeAway}
              onChange={(e) => set("homeAway", e.target.value as Filters["homeAway"])}
              aria-label="Home or away"
              className="h-9 w-full rounded-md border bg-background px-1.5 text-xs"
            >
              <option value="all">Home &amp; away</option>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
            {filterSelect(filters.venue, (v) => set("venue", v), venueOptions, "All venues", "Venue")}
            {filterSelect(filters.pitch, (v) => set("pitch", v), pitchOptions, "All pitches", "Pitch")}
            <Input
              value={filters.opponent}
              onChange={(e) => set("opponent", e.target.value)}
              placeholder="Opponent contains…"
              className="col-span-2 h-9"
            />
          </div>
        </details>

        {filtered.map((row, index) => {
          const focus = focusFirst && !filtering && index === 0;
          return (
            <div
              key={row.id}
              className={
                "relative rounded-xl border bg-card p-4 " + (focus ? "border-primary/40" : "")
              }
            >
              {canManage && (
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  aria-label={`Tick ${row.teamName} v ${row.opponent}`}
                  className="absolute right-4 top-4 h-5 w-5"
                />
              )}
              <Link
                href={row.eventId ? `/events/${row.eventId}` : `/teams/${row.teamId}`}
                className="block"
              >
                <p
                  className={
                    "font-display text-[9px] font-medium uppercase tracking-[0.16em] " +
                    (focus ? "text-primary" : "text-muted-foreground")
                  }
                >
                  {focus ? "Next up · " : ""}
                  {row.date} · {row.time}
                </p>
                <p className="mt-2 pr-8 text-[15px] font-semibold leading-tight">
                  {row.teamName} v {row.opponent}
                </p>
                <p className="mt-1 text-[12.5px] leading-tight text-muted-foreground">
                  {row.isHome ? "Home" : `Away${row.venueText ? ` · ${row.venueText}` : ""}`}
                  {" · "}
                  {row.competition}
                  {row.status !== "scheduled" ? ` · ${row.status}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {!row.isHome ? (
                    <Badge variant="muted">Away</Badge>
                  ) : (
                    <Badge variant={row.allocated ? "outline" : "warning"}>{row.pitch}</Badge>
                  )}
                  <Badge
                    variant={
                      shortOfReplies(row) ? "destructive" : row.accepted > 0 ? "success" : "muted"
                    }
                  >
                    {row.accepted} of {row.squad} in
                  </Badge>
                  {row.declined > 0 ? <Badge variant="muted">{row.declined} out</Badge> : null}
                </div>
              </Link>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No matches fit those filters.
          </p>
        )}
      </div>

      {/* ------------------------------------------------ desktop table */}
      <div className="hidden rounded-xl border bg-card lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {canManage && (
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((row) => selected.has(row.id))}
                      onChange={toggleAllFiltered}
                      aria-label="Tick every match shown"
                      className="h-4 w-4"
                    />
                  </th>
                )}
                <th className="px-4 py-2 font-medium">Kick-off</th>
                <th className="px-4 py-2 font-medium">Fixture</th>
                <th className="px-4 py-2 font-medium">Competition</th>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium">Pitch</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Replies</th>
              </tr>
              {/* One filter per column (Adam). The tick column's is above. */}
              <tr className="border-b bg-secondary/20">
                {canManage && <td className="px-3 py-2" />}
                <td className="px-4 py-2">
                  <span className="flex gap-1">
                    <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" className="h-8 w-[8.5rem] px-1.5 text-xs" />
                    <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" className="h-8 w-[8.5rem] px-1.5 text-xs" />
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="flex gap-1">
                    {filterSelect(filters.team, (v) => set("team", v), teamOptions, "All teams", "Team")}
                    <Input
                      value={filters.opponent}
                      onChange={(e) => set("opponent", e.target.value)}
                      placeholder="Opponent…"
                      aria-label="Opponent contains"
                      className="h-8 min-w-24 px-1.5 text-xs"
                    />
                    <select
                      value={filters.homeAway}
                      onChange={(e) => set("homeAway", e.target.value as Filters["homeAway"])}
                      aria-label="Home or away"
                      className="h-8 rounded-md border bg-background px-1.5 text-xs"
                    >
                      <option value="all">H &amp; A</option>
                      <option value="home">Home</option>
                      <option value="away">Away</option>
                    </select>
                  </span>
                </td>
                <td className="px-4 py-2">
                  {filterSelect(filters.competition, (v) => set("competition", v), competitionOptions, "All", "Competition")}
                </td>
                {/* The ground and the pitch on it are separate columns (Adam,
                    2026-09-04: "filter by venue … not just pitch", then
                    "Venue needs to be a column"). */}
                <td className="px-4 py-2">
                  {filterSelect(filters.venue, (v) => set("venue", v), venueOptions, "All", "Venue")}
                </td>
                <td className="px-4 py-2">
                  {filterSelect(filters.pitch, (v) => set("pitch", v), pitchOptions, "All", "Pitch")}
                </td>
                <td className="px-4 py-2">
                  {filterSelect(filters.status, (v) => set("status", v), statusOptions, "All", "Status")}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={filters.replies}
                    onChange={(e) => set("replies", e.target.value as Filters["replies"])}
                    aria-label="Replies"
                    className="h-8 w-full rounded-md border bg-background px-1.5 text-xs"
                  >
                    <option value="all">All</option>
                    <option value="short">Short of replies</option>
                    <option value="quiet">No answers yet</option>
                  </select>
                </td>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const short = shortOfReplies(row);
                return (
                  <tr key={row.id} className="border-b last:border-b-0 hover:bg-secondary/40">
                    {canManage && (
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Tick ${row.teamName} v ${row.opponent}`}
                          className="h-4 w-4"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      <span className="font-semibold">{row.date}</span>
                      <br />
                      {row.time}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={row.eventId ? `/events/${row.eventId}` : `/teams/${row.teamId}`}
                        className="font-semibold hover:underline"
                      >
                        {row.teamName} v {row.opponent}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {row.isHome ? "Home" : `Away${row.venueText ? ` · ${row.venueText}` : ""}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">{row.competition}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={row.venue === "Unallocated" ? "text-amber-700" : row.venue === "Away" ? "text-muted-foreground" : ""}>
                        {row.venue}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {!row.isHome ? (
                        <span className="text-muted-foreground">Away</span>
                      ) : (
                        <span className={row.allocated ? "" : "text-amber-700"}>{row.pitch}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {row.status === "scheduled" ? (
                        <span className="text-muted-foreground">scheduled</span>
                      ) : (
                        <Badge variant={row.status === "cancelled" ? "muted" : "outline"}>
                          {row.status}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={short ? "destructive" : row.accepted > 0 ? "success" : "muted"}>
                        {row.accepted} of {row.squad}
                      </Badge>
                      {row.declined > 0 ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.declined} out
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={canManage ? 8 : 7}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No matches fit those filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
