import Link from "next/link";
import { Baby } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChipLink } from "@/components/ui/toggle-chip";
import type { ChildReadiness, ReadinessState } from "@/lib/family-readiness";
import { cn } from "@/lib/utils";

/**
 * The readiness grid: is this child ready for the season? (P8.6)
 *
 * Rows are children, columns are the four things the club needs from each of
 * them — details, somebody to ring, whether they may have a login, and their
 * registration. Every cell says its state IN WORDS ("2 on file", "Waiting on
 * you", "Approved — U11 Venus") rather than a tick or a colour alone, because
 * a colour is not a sentence and half of this is safeguarding. The colour is
 * the second reading, not the first.
 *
 * Every cell is also a door: one press opens the sheet at the mode that fixes
 * that cell, so a parent never has to work out which card an answer lives in.
 *
 * A plain server component — no state, no client bundle. The chips and the
 * cells are `<Link>`s, so which child is in focus lives in the URL (`?child=`)
 * and the back button undoes a tap. That matters most on a phone, where four
 * columns cannot fit: there the chips pick one child and their four cells
 * stack under their name.
 *
 * The row shows an AGE GROUP, never a date of birth. A parent knows their
 * child's birthday; a screen that prints children's birthdays is a screen that
 * leaks them over somebody's shoulder.
 */

export type FamilyGridRow = {
  personId: string;
  /** What the club calls them, preferred name included. */
  name: string;
  photoUrl?: string;
  /** "U11", or "Age group unknown" — worked out from the date string. */
  ageGroup: string;
  isMinor: boolean;
  /** "parent", "guardian" — how the club has the caller down. */
  relationship: string;
  teams: { id: string; label: string }[];
  readiness: ChildReadiness;
  /** `?sheet=<mode>&child=<id>` for each column, built by the page. */
  hrefs: Record<ColumnKey, string>;
  /** `?child=<id>` — the phone's chip, which changes nothing else. */
  chipHref: string;
};

export type ColumnKey = "details" | "contacts" | "access" | "registration";

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "contacts", label: "Emergency contacts" },
  { key: "access", label: "App access" },
  { key: "registration", label: "Registration" },
];

/**
 * What a cell's state looks like. `pending` is muted on purpose: "Pending"
 * and "From age 13" are both "nothing for you to do here", and a screen that
 * paints them amber tells a parent to act on something they cannot.
 */
const CELL_TONE: Record<ReadinessState, string> = {
  ok: "border-success/25 bg-success-tint text-success",
  missing: "border-warning/25 bg-warning-tint text-warning",
  waiting: "border-warning/25 bg-warning-tint text-warning",
  pending: "border-transparent bg-secondary text-muted-foreground",
};

export function FamilyGrid({
  rows,
  focusedId,
}: {
  rows: FamilyGridRow[];
  /** Whose cells a phone shows. At `lg` every row is on screen anyway. */
  focusedId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Baby className="h-5 w-5" aria-hidden />}
        title="No children on your account yet"
        action={{ href: "#add-a-child", label: "Add a child" }}
      >
        The club has nobody recorded against you as a guardian. Add a child below, or ask the club
        if you think one should already be linked to you.
      </EmptyState>
    );
  }

  const focused = rows.some((row) => row.personId === focusedId)
    ? focusedId
    : (rows[0]?.personId ?? null);

  return (
    <section className="space-y-3">
      {/* One chip per child, and only where it earns its place: at `lg` the
          whole grid is on screen, so a strip that filters it would be a
          control that does nothing useful. */}
      {rows.length > 1 && (
        <ChipStrip className="lg:hidden">
          {rows.map((row) => (
            <ToggleChipLink
              key={row.personId}
              href={row.chipHref}
              active={row.personId === focused}
              scroll={false}
            >
              {row.name}
            </ToggleChipLink>
          ))}
        </ChipStrip>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(170px,1.1fr)_repeat(4,minmax(140px,1fr))] lg:items-stretch lg:gap-1.5">
        {/* The column names, at desk width only: on a phone each cell carries
            its own label, because the header would be four screens away. */}
        <div className="hidden lg:block" />
        {COLUMNS.map((column) => (
          <div
            key={column.key}
            className="hidden px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground lg:block"
          >
            {column.label}
          </div>
        ))}

        {rows.map((row) => {
          // A phone shows one child at a time; the rest are still in the
          // document (and still linked) but out of the way until their chip
          // is pressed.
          const away = row.personId !== focused ? "hidden lg:flex" : "flex";
          return (
            <div key={row.personId} className="contents">
              <div className={cn("min-w-0 flex-col justify-center gap-1 py-1 lg:mt-2", away)}>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={row.name} photoUrl={row.photoUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-row font-semibold leading-tight">
                    {row.name}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline">{row.ageGroup}</Badge>
                  {row.isMinor && <Badge variant="muted">Under 18</Badge>}
                  {row.teams.map((team) => (
                    <Badge key={team.id}>{team.label}</Badge>
                  ))}
                </div>
                <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                  {row.relationship}
                </span>
              </div>

              {COLUMNS.map((column) => {
                const cell = row.readiness[column.key];
                return (
                  <Link
                    key={column.key}
                    href={row.hrefs[column.key]}
                    scroll={false}
                    className={cn(
                      "touch min-w-0 flex-col justify-center gap-0.5 rounded-lg border px-3 py-2 transition-colors hover:brightness-95 lg:mt-2",
                      CELL_TONE[cell.state],
                      away,
                    )}
                  >
                    <span className="text-2xs font-semibold uppercase tracking-wide opacity-80 lg:hidden">
                      {column.label}
                    </span>
                    <span className="truncate text-list font-medium leading-tight">{cell.text}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
