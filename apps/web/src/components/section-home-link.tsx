"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "When in any finance screen, there should be a button to go back to finance
 * home" (Adam, 2026-09-04) — true of every section with a home worth naming,
 * not just Finance. A segment layout renders this once and every page under it
 * gets the same way up; it hides itself on the home page it points at, so the
 * section home never offers a link to itself.
 *
 * The icon arrives PRE-RENDERED from the server layout — a React element, not
 * a component. A Lucide icon is a forwardRef object, and a server component
 * cannot hand one of those to a client component: Next refuses it at render
 * time ("Only plain objects … can be passed to Client Components"), which is
 * what took every Pitches, Room bookings and Finance page down with digest
 * 2121152254 on 2026-09-05.
 *
 * A page still carries its own `PageHeader` back when it returns somewhere
 * OTHER than the section home — a booking back to "My pitch bookings", say.
 * Where both would name the same target, this link is the one that renders.
 */
export function SectionHomeLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === href) return null;
  return (
    <div className="px-4 pt-4 lg:px-6">
      <Link
        href={href}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-secondary"
      >
        {icon}
        {label}
      </Link>
    </div>
  );
}
