"use client";

import { useEffect, useRef } from "react";

/**
 * A menu anchored to the thing that opened it — the crest drawer, the members
 * list on a conversation. Not a `Sheet`: a Sheet owns the screen and dims it,
 * a Popover hangs off its trigger and leaves the page where it was.
 *
 * The caller owns the trigger and the `relative` box the two share; this owns
 * the panel, and the two ways out of it that a hand-rolled panel keeps
 * forgetting — Escape, and a press anywhere else.
 *
 * A press on any control that says `aria-expanded="true"` is left alone: that
 * is the trigger of an open menu (usually this one), and closing here as well
 * as in its own click handler would make the trigger reopen what it just shut.
 */
export function Popover({
  open,
  onClose,
  label,
  anchor = "left",
  width = 320,
  scrim = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The panel's accessible name — "Menu", "Members of this conversation". */
  label: string;
  /** Which edge of the trigger box the panel hangs from. */
  anchor?: "left" | "right";
  /** Pixels; the panel never grows wider than the screen less its margins. */
  width?: number;
  /** Dim the page behind it. A menu over a page you can still read does not. */
  scrim?: boolean;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // The latest `onClose` out of a ref: callers pass an inline arrow, and
  // depending on it would take the listeners off and put them back on every
  // render of the page behind.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[aria-expanded="true"]')) return;
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {scrim ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className="fixed inset-0 z-20 cursor-default bg-foreground/20"
        />
      ) : null}
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        className={
          "absolute top-full z-30 mt-1 w-[min(var(--popover-w),calc(100vw-2rem))] rounded-xl border bg-card text-card-foreground shadow-lg " +
          (anchor === "right" ? "right-0" : "left-0")
        }
        style={{ "--popover-w": `${width}px` } as React.CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
