"use client";

/**
 * The slot panel (Adam, 2026-09-14: "clicking on the slot card in the table
 * and it taking you to that slot details"). One slot, everything about it,
 * without leaving the timetable: a drawer from the right on a desk, a sheet
 * from the bottom on a phone.
 *
 *   · the teams in it — each with its share, changeable in place, and a
 *     remove — and "Add a team" offering only the parts of OUR share still
 *     free;
 *   · Edit (the slot's fields, in place), Clone (to another day or hour),
 *     Remove (armed when teams would come out of it).
 *
 * The same panel is the new-slot form: a cell's "+" or "Add a slot" opens it
 * with the venue, pitch, day and hours filled in, and once the slot exists
 * the panel moves on to it, ready for its teams. Every write is a server
 * action followed by a refresh, so what the panel shows is what the database
 * holds; the panel stays open across the refresh because it is keyed on the
 * slot's id, not on a copy of its row.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
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

import { addAllocation, addSlot, cloneSlot, removeAllocation, removeSlot, updateAllocation, updateSlot } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";
import type { AllocationRow, BookedSlot, SlotPrefill, SlotRow, TeamOption, VenueOption } from "./types";

/** What the sheet is showing: a slot, or the form for a new one. */
export type SheetState = { kind: "slot"; id: string } | { kind: "new"; prefill: SlotPrefill };

/** The `club_parts` the form sends for a venue's share: "" means all of it. */
function clubPartsFor(venue: VenueOption | undefined): string {
  if (!venue || venue.trainingParts <= 1 || venue.trainingShares >= venue.trainingParts) return "";
  return String(venue.trainingShares);
}

// ---------------------------------------------------------------------------
// The slot's fields — shared by "new" and "edit"
// ---------------------------------------------------------------------------

function SlotFields({
  prefix,
  slot,
  prefill,
  venues,
  blockVenueIds,
}: {
  prefix: string;
  slot?: SlotRow;
  prefill?: SlotPrefill;
  venues: VenueOption[];
  blockVenueIds: string[];
}) {
  const onBlock = new Set(blockVenueIds);
  const inBlock = venues.filter((venue) => onBlock.has(venue.id));
  const training = venues.filter((venue) => !onBlock.has(venue.id) && venue.forTraining);
  const grounds = venues.filter((venue) => !onBlock.has(venue.id) && !venue.forTraining);

  const startVenue = venues.find((v) => v.id === (slot?.venueId ?? prefill?.venueId ?? ""));
  const [venueId, setVenueId] = useState(startVenue?.id ?? "");
  const [pitchId, setPitchId] = useState(slot?.pitchId ?? prefill?.pitchId ?? "");
  const [weekday, setWeekday] = useState(String(slot?.weekday ?? prefill?.weekday ?? 1));
  const [startTime, setStartTime] = useState((slot?.startTime ?? prefill?.startTime ?? "18:00").slice(0, 5));
  const [endTime, setEndTime] = useState((slot?.endTime ?? prefill?.endTime ?? "19:00").slice(0, 5));
  const [parts, setParts] = useState(slot ? slot.parts : (prefill?.parts ?? startVenue?.trainingParts ?? 1));
  const [clubParts, setClubParts] = useState(() => {
    if (slot) return slot.clubParts === null ? "" : String(slot.clubParts);
    if (prefill?.parts !== undefined && prefill.shares !== undefined) {
      return prefill.parts > 1 && prefill.shares < prefill.parts ? String(prefill.shares) : "";
    }
    return clubPartsFor(startVenue);
  });
  const venue = venues.find((v) => v.id === venueId);

  function chooseVenue(id: string) {
    setVenueId(id);
    setPitchId("");
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

  // A booked slot fills the whole form: pitch, day, hours, and how much of
  // the pitch is ours.
  function pickBooked(booked: BookedSlot) {
    setPitchId(booked.pitchId ?? "");
    setWeekday(String(booked.weekday));
    setStartTime(booked.startTime.slice(0, 5));
    setEndTime(booked.endTime.slice(0, 5));
    setParts(booked.parts);
    setClubParts(booked.parts > 1 && booked.shares < booked.parts ? String(booked.shares) : "");
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
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2 space-y-1.5">
        <Label htmlFor={`${prefix}-venue`}>Venue</Label>
        <Select id={`${prefix}-venue`} name="venue_id" value={venueId} onChange={(event) => chooseVenue(event.target.value)} required>
          <option value="" disabled>
            Choose a venue…
          </option>
          {group("This block's venues", inBlock)}
          {group(inBlock.length > 0 ? "Other training venues" : "Training venues", training)}
          {group("Match grounds", grounds)}
        </Select>
        {venue?.trainingNotes ? <p className="text-xs text-muted-foreground">{venue.trainingNotes}</p> : null}
      </div>
      {venue && venue.bookedSlots.length > 0 ? (
        <div className="col-span-2 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Booked at {venue.name} — tap one to fill the slot in:</p>
          <div className="flex flex-wrap gap-1.5">
            {venue.bookedSlots.map((booked) => (
              <button
                key={`${booked.pitchId ?? ""}|${booked.weekday}|${booked.startTime}|${booked.endTime}`}
                type="button"
                onClick={() => pickBooked(booked)}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium hover:border-primary/40 hover:bg-secondary"
              >
                {booked.pitchName ? <span className="text-primary">{booked.pitchName} ·</span> : null}
                {weekdayLabel(booked.weekday, true)} {timeRange(booked.startTime, booked.endTime)}
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {booked.parts <= 1 || booked.shares >= booked.parts ? "full" : shareChip(booked.shares, booked.parts)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-pitch`}>Pitch</Label>
        <Select
          id={`${prefix}-pitch`}
          name="pitch_id"
          value={pitchId}
          onChange={(event) => setPitchId(event.target.value)}
          disabled={!venue || venue.pitches.length === 0}
        >
          <option value="">{venue && venue.pitches.length > 0 ? "Any" : "The only one"}</option>
          {(venue?.pitches ?? []).map((pitch) => (
            <option key={pitch.id} value={pitch.id}>
              {pitch.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-weekday`}>Day</Label>
        <Select id={`${prefix}-weekday`} name="weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)} required>
          {WEEKDAYS.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-start`}>From</Label>
        <Input id={`${prefix}-start`} type="time" name="start_time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-end`}>Until</Label>
        <Input id={`${prefix}-end`} type="time" name="end_time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-parts`}>Divided into</Label>
        <Select id={`${prefix}-parts`} name="parts" value={String(parts)} onChange={(event) => chooseParts(Number(event.target.value))} required>
          {PARTS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-club-parts`}>Ours</Label>
        <Select id={`${prefix}-club-parts`} name="club_parts" value={clubParts} onChange={(event) => setClubParts(event.target.value)} disabled={parts <= 1}>
          <option value="">All of it</option>
          {Array.from({ length: parts - 1 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} of {parts} · {shareChip(n, parts)}
            </option>
          ))}
        </Select>
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label htmlFor={`${prefix}-address`}>Address for this slot (optional)</Label>
        <Input
          id={`${prefix}-address`}
          name="venue_address"
          defaultValue={slot?.venueAddress ?? ""}
          placeholder="Only if it differs from the venue's — a side gate for the evening"
          maxLength={300}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New slot
// ---------------------------------------------------------------------------

function NewSlotForm({
  blockId,
  prefill,
  venues,
  blockVenueIds,
  onCreated,
}: {
  blockId: string;
  prefill: SlotPrefill;
  venues: VenueOption[];
  blockVenueIds: string[];
  onCreated: (slotId: string) => void;
}) {
  const [state, action] = useActionState(addSlot, EMPTY_PLAN_STATE);
  useEffect(() => {
    if (state.slotId) onCreated(state.slotId);
  }, [state.slotId, onCreated]);
  return (
    <form action={action} className="space-y-4">
      <PlanFeedback state={state} />
      <input type="hidden" name="block_id" value={blockId} />
      <SlotFields prefix="new-slot" prefill={prefill} venues={venues} blockVenueIds={blockVenueIds} />
      <p className="text-xs text-muted-foreground">
        A slot is one weekly space: the venue, the day, the hour, how the pitch is divided and how much of
        it is ours. Its teams come next.
      </p>
      <SubmitButton className="touch w-full lg:w-auto" pendingLabel="Adding…">
        Add the slot
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Clone a slot to another day or hour
// ---------------------------------------------------------------------------

function CloneForm({ blockId, slot, onDone }: { blockId: string; slot: SlotRow; onDone: () => void }) {
  const [state, action] = useActionState(cloneSlot, EMPTY_PLAN_STATE);
  const prefix = `clone-${slot.id}`;
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-secondary/40 p-3">
      <PlanFeedback state={state} />
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      <p className="text-sm">
        Copy this slot{slot.allocations.length > 0 ? ` and its ${slot.allocations.length} ${slot.allocations.length === 1 ? "team" : "teams"}` : ""} to:
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-weekday`}>Day</Label>
          <Select id={`${prefix}-weekday`} name="weekday" defaultValue={String(slot.weekday)} required>
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.short}
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
      <label className="touch flex items-center gap-2 text-sm">
        <input type="checkbox" name="copy_teams" defaultChecked className="h-4 w-4 rounded border-input" />
        Copy the teams and their shares too
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" className="touch" pendingLabel="Cloning…">
          <Copy className="h-4 w-4" aria-hidden /> Clone
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} className="touch">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One team in the slot: its share (changeable) and its remove
// ---------------------------------------------------------------------------

function TeamRow({ blockId, slot, allocation }: { blockId: string; slot: SlotRow; allocation: AllocationRow }) {
  const [removeState, removeAction, removing] = useActionState(removeAllocation, EMPTY_PLAN_STATE);
  const [shareState, shareAction] = useActionState(updateAllocation, EMPTY_PLAN_STATE);
  const shareForm = useRef<HTMLFormElement>(null);
  const capacity = slotCapacity(slot);
  // It may grow by what is free, or shrink.
  const most = allocation.shares + partsFree(capacity, slot.allocations);
  return (
    <li className="flex min-h-[44px] items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{allocation.teamName}</span>
        {allocation.ageGroup && !allocation.teamName.includes(allocation.ageGroup) ? (
          <span className="block text-xs text-muted-foreground">{allocation.ageGroup}</span>
        ) : null}
        {removeState.error || shareState.error ? (
          <span className="block text-xs text-destructive">{removeState.error ?? shareState.error}</span>
        ) : null}
      </span>
      {slot.parts > 1 ? (
        <form ref={shareForm} action={shareAction} className="w-28">
          <input type="hidden" name="block_id" value={blockId} />
          <input type="hidden" name="allocation_id" value={allocation.id} />
          <Select
            name="shares"
            aria-label={`How much of the slot ${allocation.teamName} has`}
            defaultValue={String(allocation.shares)}
            onChange={() => shareForm.current?.requestSubmit()}
            className="touch h-9 text-list"
          >
            {Array.from({ length: most }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {shareLabel(n, slot.parts).replace(" of the pitch", "")}
              </option>
            ))}
          </Select>
        </form>
      ) : null}
      <form action={removeAction}>
        <input type="hidden" name="block_id" value={blockId} />
        <input type="hidden" name="allocation_id" value={allocation.id} />
        <button
          type="submit"
          disabled={removing}
          aria-label={`Take ${allocation.teamName} out of this slot`}
          title="Take out of this slot"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </li>
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
  const thisDay = candidates.filter((team) => team.trainingDay === slot.weekday);
  const others = candidates.filter((team) => team.trainingDay !== slot.weekday);

  if (free === 0) {
    return (
      <p className="rounded-lg bg-success-tint px-3 py-2 text-sm text-success">
        {capacity < slot.parts ? "Full — the club's share of this slot is all allocated." : "Full — every part of this slot is allocated."}
      </p>
    );
  }

  const option = (team: TeamOption) => (
    <option key={team.id} value={team.id}>
      {team.name}
      {team.ageGroup && !team.name.includes(team.ageGroup) ? ` (${team.ageGroup})` : ""}
    </option>
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="slot_id" value={slot.id} />
      <div className="min-w-0 flex-1 basis-40 space-y-1">
        <Label htmlFor={`add-team-${slot.id}`} className="text-xs">
          Add a team
        </Label>
        <Select id={`add-team-${slot.id}`} name="team_id" required defaultValue="">
          <option value="" disabled>
            Choose a team…
          </option>
          {thisDay.length > 0 ? <optgroup label={`Train on ${weekdayLabel(slot.weekday)}s`}>{thisDay.map(option)}</optgroup> : null}
          {others.length > 0 ? <optgroup label={thisDay.length > 0 ? "Other teams" : "Teams"}>{others.map(option)}</optgroup> : null}
        </Select>
      </div>
      {slot.parts > 1 ? (
        <div className="w-32 space-y-1">
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
      <SubmitButton size="sm" className="touch" pendingLabel="Adding…">
        <Plus className="h-4 w-4" aria-hidden /> Add
      </SubmitButton>
      {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// A slot, in full
// ---------------------------------------------------------------------------

function SlotDetail({
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
  const [armed, setArmed] = useState(false);
  const [editState, editAction] = useActionState(updateSlot, EMPTY_PLAN_STATE);
  const [removeState, removeAction, removing] = useActionState(removeSlot, EMPTY_PLAN_STATE);
  const capacity = slotCapacity(slot);
  const free = partsFree(capacity, slot.allocations);
  const ours = oursLabel(slot);

  // A saved edit closes the fields; the header above shows the new values.
  useEffect(() => {
    if (editState.notice) setMode("view");
  }, [editState.notice]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {slot.parts > 1 ? <Badge variant="muted">{partsLabel(slot.parts)}</Badge> : null}
        {ours ? <Badge variant="outline">{ours}</Badge> : null}
        {capacity > 1 ? (
          <Badge variant={free === 0 ? "success" : "warning"}>{free === 0 ? "Full" : `${free} of ${capacity} free`}</Badge>
        ) : slot.allocations.length > 0 ? (
          <Badge variant="success">Taken</Badge>
        ) : (
          <Badge variant="warning">Free</Badge>
        )}
        {slot.venueAddress ? <span className="basis-full text-xs text-muted-foreground">{slot.venueAddress}</span> : null}
      </div>

      {mode === "edit" ? (
        <form action={editAction} className="space-y-3 rounded-xl border bg-secondary/40 p-3">
          <PlanFeedback state={editState} />
          <input type="hidden" name="block_id" value={blockId} />
          <input type="hidden" name="slot_id" value={slot.id} />
          <SlotFields prefix={`slot-${slot.id}`} slot={slot} venues={venues} blockVenueIds={blockVenueIds} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" className="touch">
              Save slot
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")} className="touch">
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "clone" ? <CloneForm blockId={blockId} slot={slot} onDone={() => setMode("view")} /> : null}

      <section className="space-y-2">
        <h3 className="font-display text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Teams in this slot
        </h3>
        {slot.allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet — add a team below, or drag one onto the card.</p>
        ) : (
          <ul className="divide-y rounded-xl border px-3">
            {slot.allocations.map((allocation) => (
              <TeamRow key={allocation.id} blockId={blockId} slot={slot} allocation={allocation} />
            ))}
          </ul>
        )}
        <AddTeam blockId={blockId} slot={slot} teams={teams} />
      </section>

      <section className="space-y-2 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))} className="touch">
            <Pencil className="h-4 w-4" aria-hidden /> Edit slot
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMode((m) => (m === "clone" ? "view" : "clone"))} className="touch">
            <Copy className="h-4 w-4" aria-hidden /> Clone
          </Button>
          {armed ? (
            <form action={removeAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="block_id" value={blockId} />
              <input type="hidden" name="slot_id" value={slot.id} />
              <Button type="submit" variant="destructive" size="sm" disabled={removing} className="touch">
                {removing ? "Removing…" : slot.allocations.length > 0 ? `Remove slot and its ${slot.allocations.length} team${slot.allocations.length === 1 ? "" : "s"}` : "Remove slot"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)} className="touch">
                Keep it
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setArmed(true)}
              className="touch text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Remove
            </Button>
          )}
        </div>
        {armed && slot.allocations.length > 0 ? (
          <p className="text-xs text-muted-foreground">The teams come out of it, and their sessions go at the next calendar update.</p>
        ) : null}
        {removeState.error ? <p className="text-xs text-destructive">{removeState.error}</p> : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet itself
// ---------------------------------------------------------------------------

export function SlotSheet({
  blockId,
  state,
  slot,
  teams,
  venues,
  blockVenueIds,
  onClose,
  onOpenSlot,
}: {
  blockId: string;
  state: SheetState | null;
  /** The slot `state` names, fresh from the page — undefined once it is gone. */
  slot: SlotRow | undefined;
  teams: TeamOption[];
  venues: VenueOption[];
  blockVenueIds: string[];
  onClose: () => void;
  onOpenSlot: (slotId: string) => void;
}) {
  if (!state) return null;
  // The slot was removed under the panel (or by someone else): nothing to show.
  if (state.kind === "slot" && !slot) return null;

  const title =
    state.kind === "new"
      ? "New slot"
      : `${weekdayLabel(slot!.weekday)} · ${timeRange(slot!.startTime, slot!.endTime)}`;
  const subtitle =
    state.kind === "new"
      ? "Where, when, and how much of the pitch is ours."
      : `${slot!.venueName}${slot!.pitchName ? ` · ${slot!.pitchName}` : ""}`;

  return (
    <Sheet open onClose={onClose} title={title} subtitle={subtitle} side="drawer" width={460}>
      {state.kind === "new" ? (
        <NewSlotForm blockId={blockId} prefill={state.prefill} venues={venues} blockVenueIds={blockVenueIds} onCreated={onOpenSlot} />
      ) : (
        <SlotDetail blockId={blockId} slot={slot!} teams={teams} venues={venues} blockVenueIds={blockVenueIds} />
      )}
    </Sheet>
  );
}
