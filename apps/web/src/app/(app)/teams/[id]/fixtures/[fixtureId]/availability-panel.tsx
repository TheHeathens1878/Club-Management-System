"use client";

/**
 * "Can you make it?" for one fixture — the same three-way answer the pitch
 * booking sheet uses, keyed on the fixture so it works for away games and
 * unallocated home games too.
 *
 * Rendered twice by the page: once with the household's own subjects (anyone
 * the caller may answer for), and once, for team staff, with the whole squad.
 * Either way the `availability` policies are the rule and this form is only
 * the convenience.
 */

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@club/db";

import { setFixtureAvailability, type FixtureAvailabilityState } from "./actions";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

const EMPTY: FixtureAvailabilityState = {};

const CHOICES: { value: AvailabilityStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "maybe", label: "Maybe" },
  { value: "unavailable", label: "Unavailable" },
];

const LABELS: Record<AvailabilityStatus, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Unavailable",
};

function variantOf(status: AvailabilityStatus | null): "success" | "warning" | "destructive" | "muted" {
  if (status === "available") return "success";
  if (status === "maybe") return "warning";
  if (status === "unavailable") return "destructive";
  return "muted";
}

export type FixtureSubject = {
  personId: string;
  name: string;
  /** `is_minor()` — never the date behind it. */
  isMinor: boolean;
  isSelf: boolean;
  relationship: string | null;
  shirtNumber: number | null;
  status: AvailabilityStatus | null;
  note: string | null;
};

export function FixtureAvailabilityPanel({
  fixtureId,
  teamId,
  subjects,
  emptyText,
}: {
  fixtureId: string;
  teamId: string;
  subjects: FixtureSubject[];
  emptyText: string;
}) {
  const [state, action, saving] = useActionState(setFixtureAvailability, EMPTY);

  if (subjects.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-4">
      {state.error && (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      {subjects.map((subject) => (
        <form key={subject.personId} action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="fixture_id" value={fixtureId} />
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="person_id" value={subject.personId} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {subject.isSelf ? `${subject.name} (you)` : subject.name}
              {subject.shirtNumber !== null && (
                <span className="ml-1 text-xs text-muted-foreground">#{subject.shirtNumber}</span>
              )}
            </span>
            {subject.isMinor && <Badge variant="warning">Minor</Badge>}
            {!subject.isSelf && subject.relationship && (
              <Badge variant="outline">{subject.relationship}</Badge>
            )}
            <Badge variant={variantOf(subject.status)}>
              {subject.status ? LABELS[subject.status] : "No answer yet"}
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
                htmlFor={`fixture-availability-note-${subject.personId}`}
                className="text-xs text-muted-foreground"
              >
                Note for the coach (optional)
              </label>
              <Input
                id={`fixture-availability-note-${subject.personId}`}
                name="note"
                defaultValue={subject.note ?? ""}
                maxLength={500}
                placeholder="e.g. Can only make the first half"
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
