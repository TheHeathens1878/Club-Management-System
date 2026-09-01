"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import type { Headcount } from "@/lib/headcount";

import { googleMapsUrl } from "../../events/shared";
import { fixtureHref, fixtureStatusVariant } from "./fixtures-shared";

/**
 * The whole row is the link (Adam, 2026-08-24: "you should be able to click
 * into the fixture anywhere on the card") — except clicks that land on a real
 * anchor inside it, which keep their own destination (the maps pin, the
 * attendance link). The row opens the Event & RSVP page (Adam, 2026-08-25:
 * "it should take you directly to the Event & RSVP page"); only the staff
 * Attendance link still goes to the fixture's own marker page.
 */
function rowClick(router: ReturnType<typeof useRouter>, href: string) {
  return (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) return;
    router.push(href);
  };
}

/**
 * Where a fixture is played, as a maps link. A home match pins the venue's
 * street address from Manage venues when one is recorded (Adam, 2026-08-25) —
 * a pitch NAME like "Ashton Park – Pitch 2" is a poor search term, the
 * address is the real place — falling back to the pitch name as before.
 */
function MapsLink({ fixture }: { fixture: TeamFixture }) {
  const place = fixture.isHome
    ? (fixture.pitchAddress ?? fixture.pitchName ?? fixture.venueText)
    : (fixture.venueText ?? fixture.opponent);
  if (!place) return null;
  return (
    <a
      href={googleMapsUrl(place)}
      target="_blank"
      rel="noreferrer"
      title={`Open ${place} in Google Maps`}
      className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline"
    >
      <MapPin className="h-3 w-3" /> Map
    </a>
  );
}

/**
 * The team's fixtures, in the two shapes the page needs: the full table on the
 * Fixtures tab and a three-line summary on Overview. Read-only in both — the
 * importer and the manual entry screen are what write fixtures.
 */

export type TeamFixture = {
  id: string;
  /** `fixtures.booking_id` — the pitch slot the fixture was allocated, if any. */
  bookingId: string | null;
  kickoffAt: string;
  isHome: boolean;
  opponent: string;
  competition: string | null;
  status: string;
  venueText: string | null;
  allocationConflict: boolean;
  seasonName: string | null;
  pitchName: string | null;
  /** The home pitch's street address (Manage venues) — the maps pin when set. */
  pitchAddress: string | null;
  /** Squad availability counts — staff and admin view only. */
  headcount: Headcount | null;
  /** The RSVP event mirroring this fixture, when the events module has one. */
  eventId: string | null;
  /**
   * `fixtures.no_longer_published_at` — Full-Time has stopped publishing this
   * game, and the importer left it alone because a pitch, a team sheet or
   * stats hang off it. Somebody has to decide whether the club is still
   * playing it (20260826110000).
   */
  noLongerPublishedAt: string | null;
};

/** `✓ 5 · ✗ 2 · ? 5` — the marker at a glance; unanswered fold into "?". */
export function HeadcountChips({ headcount }: { headcount: Headcount }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
      <Badge variant="success">✓ {headcount.going}</Badge>
      <Badge variant={headcount.notGoing > 0 ? "destructive" : "muted"}>
        ✗ {headcount.notGoing}
      </Badge>
      <Badge variant="muted">? {headcount.maybe + headcount.unanswered}</Badge>
    </span>
  );
}

/**
 * The Attendance column (gap 8).
 *
 * Attendance lives on the BOOKING, not the fixture — `/pitches/[bookingId]` is
 * the availability and attendance sheet — so a fixture that has not been given
 * a pitch has nowhere to send anybody. Rather than a dead link, those rows say
 * why in a `title` the staff member can hover: the fix is to allocate a pitch,
 * and that is done on the Pitches screen.
 *
 * The link is offered to team staff and administrators only, and even for them
 * `/pitches/[bookingId]` reads as the caller — it shows the sheet only to
 * whoever `is_team_staff()` or the admin roles admit.
 */
export function FixturesTable({
  fixtures,
  canManage,
  teamId,
}: {
  fixtures: TeamFixture[];
  canManage: boolean;
  teamId: string;
}) {
  const router = useRouter();
  if (fixtures.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No upcoming fixtures for this team.
      </p>
    );
  }

  return (
    <>
      {/* The phone reads the same fixtures as a stack of cards — kick-off and
          opponent, the detail line underneath, status and headcount right
          (mobile design: a dense table becomes cards). */}
      <ul className="divide-y lg:hidden">
        {fixtures.map((fixture) => {
          const local = instantToLocal(fixture.kickoffAt);
          return (
            <li
              key={fixture.id}
              onClick={rowClick(router, fixtureHref(teamId, fixture))}
              className="flex min-h-[44px] cursor-pointer items-start justify-between gap-3 py-3 first:pt-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fixture.isHome ? "v" : "away to"} {fixture.opponent}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatBookingDateShort(local.date)} · {local.time}
                  {fixture.pitchName
                    ? ` · ${fixture.pitchName}`
                    : fixture.isHome
                      ? " · no pitch yet"
                      : ""}
                  {fixture.competition ? ` · ${fixture.competition}` : ""}
                </p>
                {fixture.venueText && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {fixture.venueText}
                  </p>
                )}
                <p className="mt-1 text-xs">
                  <MapsLink fixture={fixture} />
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
                  {fixture.status}
                </Badge>
                {fixture.allocationConflict && <Badge variant="warning">Pitch clash</Badge>}
                {fixture.noLongerPublishedAt && (
                  <Badge variant="warning" title="Full-Time has stopped publishing this game. Open it to decide whether the club is still playing it.">
                    Not in Full-Time
                  </Badge>
                )}
                {canManage && fixture.headcount && (
                  <HeadcountChips headcount={fixture.headcount} />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto lg:block">
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
            <th className="py-2 pr-3 font-medium">Status</th>
            {canManage && <th className="py-2 font-medium">Attendance</th>}
          </tr>
        </thead>
        <tbody>
          {fixtures.map((fixture) => {
            const local = instantToLocal(fixture.kickoffAt);
            return (
              <tr
                key={fixture.id}
                onClick={rowClick(router, fixtureHref(teamId, fixture))}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-secondary/60"
              >
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
                  <MapsLink fixture={fixture} />
                </td>
                <td className="py-2 pr-3">{fixture.competition ?? "—"}</td>
                <td className="py-2 pr-3">{fixture.seasonName ?? "—"}</td>
                <td className="py-2 pr-3">
                  {fixture.pitchName ?? (fixture.isHome ? "Not allocated" : "—")}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
                      {fixture.status}
                    </Badge>
                    {fixture.allocationConflict && <Badge variant="warning">Pitch clash</Badge>}
                {fixture.noLongerPublishedAt && (
                  <Badge variant="warning" title="Full-Time has stopped publishing this game. Open it to decide whether the club is still playing it.">
                    Not in Full-Time
                  </Badge>
                )}
                  </div>
                </td>
                {canManage && (
                  <td className="whitespace-nowrap py-2">
                    <span className="inline-flex items-center gap-2">
                      {fixture.headcount && <HeadcountChips headcount={fixture.headcount} />}
                      <Link
                        href={`/teams/${teamId}/fixtures/${fixture.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Attendance
                      </Link>
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

export function FixturesSummary({
  fixtures,
  teamId,
}: {
  fixtures: TeamFixture[];
  teamId: string;
}) {
  const router = useRouter();
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
            <li
              key={fixture.id}
              onClick={rowClick(router, fixtureHref(teamId, fixture))}
              className="flex min-h-[44px] cursor-pointer flex-wrap items-start justify-between gap-2 rounded-md py-3 transition-colors first:pt-0 hover:bg-secondary/60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fixture.isHome ? "v" : "away to"} {fixture.opponent}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBookingDateShort(local.date)} · {local.time}
                  {fixture.pitchName ? ` · ${fixture.pitchName}` : ""}
                  {fixture.competition ? ` · ${fixture.competition}` : ""}
                  {" · "}
                  <MapsLink fixture={fixture} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {fixture.headcount && <HeadcountChips headcount={fixture.headcount} />}
                <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
                  {fixture.status}
                </Badge>
                {fixture.allocationConflict && <Badge variant="warning">Pitch clash</Badge>}
                {fixture.noLongerPublishedAt && (
                  <Badge variant="warning" title="Full-Time has stopped publishing this game. Open it to decide whether the club is still playing it.">
                    Not in Full-Time
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href={`/teams/${teamId}?tab=matchday`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        All fixtures
      </Link>
    </div>
  );
}
