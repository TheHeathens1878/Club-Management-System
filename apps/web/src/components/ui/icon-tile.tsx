import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The small tinted square with an icon in it that starts a row, a fold or a
 * status bar. It had been copy-pasted five times — the hub list, the block
 * page's folds, its calendar bar, the training list, Home's attention rows —
 * each with its own size and its own idea of the tint.
 *
 * The icon arrives RENDERED, never as a component:
 * `<IconTile icon={<CalendarOff className="h-4 w-4" aria-hidden />} />`. A
 * server page cannot hand a function to a client component, and twice that
 * mistake reached production as a 500. Passing the element also leaves the
 * caller in charge of the icon's own size, which is what `h-4`/`h-5` do.
 */
const iconTileVariants = cva("inline-flex flex-none items-center justify-center", {
  variants: {
    size: { sm: "h-8 w-8", md: "h-9 w-9", lg: "h-10 w-10" },
    tone: {
      primary: "bg-primary/10 text-primary",
      muted: "bg-secondary text-muted-foreground",
      success: "bg-success-tint text-success",
      warning: "bg-warning-tint text-warning",
      info: "bg-info-tint text-info",
    },
    shape: { square: "rounded-lg", round: "rounded-full" },
  },
  defaultVariants: { size: "sm", tone: "primary", shape: "square" },
});

export interface IconTileProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof iconTileVariants> {
  /** A rendered element, e.g. `<Users className="h-4 w-4" aria-hidden />`. */
  icon: React.ReactNode;
}

export function IconTile({ icon, size, tone, shape, className, ...props }: IconTileProps) {
  return (
    <span className={cn(iconTileVariants({ size, tone, shape }), className)} {...props}>
      {icon}
    </span>
  );
}

export { iconTileVariants };
