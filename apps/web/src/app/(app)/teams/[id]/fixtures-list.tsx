import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";

/**
 * The team's fixtures, in the two shapes the page needs: the full table on the
 * Fixtures tab and a three-line summary on Overview. Read-only in both — the
 * importer and the manual entry screen are what write fixtures.
 */

export type TeamFixture = {
  id: string;
  kickoffAt: string;
  isHome: boolean;
  opponent: string;
  competition: string | null;
  status: string;
  venueText: string | null;
  allocationConflict: boolean;
  seasonName: string | null;
  pitchName: string | null;
};

export function fixtureStatusVariant(
  status: string,
): "success" | "muted" | "destructive" | "warning" | "default" {
  if (status === "played") return "success";
  if (status === "cancelled" || status === "abandoned") return "destructive";
  if (status === "postponed") return "warning";
  return "default";
}

export function FixturesTable({ fixtures }: { fixtures: TeamFixture[] }) {
  if (fixtures.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No upcoming fixtures for this team.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="py-2 pr-3 font-medium">H/A</th>
            <th className="py-2 pr-3 font-medium">Opponent</th>
            <th className="py-2 pr-3 font-medium">Competition</th>
            <th className="py-2 pr-3 font-medium">Season</th>
            <th className="py-2 pr-3 font-medium">Pitch</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {fixtures.map((fixture) => {
            const local = instantToLocal(fixture.kickoffAt);
            return (
              <tr key={fixture.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-3">
                  {formatBookingDateShort(local.date)}
                </td>
                <td className="whitespace-nowrap py-2 pr-3">{local.time}</td>
                <td className="py-2 pr-3">{fixture.isHome ? "Home" : "Away"}</td>
                <td className="py-2 pr-3">
                  {fixture.opponent}
                  {fixture.venueText && (
                    <span className="block text-xs text-muted-foreground">{fixture.venueText}</span>
                  )}
                </td>
                <td className="py-2 pr-3">{fixture.competition ?? "—"}</td>
                <td className="py-2 pr-3">{fixture.seasonName ?? "—"}</td>
                <td className="py-2 pr-3">
                  {fixture.pitchName ?? (fixture.isHome ? "Not allocated" : "—")}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
                      {fixture.status}
                    </Badge>
                    {fixture.allocationConflict && <Badge variant="warning">Pitch clash</Badge>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FixturesSummary({
  fixtures,
  teamId,
}: {
  fixtures: TeamFixture[];
  teamId: string;
}) {
  if (fixtures.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No upcoming fixtures for this team.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y">
        {fixtures.map((fixture) => {
          const local = instantToLocal(fixture.kickoffAt);
          return (
            <li key={fixture.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fixture.isHome ? "v" : "away to"} {fixture.opponent}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBookingDateShort(local.date)} · {local.time}
                  {fixture.pitchName ? ` · ${fixture.pitchName}` : ""}
                  {fixture.competition ? ` · ${fixture.competition}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
                  {fixture.status}
                </Badge>
                {fixture.allocationConflict && <Badge variant="warning">Pitch clash</Badge>}
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href={`/teams/${teamId}?tab=fixtures`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        All fixtures
      </Link>
    </div>
  );
}
