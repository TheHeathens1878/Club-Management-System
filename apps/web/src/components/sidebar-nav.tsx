"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NavLink } from "@/components/nav-link";
import { activeDestination, type DestinationKey } from "@/lib/destinations";

/**
 * The desktop sidebar (P7.2): the five destinations as five rows, and under
 * the one you are in, its contents by section — the iOS split-view shape,
 * where the left column is always the same five things and the detail of
 * the current one unfolds beneath it. Nothing else unfolds, so the column
 * stays short whatever hats the reader wears; the Club hub page is where
 * the whole administration area is laid out at length.
 *
 * Icons arrive pre-rendered from the server layout (the NavLink trick), so
 * the capability-scoped menu stays a server concern; this component knows
 * paths and labels and which one the URL is inside.
 */
export type SidebarItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

export type SidebarSection = { section: string; items: SidebarItem[] };

export type SidebarDestination = {
  key: DestinationKey;
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  sections: SidebarSection[];
};

export function SidebarNav({
  destinations,
  hrefs,
}: {
  destinations: SidebarDestination[];
  /** Every href in the menu, for NavLink's best-match highlight. */
  hrefs: string[];
}) {
  const pathname = usePathname();
  const active = activeDestination(pathname);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {destinations.map((d) => {
        const open = d.key === active;
        return (
          <div key={d.key} className="flex flex-col gap-0.5">
            <Link
              href={d.href}
              aria-current={open ? "location" : undefined}
              className={
                "inline-flex h-10 items-center gap-2.5 rounded-md px-3 text-[14px] font-semibold transition-colors " +
                (open
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/85 hover:bg-secondary hover:text-foreground")
              }
            >
              {d.icon}
              <span className="flex-1">{d.label}</span>
              {d.badge ? (
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none " +
                    (open ? "bg-primary-foreground/20 text-primary-foreground" : "bg-accent text-accent-foreground")
                  }
                >
                  {d.badge > 99 ? "99+" : d.badge}
                </span>
              ) : null}
            </Link>

            {open && d.sections.length > 0 ? (
              <div className="mb-2 ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                {d.sections.map((section) => (
                  <div key={section.section} className="flex flex-col gap-0.5">
                    <p className="font-display px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {section.section}
                    </p>
                    {section.items.map((item) => (
                      <NavLink
                        key={`${item.href}|${item.label}`}
                        href={item.href}
                        hrefs={hrefs}
                        badge={item.badge}
                      >
                        {item.icon} {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
