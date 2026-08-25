"use client";

/**
 * The end-of-season wizard's one form (Adam, 2026-08-25: "a fully functioning
 * end of season process to upgrade age groups etc").
 *
 * The table IS the preview: every active team with what the rollover will do
 * to it — "U14 → U15" computed by the same `bump_age_group()` the rollover
 * runs, so what is shown is what happens. Each team has one decision: carry
 * it into the new season (default; the roster, staff and shirt numbers come
 * too) or retire it (marked inactive, roster left in the closing season).
 *
 * The run is guarded twice: a confirmation tick here, and the database's own
 * refusals — wrong-way-round seasons and second runs come back P0001 with the
 * reason, shown verbatim.
 */

import { useActionState, useState } from "react";
import { AlertCircle, ArrowRight, CalendarPlus, CheckCircle2, Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

import { createNextSeason, runEndOfSeason, type RolloverState } from "./eos-actions";

export type EosTeamRow = {
  id: string;
  name: string;
  ageGroup: string | null;
  proposedName: string;
  proposedAgeGroup: string | null;
  players: number;
  staff: number;
};

export type EosSeasonOption = { id: string; name: string; startsOn: string; endsOn: string };

const EMPTY: RolloverState = {};

function Feedback({ state }: { state: RolloverState }) {
  if (state.error) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="break-words">{state.error}</span>
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {state.notice}
      </p>
    );
  }
  return null;
}

export function EndOfSeasonForm({
  currentSeasonName,
  targetSeasons,
  teams,
}: {
  currentSeasonName: string;
  targetSeasons: EosSeasonOption[];
  teams: EosTeamRow[];
}) {
  const [state, action, pending] = useActionState(runEndOfSeason, EMPTY);
  const [seasonState, seasonAction, seasonPending] = useActionState(createNextSeason, EMPTY);
  const [retired, setRetired] = useState<Set<string>>(new Set());

  const toggleRetire = (teamId: string) => {
    setRetired((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  if (state.summary) {
    const s = state.summary;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="h-4 w-4" /> {s.from_season} → {s.to_season}: done.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-0.5">
            <li>
              {s.teams_upgraded} {s.teams_upgraded === 1 ? "team" : "teams"} moved up an age group
            </li>
            <li>
              {s.teams_retired} {s.teams_retired === 1 ? "team" : "teams"} retired
            </li>
            <li>
              {s.players_carried} players and {s.staff_carried} staff carried into {s.to_season},
              shirt numbers included
            </li>
            <li>{s.to_season} is now the current season</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-secondary/40 px-4 py-3 text-sm">
          <p className="font-medium">What happens by itself, and what still needs a hand:</p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-muted-foreground">
            <li>
              Full-Time imports and the join flow now write into {s.to_season} automatically. The
              club-wide widgets keep matching teams because the names moved up with the age
              groups.
            </li>
            <li>
              A team with its own Full-Time link needs re-linking once the FA publishes the new
              season — each team&apos;s Settings tab, FA Full-Time link.
            </li>
            <li>
              Nobody is auto-registered: health questions and consents are per season, so
              families re-register through the join page as the season starts.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {targetSeasons.length === 0 ? (
        <form action={seasonAction} className="space-y-3 rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">First, the season to roll into</p>
          <p className="text-xs text-muted-foreground">
            No season after {currentSeasonName} exists yet — create it here, then run the
            rollover.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="eos-season-name">Name</Label>
              <Input id="eos-season-name" name="name" placeholder="e.g. 2027/28" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eos-season-start">Starts on</Label>
              <Input id="eos-season-start" name="starts_on" type="date" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eos-season-end">Ends on</Label>
              <Input id="eos-season-end" name="ends_on" type="date" required />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={seasonPending}>
            <CalendarPlus className="h-4 w-4" />
            {seasonPending ? "Creating…" : "Create the season"}
          </Button>
          <Feedback state={seasonState} />
        </form>
      ) : (
        <form action={action} className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor="eos-target">Roll {currentSeasonName} into</Label>
            <Select id="eos-target" name="season_id" defaultValue={targetSeasons[0]?.id} required>
              {targetSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 font-medium">Age group</th>
                  <th className="px-3 py-2 font-medium">Squad</th>
                  <th className="px-3 py-2 font-medium">Retire</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {teams.map((team) => {
                  const isRetired = retired.has(team.id);
                  const nameChanges = team.proposedName !== team.name;
                  const ageChanges = (team.proposedAgeGroup ?? "") !== (team.ageGroup ?? "");
                  return (
                    <tr key={team.id} className={isRetired ? "bg-muted/40 text-muted-foreground" : ""}>
                      <td className="px-3 py-2">
                        {/* The ticked state decides which hidden input this row
                            submits — one decision, one name. */}
                        <input type="hidden" name={isRetired ? "retire" : "upgrade"} value={team.id} />
                        <span className="font-medium">{team.name}</span>
                        {nameChanges && !isRetired && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <ArrowRight className="h-3 w-3" /> {team.proposedName}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isRetired ? (
                          <Badge variant="muted">retiring</Badge>
                        ) : ageChanges ? (
                          <span className="inline-flex items-center gap-1">
                            {team.ageGroup ?? "—"} <ArrowRight className="h-3 w-3" />{" "}
                            <span className="font-medium">{team.proposedAgeGroup}</span>
                          </span>
                        ) : (
                          <span>{team.ageGroup ?? "—"} · unchanged</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {team.players} players · {team.staff} staff
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Retire ${team.name}`}
                          checked={isRetired}
                          onChange={() => toggleRetire(team.id)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              I understand: every unticked team moves up an age group (name included), its squad
              and staff carry into the new season, ticked teams are retired, and the new season
              becomes current for imports and registrations.
            </span>
          </label>

          <Button type="submit" disabled={pending || teams.length === 0}>
            <Repeat className="h-4 w-4" />
            {pending ? "Rolling over…" : "Run the end of season"}
          </Button>
          <Feedback state={state} />
        </form>
      )}
    </div>
  );
}
