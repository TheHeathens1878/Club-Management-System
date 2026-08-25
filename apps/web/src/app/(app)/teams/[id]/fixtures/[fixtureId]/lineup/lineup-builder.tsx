"use client";

/**
 * The lineup builder — pick a formation, tap a slot, pick a player.
 *
 * Tap-to-assign, not drag: a drag on a 390px pitch is a fight with the page's
 * own scroll, and the coach is doing this one-handed on a touchline. Tapping an
 * empty slot opens the sheet of unplaced players; tapping a filled one offers
 * the same sheet plus "Take off the pitch". A player already standing somewhere
 * else simply moves — the database's (lineup, person) unique key says the same
 * thing, and the screen should not make the coach undo before they redo.
 *
 * Changing formation keeps everyone whose slot key survives ("CB1" is "CB1" in
 * 4-4-2 and 4-3-3) and returns the rest to the unplaced list, so switching
 * shape to see how it looks costs nothing.
 *
 * Nothing is written until Save; Cancel puts the board back to what the server
 * last sent.
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import type { Database } from "@club/db";

import { PlayerToken } from "@/components/player-token";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formationByName, formationsFor, type PlayingFormat } from "@/lib/formations";

import { saveFixtureLineup, type FixtureLineupState } from "./actions";
import { PitchBoard } from "./pitch-board";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

const EMPTY: FixtureLineupState = {};

const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Unavailable",
};

function availabilityVariant(
  status: AvailabilityStatus | null,
): "success" | "warning" | "destructive" | "muted" {
  if (status === "available") return "success";
  if (status === "maybe") return "warning";
  if (status === "unavailable") return "destructive";
  return "muted";
}

export type SquadPlayer = {
  personId: string;
  name: string;
  shirtNumber: number | null;
  availability: AvailabilityStatus | null;
};

export function LineupBuilder({
  fixtureId,
  teamId,
  format,
  initialFormation,
  initialPlacements,
  squad,
  canManage,
}: {
  fixtureId: string;
  teamId: string;
  format: PlayingFormat;
  initialFormation: string;
  /** slot key → person id, as last saved. */
  initialPlacements: Record<string, string>;
  squad: SquadPlayer[];
  canManage: boolean;
}) {
  const options = formationsFor(format);
  const [formationName, setFormationName] = useState(initialFormation);
  const [placements, setPlacements] = useState<Record<string, string>>(initialPlacements);
  const [pickingSlot, setPickingSlot] = useState<string | null>(null);
  const [state, action, saving] = useActionState(saveFixtureLineup, EMPTY);

  // What the server last confirmed. A successful save makes the board the new
  // baseline, so "Unsaved changes" goes quiet without a reload.
  const [saved, setSaved] = useState(() => JSON.stringify([initialFormation, initialPlacements]));
  useEffect(() => {
    if (state.notice) setSaved(JSON.stringify([formationName, placements]));
    // Only a fresh notice marks a save; the board is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notice]);

  const formation = formationByName(format, formationName);
  const playersById = useMemo(
    () => new Map(squad.map((player) => [player.personId, player])),
    [squad],
  );
  const placedIds = useMemo(() => new Set(Object.values(placements)), [placements]);
  const unplaced = squad.filter((player) => !placedIds.has(player.personId));
  const dirty = JSON.stringify([formationName, placements]) !== saved;
  const filled = formation.slots.filter((slot) => placements[slot.key]).length;

  /** Keep whoever still has a slot; the rest go back to the list. */
  function changeFormation(name: string) {
    const next = formationByName(format, name);
    const keys = new Set(next.slots.map((slot) => slot.key));
    const kept: Record<string, string> = {};
    for (const [slot, personId] of Object.entries(placements)) {
      if (keys.has(slot)) kept[slot] = personId;
    }
    setFormationName(next.name);
    setPlacements(kept);
  }

  /** Put someone on a slot, lifting them off wherever they were standing. */
  function assign(slotKey: string, personId: string) {
    setPlacements((current) => {
      const next: Record<string, string> = {};
      for (const [slot, id] of Object.entries(current)) {
        if (slot !== slotKey && id !== personId) next[slot] = id;
      }
      next[slotKey] = personId;
      return next;
    });
    setPickingSlot(null);
  }

  function clearSlot(slotKey: string) {
    setPlacements((current) => {
      const next = { ...current };
      delete next[slotKey];
      return next;
    });
    setPickingSlot(null);
  }

  /** The "+" beside an unplaced player: first empty slot, front to back. */
  function placeInFirstFreeSlot(personId: string) {
    const free = formation.slots.find((slot) => !placements[slot.key]);
    if (free) assign(free.key, personId);
  }

  function reset() {
    setFormationName(initialFormation);
    setPlacements(initialPlacements);
    setPickingSlot(null);
  }

  const board = (
    <PitchBoard
      formation={formation}
      placements={placements}
      playersById={playersById}
      onSlotTap={canManage ? (slotKey) => setPickingSlot(slotKey) : undefined}
      activeSlot={pickingSlot}
    />
  );

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      {state.error && (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && !dirty && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      {canManage ? (
        <div className="space-y-1.5">
          <label htmlFor="lineup-formation" className="text-xs text-muted-foreground">
            Formation ({format})
          </label>
          <select
            id="lineup-formation"
            value={formationName}
            onChange={(event) => changeFormation(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant="default">{formation.name}</Badge>
          <span className="text-sm text-muted-foreground">
            {format} · {filled} of {formation.slots.length} named
          </span>
        </div>
      )}

      {board}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            {canManage ? "Unplaced players" : "Not on the pitch"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {filled} of {formation.slots.length} placed
          </span>
        </div>

        {unplaced.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            {squad.length === 0
              ? "No players hold a live membership of this team yet."
              : "Everyone in the squad is on the pitch."}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {unplaced.map((player) => (
              <li key={player.personId} className="flex min-h-[44px] items-center gap-3 px-3 py-2">
                <PlayerToken
                  name={player.name}
                  shirtNumber={player.shirtNumber}
                  className="h-9 w-9 flex-none"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{player.name}</span>
                {player.availability && (
                  <Badge variant={availabilityVariant(player.availability)}>
                    {AVAILABILITY_LABEL[player.availability]}
                  </Badge>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => placeInFirstFreeSlot(player.personId)}
                    disabled={filled >= formation.slots.length}
                    aria-label={`Put ${player.name} in the next free position`}
                    className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-primary disabled:opacity-40"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <form action={action} className="sticky bottom-0 -mx-4 flex gap-2 bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:px-0 lg:backdrop-blur-none">
          <input type="hidden" name="fixture_id" value={fixtureId} />
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="formation" value={formationName} />
          <input type="hidden" name="placements" value={JSON.stringify(placements)} />
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={saving || !dirty}
            className="min-h-[44px] flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="min-h-[44px] flex-1">
            {saving ? "Saving…" : dirty ? "Save lineup" : "Saved"}
          </Button>
        </form>
      )}

      {pickingSlot && (
        <PlayerPicker
          slotLabel={
            formation.slots.find((slot) => slot.key === pickingSlot)?.label ?? pickingSlot
          }
          occupant={placements[pickingSlot] ? playersById.get(placements[pickingSlot]) : undefined}
          choices={unplaced}
          onPick={(personId) => assign(pickingSlot, personId)}
          onClear={placements[pickingSlot] ? () => clearSlot(pickingSlot) : undefined}
          onClose={() => setPickingSlot(null)}
        />
      )}
    </div>
  );
}

/**
 * The sheet that opens on a slot: 44px rows, one per unplaced player, plus the
 * way off the pitch when the slot is taken. Same shape as the role switcher's
 * sheet so a phone user has met it before.
 */
function PlayerPicker({
  slotLabel,
  occupant,
  choices,
  onPick,
  onClear,
  onClose,
}: {
  slotLabel: string;
  occupant?: SquadPlayer;
  choices: SquadPlayer[];
  onPick: (personId: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose a player for ${slotLabel}`}
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative mx-auto max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-card pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 text-card-foreground shadow-2xl lg:max-w-md lg:rounded-2xl">
        <div className="flex justify-center pb-3 lg:hidden">
          <span className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>
        <div className="flex items-start gap-2 border-b border-border px-5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">{slotLabel}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
              {occupant
                ? `${occupant.name} is here. Pick someone else to swap, or take them off.`
                : "Pick a player for this position."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-9 w-9 flex-none items-center justify-center text-muted-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {choices.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            Everyone else is already on the pitch.
          </p>
        ) : (
          choices.map((player) => (
            <button
              key={player.personId}
              type="button"
              onClick={() => onPick(player.personId)}
              className="flex min-h-[44px] w-full items-center gap-3 border-t border-border/60 px-5 py-3 text-left first-of-type:border-t-0 active:bg-secondary/60"
            >
              <PlayerToken
                name={player.name}
                shirtNumber={player.shirtNumber}
                className="h-9 w-9 flex-none"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{player.name}</span>
              {player.availability && (
                <Badge variant={availabilityVariant(player.availability)}>
                  {AVAILABILITY_LABEL[player.availability]}
                </Badge>
              )}
            </button>
          ))
        )}

        <div className="space-y-2 px-5 pt-4">
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="w-full rounded-lg border border-destructive/30 py-3 text-center text-sm font-semibold text-destructive"
            >
              Take off the pitch
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-border py-3 text-center text-sm font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
