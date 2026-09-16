"use client";

/**
 * A client module, on purpose. `Input` attaches a wheel handler to number
 * boxes (below), and a handler can only be created on the client: a server
 * page rendering `<Input type="number">` from a plain module threw "Event
 * handlers cannot be passed to Client Component props" on /room-bookings/rooms
 * and /room-bookings/new (digest 1775074775, 2026-09-16, the day after the
 * handler landed in PR 336). Marked client, the server page hands over only
 * serialisable props and the handler is made here, where it belongs.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

// A number box that has focus steps its value when the mouse wheel passes
// over it — one scroll of the page turned a £150 total into £149.99 on the
// confirm form (Adam, 2026-09-15). Wheel over a number box drops focus
// instead, so the page scrolls and the figure stays.
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
      onWheel={type === "number" ? (e) => { props.onWheel?.(e); blurOnWheel(e); } : props.onWheel}
    />
  )
);
Input.displayName = "Input";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Input, Label };
