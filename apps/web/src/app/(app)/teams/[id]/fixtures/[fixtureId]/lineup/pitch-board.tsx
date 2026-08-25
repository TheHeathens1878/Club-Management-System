"use client";

/**
 * The tactics board: a portrait pitch with one circle per slot of the chosen
 * formation. Empty slots are a dashed `+` with the position under them; filled
 * slots wear the player's token (initials now, a photo later) with the first
 * name under it.
 *
 * Nothing here knows how to save — it draws what it is given and reports taps.
 * Read-only callers pass no `onSlotTap`, and the slots render as plain spans so
 * a parent's screen has nothing to press.
 *
 * The markings are one SVG scaled to the box (`preserveAspectRatio="none"`, so
 * the pitch fills whatever aspect the card gives it) and the tokens are HTML
 * positioned in percentages on top — that keeps the 44px hit target a real
 * 44px on a phone instead of an SVG unit that shrinks with the viewport.
 */

import { Plus } from "lucide-react";

import { PlayerToken, firstNameOf } from "@/components/player-token";
import type { Formation } from "@/lib/formations";
import { cn } from "@/lib/utils";

export type PlacedPlayer = {
  personId: string;
  name: string;
  shirtNumber: number | null;
};

const LINE = "rgba(255,255,255,0.55)";

function PitchMarkings() {
  return (
    <svg
      viewBox="0 0 68 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <rect width="68" height="100" className="fill-emerald-800" />
      {/* Mown stripes — eight bands, barely there. */}
      {Array.from({ length: 8 }, (_, band) => (
        <rect
          key={band}
          x="0"
          y={band * 12.5}
          width="68"
          height="12.5"
          fill={band % 2 === 0 ? "rgba(255,255,255,0.045)" : "transparent"}
        />
      ))}
      <g fill="none" stroke={LINE} strokeWidth="0.5">
        <rect x="1.6" y="1.6" width="64.8" height="96.8" />
        <line x1="1.6" y1="50" x2="66.4" y2="50" />
        <circle cx="34" cy="50" r="9.15" />
        {/* Penalty and six-yard boxes, both ends, to FA proportions. */}
        <rect x="13.84" y="1.6" width="40.32" height="16.5" />
        <rect x="24.84" y="1.6" width="18.32" height="5.5" />
        <rect x="13.84" y="81.9" width="40.32" height="16.5" />
        <rect x="24.84" y="92.9" width="18.32" height="5.5" />
      </g>
      <g fill={LINE}>
        <circle cx="34" cy="50" r="0.7" />
        <circle cx="34" cy="12.6" r="0.7" />
        <circle cx="34" cy="87.4" r="0.7" />
      </g>
    </svg>
  );
}

export function PitchBoard({
  formation,
  placements,
  playersById,
  onSlotTap,
  activeSlot,
}: {
  formation: Formation;
  /** slot key → person id. */
  placements: Record<string, string>;
  playersById: Map<string, PlacedPlayer>;
  /** Absent for the read-only view. */
  onSlotTap?: (slotKey: string) => void;
  activeSlot?: string | null;
}) {
  return (
    <div className="relative aspect-[68/100] w-full overflow-hidden rounded-xl bg-emerald-800 shadow-inner">
      <PitchMarkings />
      {formation.slots.map((slot) => {
        const personId = placements[slot.key];
        const player = personId ? playersById.get(personId) : undefined;
        const active = activeSlot === slot.key;
        const body = (
          <>
            {player ? (
              <PlayerToken
                name={player.name}
                shirtNumber={player.shirtNumber}
                className={cn("h-11 w-11", active && "ring-2 ring-white")}
              />
            ) : (
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-white/70 bg-white/10 text-white",
                  active && "border-solid bg-white/25",
                )}
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <span className="mt-1 block max-w-[74px] truncate rounded bg-black/35 px-1 text-[10px] font-medium leading-[14px] text-white">
              {player ? firstNameOf(player.name) : slot.label}
            </span>
          </>
        );
        const positioned = "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center";
        const style = { left: `${slot.x}%`, top: `${slot.y}%` };

        return onSlotTap ? (
          <button
            key={slot.key}
            type="button"
            style={style}
            onClick={() => onSlotTap(slot.key)}
            className={cn(positioned, "rounded-lg")}
            aria-label={
              player
                ? `${slot.label}: ${player.name}. Change or remove.`
                : `${slot.label}: empty. Choose a player.`
            }
          >
            {body}
          </button>
        ) : (
          <span key={slot.key} style={style} className={positioned}>
            {body}
            <span className="sr-only">
              {slot.label}: {player ? player.name : "empty"}
            </span>
          </span>
        );
      })}
    </div>
  );
}
