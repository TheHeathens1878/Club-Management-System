/**
 * The folding row, closed and open.
 *
 * Worth two shots because the closed state is the one nearly every screen
 * shows: a 52px row whose summary has to survive a long title AND a long
 * summary line at 390 without pushing the chevron off the page. The open shot
 * is here because a native <details> hydrates oddly if it is ever controlled,
 * and a screenshot of the open body is the cheapest proof the fold works at
 * all in a browser.
 *
 * P8.0d moved the component to components/ui/fold-card.tsx; every screen in
 * the makeover folds its settings beneath with it.
 */

import { CalendarOff, MapPin, Settings2 } from "lucide-react";

import { FoldCard } from "@/components/ui/fold-card";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-3 p-4">{children}</div>;
}

function Body() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>Christmas — 20 December to 3 January. No sessions are put on the calendar between those dates.</p>
      <p>Half-term — 16 to 20 February.</p>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    closed: () => (
      <Frame>
        <FoldCard
          icon={<CalendarOff className="h-4 w-4" aria-hidden />}
          title="Dates off"
          summary="Christmas, Half-term"
        >
          <Body />
        </FoldCard>
        <FoldCard
          icon={<MapPin className="h-4 w-4" aria-hidden />}
          title="Venues in this block"
          // A deliberately long summary: it must truncate, not widen the row.
          summary="Banky Lane 1, Banky Lane 2, Banky Lane 3, Wythenshawe Park astroturf, Sale West rec"
        >
          <Body />
        </FoldCard>
        <FoldCard
          icon={<Settings2 className="h-4 w-4" aria-hidden />}
          title="The block itself"
          summary="Winter 2026 · 6 September to 21 March"
        >
          <Body />
        </FoldCard>
      </Frame>
    ),

    open: () => (
      <Frame>
        <FoldCard
          icon={<CalendarOff className="h-4 w-4" aria-hidden />}
          title="Dates off"
          summary="Christmas, Half-term"
          defaultOpen
        >
          <Body />
        </FoldCard>
      </Frame>
    ),
  },
};

export default fixture;
