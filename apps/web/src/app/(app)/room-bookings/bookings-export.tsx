"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { formatCurrency } from "@/lib/utils";
import { formatBookingDateNumeric } from "@/lib/booking-time";
import type { BookingListItem } from "@/lib/booking-types";

const ALL_COLS = ["Date", "Room", "Start", "End", "Booker", "Email", "Mobile", "Occasion", "Guests", "Type", "Status", "Amount"] as const;
type ColLabel = typeof ALL_COLS[number];

// Map from toggleable ColKey to export column label(s)
const COL_KEY_MAP: Record<string, ColLabel[]> = {
  room: ["Room"],
  time: ["Start", "End"],
  booker: ["Booker"],
  email: ["Email"],
  mobile: ["Mobile"],
  occasion: ["Occasion"],
  guests: ["Guests"],
  amount: ["Amount"],
};

function toRow(b: BookingListItem, roomName: Record<string, string>): Record<ColLabel, string> {
  return {
    Date: formatBookingDateNumeric(b.date),
    Room: roomName[b.resource_id] ?? "—",
    Start: b.start_time,
    End: b.end_time,
    Booker: b.booker_name,
    Email: b.booker_email,
    Mobile: b.booker_phone ?? "—",
    Occasion: b.occasion ?? "—",
    Guests: b.estimated_guests === null ? "—" : String(b.estimated_guests),
    Type: b.kind === "block" ? "Block" : "Hire",
    Status: b.status,
    Amount: b.total_pence ? formatCurrency(b.total_pence) : "—",
  };
}

// Always-exported columns + columns derived from the visible toggle set
function activeCols(visibleCols: string[]): ColLabel[] {
  const toggled = new Set(
    visibleCols.flatMap((k) => COL_KEY_MAP[k] ?? [])
  );
  // Date, Type and Status are always included
  return ALL_COLS.filter((c) => c === "Date" || c === "Type" || c === "Status" || toggled.has(c));
}

export function BookingsExportButtons({
  bookings,
  roomName,
  visibleCols,
}: {
  bookings: BookingListItem[];
  roomName: Record<string, string>;
  visibleCols: string[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const filename = `bookings-${today}`;
  const displayDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  function exportCsv() {
    const cols = activeCols(visibleCols);
    const rows = bookings.map((b) => toRow(b, roomName));
    const escape = (v: string) =>
      v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => escape(r[c] ?? "")).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportExcel() {
    const cols = activeCols(visibleCols);
    const { utils, writeFile } = await import("xlsx");
    const allRows = bookings.map((b) => toRow(b, roomName));
    const data = allRows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    const colWidths: Record<ColLabel, number> = {
      Date: 12, Room: 22, Start: 8, End: 8, Booker: 24, Email: 28, Mobile: 16,
      Occasion: 22, Guests: 8, Type: 8, Status: 12, Amount: 10,
    };
    const ws = utils.json_to_sheet(data, { header: cols });
    ws["!cols"] = cols.map((c) => ({ wch: colWidths[c] }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Bookings");
    writeFile(wb, `${filename}.xlsx`);
  }

  async function exportPdf() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(siteConfig.clubName, 14, 16);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Room Bookings · Exported ${displayDate}`, 14, 22);
    doc.setTextColor(0);

    const cols = activeCols(visibleCols);
    const rows = bookings.map((b) => toRow(b, roomName));
    autoTable(doc, {
      startY: 28,
      head: [cols as unknown as string[]],
      body: rows.map((r) => cols.map((c) => r[c] ?? "")),
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      didDrawPage: (data) => {
        doc.setFontSize(8);
        doc.setTextColor(150);
        const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          doc.internal.pageSize.getWidth() - 14,
          doc.internal.pageSize.getHeight() - 8,
          { align: "right" }
        );
      },
    });

    doc.save(`${filename}.pdf`);
  }

  return (
    <div className="flex gap-2 shrink-0">
      <Button variant="outline" size="sm" onClick={exportCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={exportExcel}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={exportPdf}>
        <Printer className="h-3.5 w-3.5" /> PDF
      </Button>
    </div>
  );
}
