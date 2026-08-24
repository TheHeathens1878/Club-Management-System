import Link from "next/link";

/**
 * The team page's tab bar (URL-driven, `?tab=`).
 *
 * A server component on purpose: every tab is a real link, so the page is
 * shareable and bookmarkable, the back button works, and a tab the caller may
 * not use is simply not rendered rather than hidden with CSS. The bar scrolls
 * sideways on a phone instead of wrapping into two rows.
 */

export type TeamTabKey = "chat" | "overview" | "members" | "fixtures" | "bookings" | "notices" | "settings";

export type TeamTab = { key: TeamTabKey; label: string };

export function TeamTabs({
  teamId,
  tabs,
  active,
}: {
  teamId: string;
  tabs: TeamTab[];
  active: TeamTabKey;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <nav
        aria-label="Team sections"
        className="inline-flex min-w-max gap-1 rounded-lg bg-secondary p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/teams/${teamId}?tab=${tab.key}`}
            aria-current={tab.key === active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab.key === active
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
