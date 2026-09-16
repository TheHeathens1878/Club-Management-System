import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A grey bar where a line of text is about to be. Its job is to say "this
 * screen is arriving" in the shape of the screen that is arriving, so a tap
 * lands somewhere visibly loading instead of appearing ignored.
 *
 * It is `aria-hidden`: the loading state is announced once, by the
 * `aria-busy` region around it, not forty times by the bars inside it. Size
 * it with `className` — `h-4 w-1/3` — because only the caller knows what is
 * coming.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-muted", className)} {...props} />;
}
