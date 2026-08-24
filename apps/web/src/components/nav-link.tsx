"use client";

/**
 * One sidebar link, aware of the current route (the crest design highlights
 * where you are). The icon arrives pre-rendered from the server layout as
 * `children`, so the capability-scoped nav stays a server concern and this
 * component knows nothing but the path.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  child = false,
  children,
}: {
  href: string;
  /** Indented sub-entry (the nav's `child` items). */
  child?: boolean;
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
          ? "bg-primary/20 text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground")
      }
    >
      {children}
    </Link>
  );
}
