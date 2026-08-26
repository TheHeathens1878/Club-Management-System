"use client";

/**
 * Requesting a pitch (gap 3, deliverable 1).
 *
 * One form, two audiences — and which one you are is the HAT, not the role
 * (Adam, 2026-08-25: "I can still book a pitch as confirmed using my coach
 * login … remove this functionality"). Wearing the Coach hat this is a request
 * form and the Save-as control is simply absent, whoever is wearing it: the
 * booking goes through `request_team_pitch_booking()`, which has no status
 * parameter and so cannot produce a confirmed row for anybody. Wearing the
 * Club admin hat, and holding `is_club_admin()`, the same form gains the choice
 * to confirm on the spot.
 *
 * A match (`booking_kind = 'fixture'`) asks who it is against — one of the
 * club's own teams, or a club typed in — and offers the label that follows
 * from the answer. Offers, not imposes: a label somebody has typed themselves
 * is never overwritten (`nextSuggestedLabel`).
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
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import {
  matchLabel,
  MAX_REPEAT_WEEKS,
  nextSuggestedLabel,
  PITCH_BOOKING_KIND_LABELS,
  type OppositionSide,
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
  allTeams,
  pitches,
  canConfirm,
  couldConfirmInAdminView,
  defaultTeamId,
  homePitchByTeam,
  today,
  prefill,
}: {
  teams: TeamOption[];
  /** Every active team — the opposition for an internal match, not a booker. */
  allTeams: TeamOption[];
  pitches: PitchOption[];
  /**
   * `is_club_admin()` AND the Club admin hat. Both, because the role alone is
   * what let a coach-hatted committee sign-in confirm its own bookings.
   */
  canConfirm: boolean;
  /** Holds club admin but is wearing another hat — worth saying so, once. */
  couldConfirmInAdminView: boolean;
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
  const [opposition, setOpposition] = useState<OppositionSide>("internal");
  const [opponentTeamId, setOpponentTeamId] = useState("");
  const [opponentName, setOpponentName] = useState("");
  /** The Label box, and the last thing this form offered to put in it. */
  const [label, setLabel] = useState("");
  const [suggestion, setSuggestion] = useState("");

  // Adam, 2026-08-26: the teams that can share a session are ANY of the
  // club's, not only the ones this person runs — an U14 coach putting the U9s
  // on the same hour does not staff the U9s. `allTeams` is the same
  // `teams_read` list the opposition picker uses; a team's name is not
  // private.
  const sharingCandidates = allTeams.filter((team) => team.id !== teamId);
  const [sharing, setSharing] = useState<string[]>([]);
  const [sharingOpen, setSharingOpen] = useState(false);
  /** You cannot play yourself: the booking's own team is never the opposition. */
  const oppositionTeams = allTeams.filter((team) => team.id !== teamId);
  const sharingSelected = sharing.filter((id) => id !== teamId);
  if (sharingSelected.length !== sharing.length) setSharing(sharingSelected);

  /**
   * Re-offer the label after anything it is built from moves.
   *
   * The new values are passed in rather than read from state because a React
   * state setter does not update the variable this render is holding — reading
   * `teamId` here right after `setTeamId(next)` would build the label from the
   * team that was just replaced.
   */
  function offerLabel(next: {
    teamId?: string;
    kind?: PitchBookingKind;
    opposition?: OppositionSide;
    opponentTeamId?: string;
    opponentName?: string;
  }): void {
    const forTeam = next.teamId ?? teamId;
    const forKind = next.kind ?? kind;
    const side = next.opposition ?? opposition;
    const rivalId = next.opponentTeamId ?? opponentTeamId;
    const rivalTyped = next.opponentName ?? opponentName;

    const home =
      teams.find((team) => team.id === forTeam)?.name ??
      allTeams.find((team) => team.id === forTeam)?.name ??
      "";
    const away =
      side === "internal"
        ? (allTeams.find((team) => team.id === rivalId)?.name ?? "")
        : rivalTyped;
    const offered = forKind === "fixture" ? matchLabel(home, away) : "";

    setLabel((current) => nextSuggestedLabel(current, suggestion, offered));
    setSuggestion(offered);
  }

  return (
    <form action={action} className="space-y-5">
      {/* Said plainly, once, before anything is filled in: a coach is asking,
          not booking. The database says the same thing — `bookings_team_guard()`
          pins a non-administrator's pitch booking to `pending` whatever is
          posted — but nobody should have to submit the form to find out. */}
      {!canConfirm && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This is a <span className="font-medium">request</span>. It goes to a club administrator
          for approval and is held as <span className="font-medium">Awaiting confirmation</span>{" "}
          until they confirm it — the pitch is reserved for you in the meantime, and you can see
          where it has got to on{" "}
          <Link href="/pitches/mine" className="underline underline-offset-2">
            My pitch bookings
          </Link>
          .
          {couldConfirmInAdminView && (
            <>
              {" "}
              You are looking at the club as a coach. Switch the view to{" "}
              <span className="font-medium">Club admin</span> if you meant to confirm this one
              yourself.
            </>
          )}
        </p>
      )}

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
              // A team cannot be its own opposition.
              const rival = opponentTeamId === next ? "" : opponentTeamId;
              if (rival !== opponentTeamId) setOpponentTeamId(rival);
              offerLabel({ teamId: next, opponentTeamId: rival });
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
              offerLabel({ kind: next });
            }}
          >
            <option value="training">{PITCH_BOOKING_KIND_LABELS.training}</option>
            <option value="fixture">{PITCH_BOOKING_KIND_LABELS.fixture}</option>
            <option value="block">{PITCH_BOOKING_KIND_LABELS.block}</option>
          </Select>
        </div>

      </div>

      {/* Adam, 2026-08-25: "if match is selected, it should ask if the
          opposition is internal (and then choose the team) or external (free
          type)". The answer becomes the label the pitch diary shows, and — for
          an internal opposition since 20260825410000 — `bookings.opponent_team_id`,
          which is what `create_internal_match_fixtures()` builds the two
          mirrored fixture rows from when the request is confirmed. An external
          club has no team row and so still creates no fixture at all. */}
      {kind === "fixture" && (
        <fieldset className="space-y-3 rounded-lg border bg-secondary/40 p-3">
          <legend className="px-1 text-sm font-medium">Who is the match against?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(
              [
                ["internal", "Another team in the club"],
                ["external", "A club from outside"],
              ] as const
            ).map(([value, caption]) => (
              <label key={value} className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0">
                <input
                  type="radio"
                  name="opposition"
                  value={value}
                  checked={opposition === value}
                  onChange={() => {
                    setOpposition(value);
                    offerLabel({ opposition: value });
                  }}
                  className="h-4 w-4 border-input"
                />
                {caption}
              </label>
            ))}
          </div>

          {opposition === "internal" ? (
            <div className="space-y-1">
              <Label htmlFor="opponent_team_id">Opposition team</Label>
              <Select
                id="opponent_team_id"
                name="opponent_team_id"
                value={opponentTeamId}
                onChange={(event) => {
                  const next = event.target.value;
                  setOpponentTeamId(next);
                  offerLabel({ opponentTeamId: next });
                }}
              >
                <option value="">Choose a team…</option>
                {oppositionTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {teamLabel(team)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Both teams are the club&apos;s, so this books the pitch once, for the team above.
                When a club administrator confirms it, the match appears on both teams&apos;
                pages — the team above at home, the opposition away.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="opponent_name">Opposition club</Label>
              <Input
                id="opponent_name"
                name="opponent_name"
                maxLength={80}
                placeholder="e.g. Sale Sharks"
                value={opponentName}
                onChange={(event) => {
                  const next = event.target.value;
                  setOpponentName(next);
                  offerLabel({ opponentName: next });
                }}
              />
            </div>
          )}
        </fieldset>
      )}

      {/* The label sits below the match box (Adam, 2026-08-26): what fills it
          in is above it, so the pre-filled value makes sense when it appears. */}
      <div className="space-y-1">
        <Label htmlFor="occasion">Label</Label>
        <Input
          id="occasion"
          name="occasion"
          maxLength={120}
          placeholder={kind === "fixture" ? "e.g. U14 Mavericks v Sale Sharks" : "e.g. Tuesday training"}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {kind === "fixture"
            ? "What the club calendar shows. Filled in from the teams above — change it if you want it to read differently."
            : "What the club calendar shows. Left blank, it shows the team name."}
        </p>
      </div>

      {sharingCandidates.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="sharing-toggle">Other teams sharing this session</Label>
          {/* A dropdown of tick boxes (Adam, 2026-08-26): the club has more
              teams than fit as a row of checkboxes, and most sessions share
              with none of them. The chosen ids are posted as hidden inputs so
              the form still submits plain `extra_team_ids` values. */}
          <div className="relative">
            <button
              id="sharing-toggle"
              type="button"
              aria-expanded={sharingOpen}
              aria-haspopup="listbox"
              onClick={() => setSharingOpen((open) => !open)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm lg:min-h-[2.25rem]"
            >
              <span className={sharing.length === 0 ? "text-muted-foreground" : undefined}>
                {sharing.length === 0
                  ? "No other teams"
                  : sharing.length === 1
                    ? teamLabel(sharingCandidates.find((team) => team.id === sharing[0]) ?? sharingCandidates[0]!)
                    : `${sharing.length} teams`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>

            {sharingOpen && (
              <div
                role="listbox"
                aria-multiselectable
                className="absolute z-20 mt-1 max-h-[50dvh] w-full overflow-y-auto rounded-md border bg-card p-1 shadow-lg"
              >
                {sharingCandidates.map((team) => {
                  const picked = sharing.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      role="option"
                      aria-selected={picked}
                      className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-secondary lg:min-h-[2rem]"
                    >
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={(event) =>
                          setSharing((current) =>
                            event.target.checked
                              ? [...current, team.id]
                              : current.filter((id) => id !== team.id),
                          )
                        }
                        className="h-4 w-4 rounded border-input"
                      />
                      {teamLabel(team)}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {sharing.map((id) => (
            <input key={id} type="hidden" name="extra_team_ids" value={id} />
          ))}

          <p className="text-xs text-muted-foreground">
            Shared teams see the session on their own team page. The team above stays the one
            responsible for it.
          </p>
        </div>
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

      {canConfirm && (
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
          {pending ? "Checking the pitch…" : canConfirm ? "Save booking" : "Request pitch"}
        </Button>
        {!canConfirm && (
          <p className="text-xs text-muted-foreground">
            Requests are held until a club administrator confirms them.
          </p>
        )}
      </div>
    </form>
  );
}
