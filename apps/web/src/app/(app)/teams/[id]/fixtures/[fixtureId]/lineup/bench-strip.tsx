"use client";

/**
 * The bench, under the pitch (Adam, 2026-08-25: "Should be able to drag and
 * drop players on to the pitch and also substitutes").
 *
 * Seven places in a seven-column grid, so the whole bench fits the width of a
 * 390px phone and no place is behind a sideways scroll a coach cannot reach
 * mid-drag. Each place is a 44px target that behaves exactly like a slot on
 * the pitch: tap it to pick a name, drag a shirt onto it, drag the shirt off
 * it again. That is not a coincidence — a substitute IS a slot, keyed "SUB1"
 * to "SUB7" in the same table (see `BENCH_SIZE` in `lib/formations.ts`), which
 * is what stops anyone being named twice.
 *
 * Players and parents get the same strip without the empty places, so a family
 * can see their child is a substitute rather than left out.
 */

import { Plus } from "lucide-react";

import { PlayerToken, firstNameOf } from "@/components/player-token";
import { benchLabel } from "@/lib/formations";
import { cn } from "@/lib/utils";

import type { PlacedPlayer } from "./pitch-board";
import type { CarriedToken, DragHandleProps } from "./use-lineup-drag";

export function BenchStrip({
  keys,
  placements,
  playersById,
  onPlaceTap,
  activeSlot,
  zoneRef,
  handleProps,
  carrying,
}: {
  /** "SUB1" … "SUB7", in bench order. */
  keys: string[];
  placements: Record<string, string>;
  playersById: Map<string, PlacedPlayer>;
  /** Absent for the read-only view. */
  onPlaceTap?: (slotKey: string) => void;
  activeSlot?: string | null;
  zoneRef?: (key: string) => (element: HTMLElement | null) => void;
  handleProps?: (personId: string, from: string | null) => DragHandleProps;
  carrying?: CarriedToken | null;
}) {
  const named = keys.filter((key) => placements[key]);
  const shown = onPlaceTap ? keys : named;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Substitutes</h2>
        <span className="text-xs text-muted-foreground">
          {named.length} of {keys.length} named
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          No substitutes named.
        </p>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-2",
            onPlaceTap ? "grid grid-cols-7 gap-1" : "flex flex-wrap gap-2",
          )}
        >
          {shown.map((key) => {
            const personId = placements[key];
            const player = personId ? playersById.get(personId) : undefined;
            const active = activeSlot === key;
            const over = carrying?.over === key;
            const lifted = carrying?.personId !== undefined && carrying.personId === personId;
            const label = benchLabel(key);
            const body = (
              <>
                {player ? (
                  <PlayerToken
                    name={player.name}
                    shirtNumber={player.shirtNumber}
                    className={cn(
                      "h-11 w-11 flex-none",
                      (active || over) && "ring-2 ring-primary",
                      lifted && "opacity-40",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-dashed border-border bg-secondary/40 text-muted-foreground",
                      (active || over) && "border-solid border-primary bg-primary/10 text-primary",
                    )}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
                <span className="mt-1 block w-full truncate text-center text-[9.5px] leading-[13px] text-muted-foreground">
                  {player ? firstNameOf(player.name) : key.slice(3)}
                </span>
              </>
            );
            const drag =
              player && handleProps ? handleProps(player.personId, key) : undefined;

            return onPlaceTap ? (
              <button
                key={key}
                type="button"
                ref={zoneRef?.(key)}
                style={drag?.style}
                onClick={() => onPlaceTap(key)}
                onPointerDown={drag?.onPointerDown}
                onPointerMove={drag?.onPointerMove}
                onPointerUp={drag?.onPointerUp}
                onPointerCancel={drag?.onPointerCancel}
                className={cn(
                  "flex min-w-0 flex-col items-center rounded-lg py-1",
                  player && "cursor-grab",
                )}
                aria-label={
                  player
                    ? `${label}: ${player.name}. Change or remove.`
                    : `${label}: empty. Choose a player.`
                }
              >
                {body}
              </button>
            ) : (
              <span key={key} className="flex w-14 min-w-0 flex-col items-center">
                {body}
                <span className="sr-only">
                  {label}: {player ? player.name : "empty"}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
