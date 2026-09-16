import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The little upper-case label over a group of things — "Your teams",
 * "Show me", "Tuesdays". Oswald, letter-spaced, and small enough that it
 * reads as a signpost rather than a heading, which is exactly why it is not
 * an `<h2>` by default: use `as="h2"` with an `id` when it really does name
 * a landmark the screen reader should announce.
 */
export function Eyebrow({
  as: Tag = "p",
  tone = "muted",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: "p" | "h2" | "h3" | "span";
  tone?: "muted" | "primary" | "accent";
}) {
  return (
    <Tag
      className={cn(
        "font-display text-2xs font-medium uppercase tracking-[0.16em]",
        tone === "primary" ? "text-primary" : tone === "accent" ? "text-accent" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
