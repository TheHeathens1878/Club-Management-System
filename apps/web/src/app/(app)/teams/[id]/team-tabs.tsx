import Link from "next/link";

/**
 * The team page's tab bar (URL-driven, `?tab=`).
 *
 * A server component on purpose: every tab is a real link, so the page is
 * shareable and bookmarkable, the back button works, and a tab the caller may
 * not use is simply not rendered rather than hidden with CSS. The bar scrolls
 * sideways on a phone instead of wrapping into two rows.
 *
 * Two tones. `plain` is the design build's strip in the page body (lg+); `ink`
 * is the phone's, drawn inside the dark team band the mobile artboard shows —
 * translucent trough, crest-orange active pill, 44px targets.
 */

export type TeamTabKey = "matchday" | "board" | "squad" | "training" | "subs" | "settings";

export type TeamTab = { key: TeamTabKey; label: string };

export function TeamTabs({
  teamId,
  tabs,
  active,
  tone = "plain",
}: {
  teamId: string;
  tabs: TeamTab[];
  active: TeamTabKey;
  tone?: "plain" | "ink";
}) {
  const ink = tone === "ink";
  return (
    <div
      className={
        ink
          ? "-mx-1 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "-mx-1 overflow-x-auto px-1 pb-1"
      }
    >
      <nav
        aria-label="Team sections"
        className={
          "inline-flex min-w-max gap-1 rounded-lg p-1 " +
          (ink ? "bg-foreground/10" : "bg-secondary")
        }
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/teams/${teamId}?tab=${tab.key}`}
            aria-current={tab.key === active ? "page" : undefined}
            className={
              ink
                ? `flex min-h-[38px] items-center whitespace-nowrap rounded-md px-3.5 text-[12.5px] font-medium transition-colors ${
                    tab.key === active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/70"
                  }`
                : `whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab.key === active
                      ? "bg-card shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
