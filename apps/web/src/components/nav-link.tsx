"use client";

/**
 * One sidebar link, aware of the current route (the crest design highlights
 * where you are). The icon arrives pre-rendered from the server layout as
 * `children`, so the capability-scoped nav stays a server concern and this
 * component knows nothing but the path.
 *
 * The design's row furniture is opt-in: `badge` renders the orange count pill
 * on the right ("Messages · 12"), `lock` the small admin-only glyph (Settings)
 * — both taken from the nav item when the item carries them, absent otherwise.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export function NavLink({
  href,
  hrefs,
  child = false,
  badge,
  lock = false,
  children,
}: {
  href: string;
  /**
   * Every href in the menu, so the highlight can go to the BEST match and
   * only that one. `/pitches/calendar` starts with `/pitches`, and without
   * this both "Pitch calendar" and "Allocate fixtures" lit up together
   * (Adam, 2026-09-02) — the row that matches more of the path owns it.
   */
  hrefs?: string[];
  /** Indented sub-entry (the nav's `child` items). */
  child?: boolean;
  /** Right-aligned count pill, e.g. an unread count. Omitted = no pill. */
  badge?: string | number;
  /** Right-aligned lock glyph for admin-only rows (the design's Settings). */
  lock?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A menu row may carry a query ("/messages?filter=groups", "/room-bookings
  // ?status=pending"): it matches only when every one of its params is in the
  // current URL, and it then BEATS its query-less twin — so "My groups" lights
  // up on the groups filter and "Messaging" does not, instead of the reverse
  // being permanently true (2026-09-04 audit: the three query rows could never
  // highlight at all).
  const matches = (candidate: string): boolean => {
    const [path, query] = candidate.split("?");
    const base = path ?? candidate;
    if (!(pathname === base || (base !== "/" && pathname.startsWith(`${base}/`)))) return false;
    if (!query) return true;
    return [...new URLSearchParams(query)].every(([key, value]) => searchParams.get(key) === value);
  };
  const specificity = (candidate: string): number => {
    const [path, query] = candidate.split("?");
    return (path ?? candidate).length + (query ? new URLSearchParams(query).size * 1000 : 0);
  };
  const active =
    matches(href) &&
    !(hrefs ?? []).some(
      (other) => other !== href && specificity(other) > specificity(href) && matches(other),
    );

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex items-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
        (child ? "h-7 justify-start pl-7 text-xs " : "h-9 justify-start px-3 ") +
        (active
          ? "bg-primary text-primary-foreground font-semibold"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground")
      }
    >
      {children}
      {badge !== undefined || lock ? (
        <span className="ml-auto inline-flex items-center gap-1">
          {badge !== undefined && (
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none " +
                (active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-accent text-accent-foreground")
              }
            >
              {badge}
            </span>
          )}
          {lock && <Lock className="h-3 w-3 opacity-60" aria-label="Admin only" />}
        </span>
      ) : null}
    </Link>
  );
}
