"use client";

/**
 * Venues and slots — where the allocating happens (Adam, 2026-09-06: "we
 * don't always have a full pitch so need to be able to easily subdivide
 * into 2 or 3 or 4 or 5 or even 6").
 *
 * Grouped by venue. Each slot is one row: the day, the time, how the pitch
 * is divided, and the teams in it as chips with their share ("U10 Giants ·
 * ⅓"). "Add team" sits on the row and offers only the parts still free; the
 * database's own guard has the last word if two administrators race for the
 * same third. Editing a slot opens its fields in place.
 */

import { useActionState, useState } from "react";
import { LandPlot, Pencil, Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import {
  PARTS_OPTIONS,
  WEEKDAYS,
  partsFree,
  partsLabel,
  shareChip,
  shareLabel,
  timeRange,
  weekdayLabel,
} from "@/lib/training-plan";

import { addAllocation, addSlot, removeAllocation, removeSlot, updateSlot } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";

export type AllocationRow = {
  id: string;
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  shares: number;
};

export type SlotRow = {
  id: string;
  venueName: string;
  venueAddress: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  notes: string | null;
  allocations: AllocationRow[];
};

export type TeamOption = { id: string; name: string; ageGroup: string | null };

// ---------------------------------------------------------------------------
// The slot's fields — shared by "add" and "edit"
// ---------------------------------------------------------------------------

function SlotFields({
  prefix,
  slot,
  venues,
  defaultVenue,
}: {
  prefix: string;
  slot?: SlotRow;
  venues: string[];
  defaultVenue?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor={`${prefix}-venue`}>Venue</Label>
        <Input
          id={`${prefix}-venue`}
          name="venue_name"
          list={`${prefix}-venues`}
          defaultValue={slot?.venueName ?? defaultVenue ?? ""}
          placeholder="Sale Grammar 3G"
          maxLength={120}
          required
        />
        <datalist id={`${prefix}-venues`}>
          {venues.map((venue) => (
            <option key={venue} value={venue} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor={`${prefix}-address`}>Address (optional)</Label>
        <Input
          id={`${prefix}-address`}
          name="venue_address"
          defaultValue={slot?.venueAddress ?? ""}
          placeholder="For the maps link on each session"
          maxLength={300}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor={`${prefix}-weekday`}>Day</Label>
        <Select id={`${prefix}-weekday`} name="weekday" defaultValue={String(slot?.weekday ?? 1)} required>
          {WEEKDAYS.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-start`}>From</Label>
        <Input id={`${prefix}-start`} type="time" name="start_time" defaultValue={slot?.startTime.slice(0, 5) ?? "18:00"} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-end`}>Until</Label>
        <Input id={`${prefix}-end`} type="time" name="end_time" defaultValue={slot?.endTime.slice(0, 5) ?? "19:00"} required />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor={`${prefix}-parts`}>Divided into</Label>
        <Select id={`${prefix}-parts`} name="parts" defaultValue={String(slot?.parts ?? 1)} required>
          {PARTS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One team chip, with its remove
// ---------------------------------------------------------------------------

function TeamChip({ blockId, slot, allocation }: { blockId: string; slot: SlotRow; allocation: AllocationRow }) {
  const [state, action, pending] = useActionState(removeAllocation, EMPTY_PLAN_STATE);
  return (
    <form
      action={action}
      className="inline-flex min-h-[36px] items-center gap-1 rounded-full border bg-card pl-3 pr-1 text-[13px] font-medium"
      title={shareLabel(allocation.shares, slot.parts)}
    >
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="allocation_id" value={allocation.id} />
      <span>{allocation.teamName}</span>
      <span className="text-muted-foreground">· {shareChip(allocation.shares, slot.parts)}</span>
      <button
        type="submit"
        disabled={pending}
        aria-label={`Take ${allocation.teamName} out of this slot`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {state.error ? <span className="sr-only">{state.error}</span> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Add a team to a slot
// ---------------------------------------------------------------------------

function AddTeam({ blockId, slot, teams }: { blockId: string; slot: SlotRow; teams: TeamOption[] }) {
  const [state, action] = useActionState(addAllocation, EMPTY_PLAN_STATE);
  const free = partsFree(slot.parts, slot.allocations);
  const taken = new Set(slot.allocations.map((a) => a.teamId));
  const candidates = teams.filter((team) => !taken.has(team.id));

  if (free === 0) {
    return <p className="text-xs text-muted-foreground">Full — every part of this slot is allocated.</p>;
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <Label htmlFor={`add-team-${slot.id}`} className="text-xs">
          Add a team
        </Label>
        <Select id={`add-team-${slot.id}`} name="team_id" required defaultValue="">
          <option value="" disabled>
            Choose a team…
          </option>
          {candidates.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
              {team.ageGroup && !team.name.includes(team.ageGroup) ? ` (${team.ageGroup})` : ""}
            </option>
          ))}
        </Select>
      </div>
      {slot.parts > 1 ? (
        <div className="w-40 space-y-1">
          <Label htmlFor={`add-shares-${slot.id}`} className="text-xs">
            How much
          </Label>
          <Select id={`add-shares-${slot.id}`} name="shares" defaultValue="1">
            {Array.from({ length: free }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {shareLabel(n, slot.parts).replace(" of the pitch", "")}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="shares" value="1" />
      )}
      <SubmitButton size="sm" variant="outline" className="min-h-[44px] lg:min-h-0" pendingLabel="Adding…">
        <Plus className="h-4 w-4" aria-hidden /> Add
      </SubmitButton>
      {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// A slot
// ---------------------------------------------------------------------------

function SlotCard({
  blockId,
  slot,
  teams,
  venues,
}: {
  blockId: string;
  slot: SlotRow;
  teams: TeamOption[];
  venues: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction] = useActionState(updateSlot, EMPTY_PLAN_STATE);
  const [removeState, removeAction, removing] = useActionState(removeSlot, EMPTY_PLAN_STATE);
  const free = partsFree(slot.parts, slot.allocations);

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">
          {weekdayLabel(slot.weekday)} · {timeRange(slot.startTime, slot.endTime)}
        </span>
        <Badge variant="muted">{partsLabel(slot.parts)}</Badge>
        {slot.parts > 1 ? (
          <Badge variant={free === 0 ? "success" : "warning"}>
            {free === 0 ? "Full" : `${free} of ${slot.parts} free`}
          </Badge>
        ) : slot.allocations.length > 0 ? (
          <Badge variant="success">Taken</Badge>
        ) : (
          <Badge variant="warning">Free</Badge>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            aria-label="Edit this slot"
            className="min-h-[44px] lg:min-h-0"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <form action={removeAction}>
            <input type="hidden" name="block_id" value={blockId} />
            <input type="hidden" name="slot_id" value={slot.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={removing}
              aria-label="Remove this slot"
              className="min-h-[44px] text-muted-foreground lg:min-h-0"
              onClick={(event) => {
                if (slot.allocations.length > 0 && !window.confirm(`Remove ${weekdayLabel(slot.weekday)} ${timeRange(slot.startTime, slot.endTime)} at ${slot.venueName}? ${slot.allocations.length} team${slot.allocations.length === 1 ? "" : "s"} come out of it, and their sessions go at the next calendar update.`)) {
                  event.preventDefault();
                }
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </span>
      </div>
      {removeState.error ? <p className="text-xs text-destructive">{removeState.error}</p> : null}

      {editing ? (
        <form action={editAction} className="space-y-3 rounded-xl border bg-secondary/40 p-4">
          <PlanFeedback state={editState} />
          <input type="hidden" name="block_id" value={blockId} />
          <input type="hidden" name="slot_id" value={slot.id} />
          <SlotFields prefix={`slot-${slot.id}`} slot={slot} venues={venues} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0">
              Save slot
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} className="min-h-[44px] lg:min-h-0">
              Done
            </Button>
          </div>
        </form>
      ) : null}

      {slot.allocations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {slot.allocations.map((allocation) => (
            <TeamChip key={allocation.id} blockId={blockId} slot={slot} allocation={allocation} />
          ))}
        </div>
      ) : null}

      <AddTeam blockId={blockId} slot={slot} teams={teams} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// The section: venues, each with its slots, and "Add a slot"
// ---------------------------------------------------------------------------

export function SlotsSection({ blockId, slots, teams }: { blockId: string; slots: SlotRow[]; teams: TeamOption[] }) {
  const [adding, setAdding] = useState(slots.length === 0);
  const [state, action] = useActionState(addSlot, EMPTY_PLAN_STATE);
  const venues = Array.from(new Set(slots.map((s) => s.venueName)));
  const byVenue = venues.map((venue) => ({
    venue,
    address: slots.find((s) => s.venueName === venue)?.venueAddress ?? null,
    slots: slots.filter((s) => s.venueName === venue),
  }));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="font-display text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Venues and slots
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)} className="min-h-[44px] lg:min-h-0">
          <Plus className="h-4 w-4" aria-hidden /> Add a slot
        </Button>
      </div>

      {adding ? (
        <Card>
          <CardContent className="p-4 lg:p-6">
            <form action={action} className="space-y-3">
              <PlanFeedback state={state} />
              <input type="hidden" name="block_id" value={blockId} />
              <SlotFields prefix="new-slot" venues={venues} defaultVenue={venues[venues.length - 1]} />
              <p className="text-xs text-muted-foreground">
                A slot is one weekly space: the venue, the day, the hour, and how many ways the pitch is
                divided. Teams are added to it once it exists.
              </p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0" pendingLabel="Adding…">
                  Add the slot
                </SubmitButton>
                {slots.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} className="min-h-[44px] lg:min-h-0">
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {byVenue.map((group) => (
        <Card key={group.venue}>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <LandPlot className="h-4 w-4 text-primary" aria-hidden /> {group.venue}
            </CardTitle>
            {group.address ? <p className="text-xs text-muted-foreground">{group.address}</p> : null}
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {group.slots.map((slot) => (
                <SlotCard key={slot.id} blockId={blockId} slot={slot} teams={teams} venues={venues} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
