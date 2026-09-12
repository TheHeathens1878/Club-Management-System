"use client";

/**
 * The per-noun tabs (P7.5): under the top bar, the rows of whichever noun
 * the page is inside — Overview first, then its items — as a scrolling strip
 * with the crest underline on the active one. The strip is the noun's table
 * of contents; the page below keeps its own header.
 *
 * The groups arrive pre-built from the server layout (each row's href already
 * carries its hat via /context), so this component knows nothing but paths.
 * Active tab: the row whose href matches the most of the URL — path first,
 * then every query parameter it names — so "/messages?filter=groups" beats
 * "/messages" on the groups filter and loses everywhere else.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { activeDestination, type DestinationKey } from "@/lib/destinations";

export type NounTab = { href: string; label: string; badge?: number };
export type NounTabGroup = { key: DestinationKey; tabs: NounTab[] };

export function NounTabs({ groups }: { groups: NounTabGroup[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeDestination(pathname);
  const group = active ? groups.find((g) => g.key === active) : undefined;
  if (!group || group.tabs.length <= 1) return null;

  // A row that goes through /context names its real target in `next`.
  const target = (href: string): string => {
    if (!href.startsWith("/context?")) return href;
    return new URLSearchParams(href.slice("/context?".length)).get("next") ?? href;
  };
  const matches = (href: string): boolean => {
    const [path, query] = target(href).split("?");
    const base = path ?? href;
    if (!(pathname === base || (base !== "/" && pathname.startsWith(`${base}/`)))) return false;
    if (!query) return true;
    return [...new URLSearchParams(query)].every(([key, value]) => searchParams.get(key) === value);
  };
  const specificity = (href: string): number => {
    const [path, query] = target(href).split("?");
    return (path ?? href).length + (query ? new URLSearchParams(query).size * 1000 : 0);
  };
  let current: NounTab | null = null;
  for (const tab of group.tabs) {
    if (!matches(tab.href)) continue;
    if (!current || specificity(tab.href) > specificity(current.href)) current = tab;
  }

  return (
    <nav
      aria-label="Section"
      className="flex gap-6 overflow-x-auto border-b border-border bg-card px-4 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {group.tabs.map((tab) => {
        const on = current?.href === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={
              "flex min-h-[44px] flex-none items-center gap-2 whitespace-nowrap border-b-[2.5px] pt-0.5 text-[13px] leading-none transition-colors " +
              (on
                ? "border-accent font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
