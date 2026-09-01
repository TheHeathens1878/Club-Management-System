"use client";

/**
 * The roster and the attendance sheet (gap 8) — team staff and administrators.
 *
 * One table, one submit. Every live member of every team on this booking gets
 * a row: what they said (availability, read only — it is theirs to change) and
 * what happened (attendance, the coach's to record). "Not marked" is a real
 * state and it is the default; a session nobody has ticked off yet must not
 * read as "everybody absent".
 *
 * No dates of birth. The minor badge is `is_minor()` and nothing more.
 */

import Link from "next/link";
import { useActionState } from "react";

import type { Database } from "@club/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveBookingAttendance, type AttendanceActionState } from "./attendance-actions";
import { AVAILABILITY_LABELS, availabilityVariant } from "./availability-panel";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];
type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];

const EMPTY: AttendanceActionState = {};

const ATTENDANCE_CHOICES: { value: AttendanceStatus | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
];

export type RosterRow = {
  personId: string;
  name: string;
  /** `is_minor()` — a boolean, never the date behind it. */
  isMinor: boolean;
  teamName: string;
  role: Database["public"]["Enums"]["team_role"];
  shirtNumber: number | null;
  availability: AvailabilityStatus | null;
  availabilityNote: string | null;
  attendance: AttendanceStatus | null;
  attendanceNote: string | null;
};

const ROLE_LABELS: Record<Database["public"]["Enums"]["team_role"], string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Manager",
};

function Feedback({ state }: { state: AttendanceActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
      {label} <strong className="text-foreground">{value}</strong>
    </span>
  );
}

/**
 * Rendered only where `is_staff_of_booking()` or `is_club_admin()` said yes.
 * That gate is the page's; `booking_attendance_staff_write` is the one that
 * counts, and it refuses the save with a sentence either way.
 */
export function AttendancePanel({ bookingId, rows }: { bookingId: string; rows: RosterRow[] }) {
  const [state, action, saving] = useActionState(saveBookingAttendance, EMPTY);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nobody is recorded in the teams on this session, so there is no sheet to mark.
      </p>
    );
  }

  const count = (predicate: (row: RosterRow) => boolean) => rows.filter(predicate).length;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="booking_id" value={bookingId} />

      <div className="flex flex-wrap gap-1.5">
        <Count label="On the roster" value={rows.length} />
        <Count label="Available" value={count((r) => r.availability === "available")} />
        <Count label="Maybe" value={count((r) => r.availability === "maybe")} />
        <Count label="Unavailable" value={count((r) => r.availability === "unavailable")} />
        <Count label="No answer" value={count((r) => r.availability === null)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Count label="Present" value={count((r) => r.attendance === "present")} />
        <Count label="Late" value={count((r) => r.attendance === "late")} />
        <Count label="Absent" value={count((r) => r.attendance === "absent")} />
        <Count label="Not marked" value={count((r) => r.attendance === null)} />
      </div>

      <Feedback state={state} />

      {/* The register is the one screen that is used standing up: below lg
          every row becomes a card and the Present / Late / Absent choices
          become 44px chips (mobile design). The table is the same markup on
          lg+, so the sheet keeps one set of inputs and cannot disagree with
          itself. */}
      <div className="overflow-x-auto">
        <table className="block w-full text-left text-sm lg:table">
          <thead className="hidden border-b text-xs text-muted-foreground lg:table-header-group">
            <tr>
              <th className="py-2 pr-3 font-medium">Member</th>
              <th className="py-2 pr-3 font-medium">Team</th>
              <th className="py-2 pr-3 font-medium">Said</th>
              <th className="py-2 pr-3 font-medium">Attendance</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {rows.map((row) => (
              <tr
                key={row.personId}
                className="mb-3 block rounded-xl border bg-card p-4 last:mb-0 lg:mb-0 lg:table-row lg:rounded-none lg:border-0 lg:border-b lg:bg-transparent lg:p-0 lg:align-top lg:last:border-0"
              >
                <td className="block py-0 lg:table-cell lg:py-2 lg:pr-3">
                  <Link
                    href={`/people/${row.personId}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {row.name}
                  </Link>
                  {row.isMinor && (
                    <Badge variant="warning" className="ml-2">
                      Minor
                    </Badge>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABELS[row.role]}
                    {row.shirtNumber !== null ? ` · #${row.shirtNumber}` : ""}
                  </span>
                </td>
                <td className="block py-0 text-xs text-muted-foreground lg:table-cell lg:py-2 lg:pr-3">
                  {row.teamName}
                </td>
                <td className="block pt-2 lg:table-cell lg:py-2 lg:pr-3">
                  <Badge variant={availabilityVariant(row.availability)}>
                    {row.availability ? AVAILABILITY_LABELS[row.availability] : "No answer"}
                  </Badge>
                  {row.availabilityNote && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {row.availabilityNote}
                    </span>
                  )}
                </td>
                <td className="block pt-3 lg:table-cell lg:py-2 lg:pr-3">
                  <fieldset className="grid grid-cols-4 gap-1.5 lg:flex lg:flex-wrap lg:gap-2">
                    <legend className="sr-only">Attendance for {row.name}</legend>
                    {ATTENDANCE_CHOICES.map((choice) => (
                      <label
                        key={choice.value || "none"}
                        className="flex min-h-[44px] items-center justify-center gap-1 rounded-lg border px-1 text-xs lg:min-h-0 lg:justify-start lg:rounded-none lg:border-0 lg:px-0"
                      >
                        <input
                          type="radio"
                          name={`status:${row.personId}`}
                          value={choice.value}
                          defaultChecked={(row.attendance ?? "") === choice.value}
                        />
                        {choice.label}
                      </label>
                    ))}
                  </fieldset>
                </td>
                <td className="block pt-2 lg:table-cell lg:py-2">
                  <Input
                    name={`note:${row.personId}`}
                    defaultValue={row.attendanceNote ?? ""}
                    maxLength={500}
                    aria-label={`Attendance note for ${row.name}`}
                    className="h-11 min-w-[10rem] px-2 text-xs lg:h-8"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="sm"
          className="h-11 w-full lg:h-9 lg:w-auto"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save attendance"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Leaving someone on &ldquo;—&rdquo; removes any mark they had: not marked is not the same
          as absent.
        </p>
      </div>
    </form>
  );
}
