import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A pill that is either on or off — a day on the training timetable, a kind
 * of event, a team. Two of them, because the app has two kinds of filter and
 * they are not interchangeable:
 *
 *   · `ToggleChip` is a button holding local state (the block page's day
 *     chips, which only ever change what is drawn on screen). It says
 *     `aria-pressed`, which is what a screen reader wants from a toggle.
 *   · `ToggleChipLink` is a `<Link>`, and is the one to reach for whenever
 *     the filter belongs in the URL — which is nearly always, because a
 *     filtered view should be shareable and the back button should undo a
 *     tap. It says `aria-current="page"`.
 *
 * Both are `.touch` tall on a phone and settle to a compact desk height at
 * `lg`. `count` is the number that rides on the right of the label; zero is
 * not drawn, because "Thursday 0" is noise.
 */
const toggleChipVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      size: {
        sm: "touch px-3 text-list lg:min-h-[30px]",
        md: "touch px-3.5 text-list lg:min-h-[34px]",
      },
      on: {
        true: "border-primary bg-primary text-primary-foreground",
        false: "bg-card text-foreground hover:bg-secondary",
      },
    },
    defaultVariants: { size: "md", on: false },
  }
);

function Count({ count, on }: { count: number; on: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-2xs font-semibold leading-none",
        on ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-muted-foreground"
      )}
    >
      {count}
    </span>
  );
}

export interface ToggleChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    Omit<VariantProps<typeof toggleChipVariants>, "on"> {
  /** Whether this chip is the chosen one. */
  on: boolean;
  count?: number;
}

export function ToggleChip({ on, count, size, className, children, ...props }: ToggleChipProps) {
  return (
    <button type="button" aria-pressed={on} className={cn(toggleChipVariants({ size, on }), className)} {...props}>
      {children}
      {count ? <Count count={count} on={on} /> : null}
    </button>
  );
}

export interface ToggleChipLinkProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Link>, "children">,
    Omit<VariantProps<typeof toggleChipVariants>, "on"> {
  /** Whether this chip is the view being shown. */
  active: boolean;
  count?: number;
  children?: React.ReactNode;
}

export function ToggleChipLink({ active, count, size, className, children, ...props }: ToggleChipLinkProps) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(toggleChipVariants({ size, on: active }), className)}
      {...props}
    >
      {children}
      {count ? <Count count={count} on={active} /> : null}
    </Link>
  );
}

export { toggleChipVariants };
