"use client";

/**
 * Requesting a pitch (gap 3, deliverable 1).
 *
 * One form, two audiences. A coach gets exactly what
 * `bookings_team_staff_insert` allows — a pending training or block booking on
 * a pitch for a team they staff — and the status control is simply absent,
 * because the policy would pin it to `pending` anyway and offering a choice the
 * database refuses is worse than not offering it. A club administrator gets the
 * same form plus the choice to confirm on the spot.
 *
 * The weekly repeat is shown only for training: a one-off block booking that
 * silently recurred twenty times is the sort of surprise a pitch diary never
 * recovers from.
 *
 * The pitch follows the team — a coach who picks their under-12s gets the
 * under-12s' home pitch already selected — but only until they touch the pitch
 * select themselves. After that, changing the team leaves their choice alone:
 * a default that silently undoes a deliberate pick is worse than no default.
 */

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import {
  MAX_REPEAT_WEEKS,
  PITCH_BOOKING_KIND_LABELS,
  type PitchBookingKind,
  type PitchOption,
  type TeamOption,
} from "@/lib/pitch-booking";

import { createPitchBooking } from "../booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "../booking-feedback";

function teamLabel(team: TeamOption): string {
  return team.ageGroup ? `${team.name} (${team.ageGroup})` : team.name;
}

export function BookForm({
  teams,
  pitches,
  isAdmin,
  defaultTeamId,
  homePitchByTeam,
  today,
  prefill,
}: {
  teams: TeamOption[];
  pitches: PitchOption[];
  isAdmin: boolean;
  defaultTeamId: string | null;
  /** `teams.home_resource_id` by team id, already filtered to bookable pitches. */
  homePitchByTeam: Record<string, string>;
  today: string;
  /** From a calendar slot click: the pitch and window the click named. */
  prefill?: { pitchId?: string; date?: string; start?: string; end?: string };
}) {
  const [state, action, pending] = useActionState(createPitchBooking, EMPTY_BOOKING_STATE);
  const initialTeamId = defaultTeamId ?? teams[0]?.id ?? "";
  const [teamId, setTeamId] = useState(initialTeamId);
  const [resourceId, setResourceId] = useState(
    prefill?.pitchId ?? homePitchByTeam[initialTeamId] ?? "",
  );
  /** Once the pitch has been chosen by hand, the team stops overriding it. */
  const [pitchTouched, setPitchTouched] = useState(Boolean(prefill?.pitchId));
  const [kind, setKind] = useState<PitchBookingKind>("training");
  const [repeats, setRepeats] = useState(false);

  const sharingCandidates = teams.filter((team) => team.id !== teamId);

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="team_id">Team</Label>
          <Select
            id="team_id"
            name="team_id"
            required
            value={teamId}
            onChange={(event) => {
              const next = event.target.value;
              setTeamId(next);
              if (!pitchTouched) setResourceId(homePitchByTeam[next] ?? "");
            }}
          >
            <option value="" disabled>
              Choose a team…
            </option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {teamLabel(team)}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="resource_id">Pitch</Label>
          <Select
            id="resource_id"
            name="resource_id"
            required
            value={resourceId}
            onChange={(event) => {
              setPitchTouched(true);
              setResourceId(event.target.value);
            }}
          >
            <option value="" disabled>
              Choose a pitch…
            </option>
            {pitches.map((pitch) => (
              <option key={pitch.id} value={pitch.id}>
                {pitch.name}
                {pitch.id === homePitchByTeam[teamId] ? " (home)" : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            required
            min={today}
            defaultValue={prefill?.date ?? today}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="start_time">Start</Label>
          <Input
            id="start_time"
            name="start_time"
            type="time"
            required
            defaultValue={prefill?.start ?? "18:00"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="end_time">End</Label>
          <Input
            id="end_time"
            name="end_time"
            type="time"
            required
            defaultValue={prefill?.end ?? "19:30"}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Times are Europe/London. A session must finish on the day it starts.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="kind">What is the pitch for?</Label>
          <Select
            id="kind"
            name="kind"
            required
            value={kind}
            onChange={(event) => {
              const next = event.target.value as PitchBookingKind;
              setKind(next);
              if (next !== "training") setRepeats(false);
            }}
          >
            <option value="training">{PITCH_BOOKING_KIND_LABELS.training}</option>
            <option value="block">{PITCH_BOOKING_KIND_LABELS.block}</option>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="occasion">Label</Label>
          <Input
            id="occasion"
            name="occasion"
            maxLength={120}
            placeholder="e.g. Tuesday training"
          />
          <p className="text-xs text-muted-foreground">
            What the club calendar shows. Left blank, it shows the team name.
          </p>
        </div>
      </div>

      {sharingCandidates.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Other teams sharing this session</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {sharingCandidates.map((team) => (
              <label
                key={team.id}
                className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0"
              >
                <input
                  type="checkbox"
                  name="extra_team_ids"
                  value={team.id}
                  className="h-4 w-4 rounded border-input"
                />
                {teamLabel(team)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Shared teams see the session on their own team page. The team above stays the one
            responsible for it.
          </p>
        </fieldset>
      )}

      {kind === "training" && (
        <div className="space-y-2 rounded-lg border bg-secondary/40 p-3">
          <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium sm:min-h-0">
            <input
              type="checkbox"
              checked={repeats}
              onChange={(event) => setRepeats(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Repeat weekly
          </label>
          {repeats ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-32 space-y-1">
                <Label htmlFor="repeat_weeks">Weeks</Label>
                <Input
                  id="repeat_weeks"
                  name="repeat_weeks"
                  type="number"
                  min={1}
                  max={MAX_REPEAT_WEEKS}
                  defaultValue={6}
                />
              </div>
              <p className="flex-1 text-xs text-muted-foreground">
                One booking per week at the same time, up to {MAX_REPEAT_WEEKS}. Every week is
                checked against the pitch first; if any of them clash, nothing is saved and the
                clashing weeks are listed.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A single session. Tick the box to book the same slot for several weeks at once.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" maxLength={500} placeholder="Anything the club should know" />
      </div>

      {isAdmin && (
        <div className="space-y-1">
          <Label htmlFor="status">Save as</Label>
          <Select id="status" name="status" defaultValue="confirmed" className="max-w-xs">
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending — leave it on the requests desk</option>
          </Select>
        </div>
      )}

      <BookingFeedback state={state} />

      {state.notice && state.teamId && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/teams/${state.teamId}`}
            className="text-sm font-medium text-primary underline underline-offset-2"
          >
            View the team page
          </Link>
          <Link
            href="/pitches/mine"
            className="text-sm font-medium text-primary underline underline-offset-2"
          >
            See my pitch bookings
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          className="h-11 w-full sm:w-auto"
          disabled={pending || teams.length === 0 || pitches.length === 0}
        >
          {pending ? "Checking the pitch…" : isAdmin ? "Save booking" : "Request pitch"}
        </Button>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Requests are held until a club administrator confirms them.
          </p>
        )}
      </div>
    </form>
  );
}
