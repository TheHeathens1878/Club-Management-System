"use client";

/**
 * The behaviour behind both "Viewing as" controls — the sidebar's popover and
 * the phone's bottom sheet — kept in one place so the two cannot drift apart.
 *
 * Adam, 2026-09-01: "when you click on a club (viewing as) it should confirm
 * and auto-close the popup down rather than you having to click off." Neither
 * control did anything useful with the answer it had asked for. The sheet fired
 * `switchRoleView` and then just sat there, still open over the view it had
 * just changed, until you tapped the dim; the popover did the opposite and shut
 * instantly, before the switch had landed. Neither is a confirmation.
 *
 * Three things make the confirmation honest:
 *
 *   · The action's promise is not the signal, and it never was. Both controls
 *     handed `startTransition` a SYNCHRONOUS callback that dropped the promise
 *     on the floor, so `isPending` came straight back down while the server was
 *     still thinking and the only feedback in the design — the greyed row —
 *     flickered past unseen. The callback is async here, so React holds the
 *     transition open for the whole round-trip.
 *   · `current` is the signal. `switchRoleView` → `setRoleView` revalidates the
 *     layout and redirects, so the hat the server actually wrote comes back
 *     down this component's own props. Closing on THAT, and on nothing else,
 *     means the panel can never close onto the view you were leaving.
 *   · A refusal is silent by design — `setRoleView` returns without writing
 *     when the database no longer backs the view (a coach role that ended
 *     between the menu being drawn and the tap), so no redirect ever arrives.
 *     After `STALL_MS` the rows come back and the panel says so, rather than
 *     leaving a dead sheet with everything disabled. `pending` is deliberately
 *     kept through that, so a switch that was merely slow still closes the
 *     panel when it lands.
 *
 * Focus is returned to the trigger on close, but only when it was inside the
 * panel being closed — clicking somewhere else on the page must not have the
 * switcher snatch the focus back off whatever was clicked.
 */

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { switchRoleView } from "@/app/(app)/welcome/actions";

/** How long a switch may take before the panel offers the controls back. */
const STALL_MS = 10_000;

export type RoleSwitcherControl = {
  open: boolean;
  /** The option value being switched to, or null when nothing is in flight. */
  pending: string | null;
  /** The switch has taken long enough that it probably is not coming. */
  stalled: boolean;
  /** Rows are inert while a switch is genuinely in flight. */
  busy: boolean;
  openPanel: () => void;
  /** Close without changing anything — Escape, Cancel, a tap on the dim. */
  dismiss: () => void;
  choose: (value: string) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
};

export function useRoleSwitcher(current: string): RoleSwitcherControl {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const dismiss = useCallback(() => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    const fromInside = !!active && !!panelRef.current && panelRef.current.contains(active);
    setOpen(false);
    if (fromInside) triggerRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setStalled(false);
    setOpen(true);
  }, []);

  const choose = useCallback(
    (value: string) => {
      // Picking the hat already being worn is a no-op with a close attached.
      if (value === current) {
        dismiss();
        return;
      }
      setStalled(false);
      setPending(value);
      startTransition(async () => {
        await switchRoleView(value);
      });
    },
    [current, dismiss],
  );

  // The switch has landed: the server wrote the cookie, revalidated the layout
  // and sent the new hat back down as `current`. Only now is it safe to close.
  useEffect(() => {
    if (pending === null || current !== pending) return;
    setPending(null);
    setStalled(false);
    dismiss();
  }, [current, pending, dismiss]);

  useEffect(() => {
    if (pending === null) return;
    const timer = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // Escape closes either control, in flight or not — a panel a keyboard cannot
  // get out of is worse than one that closes over a switch still travelling.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  return {
    open,
    pending,
    stalled,
    busy: pending !== null && !stalled,
    openPanel,
    dismiss,
    choose,
    triggerRef,
    panelRef,
  };
}
