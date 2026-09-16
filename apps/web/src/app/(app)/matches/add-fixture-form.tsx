"use client";

/**
 * "Add a fixture", answered where it was asked (Adam, 2026-09-04: the header
 * button used to bounce an administrator to the team page).
 *
 * It used to be a `<details>` popover hanging off the header button. The grid
 * retired that (P8.4): an empty cell in the grid IS the question — this team,
 * that day — so the form opens as the app's own sheet with the team and the
 * date already in it, and the header button opens the same sheet with
 * nothing filled. One form, two doors.
 *
 * The database's `fixtures_staff_insert` is the permission; the team list
 * passed in is who the CALLER may add for.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";

import { addFixture, type AddFixtureState } from "./add-fixture-actions";

const EMPTY: AddFixtureState = {};

/** What an empty cell in the grid knows before the form is opened. */
export type AddFixturePrefill = { teamId?: string; dateIso?: string };

export function AddFixtureForm({
  teams,
  prefill,
  onAdded,
}: {
  teams: { id: string; name: string }[];
  prefill?: AddFixturePrefill;
  /** The fixture landed: the caller refreshes and closes. */
  onAdded?: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, saving] = useActionState(addFixture, EMPTY);

  useEffect(() => {
    if (!state.notice) return;
    formRef.current?.reset();
    router.refresh();
    onAdded?.();
    // `onAdded` is an inline arrow at its call site; depending on it would
    // re-fire this on every render of the grid above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notice, router]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="af-team">Team *</Label>
        {/* min-w-0: WebKit will not shrink a select below its longest option. */}
        <Select id="af-team" name="team_id" required defaultValue={prefill?.teamId ?? ""} className="touch min-w-0">
          <option value="" disabled>
            Choose a team…
          </option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="af-opponent">Opponent *</Label>
        <Input id="af-opponent" name="opponent" required maxLength={120} className="touch" placeholder="e.g. Sale United U12" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="af-side">Home / away</Label>
          <Select id="af-side" name="side" defaultValue="home" className="touch min-w-0 px-2">
            <option value="home">Home</option>
            <option value="away">Away</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="af-date">Date *</Label>
          <Input id="af-date" name="kickoff_date" type="date" required className="touch" defaultValue={prefill?.dateIso ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="af-time">KO *</Label>
          <Input id="af-time" name="kickoff_time" type="time" required className="touch" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="af-competition">Competition</Label>
        <Input id="af-competition" name="competition" maxLength={120} className="touch" placeholder="League if blank" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="af-venue">Ground (away games)</Label>
        <Input id="af-venue" name="venue_text" maxLength={200} className="touch" placeholder="Where an away game is played" />
      </div>
      <Button type="submit" size="touch" disabled={saving} className="w-full">
        {saving ? "Adding…" : "Add fixture"}
      </Button>
      <p className="text-xs text-muted-foreground">
        The diary event and notifications follow on their own; a home game then waits on the desk
        for its pitch.
      </p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && <p className="text-sm text-success">{state.notice}</p>}
    </form>
  );
}

/** The header's own door: a button, and the sheet it opens. */
export function AddFixtureButton({ teams }: { teams: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="touch" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-4 w-4" aria-hidden /> Add a fixture
      </Button>
      <AddFixtureSheet open={open} teams={teams} onClose={() => setOpen(false)} />
    </>
  );
}

/** The form as a sheet — the grid's empty cells open this one with a prefill. */
export function AddFixtureSheet({
  open,
  teams,
  prefill,
  onClose,
}: {
  open: boolean;
  teams: { id: string; name: string }[];
  prefill?: AddFixturePrefill;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="New fixture"
      subtitle="Who, when, and which way round."
      side="drawer"
      width={460}
    >
      <AddFixtureForm teams={teams} prefill={prefill} onAdded={onClose} />
    </Sheet>
  );
}
