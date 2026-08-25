import Link from "next/link";
import { Bell } from "lucide-react";

import { RoleSwitcherSheet } from "@/components/role-switcher-sheet";
import type { RoleSwitcherOption } from "@/components/role-switcher";

/**
 * The phone's identity strip (Club CRM mobile design): crest + club name over
 * the current role in crest orange — tapping the role opens the Viewing-as
 * sheet — with the notifications bell and the person's initials on the right.
 * Ink on paper, same `theme-ink` scope as the sidebar rail; hidden on lg+
 * where the sidebar carries all of this.
 */
export function MobileHeader({
  name,
  switcher,
  unread,
}: {
  name: string;
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

  return (
    <header className="theme-ink sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-2.5 text-foreground lg:hidden">
      {/* Same drop-shadow rim as the sidebar crest — black shield on ink. */}
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
        {switcher ? (
          <RoleSwitcherSheet
            options={switcher.options}
            current={switcher.current}
            trigger="role-line"
          />
        ) : (
          <p className="truncate text-[11.5px] leading-tight text-foreground/55">{name}</p>
        )}
      </div>
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
