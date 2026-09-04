"use client";

/**
 * "Add a fixture", answered where it was asked (Adam, 2026-09-04: the header
 * button used to bounce an administrator to the team page). A details
 * popover, the same pattern as the teams page's New team: the desk stays a
 * desk until the button is opened. The database's `fixtures_staff_insert`
 * is the permission — the team list passed in is who the CALLER may add for.
 */

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

import { addFixture, type AddFixtureState } from "./add-fixture-actions";

const EMPTY: AddFixtureState = {};

export function AddFixtureForm({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, saving] = useActionState(addFixture, EMPTY);

  useEffect(() => {
    if (!state.notice) return;
    formRef.current?.reset();
    router.refresh();
  }, [state.notice, router]);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 [&::-webkit-details-marker]:hidden lg:min-h-0">
        <CalendarPlus className="h-4 w-4" /> Add a fixture
      </summary>
      <Card className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))]">
        <CardContent className="pt-6">
          <form ref={formRef} action={action} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="af-team">Team *</Label>
              {/* min-w-0: WebKit will not shrink a select below its longest
                  option without it. */}
              <select
                id="af-team"
                name="team_id"
                required
                defaultValue=""
                className="flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  Choose a team…
                </option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="af-opponent">Opponent *</Label>
              <Input id="af-opponent" name="opponent" required maxLength={120} placeholder="e.g. Sale United U12" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="af-side">Home / away</Label>
                <select
                  id="af-side"
                  name="side"
                  defaultValue="home"
                  className="flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-2 py-2 text-sm"
                >
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="af-date">Date *</Label>
                <Input id="af-date" name="kickoff_date" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="af-time">KO *</Label>
                <Input id="af-time" name="kickoff_time" type="time" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="af-competition">Competition</Label>
              <Input id="af-competition" name="competition" maxLength={120} placeholder="League if blank" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="af-venue">Ground (away games)</Label>
              <Input id="af-venue" name="venue_text" maxLength={200} placeholder="Where an away game is played" />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Adding…" : "Add fixture"}
            </Button>
            <p className="text-xs text-muted-foreground">
              The diary event and notifications follow on their own; a home game then waits on
              the desk for its pitch.
            </p>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {state.notice && <p className="text-sm text-emerald-700">{state.notice}</p>}
          </form>
        </CardContent>
      </Card>
    </details>
  );
}
