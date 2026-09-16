"use client";

/**
 * A fixture, opened where it is (P8.4). The matches grid is the desk; this is
 * what a card opens into — the kick-off, the pitch, the replies, and the four
 * things an administrator does to a match, without leaving the grid behind.
 *
 * ONE SHEET, ONE OR MANY FIXTURES. `fixtures` is the object the sheet is
 * about: one card clicked, or every card ticked ("12 fixtures"). The four
 * forms are identical either way, because the server actions behind them have
 * always been bulk — they read repeated `fixture_id` fields, and one id is one
 * field. That is why ticking several and pressing "Set kick-off" and clicking
 * one and pressing "Set kick-off" are the same post, and why nothing in this
 * file re-implements a single-fixture path.
 *
 * NOTHING HERE IS A PERMISSION. `canManage` is the SCREEN's rule, computed on
 * the server as `capability && !isMemberView(view)` and handed in; every
 * action re-checks club admin for itself, and RLS has the last word. With it
 * false the sheet is the fixture's facts and the door to its event.
 *
 * Delete arms by typing the count back — the number, not the word "yes",
 * because the number is the thing worth checking. Kept exactly as the manage
 * panel had it (Adam, 2026-09-02).
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, CalendarX2, LandPlot, Trash2 } from "lucide-react";

import {
  bulkAllocatePitch,
  bulkCancelFixtures,
  bulkDeleteFixtures,
  bulkSetKickoffTime,
  type MatchAdminState,
} from "@/app/(app)/matches/fixture-admin-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";

/** What the sheet is doing: reading the fixture, or one of the four edits. */
export type FixtureSheetMode = "view" | "kickoff" | "pitch" | "cancel" | "delete";

/**
 * What the sheet needs of a fixture. A `Pick` of the desk's own row in all
 * but name, so `/matches` hands its rows over unchanged and `/teams/[id]`
 * (P8.7) can build the same shape from its own read.
 */
export type FixtureSheetFixture = {
  id: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  opponent: string;
  isHome: boolean;
  /** "Sat 6 Sep" and "10:30" — London wall clock, formatted by the server. */
  dateLabel: string;
  time: string;
  /** "Banky Lane 1" · "Away" · "Needs a pitch". */
  pitchLabel: string;
  venueText?: string | null;
  competition?: string | null;
  /** `fixtures.status` — scheduled, cancelled, postponed, played. */
  status: string;
  replies: { in: number; out: number; total: number };
  /** A scheduled home fixture with no pitch and no central venue. */
  needsPitch: boolean;
};

export type FixtureSheetProps = {
  open: boolean;
  /** The fixture the sheet is about, or the ticked many. Empty closes it. */
  fixtures: FixtureSheetFixture[];
  mode: FixtureSheetMode;
  onMode: (mode: FixtureSheetMode) => void;
  onClose: () => void;
  /**
   * Whether the four forms are offered at all. The SCREEN's gate —
   * `capability && !isMemberView(view)` — computed on the server.
   */
  canManage: boolean;
  /** Active pitches for the pitch mode; empty hides that mode. */
  pitches: { id: string; name: string }[];
  /** Where the event door comes back to, e.g. "/matches". */
  from?: string;
  /** A server action reported success: the caller refreshes and drops its ticks. */
  onDone?: () => void;
};

const EMPTY: MatchAdminState = {};

/** "1 fixture" / "12 fixtures". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function fixtureLine(fixture: FixtureSheetFixture): string {
  return `${fixture.dateLabel} · ${fixture.time} · ${fixture.teamName} v ${fixture.opponent}`;
}

/** Every ticked fixture as the repeated field the bulk actions read. */
function HiddenIds({ fixtures }: { fixtures: FixtureSheetFixture[] }) {
  return (
    <>
      {fixtures.map((fixture) => (
        <input key={fixture.id} type="hidden" name="fixture_id" value={fixture.id} />
      ))}
    </>
  );
}

function Messages({ states }: { states: MatchAdminState[] }) {
  const errors = states.map((state) => state.error).filter(Boolean);
  const notices = states.map((state) => state.notice).filter(Boolean);
  const warnings = states.flatMap((state) => state.warnings ?? []);
  if (errors.length + notices.length + warnings.length === 0) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {errors.map((error, index) => (
        <Callout key={`e${index}`} tone="danger">
          {error}
        </Callout>
      ))}
      {notices.map((notice, index) => (
        <Callout key={`n${index}`} tone="success">
          {notice}
        </Callout>
      ))}
      {warnings.map((warning, index) => (
        <Callout key={`w${index}`} tone="warning">
          {warning}
        </Callout>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The body: what the sheet is about, then the mode's form
// ---------------------------------------------------------------------------

function FixtureFacts({ fixture, from }: { fixture: FixtureSheetFixture; from?: string }) {
  const short = fixture.replies.total > 0 && fixture.replies.in * 2 < fixture.replies.total;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={fixture.isHome ? "default" : "muted"}>{fixture.isHome ? "Home" : "Away"}</Badge>
        {fixture.isHome ? (
          <Badge variant={fixture.needsPitch ? "warning" : "outline"}>{fixture.pitchLabel}</Badge>
        ) : fixture.venueText ? (
          <Badge variant="outline">{fixture.venueText}</Badge>
        ) : null}
        <Badge variant={short ? "destructive" : fixture.replies.in > 0 ? "success" : "muted"}>
          {fixture.replies.in} of {fixture.replies.total} in
        </Badge>
        {fixture.replies.out > 0 ? <Badge variant="muted">{fixture.replies.out} out</Badge> : null}
        {fixture.status !== "scheduled" ? <Badge variant="muted">{fixture.status}</Badge> : null}
        {fixture.competition ? <Badge variant="outline">{fixture.competition}</Badge> : null}
      </div>
      {fixture.eventId ? (
        <Link
          href={`/events/${fixture.eventId}${from ? `?from=${from}` : ""}`}
          className="touch inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the fixture <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground">
          This match has no diary entry yet — the replies and the reminders live there once it does.
        </p>
      )}
    </div>
  );
}

function ManyFacts({ fixtures }: { fixtures: FixtureSheetFixture[] }) {
  const teams = new Set(fixtures.map((fixture) => fixture.teamName));
  const needPitch = fixtures.filter((fixture) => fixture.needsPitch).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{plural(teams.size, "team", "teams")}</Badge>
        {needPitch > 0 ? <Badge variant="warning">{needPitch} without a pitch</Badge> : null}
      </div>
      {/* Edge to edge, so the list reads as the sheet's contents rather than
          a box inside it. */}
      <ul className="-mx-4 max-h-56 divide-y overflow-y-auto border-y lg:-mx-5">
        {fixtures.map((fixture) => (
          <li key={fixture.id} className="px-4 py-2 text-list lg:px-5">
            {fixtureLine(fixture)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FixtureSheet({
  open,
  fixtures,
  mode,
  onMode,
  onClose,
  canManage,
  pitches,
  from,
  onDone,
}: FixtureSheetProps) {
  const [timeState, timeAction, settingTime] = useActionState(bulkSetKickoffTime, EMPTY);
  const [pitchState, pitchAction, allocating] = useActionState(bulkAllocatePitch, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState(bulkCancelFixtures, EMPTY);
  const [deleteState, deleteAction, deleting] = useActionState(bulkDeleteFixtures, EMPTY);
  const [confirmCount, setConfirmCount] = useState("");

  const busy = settingTime || allocating || cancelling || deleting;
  const one = fixtures.length === 1 ? fixtures[0] : undefined;
  const armed = confirmCount.trim() === String(fixtures.length) && fixtures.length > 0;

  const states = useMemo(
    () => [timeState, pitchState, cancelState, deleteState],
    [timeState, pitchState, cancelState, deleteState],
  );

  // A finished action means the rows behind the sheet are stale. The caller
  // refetches and puts its ticks down; the sheet goes back to the facts.
  const doneStamp = states.map((state) => state.notice ?? "").join("|");
  useEffect(() => {
    if (doneStamp.replace(/\|/g, "") === "") return;
    setConfirmCount("");
    onDone?.();
    // `onDone` is an inline arrow at every call site, so depending on it would
    // re-fire this on every render of the page above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneStamp]);

  // The ticks changed under the sheet: the typed count no longer matches what
  // delete would take, so it disarms rather than arming for a different set.
  useEffect(() => {
    setConfirmCount("");
  }, [fixtures.length]);

  if (!open || fixtures.length === 0) return null;

  const title = one ? `${one.teamName} v ${one.opponent}` : plural(fixtures.length, "fixture", "fixtures");
  const subtitle = one
    ? `${one.dateLabel} · ${one.time}${one.isHome ? ` · ${one.pitchLabel}` : " · Away"}`
    : "Everything below acts on all of them";

  const modeButton = (next: FixtureSheetMode, label: string, icon: React.ReactNode, tone?: "destructive") => (
    <Button
      type="button"
      size="sm"
      variant={mode === next ? "default" : "outline"}
      onClick={() => onMode(mode === next ? "view" : next)}
      className={tone === "destructive" && mode !== next ? "touch text-destructive hover:text-destructive" : "touch"}
    >
      {icon}
      {label}
    </Button>
  );

  return (
    <Sheet open onClose={onClose} title={title} subtitle={subtitle} side="drawer" width={460} busy={busy}>
      <div className="space-y-5">
        {one ? <FixtureFacts fixture={one} from={from} /> : <ManyFacts fixtures={fixtures} />}

        <Messages states={states} />

        {canManage ? (
          <section className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              {modeButton("kickoff", "Kick-off", <CalendarClock className="h-4 w-4" aria-hidden />)}
              {pitches.length > 0
                ? modeButton("pitch", "Pitch", <LandPlot className="h-4 w-4" aria-hidden />)
                : null}
              {modeButton("cancel", "Cancel", <CalendarX2 className="h-4 w-4" aria-hidden />)}
              {modeButton("delete", "Delete", <Trash2 className="h-4 w-4" aria-hidden />, "destructive")}
            </div>

            {mode === "kickoff" ? (
              <form action={timeAction} className="space-y-3 rounded-xl border bg-secondary/40 p-3">
                <HiddenIds fixtures={fixtures} />
                <div className="space-y-1.5">
                  <Label htmlFor="fs-kickoff">New kick-off time</Label>
                  <Input id="fs-kickoff" name="kickoff_time" type="time" required className="touch w-32" />
                </div>
                <p className="text-xs text-muted-foreground">
                  The pitch booking moves with the match. Where the new hour clashes with something
                  else the booking is left where it is and the match is flagged instead.
                </p>
                <Button type="submit" size="sm" className="touch" disabled={busy}>
                  {settingTime ? "Moving…" : "Set kick-off"}
                </Button>
              </form>
            ) : null}

            {mode === "pitch" && pitches.length > 0 ? (
              <form action={pitchAction} className="space-y-3 rounded-xl border bg-secondary/40 p-3">
                <HiddenIds fixtures={fixtures} />
                <div className="space-y-1.5">
                  <Label htmlFor="fs-pitch">Pitch</Label>
                  {/* min-w-0: WebKit will not shrink a select below its longest
                      option without it, and pitch names run long. */}
                  <Select id="fs-pitch" name="resource_id" required defaultValue="" className="touch min-w-0">
                    <option value="" disabled>
                      Choose a pitch…
                    </option>
                    {pitches.map((pitch) => (
                      <option key={pitch.id} value={pitch.id}>
                        {pitch.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fs-pitch-ko">Kick-off (optional)</Label>
                  <Input id="fs-pitch-ko" name="kickoff_time" type="time" className="touch w-32" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Booking the pitch runs the same clash check as any hire. A blank kick-off keeps
                  each match&apos;s own time.
                </p>
                <Button type="submit" size="sm" className="touch" disabled={busy}>
                  {allocating ? "Allocating…" : "Allocate the pitch"}
                </Button>
              </form>
            ) : null}

            {mode === "cancel" ? (
              <form action={cancelAction} className="space-y-3 rounded-xl border bg-secondary/40 p-3">
                <HiddenIds fixtures={fixtures} />
                <p className="text-sm">
                  Cancelling frees the pitch and keeps the record — putting the match back to
                  scheduled re-books it. Everyone involved is told.
                </p>
                <Button type="submit" size="sm" variant="outline" className="touch" disabled={busy}>
                  {cancelling
                    ? "Cancelling…"
                    : one
                      ? "Cancel this match"
                      : `Cancel ${plural(fixtures.length, "match", "matches")}`}
                </Button>
              </form>
            ) : null}

            {mode === "delete" ? (
              <form action={deleteAction} className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <HiddenIds fixtures={fixtures} />
                <p className="text-sm">
                  Deleting removes the match, its diary entry and everyone&apos;s answers, and gives
                  the pitch back first. Nothing brings those answers back.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="fs-confirm">Type {fixtures.length} to arm delete</Label>
                  <Input
                    id="fs-confirm"
                    value={confirmCount}
                    onChange={(event) => setConfirmCount(event.target.value)}
                    inputMode="numeric"
                    className="touch w-24"
                  />
                </div>
                <Button type="submit" size="sm" variant="destructive" className="touch" disabled={busy || !armed}>
                  {deleting ? "Deleting…" : one ? "Delete this match" : `Delete ${fixtures.length}`}
                </Button>
              </form>
            ) : null}
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
