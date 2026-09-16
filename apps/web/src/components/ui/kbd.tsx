import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A key, drawn as a key: `<Kbd>⌘K</Kbd>`. Used beside the thing the shortcut
 * opens, so the shortcut is discovered by people who never read a help page.
 */
export function Kbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded border border-border/60 px-1 font-mono text-2xs leading-5",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
