"use client";

/**
 * The pitch list, with the four things a club administrator actually does to
 * one: reorder it, take it out of use, bring it back, and edit its details
 * (gap 7).
 *
 * There is no delete. `bookings.resource_id` references `resources` with
 * ON DELETE RESTRICT, so a pitch that has ever been booked cannot be removed
 * without taking the club's history with it — and one that has not been booked
 * yet is a keystroke away from being needed. "Out of use" is the retirement,
 * and it is reversible.
 *
 * Every refusal is shown as the database wrote it; `resources_admin_update` is
 * what decides, not this component.
 */

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { movePitch, setPitchActive, updatePitch, type PitchAdminActionState } from "./pitch-actions";
import { PitchFields } from "./pitch-fields";

const EMPTY: PitchAdminActionState = {};

export type PitchAdminRow = {
  id: string;
  name: string;
  description: string | null;
  information: string | null;
  capacity: number | null;
  active: boolean;
  defaultPreBufferMinutes: number;
  defaultPostBufferMinutes: number;
  /** `legacy_neon_pitch_id` — the id this pitch had in the booking app. */
  legacyId: string | null;
  /** Live bookings still pointing at this pitch, so retiring it is informed. */
  upcomingBookings: number;
};

export function PitchAdminFeedback({ state }: { state: PitchAdminActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function ManagePitchesPanel({ pitches }: { pitches: PitchAdminRow[] }) {
  const [moveState, moveAction, moving] = useActionState(movePitch, EMPTY);
  const [activeState, activeAction, togglingActive] = useActionState(setPitchActive, EMPTY);
  const [editState, editAction, saving] = useActionState(updatePitch, EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (pitches.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No pitches yet. Add the first one and it appears on the booking form straight away.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <PitchAdminFeedback state={moveState} />
      <PitchAdminFeedback state={activeState} />
      <PitchAdminFeedback state={editState} />

      {pitches.map((pitch, index) => {
        const editing = editingId === pitch.id;
        return (
          <Card key={pitch.id} className={pitch.active ? undefined : "border-dashed opacity-90"}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {pitch.name}
                    <Badge variant={pitch.active ? "success" : "muted"}>
                      {pitch.active ? "Bookable" : "Out of use"}
                    </Badge>
                    {pitch.legacyId && (
                      <Badge variant="outline" title="The id this pitch had in the booking app">
                        Legacy {pitch.legacyId.slice(0, 8)}
                      </Badge>
                    )}
                  </CardTitle>
                  {pitch.description && (
                    <p className="text-sm text-muted-foreground">{pitch.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Buffers {pitch.defaultPreBufferMinutes}/{pitch.defaultPostBufferMinutes} min
                    {pitch.capacity !== null ? ` · capacity ${pitch.capacity}` : ""} ·{" "}
                    {pitch.upcomingBookings === 0
                      ? "nothing booked ahead"
                      : `${pitch.upcomingBookings} booking${
                          pitch.upcomingBookings === 1 ? "" : "s"
                        } still to come`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <form action={moveAction}>
                    <input type="hidden" name="id" value={pitch.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={moving || index === 0}
                      aria-label={`Move ${pitch.name} up`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                  <form action={moveAction}>
                    <input type="hidden" name="id" value={pitch.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={moving || index === pitches.length - 1}
                      aria-label={`Move ${pitch.name} down`}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </form>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingId(editing ? null : pitch.id)}
                  >
                    {editing ? (
                      <>
                        <X className="h-3.5 w-3.5" /> Close
                      </>
                    ) : (
                      <>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </>
                    )}
                  </Button>

                  <form
                    action={activeAction}
                    onSubmit={(event) => {
                      if (!pitch.active) return;
                      const ok = window.confirm(
                        pitch.upcomingBookings > 0
                          ? `${pitch.name} has ${pitch.upcomingBookings} booking(s) still to come. Taking it out of use does not cancel them — it only stops new ones. Continue?`
                          : `Take ${pitch.name} out of use? It stops being offered; nothing already booked is changed.`,
                      );
                      if (!ok) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="id" value={pitch.id} />
                    <input type="hidden" name="active" value={pitch.active ? "false" : "true"} />
                    <Button type="submit" variant="outline" size="sm" disabled={togglingActive}>
                      {pitch.active ? "Take out of use" : "Bring back"}
                    </Button>
                  </form>
                </div>
              </div>
            </CardHeader>

            {editing && (
              <CardContent>
                <form action={editAction} className="space-y-4">
                  <input type="hidden" name="id" value={pitch.id} />
                  <PitchFields
                    idPrefix={`pitch-${pitch.id}`}
                    values={{
                      name: pitch.name,
                      description: pitch.description,
                      information: pitch.information,
                      capacity: pitch.capacity,
                      defaultPreBufferMinutes: pitch.defaultPreBufferMinutes,
                      defaultPostBufferMinutes: pitch.defaultPostBufferMinutes,
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}

            {!editing && pitch.information && (
              <CardContent>
                <p className="whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {pitch.information}
                </p>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
