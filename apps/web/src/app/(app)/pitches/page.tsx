import { redirect } from "next/navigation";
import Link from "next/link";
import type { Database, Json } from "@club/db";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  formatBookingDate,
  formatBookingDateShort,
  instantToLocal,
  isValidDateString,
} from "@/lib/booking-time";
import {
  comingWeekend,
  shiftWeekend,
  weekendOf,
  weekendWindow,
  type GridEntry,
} from "@/lib/pitch-grid";
import { AlertCircle, CalendarRange, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { AllocateControl, type PitchOption } from "./allocate-control";
import { WeekendPitchGrid, type GridDay } from "./weekend-grid";

/**
 * Pitch allocation (PLAN.md P2.5) — committee only.
 *
 * Three reads, all of them the database's own: `unallocated_home_fixtures`
 * (the work list), `pitch_grid(from, to)` (the weekend), and the fixtures
 * carrying `allocation_conflict` (what a Full-Time reschedule could not move).
 * Nothing here decides whether a pitch is free; `allocate_fixture()` does, and
 * the conflicts it names are shown verbatim by `AllocateControl`.
 */

/** How many recent conflict audit rows to read for the clash detail. */
const CONFLICT_AUDIT_LIMIT = 200;

type UnallocatedRow = Database["public"]["Views"]["unallocated_home_fixtures"]["Row"];
type PitchGridRow = Database["public"]["Functions"]["pitch_grid"]["Returns"][number];
/** The left join in `pitch_grid()` yields a row per pitch even with no booking. */
type PitchGridRowMaybe = { [K in keyof PitchGridRow]: PitchGridRow[K] | null };

/** The `conflicts` text `fixtures_sync_booking()` wrote onto the audit row. */
function conflictsFrom(detail: Json | null): string | null {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return null;
  const value = (detail as Record<string, Json | undefined>)["conflicts"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function kickoffLabel(iso: string): string {
  const local = instantToLocal(iso);
  return `${formatBookingDateShort(local.date)} · ${local.time}`;
}

export default async function PitchesPage({
  searchParams,
}: {
  searchParams: Promise<{ weekend?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/room-bookings");

  const { weekend: weekendParam } = await searchParams;
  const weekend =
    weekendParam && isValidDateString(weekendParam) ? weekendOf(weekendParam) : comingWeekend();
  const range = weekendWindow(weekend);

  const admin = createAdminClient();
  const [pitchesResult, unallocatedResult, gridResult, flaggedResult, auditResult] =
    await Promise.all([
      admin
        .from("resources")
        .select("id,name,default_pre_buffer_minutes,default_post_buffer_minutes")
        .neq("type", "function_room")
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      admin.from("unallocated_home_fixtures").select("*"),
      admin.rpc("pitch_grid", { p_from: range.from, p_to: range.untilExclusive }),
      admin
        .from("fixtures")
        // One string literal, not a concatenation: supabase-js infers the row
        // type from the select text, and only a literal carries that type.
        .select(
          "id,kickoff_at,opponent,competition,duration_minutes,venue_resource_id,teams(name),resources!fixtures_venue_resource_id_fkey(name)",
        )
        .eq("allocation_conflict", true)
        .order("kickoff_at"),
      admin
        .from("audit_log")
        .select("entity_id,detail,created_at")
        .eq("action", "fixtures.allocation_conflict")
        .eq("entity", "fixtures")
        .order("created_at", { ascending: false })
        .limit(CONFLICT_AUDIT_LIMIT),
    ]);

  const pitches: PitchOption[] = (pitchesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    defaultPreBufferMinutes: row.default_pre_buffer_minutes,
    defaultPostBufferMinutes: row.default_post_buffer_minutes,
  }));

  // Latest conflict detail per fixture — the rows arrive newest first, so the
  // first one seen for a fixture is the one to show.
  const latestConflict = new Map<string, { text: string; at: string }>();
  for (const row of auditResult.data ?? []) {
    if (row.entity_id === null || latestConflict.has(row.entity_id)) continue;
    const text = conflictsFrom(row.detail);
    if (text !== null) latestConflict.set(row.entity_id, { text, at: row.created_at });
  }

  const unallocated = (unallocatedResult.data ?? []).filter(
    (row): row is UnallocatedRow & { id: string; kickoff_at: string } =>
      row.id !== null && row.kickoff_at !== null,
  );

  // pitch_grid() returns one row per pitch even when nothing is booked on it.
  const gridEntries: Record<string, GridEntry[]> = {};
  for (const pitch of pitches) gridEntries[pitch.id] = [];
  for (const raw of (gridResult.data ?? []) as PitchGridRowMaybe[]) {
    if (raw.resource_id === null) continue;
    const column = gridEntries[raw.resource_id] ?? [];
    gridEntries[raw.resource_id] = column;
    if (
      raw.booking_id === null ||
      raw.starts_at === null ||
      raw.ends_at === null ||
      raw.blocked_from === null ||
      raw.blocked_until === null
    ) {
      continue;
    }
    column.push({
      bookingId: raw.booking_id,
      kind: raw.kind ?? "hire",
      status: raw.status ?? "confirmed",
      label: raw.label ?? "Booking",
      startsAtMs: Date.parse(raw.starts_at),
      endsAtMs: Date.parse(raw.ends_at),
      blockedFromMs: Date.parse(raw.blocked_from),
      blockedUntilMs: Date.parse(raw.blocked_until),
      fixtureId: raw.fixture_id,
      teamId: raw.team_id,
    });
  }

  const days: GridDay[] = [
    { date: weekend.saturday, label: formatBookingDate(weekend.saturday) },
    { date: weekend.sunday, label: formatBookingDate(weekend.sunday) },
  ];
  const previous = shiftWeekend(weekend, -1);
  const next = shiftWeekend(weekend, 1);
  const thisWeekend = comingWeekend();

  const flagged = flaggedResult.data ?? [];
  const loadError =
    pitchesResult.error ?? unallocatedResult.error ?? gridResult.error ?? flaggedResult.error;

  return (
    <>
      <PageHeader
        title="Pitches"
        subtitle="Allocate home fixtures to a pitch, and see the weekend as the booking system sees it"
        action={
          <Link
            href="/pitches/calendar"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <CalendarRange className="h-4 w-4" /> Calendar
          </Link>
        }
      />
      <div className="space-y-6 p-6">
        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Could not load the allocation dashboard: {loadError.message}</span>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* a. Unallocated home fixtures                                     */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Home fixtures with no pitch</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every upcoming home fixture that has no slot yet, plus any whose slot could not be
              moved when the fixture was rescheduled. Allocating creates the pitch booking, buffers
              and all, and runs the same conflict check as a hire.
            </p>
          </CardHeader>
          <CardContent>
            {unallocated.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every upcoming home fixture has a pitch.
              </p>
            ) : (
              <ul className="divide-y">
                {unallocated.map((fixture) => {
                  const conflict = latestConflict.get(fixture.id);
                  return (
                    <li key={fixture.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">
                          {fixture.team_name ?? "Team"} v {fixture.opponent ?? "—"}
                        </span>
                        {fixture.competition && (
                          <Badge variant="muted">{fixture.competition}</Badge>
                        )}
                        {fixture.allocation_conflict && (
                          <Badge variant="warning">Clash — needs re-allocating</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {kickoffLabel(fixture.kickoff_at)} · {fixture.duration_minutes ?? 90} min
                      </p>
                      {conflict && (
                        <p className="flex items-start gap-1.5 text-xs text-amber-800">
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">Clashed with {conflict.text}</span>
                        </p>
                      )}
                      <AllocateControl fixtureId={fixture.id} pitches={pitches} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* b. The weekend grid                                              */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Weekend pitch grid</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatBookingDateShort(weekend.saturday)} –{" "}
                  {formatBookingDateShort(weekend.sunday)}, 08:00–20:00 Europe/London.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/pitches?weekend=${previous.saturday}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Link>
                {weekend.saturday !== thisWeekend.saturday && (
                  <Link
                    href={`/pitches?weekend=${thisWeekend.saturday}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    This weekend
                  </Link>
                )}
                <Link
                  href={`/pitches?weekend=${next.saturday}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <WeekendPitchGrid days={days} pitches={pitches} entries={gridEntries} />
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* c. Flagged by a reschedule                                       */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Flagged by a reschedule</CardTitle>
            <p className="text-sm text-muted-foreground">
              When a Full-Time reschedule moves a kick-off into an hour the pitch is already taken,
              the booking stays where it was and the fixture is flagged — never double-booked. Pick
              another pitch, or unallocate and re-do it once the clash is resolved.
            </p>
          </CardHeader>
          <CardContent>
            {flagged.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing flagged. Every linked booking matches its fixture.
              </p>
            ) : (
              <ul className="divide-y">
                {flagged.map((fixture) => {
                  const conflict = latestConflict.get(fixture.id);
                  return (
                    <li key={fixture.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">
                          {fixture.teams?.name ?? "Team"} v {fixture.opponent}
                        </span>
                        {fixture.competition && (
                          <Badge variant="muted">{fixture.competition}</Badge>
                        )}
                        <Badge variant="warning">Allocation conflict</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {kickoffLabel(fixture.kickoff_at)} · {fixture.duration_minutes} min ·{" "}
                        {fixture.resources?.name
                          ? `booking still on ${fixture.resources.name}`
                          : "no pitch booking"}
                      </p>
                      {conflict && (
                        <p className="flex items-start gap-1.5 text-xs text-amber-800">
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">Clashed with {conflict.text}</span>
                        </p>
                      )}
                      <AllocateControl
                        fixtureId={fixture.id}
                        pitches={pitches}
                        currentResourceId={fixture.venue_resource_id}
                        allowUnallocate
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
