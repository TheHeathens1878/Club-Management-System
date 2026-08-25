"use client";

/**
 * The lineup builder — pick a formation, then fill the pitch and the bench.
 *
 * TWO WAYS TO PLACE A PLAYER, and they are the same operation underneath:
 *
 *   DRAG (Adam, 2026-08-25: "Should be able to drag and drop players on to the
 *   pitch and also substitutes") — take a shirt from the squad list onto a
 *   position or a bench place, carry a shirt from one position to another
 *   (they swap), or drag a shirt back to the list to take that player off.
 *   Mouse, finger or pen, through Pointer Events; see `use-lineup-drag.ts`.
 *
 *   TAP — the original flow, and the one a keyboard or a screen reader has:
 *   tapping an empty slot opens the sheet of unplaced players, tapping a
 *   filled one offers the same sheet plus "Take off the pitch", and "+" beside
 *   a player drops them into the first free position. Nothing about it changed
 *   when dragging arrived, because a drag ends in exactly the call a tap makes.
 *
 * A player already standing somewhere else simply moves — the database's
 * (lineup, person) unique key says the same thing, and the screen should not
 * make the coach undo before they redo. The bench is not a separate list: a
 * substitute is a slot keyed "SUB1".."SUB7" in the same map and the same
 * table, which is why nobody can be on the pitch and the bench at once.
 *
 * Changing formation keeps everyone whose slot key survives ("CB1" is "CB1" in
 * 4-4-2 and 4-3-3) and returns the rest to the unplaced list, so switching
 * shape to see how it looks costs nothing. The bench survives every change of
 * shape — no formation owns those keys.
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
import {
  benchKeys,
  benchLabel,
  formationByName,
  formationsFor,
  isBenchKey,
  type PlayingFormat,
} from "@/lib/formations";
import {
  boardSignature,
  clearSlot as clearOneSlot,
  dropOnSlot,
  firstFreeSlot,
  keepSlots,
  removePlayer,
} from "@/lib/lineup-placements";
import { cn } from "@/lib/utils";

import { BenchStrip } from "./bench-strip";
import { saveFixtureLineup, type FixtureLineupState } from "./actions";
import { PitchBoard } from "./pitch-board";
import { UNPLACED_ZONE, useLineupDrag } from "./use-lineup-drag";

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
  /** slot key → person id, as last saved — pitch slots and "SUB1".. alike. */
  initialPlacements: Record<string, string>;
  squad: SquadPlayer[];
  canManage: boolean;
}) {
  const options = formationsFor(format);
  const bench = useMemo(() => benchKeys(), []);
  const [formationName, setFormationName] = useState(initialFormation);
  const [placements, setPlacements] = useState<Record<string, string>>(initialPlacements);
  const [pickingSlot, setPickingSlot] = useState<string | null>(null);
  const [state, action, saving] = useActionState(saveFixtureLineup, EMPTY);

  // What the server last confirmed. A successful save makes the board the new
  // baseline, so "Unsaved changes" goes quiet without a reload.
  const [saved, setSaved] = useState(() => boardSignature(initialFormation, initialPlacements));
  useEffect(() => {
    if (state.notice) setSaved(boardSignature(formationName, placements));
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
  const dirty = boardSignature(formationName, placements) !== saved;
  const filled = formation.slots.filter((slot) => placements[slot.key]).length;

  /** Keep whoever still has a slot; the rest go back to the list. */
  function changeFormation(name: string) {
    const next = formationByName(format, name);
    const keys = new Set(next.slots.map((slot) => slot.key));
    setFormationName(next.name);
    setPlacements((current) => keepSlots(current, (slot) => keys.has(slot) || isBenchKey(slot)));
  }

  /** Put someone on a slot, lifting them off wherever they were standing. */
  function assign(slotKey: string, personId: string) {
    setPlacements((current) => dropOnSlot(current, slotKey, personId));
    setPickingSlot(null);
  }

  function clearSlot(slotKey: string) {
    setPlacements((current) => clearOneSlot(current, slotKey));
    setPickingSlot(null);
  }

  /** The "+" beside an unplaced player: first empty slot, front to back. */
  function placeInFirstFreeSlot(personId: string) {
    const free = firstFreeSlot(
      placements,
      formation.slots.map((slot) => slot.key),
    );
    if (free) assign(free, personId);
  }

  function reset() {
    setFormationName(initialFormation);
    setPlacements(initialPlacements);
    setPickingSlot(null);
  }

  /**
   * The end of a drag. A drop on the squad list takes the player off the
   * board; a drop on nothing at all leaves the board exactly as it was, which
   * is what a coach who has changed their mind mid-drag expects.
   */
  const drag = useLineupDrag({
    enabled: canManage,
    onDrop: (personId, _from, to) => {
      if (!to) return;
      if (to === UNPLACED_ZONE) setPlacements((current) => removePlayer(current, personId));
      else setPlacements((current) => dropOnSlot(current, to, personId));
    },
  });

  /** A drag ends in a click the browser sends anyway; a tap must survive it. */
  function tapSlot(slotKey: string) {
    if (drag.consumeClick()) return;
    setPickingSlot(slotKey);
  }

  const carried = drag.carrying ? playersById.get(drag.carrying.personId) : undefined;
  const pickingLabel = pickingSlot
    ? (formation.slots.find((slot) => slot.key === pickingSlot)?.label ??
      (isBenchKey(pickingSlot) ? benchLabel(pickingSlot) : pickingSlot))
    : "";

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

      <PitchBoard
        formation={formation}
        placements={placements}
        playersById={playersById}
        onSlotTap={canManage ? tapSlot : undefined}
        activeSlot={pickingSlot}
        zoneRef={canManage ? drag.zoneRef : undefined}
        handleProps={canManage ? drag.handleProps : undefined}
        carrying={drag.carrying}
      />

      <BenchStrip
        keys={bench}
        placements={placements}
        playersById={playersById}
        onPlaceTap={canManage ? tapSlot : undefined}
        activeSlot={pickingSlot}
        zoneRef={canManage ? drag.zoneRef : undefined}
        handleProps={canManage ? drag.handleProps : undefined}
        carrying={drag.carrying}
      />

      <div
        ref={canManage ? drag.zoneRef(UNPLACED_ZONE) : undefined}
        className={cn(
          "space-y-2",
          // The list doubles as the drop target that means "take them off".
          drag.carrying?.over === UNPLACED_ZONE &&
            "rounded-xl outline-dashed outline-2 outline-offset-4 outline-primary",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            {/* Not "not on the pitch": the substitutes are not on the pitch
                either, and they are named in the strip above. */}
            {canManage ? "Unplaced players" : "Not named"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {filled} of {formation.slots.length} placed
          </span>
        </div>

        {unplaced.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            {squad.length === 0
              ? "No players hold a live membership of this team yet."
              : "Everyone in the squad is on the pitch or on the bench."}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {unplaced.map((player) => {
              const handle = canManage ? drag.handleProps(player.personId, null) : undefined;
              return (
                <li
                  key={player.personId}
                  className="flex min-h-[44px] items-center gap-3 px-3 py-2"
                >
                  {/* The shirt is the grip: only it takes the pointer, so the
                      rest of the row still scrolls the page under a finger. */}
                  <span
                    style={handle?.style}
                    onPointerDown={handle?.onPointerDown}
                    onPointerMove={handle?.onPointerMove}
                    onPointerUp={handle?.onPointerUp}
                    onPointerCancel={handle?.onPointerCancel}
                    className={canManage ? "flex-none cursor-grab" : "flex-none"}
                  >
                    <PlayerToken
                      name={player.name}
                      shirtNumber={player.shirtNumber}
                      className="h-9 w-9 flex-none"
                    />
                  </span>
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
              );
            })}
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

      {/* The shirt under the finger. Fixed to the viewport and out of the way
          of hit-testing; `use-lineup-drag` moves it by writing a transform. */}
      {drag.carrying && carried && (
        <div
          ref={drag.ghostRef}
          aria-hidden="true"
          // The margin is inline because this sits inside a `space-y-4` stack,
          // which would otherwise push the carried shirt 16px off the finger.
          style={{ margin: 0 }}
          className="pointer-events-none fixed left-0 top-0 z-[60] flex flex-col items-center"
        >
          <PlayerToken
            name={carried.name}
            shirtNumber={carried.shirtNumber}
            className="h-12 w-12 shadow-lg ring-2 ring-white"
          />
        </div>
      )}

      {pickingSlot && (
        <PlayerPicker
          slotLabel={pickingLabel}
          occupant={placements[pickingSlot] ? playersById.get(placements[pickingSlot]) : undefined}
          choices={unplaced}
          onPick={(personId) => assign(pickingSlot, personId)}
          onClear={placements[pickingSlot] ? () => clearSlot(pickingSlot) : undefined}
          onClose={() => setPickingSlot(null)}
          bench={isBenchKey(pickingSlot)}
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
  bench,
}: {
  slotLabel: string;
  occupant?: SquadPlayer;
  choices: SquadPlayer[];
  onPick: (personId: string) => void;
  onClear?: () => void;
  onClose: () => void;
  /** A bench place is "taken off the bench", not "off the pitch". */
  bench?: boolean;
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
                : bench
                  ? "Pick a substitute for this place."
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
            Everyone else is already on the pitch or on the bench.
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
              {bench ? "Take off the bench" : "Take off the pitch"}
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
