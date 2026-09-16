/**
 * The status bar, as a plain div and as a form.
 *
 * The case that matters at 390 is a long sentence beside a wide button: the
 * text column has `basis-56` and `min-w-0`, so the button drops onto its own
 * line rather than pushing the bar off the page. `children` are the footnote
 * and the named warnings a bulk action answers with — they sit beneath the
 * row inside the same surface.
 */

import { CalendarCheck2, LandPlot, RefreshCw } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-3 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    tones: () => (
      <Frame>
        <ActionBar
          icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
          tone="waiting"
          status="8 to add, 2 to change, 3 to remove"
          detail="24 sessions on the calendar · last updated 14 Sep, 09:05 · nothing moves until you press"
          action={
            <Button size="touch">
              <RefreshCw className="h-4 w-4" aria-hidden /> Update the calendar
            </Button>
          }
        />
        <ActionBar
          icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
          tone="done"
          status="8 added, 2 changed, 3 removed"
          detail="24 sessions on the calendar · last updated a moment ago"
          action={
            <Button size="touch" variant="outline">
              Update again
            </Button>
          }
        />
        <ActionBar
          icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
          tone="error"
          status="Could not compare the plan with the calendar: the block has no dates."
          action={
            <Button size="touch" disabled>
              Update the calendar
            </Button>
          }
        />
      </Frame>
    ),

    // A bulk bar: a form, a row of controls in the action slot, and the
    // footnote and warnings beneath.
    withNotes: () => (
      <Frame>
        <ActionBar
          as="form"
          className="border-primary/30"
          icon={<LandPlot className="h-4 w-4" aria-hidden />}
          status="6 teams ticked"
          detail="The ticks survive filtering — this sets every ticked team's home."
          action={
            <div className="flex flex-wrap items-end gap-3">
              <select
                aria-label="Home pitch"
                className="touch block h-9 w-full min-w-0 max-w-64 rounded-md border bg-background px-2 text-sm"
              >
                <option>Banky Lane 1</option>
              </select>
              <Button size="touch" type="button">
                Set home venue
              </Button>
            </div>
          }
        >
          <p className="text-xs text-muted-foreground">
            A blank kick-off leaves each team&apos;s standing time alone. Central-venue teams are left
            alone and named.
          </p>
          <p className="text-sm text-warning">U11 Venus plays at a central venue — left alone.</p>
        </ActionBar>
      </Frame>
    ),
  },
};

export default fixture;
