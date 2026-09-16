/**
 * The desk on paper. The grid is the screen — a printer gets none of its
 * colour, its badges or its sideways scroll — so the rows the filters show
 * are also laid out as a plain table that only ever appears in print
 * (`hidden print:block`). A phone prints the same rows a desk would (Adam,
 * 2026-09-08: the whole club, "export to pdf", from the phone).
 *
 * No `"use client"` of its own: it draws nothing interactive, and the grid
 * that renders it is already a client component.
 */

import type { DeskRow } from "./types";

export function PrintTable({ rows }: { rows: DeskRow[] }) {
  return (
    <div className="hidden rounded-xl border bg-card print:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-secondary/40 text-left text-2xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Kick-off</th>
            <th className="px-4 py-2 font-medium">Fixture</th>
            <th className="px-4 py-2 font-medium">Competition</th>
            <th className="px-4 py-2 font-medium">Venue</th>
            <th className="px-4 py-2 font-medium">Pitch</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Replies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-b-0">
              <td className="px-4 py-3 align-top text-muted-foreground">
                <span className="font-semibold">{row.date}</span>
                <br />
                {row.time}
              </td>
              <td className="px-4 py-3 align-top">
                <span className="font-semibold">
                  {row.teamName} v {row.opponent}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {row.isHome ? "Home" : `Away${row.venueText ? ` · ${row.venueText}` : ""}`}
                </span>
              </td>
              <td className="px-4 py-3 align-top">{row.competition}</td>
              <td className="px-4 py-3 align-top">{row.venue}</td>
              <td className="px-4 py-3 align-top">{row.isHome ? row.pitch : "Away"}</td>
              <td className="px-4 py-3 align-top">{row.status}</td>
              <td className="px-4 py-3 align-top">
                {row.accepted} of {row.squad}
                {row.declined > 0 ? ` · ${row.declined} out` : ""}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No matches fit those filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
