"use client";

/**
 * The phone's primary nav (Club CRM mobile design): a fixed bar of up to five
 * 44px+ targets — icon over a 10px label, crest orange + 600 weight on the
 * active tab, an orange count pill on Messages when something is unread.
 *
 * Icons arrive pre-rendered from the server layout (the same trick as
 * NavLink), so the capability-scoped tab list stays a server concern and this
 * component knows nothing but paths.
 *
 * Active tab: the entry with the LONGEST matching pathname prefix wins, so
 * /room-bookings/contacts lights Contacts rather than the diary it sits
 * under. A route no tab claims lights More — every page reached through the
 * More screen keeps you visibly "in" More, which is what the design draws.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export type MobileTabItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Pathname prefixes that count as "on this tab". */
  match: string[];
  /** The More tab: active whenever nothing else matches. */
  moreFallback?: boolean;
  badge?: number;
};

export function MobileTabBar({ tabs }: { tabs: MobileTabItem[] }) {
  const pathname = usePathname();

  let activeIndex = -1;
  let bestLength = -1;
  tabs.forEach((tab, index) => {
    for (const prefix of tab.match) {
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLength) {
        bestLength = prefix.length;
        activeIndex = index;
      }
    }
  });
  if (activeIndex === -1) activeIndex = tabs.findIndex((tab) => tab.moreFallback);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab, index) => {
          const active = index === activeIndex;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                "flex min-h-[54px] flex-col items-center justify-center gap-1 pb-1 pt-1.5 text-[10px] leading-none transition-colors " +
                (active
                  ? "font-semibold text-primary"
                  : "font-normal text-muted-foreground hover:text-foreground")
              }
            >
              <span className="relative inline-flex">
                {tab.icon}
                {tab.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold leading-none text-accent-foreground">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                ) : null}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
