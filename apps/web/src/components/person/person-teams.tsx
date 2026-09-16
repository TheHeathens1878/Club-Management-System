import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatStamp } from "@/lib/people-display";

/**
 * Every team this person has been in, season by season (P8.3).
 *
 * It was a six-column `<table>` with a horizontal scrollbar, which on a phone
 * meant the shirt number and the leaving date were somewhere off the right of
 * the screen. A membership is really one line — "U12 Mavericks · 2026/27 ·
 * Player · shirt 7 · since 3 Sep" — so it is drawn as a line, and the season
 * heads a group of them rather than repeating on every row.
 *
 * Current season first, because that is the one being asked about.
 */

const TEAM_ROLE_LABELS: Record<string, string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Manager",
};

export type PersonTeamRow = {
  id: string;
  teamId: string | null;
  teamName: string;
  seasonName: string;
  seasonIsCurrent: boolean;
  role: string;
  shirtNumber: number | null;
  joinedAt: string | null;
  leftAt: string | null;
};

export function PersonTeams({ rows }: { rows: PersonTeamRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No team memberships recorded.</p>;
  }

  // Grouped in the order the rows arrive (the page reads them newest first),
  // so the season headings come out newest first without a second sort.
  const seasons: { name: string; isCurrent: boolean; rows: PersonTeamRow[] }[] = [];
  for (const row of rows) {
    const last = seasons[seasons.length - 1];
    if (last && last.name === row.seasonName) last.rows.push(row);
    else seasons.push({ name: row.seasonName, isCurrent: row.seasonIsCurrent, rows: [row] });
  }

  return (
    <div className="space-y-4">
      {seasons.map((season) => (
        <div key={season.name} className="space-y-1">
          {/* A div, not a p: `Badge` renders a div and a block inside a
              paragraph is a hydration error. */}
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="min-w-0 truncate">{season.name}</span>
            {season.isCurrent && <Badge variant="success">Current</Badge>}
          </div>
          <ul className="divide-y rounded-lg border">
            {season.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                {row.teamId ? (
                  <Link
                    href={`/teams/${row.teamId}`}
                    className="touch flex min-w-0 items-center text-row font-medium underline underline-offset-2"
                  >
                    <span className="min-w-0 truncate">{row.teamName}</span>
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-row font-medium">{row.teamName}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {TEAM_ROLE_LABELS[row.role] ?? row.role}
                  {row.shirtNumber != null ? ` · shirt ${row.shirtNumber}` : ""}
                </span>
                <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                  {row.joinedAt ? `joined ${formatStamp(row.joinedAt)}` : "joined —"}
                  {row.leftAt ? ` · left ${formatStamp(row.leftAt)}` : ""}
                </span>
                {!row.leftAt && <Badge variant="success">Live</Badge>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
