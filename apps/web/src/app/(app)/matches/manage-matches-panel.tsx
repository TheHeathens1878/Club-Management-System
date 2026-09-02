"use client";

/**
 * Manage matches — tick some, then cancel them, delete them, or put them all
 * at the same kick-off.
 *
 * Adam, 2026-09-02: "I need the ability to bulk delete and cancel matches (as
 * admin) for an individual team and the matches tab", and "I (admin) need the
 * ability to change KO times… bulk on the matches screen."
 *
 * ONE PANEL, BOTH SCREENS. The club-wide list and a team's own fixtures tab
 * show very different tables — mobile cards, headcount chips, Full-Time dots —
 * and threading a checkbox column through both would have meant two
 * implementations of the same three buttons. This is a separate, plainer list:
 * the date, the game, and what state it is in. It sits behind a summary that
 * is shut until an administrator wants it, so the ordinary read of the page is
 * untouched.
 *
 * DELETE ASKS TWICE, CANCEL ASKS ONCE. Cancelling is reversible and keeps the
 * record; deleting takes the team sheet, the availability and the stats with
 * it, and nothing brings those back. So the delete button only arms after the
 * count is typed back — the number, not the word "yes", because the number is
 * the thing worth checking.
 */

import { useActionState, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";

import {
  bulkCancelFixtures,
  bulkDeleteFixtures,
  bulkSetKickoffTime,
  type MatchAdminState,
} from "./fixture-admin-actions";

const EMPTY: MatchAdminState = {};

export type ManageableMatch = {
  id: string;
  kickoffAt: string;
  isHome: boolean;
  opponent: string;
  status: string;
  /** Shown only on the club-wide list, where one row is not obviously whose. */
  teamName?: string | null;
  /** Full-Time has stopped publishing it — the row Adam could not shift. */
  notInFullTime?: boolean;
  /** It holds a pitch, so a delete gives the slot back. */
  hasPitch?: boolean;
};

function Feedback({ state }: { state: MatchAdminState }) {
  if (!state.error && !state.notice && !state.warnings?.length) return null;
  return (
    <div className="space-y-2">
      {state.error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}
      {state.notice && (
        <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.notice}</span>
        </p>
      )}
      {state.warnings && state.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          {state.warnings.map((warning) => (
            <li key={warning} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ManageMatchesPanel({
  matches,
  heading = "Manage matches",
}: {
  matches: ManageableMatch[];
  heading?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmCount, setConfirmCount] = useState("");
  const [cancelState, cancel, cancelling] = useActionState(bulkCancelFixtures, EMPTY);
  const [deleteState, remove, deleting] = useActionState(bulkDeleteFixtures, EMPTY);
  const [timeState, setTime, settingTime] = useActionState(bulkSetKickoffTime, EMPTY);

  const chosen = useMemo(
    () => matches.filter((match) => selected.has(match.id)),
    [matches, selected],
  );
  const count = chosen.length;
  const armed = confirmCount.trim() === String(count) && count > 0;
  const busy = cancelling || deleting || settingTime;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmCount("");
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === matches.length ? new Set() : new Set(matches.map((m) => m.id)),
    );
    setConfirmCount("");
  }

  /** Every ticked id, on whichever of the three forms is submitting. */
  const hidden = chosen.map((match) => (
    <input key={match.id} type="hidden" name="fixture_id" value={match.id} />
  ));

  if (matches.length === 0) {
    return <p className="text-sm text-muted-foreground">No matches to manage here.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{heading}</p>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
          {selected.size === matches.length ? "Clear all" : `Select all ${matches.length}`}
        </Button>
      </div>

      <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
        {matches.map((match) => {
          const local = instantToLocal(match.kickoffAt);
          const ticked = selected.has(match.id);
          return (
            <li key={match.id}>
              <label
                className={
                  "flex min-h-[44px] cursor-pointer items-start gap-3 px-3 py-2.5 text-sm " +
                  (ticked ? "bg-primary/5" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() => toggle(match.id)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {match.teamName ? `${match.teamName} ` : ""}
                    {match.isHome ? "v" : "away to"} {match.opponent}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatBookingDateShort(local.date)} · {local.time}
                    {match.hasPitch ? " · pitch booked" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {match.status !== "scheduled" && (
                    <Badge variant="muted" className="capitalize">
                      {match.status}
                    </Badge>
                  )}
                  {match.notInFullTime && <Badge variant="warning">Not in Full-Time</Badge>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-muted-foreground">
        {count === 0 ? "Nothing ticked." : `${count} ticked.`}
      </p>

      {/* Kick-off, then cancel, then delete: the order they get reached for. */}
      <form action={setTime} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        {hidden}
        <div className="space-y-1">
          <Label htmlFor="bulk-kickoff" className="text-xs">
            Kick-off time
          </Label>
          <Input id="bulk-kickoff" name="kickoff_time" type="time" required className="w-32" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy || count === 0} className="gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          {settingTime ? "Moving…" : "Set kick-off"}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Each match keeps its own date and moves to this time. The pitch booking, the diary entry
          and everybody&apos;s notifications follow it.
        </p>
      </form>

      <form action={cancel} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        {hidden}
        <Button type="submit" size="sm" variant="outline" disabled={busy || count === 0} className="gap-1.5">
          <XCircle className="h-3.5 w-3.5" />
          {cancelling ? "Cancelling…" : `Cancel ${count || ""} ${count === 1 ? "match" : "matches"}`.trim()}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Keeps the record and frees the pitch. Putting a match back to scheduled re-books it.
        </p>
      </form>

      <form action={remove} className="space-y-2 rounded-lg border border-destructive/30 p-3">
        {hidden}
        <p className="text-sm font-medium text-destructive">Delete for good</p>
        <p className="text-xs text-muted-foreground">
          Takes the team sheets, the availability answers and the match stats with it, and nothing
          brings those back. Any pitch is given back first. If the game is simply off, cancel it
          instead.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="bulk-delete-confirm" className="text-xs">
              Type {count || "the number"} to confirm
            </Label>
            <Input
              id="bulk-delete-confirm"
              value={confirmCount}
              onChange={(event) => setConfirmCount(event.target.value)}
              inputMode="numeric"
              className="w-32"
              disabled={count === 0}
            />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={busy || !armed} className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </form>

      <Feedback state={timeState} />
      <Feedback state={cancelState} />
      <Feedback state={deleteState} />
    </div>
  );
}
