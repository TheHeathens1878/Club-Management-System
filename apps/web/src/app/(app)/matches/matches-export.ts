/**
 * The desk, taken away with you (Adam, 2026-09-03: "the ability to export all
 * to a pdf / csv"). Of exactly what the filters show, never more, and built
 * in the browser from the rows already on screen — no second query, so the
 * file cannot disagree with the grid.
 *
 * jspdf ships with the app already (match sheets); it is imported on demand so
 * the desk itself stays light.
 */

import type { DeskRow } from "./types";

export const EXPORT_HEAD = [
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

export function exportLine(row: DeskRow): string[] {
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

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportCsv(rows: DeskRow[]): void {
  const lines = [EXPORT_HEAD, ...rows.map(exportLine)]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
  // The BOM is what makes Excel read the commas and the accents correctly.
  saveBlob(new Blob(["﻿", lines, "\r\n"], { type: "text/csv;charset=utf-8" }), `matches-${stamp()}.csv`);
}

export async function exportPdf(rows: DeskRow[]): Promise<void> {
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
