import Link from "next/link";
import { Bell } from "lucide-react";

import { SearchTrigger } from "@/components/command-palette";
import { RoleSwitcherSheet } from "@/components/role-switcher-sheet";
import type { RoleSwitcherOption } from "@/components/role-switcher";

/**
 * The phone's identity strip: crest + club name over the CONTEXT the page is
 * wearing — "Coaching · U14 Mavericks", "Your child · U12 Cobras", "Club
 * administration" — with the search magnifier, the notifications bell and
 * the person's initials on the right. Tapping the context line opens the
 * switcher sheet, the explicit way to change hats when a page could mean two
 * things (P7.2: most people never need it — the Club rows put the right hat
 * on as they open).
 *
 * Ink on paper, same `theme-ink` scope as the sidebar rail; hidden on lg+
 * where the sidebar carries all of this.
 */
export function MobileHeader({
  name,
  context,
  switcher,
  unread,
}: {
  name: string;
  /** The hat's plain label, or null when the person is simply themselves. */
  context: string | null;
  switcher: { options: RoleSwitcherOption[]; current: string } | null;
  unread: number;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  // A declared height, not one that falls out of the tallest child: the thread
  // — and anything else that fills the screen — measures itself against
  // `--mobile-header-h` (Adam, 2026-09-01).
  return (
    <header className="theme-ink sticky top-0 z-30 flex h-[var(--mobile-header-h)] items-center gap-3 border-b border-border bg-background px-4 text-foreground lg:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/crest.png"
        alt=""
        className="h-[34px] w-auto shrink-0 [filter:drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.9))_drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.6))]"
      />
      <div className="min-w-0 flex-1">
        <p className="font-display truncate text-[13px] font-semibold uppercase leading-tight tracking-wide">
          AoM Sports Club
        </p>
        {switcher && switcher.options.length > 1 ? (
          <RoleSwitcherSheet
            options={switcher.options}
            current={switcher.current}
            trigger="role-line"
          />
        ) : (
          <p className="truncate text-[11.5px] leading-tight text-foreground/55">{context ?? name}</p>
        )}
      </div>
      <SearchTrigger variant="icon" />
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread"}
        className="relative inline-flex h-11 w-9 flex-none items-center justify-center"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0 top-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold leading-none text-accent-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      <span
        aria-hidden
        className="inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
      >
        {initials}
      </span>
    </header>
  );
}
