import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The row a set of chips lives in on a phone: one line that scrolls sideways
 * instead of wrapping into a ladder, bleeding into the page's own 16px
 * padding so the first chip starts at the text margin and the last one runs
 * off the edge — which is how a phone says "there is more this way".
 *
 * At `lg` the bleed and the padding are cancelled, because on a desk the
 * chips fit and a strip that starts outside the column looks broken.
 */
export function ChipStrip({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 no-scrollbar lg:mx-0 lg:px-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
