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
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

export function NavLink({
  href,
  child = false,
  badge,
  lock = false,
  children,
}: {
  href: string;
  /** Indented sub-entry (the nav's `child` items). */
  child?: boolean;
  /** Right-aligned count pill, e.g. an unread count. Omitted = no pill. */
  badge?: string | number;
  /** Right-aligned lock glyph for admin-only rows (the design's Settings). */
  lock?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

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
