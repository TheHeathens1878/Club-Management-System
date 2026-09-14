"use client";

/**
 * A card that starts folded (Adam, 2026-09-14: "minimising clicks and
 * scrolling"). The timetable is the page; dates off, the block's venues and
 * the block's own details are settings, so each is one row that says what it
 * holds — "Dates off · Christmas, Half-term" — and opens on a press. Native
 * <details>, so it works without a script and the state survives a refresh
 * only as long as React keeps the node (it does, across a server action).
 */

import { ChevronDown, type LucideIcon } from "lucide-react";

export function FoldCard({
  icon: Icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** What is inside, in a few words, so the row is worth reading folded. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border bg-card text-card-foreground shadow-sm">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden lg:px-5">
        <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight">{title}</span>
          {summary ? <span className="block truncate text-[12.5px] text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t px-4 py-4 lg:px-5">{children}</div>
    </details>
  );
}
