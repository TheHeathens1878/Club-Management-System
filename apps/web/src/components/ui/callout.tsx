import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A short paragraph the eye should land on: what the server just said, a
 * thing worth knowing about the list beside it, a warning that is not an
 * error. One inset box, tinted by what it means, so the app stops inventing
 * a new amber border every time something needs saying.
 *
 * `danger` is the one that means somebody did something that failed —
 * `warning` means "look at this soon". An icon, when given, arrives
 * rendered: `icon={<AlertCircle className="h-4 w-4" aria-hidden />}`.
 */
const calloutVariants = cva("rounded-lg border px-3 py-2 text-sm", {
  variants: {
    tone: {
      info: "border-info/25 bg-info-tint text-info",
      success: "border-success/25 bg-success-tint text-success",
      warning: "border-warning/25 bg-warning-tint text-warning",
      danger: "border-destructive/20 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

export interface CalloutProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof calloutVariants> {
  /** A bold first line, when the body needs a heading to be read at all. */
  title?: React.ReactNode;
  icon?: React.ReactNode;
}

export function Callout({ tone, title, icon, className, children, ...props }: CalloutProps) {
  return (
    <div className={cn(calloutVariants({ tone }), className)} {...props}>
      <div className={cn("flex gap-1.5", icon ? "items-start" : "")}>
        {icon ? <span className="mt-0.5 flex-none">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold leading-snug">{title}</p> : null}
          {children ? <div className={cn("leading-snug", title ? "mt-0.5" : "")}>{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export { calloutVariants };
