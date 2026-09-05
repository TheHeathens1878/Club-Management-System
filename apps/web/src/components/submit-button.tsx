"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * The form's one submit (P7.2 screen patterns): disabled and spinning while
 * the action runs, so a second tap cannot send a second copy — the duplicate
 * submission every form is one impatient thumb away from. Reads the pending
 * state from the nearest form, so it needs no wiring beyond being inside one.
 *
 * `pendingLabel` is what a screen reader hears while it waits; the visual
 * label stays put so the button does not change width under the pointer.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      aria-disabled={pending}
      aria-busy={pending}
      disabled={pending || props.disabled}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="sr-only">{pendingLabel}</span>
        </>
      ) : null}
      <span aria-hidden={pending}>{children}</span>
    </Button>
  );
}
