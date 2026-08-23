"use client";

/**
 * "Can you make it?" — for the signed-in person and every child they guard who
 * is in one of this booking's teams (gap 8).
 *
 * The list of subjects is worked out on the server from `my_children()` and
 * `is_member_of_booking()`, both of which are the database's own answers. If
 * this component were ever handed somebody it should not have been,
 * `booking_availability_insert` would still refuse the write — the form is the
 * convenience, the policy is the rule.
 *
 * No date of birth is shown or sent. The minor badge is `is_minor()`, a
 * boolean, and that is all a "can you make it" form needs to know.
 */

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@club/db";

import { setBookingAvailability, type AttendanceActionState } from "./attendance-actions";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

const EMPTY: AttendanceActionState = {};

const CHOICES: { value: AvailabilityStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "maybe", label: "Maybe" },
  { value: "unavailable", label: "Unavailable" },
];

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Unavailable",
};

export function availabilityVariant(
  status: AvailabilityStatus | null,
): "success" | "warning" | "destructive" | "muted" {
  if (status === "available") return "success";
  if (status === "maybe") return "warning";
  if (status === "unavailable") return "destructive";
  return "muted";
}

export type AvailabilitySubject = {
  personId: string;
  name: string;
  /** `is_minor()` — never the date behind it. */
  isMinor: boolean;
  /** True for the signed-in person's own row. */
  isSelf: boolean;
  /** "mother", "father", … from `my_children()`, for a guarded child. */
  relationship: string | null;
  status: AvailabilityStatus | null;
  note: string | null;
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

export function AvailabilityPanel({
  bookingId,
  fixtureId,
  subjects,
}: {
  bookingId: string;
  /** Set for a fixture booking — availability is written to `availability`. */
  fixtureId: string | null;
  subjects: AvailabilitySubject[];
}) {
  const [state, action, saving] = useActionState(setBookingAvailability, EMPTY);

  if (subjects.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nobody you can answer for is in the teams on this session, so there is no availability to
        set here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Feedback state={state} />

      {subjects.map((subject) => (
        <form
          key={subject.personId}
          action={action}
          className="space-y-3 rounded-lg border p-4"
        >
          <input type="hidden" name="booking_id" value={bookingId} />
          <input type="hidden" name="person_id" value={subject.personId} />
          <input type="hidden" name="fixture_id" value={fixtureId ?? ""} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {subject.isSelf ? `${subject.name} (you)` : subject.name}
            </span>
            {subject.isMinor && <Badge variant="warning">Minor</Badge>}
            {!subject.isSelf && subject.relationship && (
              <Badge variant="outline">{subject.relationship}</Badge>
            )}
            <Badge variant={availabilityVariant(subject.status)}>
              {subject.status ? AVAILABILITY_LABELS[subject.status] : "No answer yet"}
            </Badge>
          </div>

          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">Availability for {subject.name}</legend>
            {CHOICES.map((choice) => (
              <label key={choice.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="status"
                  value={choice.value}
                  defaultChecked={subject.status === choice.value}
                  required
                />
                {choice.label}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1 space-y-1.5">
              <label
                htmlFor={`availability-note-${subject.personId}`}
                className="text-xs text-muted-foreground"
              >
                Note for the coach (optional)
              </label>
              <Input
                id={`availability-note-${subject.personId}`}
                name="note"
                defaultValue={subject.note ?? ""}
                maxLength={500}
                placeholder="e.g. Arriving late — away at a match until 6"
              />
            </div>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ))}
    </div>
  );
}
