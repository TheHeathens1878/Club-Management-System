import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * One figure with its name over it — the facts band every screen in the
 * makeover opens with, and the "Total · Paid · Outstanding" triple finance
 * had written out by hand on four pages with four different type sizes.
 *
 * The figure is `font-display` and `tabular-nums` so a column of them lines
 * up digit under digit and a number changing does not shuffle the layout.
 * `href` turns the whole tile into one press — the tile is then the door to
 * the detail, which is why the label stays plain and the figure does the
 * talking.
 */
const TONE_INK = {
  default: "",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
} as const;

export type StatTone = keyof typeof TONE_INK;

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** The line under the figure — "3 over 60 days", "of £1,840 due". */
  hint?: React.ReactNode;
  tone?: StatTone;
  /** Makes the tile a press. Every filter and every drill-down is a URL. */
  href?: string;
  /** A rendered icon, e.g. `<Receipt className="h-3.5 w-3.5" aria-hidden />`. */
  icon?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon ? <span className="flex-none">{icon}</span> : null}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      <p className={cn("font-display mt-1 text-panel font-semibold tabular-nums", TONE_INK[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  const shell = cn("rounded-lg border bg-card p-3", className);

  if (href) {
    return (
      <Link href={href} className={cn(shell, "block transition-colors hover:bg-secondary/50")}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * The band the tiles sit in: two across on a phone, four on a desk. Pass a
 * `className` to say otherwise — `md:grid-cols-3 xl:grid-cols-6` for a hub
 * with six of them — the class merger lets the caller win.
 */
export function StatRow({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} {...props}>
      {children}
    </div>
  );
}
