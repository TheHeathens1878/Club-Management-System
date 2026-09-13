"use client";

/**
 * Venues and slots — where the allocating happens (Adam, 2026-09-06: "we
 * don't always have a full pitch so need to be able to easily subdivide
 * into 2 or 3 or 4 or 5 or even 6").
 *
 * Grouped by venue. Each slot is one row: the day, the time, how the pitch
 * is divided, how much of it is ours, and the teams in it as chips with
 * their share ("U10 Giants · ⅓"). "Add team" sits on the row and offers only
 * the parts still free — free of OUR share, not of the whole pitch; the
 * database's own guard has the last word if two administrators race for the
 * same third. Editing a slot opens its fields in place.
 *
 * A slot is AT a venue (2026-09-13): the picker lists the block's venues
 * first, then the club's other training venues, then the match grounds —
 * pick any and it joins the block. Choosing a venue fills in how its pitch
 * is divided and how much the club has, from the venue's own record. "Clone"
 * copies a slot, teams and all, to another day or hour.
 */

import { useActionState, useState } from "react";
import { Copy, LandPlot, Pencil, Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import {
  PARTS_OPTIONS,
  WEEKDAYS,
  oursLabel,
  partsFree,
  partsLabel,
  shareChip,
  shareLabel,
  slotCapacity,
  timeRange,
  weekdayLabel,
} from "@/lib/training-plan";

import { addAllocation, addSlot, cloneSlot, removeAllocation, removeSlot, updateSlot } from "../actions";
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
  venueId: string | null;
  venueName: string;
  venueAddress: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  /** How many of `parts` are the club's to hand out; null = all of them. */
  clubParts: number | null;
  notes: string | null;
  allocations: AllocationRow[];
};

export type TeamOption = { id: string; name: string; ageGroup: string | null; trainingDay: number | null };

export type VenueOption = {
  id: string;
  name: string;
  forTraining: boolean;
  /** How the pitch is divided when the club trains here, 1–6. */
  trainingParts: number;
  /** How many of those parts are the club's. */
  trainingShares: number;
  trainingNotes: string | null;
};

/** The `club_parts` the form sends for a venue's share: "" means all of it. */
function clubPartsFor(venue: VenueOption | undefined): string {
  if (!venue || venue.trainingParts <= 1 || venue.trainingShares >= venue.trainingParts) return "";
  return String(venue.trainingShares);
}

// ---------------------------------------------------------------------------
// The slot's fields — shared by "add" and "edit"
// ---------------------------------------------------------------------------

function SlotFields({
  prefix,
  slot,
  venues,
  blockVenueIds,
  defaultVenueId,
}: {
  prefix: string;
  slot?: SlotRow;
  venues: VenueOption[];
  blockVenueIds: string[];
  defaultVenueId?: string;
}) {
  const onBlock = new Set(blockVenueIds);
  const inBlock = venues.filter((venue) => onBlock.has(venue.id));
  const training = venues.filter((venue) => !onBlock.has(venue.id) && venue.forTraining);
  const grounds = venues.filter((venue) => !onBlock.has(venue.id) && !venue.forTraining);

  const [venueId, setVenueId] = useState(slot?.venueId ?? defaultVenueId ?? "");
  const [parts, setParts] = useState(
    slot ? slot.parts : (venues.find((v) => v.id === venueId)?.trainingParts ?? 1),
  );
  const [clubParts, setClubParts] = useState(
    slot ? (slot.clubParts === null ? "" : String(slot.clubParts)) : clubPartsFor(venues.find((v) => v.id === venueId)),
  );
  const venue = venues.find((v) => v.id === venueId);

  function chooseVenue(id: string) {
    setVenueId(id);
    // A new slot starts from the venue's share; an existing one keeps its own.
    const next = venues.find((v) => v.id === id);
    if (!slot && next) {
      setParts(next.trainingParts);
      setClubParts(clubPartsFor(next));
    }
  }

  function chooseParts(next: number) {
    setParts(next);
    setClubParts((current) => (current !== "" && Number(current) >= next ? "" : current));
  }

  const group = (label: string, list: VenueOption[]) =>
    list.length > 0 ? (
      <optgroup label={label}>
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </optgroup>
    ) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor={`${prefix}-venue`}>Venue</Label>
        <Select
          id={`${prefix}-venue`}
          name="venue_id"
          value={venueId}
          onChange={(event) => chooseVenue(event.target.value)}
          required
        >
          <option value="" disabled>
            Choose a venue…
          </option>
          {group("This block's venues", inBlock)}
          {group(inBlock.length > 0 ? "Other training venues" : "Training venues", training)}
          {group("Match grounds", grounds)}
        </Select>
        <p className="text-xs text-muted-foreground">
          {venue?.trainingNotes
            ? venue.trainingNotes
            : "Not listed? Add it under Venues. A venue picked here joins the block, and a match ground becomes a training venue too."}
        </p>
      </div>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor={`${prefix}-address`}>Address for this slot (optional)</Label>
        <Input
          id={`${prefix}-address`}
          name="venue_address"
          defaultValue={slot?.venueAddress ?? ""}
          placeholder="Only if it differs from the venue's — a side gate for the evening"
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
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-parts`}>Divided into</Label>
        <Select
          id={`${prefix}-parts`}
          name="parts"
          value={String(parts)}
          onChange={(event) => chooseParts(Number(event.target.value))}
          required
        >
          {PARTS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-club-parts`}>Ours</Label>
        <Select
          id={`${prefix}-club-parts`}
          name="club_parts"
          value={clubParts}
          onChange={(event) => setClubParts(event.target.value)}
          disabled={parts <= 1}
        >
          <option value="">All of it</option>
          {Array.from({ length: parts - 1 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} of {parts} · {shareChip(n, parts)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clone a slot to another day or hour
// ---------------------------------------------------------------------------

function CloneForm({ blockId, slot, onDone }: { blockId: string; slot: SlotRow; onDone: () => void }) {
  const [state, action] = useActionState(cloneSlot, EMPTY_PLAN_STATE);
  const prefix = `clone-${slot.id}`;
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-secondary/40 p-4">
      <PlanFeedback state={state} />
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      <p className="text-sm">
        Copy <span className="font-medium">{slot.venueName}</span>, {partsLabel(slot.parts).toLowerCase()}
        {oursLabel(slot) ? ` (${oursLabel(slot)})` : ""}
        {slot.allocations.length > 0 ? ` and its ${slot.allocations.length} ${slot.allocations.length === 1 ? "team" : "teams"}` : ""}, to:
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-weekday`}>Day</Label>
          <Select id={`${prefix}-weekday`} name="weekday" defaultValue={String(slot.weekday)} required>
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-start`}>From</Label>
          <Input id={`${prefix}-start`} type="time" name="start_time" defaultValue={slot.endTime.slice(0, 5)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-end`}>Until</Label>
          <Input id={`${prefix}-end`} type="time" name="end_time" defaultValue={slot.endTime.slice(0, 5)} required />
        </div>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm lg:min-h-0">
        <input type="checkbox" name="copy_teams" defaultChecked className="h-4 w-4 rounded border-input" />
        Copy the teams and their shares too
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0" pendingLabel="Cloning…">
          <Copy className="h-4 w-4" aria-hidden /> Clone the slot
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} className="min-h-[44px] lg:min-h-0">
          Cancel
        </Button>
      </div>
    </form>
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
  const capacity = slotCapacity(slot);
  const free = partsFree(capacity, slot.allocations);
  const taken = new Set(slot.allocations.map((a) => a.teamId));
  const candidates = teams.filter((team) => !taken.has(team.id));

  if (free === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {capacity < slot.parts ? "Full — the club's share of this slot is all allocated." : "Full — every part of this slot is allocated."}
      </p>
    );
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
              {team.trainingDay === slot.weekday ? " · trains this day" : ""}
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
  blockVenueIds,
}: {
  blockId: string;
  slot: SlotRow;
  teams: TeamOption[];
  venues: VenueOption[];
  blockVenueIds: string[];
}) {
  const [mode, setMode] = useState<"view" | "edit" | "clone">("view");
  const [editState, editAction] = useActionState(updateSlot, EMPTY_PLAN_STATE);
  const [removeState, removeAction, removing] = useActionState(removeSlot, EMPTY_PLAN_STATE);
  const capacity = slotCapacity(slot);
  const free = partsFree(capacity, slot.allocations);
  const ours = oursLabel(slot);

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">
          {weekdayLabel(slot.weekday)} · {timeRange(slot.startTime, slot.endTime)}
        </span>
        <Badge variant="muted">{partsLabel(slot.parts)}</Badge>
        {ours ? <Badge variant="outline">{ours}</Badge> : null}
        {capacity > 1 ? (
          <Badge variant={free === 0 ? "success" : "warning"}>
            {free === 0 ? "Full" : `${free} of ${capacity} free`}
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
            onClick={() => setMode((m) => (m === "clone" ? "view" : "clone"))}
            aria-label="Clone this slot to another day or hour"
            title="Clone to another day or hour"
            className="min-h-[44px] lg:min-h-0"
          >
            <Copy className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
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

      {mode === "edit" ? (
        <form action={editAction} className="space-y-3 rounded-xl border bg-secondary/40 p-4">
          <PlanFeedback state={editState} />
          <input type="hidden" name="block_id" value={blockId} />
          <input type="hidden" name="slot_id" value={slot.id} />
          <SlotFields prefix={`slot-${slot.id}`} slot={slot} venues={venues} blockVenueIds={blockVenueIds} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0">
              Save slot
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")} className="min-h-[44px] lg:min-h-0">
              Done
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "clone" ? <CloneForm blockId={blockId} slot={slot} onDone={() => setMode("view")} /> : null}

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

export function SlotsSection({
  blockId,
  slots,
  teams,
  venues,
  blockVenueIds,
}: {
  blockId: string;
  slots: SlotRow[];
  teams: TeamOption[];
  venues: VenueOption[];
  blockVenueIds: string[];
}) {
  const [adding, setAdding] = useState(slots.length === 0);
  const [state, action] = useActionState(addSlot, EMPTY_PLAN_STATE);
  const venueNames = Array.from(new Set(slots.map((s) => s.venueName)));
  const byVenue = venueNames.map((venue) => ({
    venue,
    address: slots.find((s) => s.venueName === venue)?.venueAddress ?? null,
    slots: slots.filter((s) => s.venueName === venue),
  }));
  const lastVenueId = slots.length > 0 ? slots[slots.length - 1]?.venueId ?? undefined : blockVenueIds[0];

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
              <SlotFields prefix="new-slot" venues={venues} blockVenueIds={blockVenueIds} defaultVenueId={lastVenueId} />
              <p className="text-xs text-muted-foreground">
                A slot is one weekly space: the venue, the day, the hour, how many ways the pitch is
                divided and how many of those parts are ours. Teams are added to it once it exists, or
                dragged onto it in the day planner above.
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
                <SlotCard
                  key={slot.id}
                  blockId={blockId}
                  slot={slot}
                  teams={teams}
                  venues={venues}
                  blockVenueIds={blockVenueIds}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
