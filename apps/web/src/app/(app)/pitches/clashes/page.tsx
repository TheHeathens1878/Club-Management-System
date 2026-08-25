import Link from "next/link";
import { redirect } from "next/navigation";
import type { Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { createClient } from "@/lib/supabase/server";
import { CalendarRange, LandPlot, ShieldAlert } from "lucide-react";

/**
 * `/pitches/clashes` — the clashes report (Adam, 2026-08-25).
 *
 * One RPC, `pitch_clash_report()`, and no judgement calls in here: the
 * database names everything the overlap constraint cannot prevent —
 * Full-Time reschedules it refused, one team booked in two places at once,
 * fixtures out of step with their booking, and home fixtures still without a
 * pitch. The same two gates as the requests desk: `isCommittee` keeps the
 * screen out of ordinary staff traffic, and the RPC's own guard is the
 * database's answer.
 */

export const dynamic = "force-dynamic";

/** The horizons the chip row offers. The RPC accepts 1–365. */
const HORIZONS = [14, 30, 60, 90] as const;
type Horizon = (typeof HORIZONS)[number];
const DEFAULT_HORIZON: Horizon = 60;

function horizonOf(value: string | undefined): Horizon {
  const days = Number(value);
  return (HORIZONS as readonly number[]).includes(days) ? (days as Horizon) : DEFAULT_HORIZON;
}

/** `2026-08-30T09:45:00+00:00` → `Sun 30 Aug · 10:45` (Europe/London). */
function whenLabel(iso: string): string {
  const local = instantToLocal(iso);
  return `${formatBookingDateShort(local.date)} · ${local.time}`;
}

// --- Defensive readers over the RPC's jsonb ---------------------------------

type JsonRecord = Record<string, Json | undefined>;

function rows(report: Json | null, key: string): JsonRecord[] {
  if (report === null || typeof report !== "object" || Array.isArray(report)) return [];
  const value = (report as JsonRecord)[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is JsonRecord => row !== null && typeof row === "object" && !Array.isArray(row),
  );
}

function str(row: JsonRecord, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function child(row: JsonRecord, key: string): JsonRecord {
  const value = row[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function BookingLine({ side, row }: { side: string; row: JsonRecord }) {
  const starts = str(row, "starts_at");
  const ends = str(row, "ends_at");
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{side}: </span>
      <span className="font-medium">{str(row, "pitch_name") ?? "Unknown pitch"}</span>
      {starts ? <> · {whenLabel(starts)}</> : null}
      {ends ? <>–{instantToLocal(ends).time}</> : null}
      {str(row, "label") ? (
        <span className="text-muted-foreground"> · {str(row, "label")}</span>
      ) : null}
      {str(row, "kind") ? <Badge className="ml-2" variant="outline">{str(row, "kind")}</Badge> : null}
    </p>
  );
}

export default async function PitchClashesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");
  if (!(await isClubAdmin())) redirect("/pitches");

  const { days } = await searchParams;
  const horizon = horizonOf(days);

  const supabase = await createClient();
  const { data: report, error } = await supabase.rpc("pitch_clash_report", {
    p_horizon_days: horizon,
  });

  const flagged = rows(report ?? null, "flagged");
  const overlaps = rows(report ?? null, "team_overlaps");
  const outOfStep = rows(report ?? null, "out_of_step");
  const unallocated = rows(report ?? null, "unallocated");
  const allClear =
    !error &&
    flagged.length === 0 &&
    overlaps.length === 0 &&
    outOfStep.length === 0 &&
    unallocated.length === 0;

  return (
    <>
      <PageHeader
        title="Clashes"
        subtitle="Everything the pitch diary cannot untangle by itself"
        action={
          <Link href="/pitches" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <LandPlot className="h-4 w-4" /> Allocate fixtures
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        {/* The horizon chips scroll in their own strip on a phone. */}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 [&>*]:flex-none lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Looking ahead</span>
          {HORIZONS.map((option) => (
            <Link
              key={option}
              href={`/pitches/clashes?days=${option}`}
              className={
                buttonVariants({
                  variant: option === horizon ? "default" : "outline",
                  size: "sm",
                }) + " h-11 lg:h-9"
              }
            >
              {option} days
            </Link>
          ))}
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the report: {error.message}
          </p>
        ) : null}

        {allClear ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Nothing to untangle in the next {horizon} days — no flagged reschedules, no team booked
            in two places, nothing out of step, and every home fixture has its pitch.
          </p>
        ) : null}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Reschedules the diary refused{flagged.length > 0 ? ` (${flagged.length})` : ""}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A Full-Time change moved the kick-off, but the pitch was already taken at the new
              time, so the booking stayed put. The blocking bookings are named exactly as the
              database recorded them; clear each one on the allocator.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-3">
                {flagged.map((row) => (
                  <li key={str(row, "fixture_id") ?? ""} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">
                      {str(row, "team_name")} v {str(row, "opponent")}
                      {str(row, "competition") ? (
                        <span className="text-muted-foreground"> · {str(row, "competition")}</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {str(row, "kickoff_at") ? whenLabel(str(row, "kickoff_at")!) : "No kick-off"}
                      {str(row, "pitch_name") ? <> · {str(row, "pitch_name")}</> : null}
                    </p>
                    {str(row, "conflicts") ? (
                      <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        Clashed with {str(row, "conflicts")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>
              One team, two places{overlaps.length > 0 ? ` (${overlaps.length})` : ""}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Two live bookings for the same team whose times overlap. The diary&apos;s overlap
              rule only guards a single pitch, so a team double-booked across two pitches is only
              visible here.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {overlaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-3">
                {overlaps.map((row, index) => (
                  <li key={index} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">
                      {str(row, "team_id") ? (
                        <Link href={`/teams/${str(row, "team_id")}`} className="underline underline-offset-2">
                          {str(row, "team_name") ?? "Team"}
                        </Link>
                      ) : (
                        str(row, "team_name") ?? "Team"
                      )}
                    </p>
                    <BookingLine side="First" row={child(row, "first")} />
                    <BookingLine side="Second" row={child(row, "second")} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>
              Out of step{outOfStep.length > 0 ? ` (${outOfStep.length})` : ""}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A fixture and its booking no longer agree on the pitch or the window. Re-allocating
              the fixture puts them back together.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {outOfStep.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-3">
                {outOfStep.map((row) => (
                  <li key={str(row, "fixture_id") ?? ""} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">
                      {str(row, "team_name")} v {str(row, "opponent")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Fixture: {str(row, "kickoff_at") ? whenLabel(str(row, "kickoff_at")!) : "?"}
                      {str(row, "fixture_pitch_name") ? (
                        <> on {str(row, "fixture_pitch_name")}</>
                      ) : null}
                      {" — "}booking: {str(row, "booking_starts_at")
                        ? whenLabel(str(row, "booking_starts_at")!)
                        : "?"}
                      {str(row, "booking_pitch_name") ? (
                        <> on {str(row, "booking_pitch_name")}</>
                      ) : null}
                    </p>
                    <p className="mt-1 flex gap-2">
                      {row["pitch_mismatch"] === true ? (
                        <Badge variant="outline">different pitch</Badge>
                      ) : null}
                      {row["time_mismatch"] === true ? (
                        <Badge variant="outline">different time</Badge>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>
              Still waiting for a pitch{unallocated.length > 0 ? ` (${unallocated.length})` : ""}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Home fixtures inside the window with no booking at all. The allocator&apos;s
              unallocated list is where each one gets its pitch — opening on the team&apos;s home
              pitch and kick-off.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {unallocated.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-2">
                {unallocated.map((row) => (
                  <li
                    key={str(row, "fixture_id") ?? ""}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="text-sm">
                      <span className="font-medium">
                        {str(row, "team_name")} v {str(row, "opponent")}
                      </span>
                      {str(row, "kickoff_at") ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {whenLabel(str(row, "kickoff_at")!)}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Home pitch: {str(row, "home_pitch_name") ?? "not set"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
