"use client";

/**
 * A card that starts folded (Adam, 2026-09-14: "minimising clicks and
 * scrolling"). On the training block page the timetable is the page; dates
 * off, the block's venues and the block's own details are settings, so each
 * is one row that says what it holds — "Dates off · Christmas, Half-term" —
 * and opens on a press. Lifted out of that folder (P8.0d) because every
 * screen in the makeover ends the same way: the work at the top, the
 * settings folded beneath.
 *
 * Native `<details>`, so it works before the script arrives and a server
 * action re-rendering the page underneath does not slam it shut.
 *
 * `defaultOpen` only, never a controlled `open`: the browser toggles the
 * element itself, so React's idea of `open` and the DOM's part company the
 * moment somebody presses the summary, and the next render snaps the fold
 * back. A disclosure that must be driven from outside is a different
 * component; this one is not it. `suppressHydrationWarning` is on the
 * `<details>` for the same reason — a browser that restores the open state
 * on a back-navigation hands React a DOM that does not match the server's
 * HTML, and that mismatch is harmless here.
 *
 * The icon arrives RENDERED, not as a component: the block page is a server
 * component and a function cannot cross into a client one (the 2026-09-14
 * "Functions cannot be passed directly to Client Components" 500).
 */

import { ChevronDown } from "lucide-react";

import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

export function FoldCard({
  icon,
  title,
  summary,
  defaultOpen = false,
  className,
  children,
}: {
  /** A lucide icon element, e.g. <CalendarOff className="h-4 w-4" aria-hidden />. */
  icon: React.ReactNode;
  title: string;
  /** What is inside, in a few words, so the row is worth reading folded. */
  summary?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      suppressHydrationWarning
      className={cn("group rounded-xl border bg-card text-card-foreground shadow-sm", className)}
    >
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden lg:px-5">
        <IconTile icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="block text-row font-semibold leading-tight">{title}</span>
          {summary ? <span className="block truncate text-xs text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronDown
          className="h-4 w-4 flex-none text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t px-4 py-4 lg:px-5">{children}</div>
    </details>
  );
}
