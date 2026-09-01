import Link from "next/link";

import { EVENT_TABS, type EventTabKey } from "@/lib/match-tabs";

export { EVENT_TABS, eventTabFrom, eventTabsFor, type EventTabKey } from "@/lib/match-tabs";

/**
 * The match page's tab bar (Adam, 2026-08-25: "The event (match) page should
 * have tabs showing details, line-up, match-stats … and scoreline").
 *
 * The same idea as the team page's `TeamTabs`, and a server component for the
 * same reasons: every tab is a real link, so the page is shareable and
 * bookmarkable and the back button works. Only a fixture-mirrored event gets a
 * bar at all — a training session or a social has nothing to put in the other
 * three tabs, and its page is left exactly as it was.
 */

const LABELS: Record<EventTabKey, string> = {
  details: "Details",
  lineup: "Line-up",
  stats: "Match stats",
  score: "Scoreline",
};

export function EventTabs({
  eventId,
  active,
  tabs = EVENT_TABS,
}: {
  eventId: string;
  active: EventTabKey;
  /**
   * Which tabs this reader gets. A family waiting for Sunday gets Details and
   * nothing else — the event page says why — and the whole bar afterwards.
   */
  tabs?: readonly EventTabKey[];
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav
        aria-label="Match sections"
        className="inline-flex min-w-max gap-1 rounded-lg bg-secondary p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab}
            href={`/events/${eventId}?tab=${tab}`}
            aria-current={tab === active ? "page" : undefined}
            className={
              "flex min-h-[44px] items-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors sm:min-h-[34px] " +
              (tab === active
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {LABELS[tab]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
