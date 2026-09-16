"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * A panel over the screen — the winter-training block page's side sheet
 * (`pitches/training/[id]/slot-sheet.tsx`), lifted out of its folder so every
 * screen gets the same one instead of the seventh hand-rolled `fixed inset-0`.
 *
 * Everything the good one already did is built in: a scrim that is a real
 * Close button (so a screen reader is told what tapping the dim does), Escape,
 * the body locked against scrolling underneath, focus starting on the close
 * button, the phone grabber, the home-indicator's safe area, and one
 * scrolling body between a fixed header and an optional footer.
 *
 * Two things it did not do, and now does:
 *
 *   · **Focus comes back.** Whatever was focused when the sheet opened is
 *     focused again when it closes, so a keyboard does not land back at the
 *     top of the page after every edit. A trigger that the page re-rendered
 *     away under the sheet is skipped rather than focused as a stray node.
 *   · **Tab cannot walk out.** While the sheet is open everything else in the
 *     document is `inert`, which is the browser's own containment — no
 *     focus-trap dependency, no sentinel elements, nothing to keep in sync.
 *     That is why the panel is PORTALLED to <body>: `inert` is inherited and a
 *     descendant cannot escape it, so the sheet has to be a SIBLING of the app
 *     shell rather than a child of the page that opened it. Browsers without
 *     `inert` (feature-detected) keep the restoration and lose only the
 *     containment, which is what they have today.
 *
 * The four sides are the four shapes the app actually uses:
 *
 *   · `drawer` — bottom sheet on a phone, right-hand drawer at `lg`. The
 *     benchmark's shape, for a panel you work IN.
 *   · `modal`  — bottom sheet on a phone, centred card at `lg`. For a choice
 *     you make and leave.
 *   · `center` — centred at every width.
 *   · `top`    — centred and anchored near the top (the command palette).
 *
 * `width` is the panel's width at `lg` for a drawer and its maximum width
 * everywhere else; it rides in as a custom property because a Tailwind class
 * cannot be built from a number at runtime.
 */

export type SheetSide = "drawer" | "modal" | "center" | "top";

const OUTER: Record<SheetSide, string> = {
  drawer: "fixed inset-0 z-50",
  modal: "fixed inset-0 z-50 flex flex-col justify-end lg:items-center lg:justify-center lg:p-4",
  center: "fixed inset-0 z-50 flex items-center justify-center p-4",
  top: "fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]",
};

const PANEL: Record<SheetSide, string> = {
  drawer:
    "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-card text-card-foreground shadow-2xl lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-[min(var(--sheet-w),100vw)] lg:rounded-none lg:border-l",
  modal:
    "relative flex max-h-[92dvh] flex-col rounded-t-2xl bg-card text-card-foreground shadow-2xl lg:max-h-[85dvh] lg:w-[min(var(--sheet-w),100%)] lg:rounded-xl lg:border",
  center:
    "relative flex max-h-[85dvh] w-[min(var(--sheet-w),100%)] flex-col rounded-xl border bg-card text-card-foreground shadow-2xl",
  top: "relative flex max-h-[76dvh] w-[min(var(--sheet-w),100%)] flex-col rounded-xl border bg-card text-card-foreground shadow-2xl",
};

/**
 * Make everything else in the document unreachable while the sheet is open.
 * Returns the undo. Elements already inert are left alone, so a sheet opened
 * over a sheet cannot un-inert the one underneath on its way out.
 */
function inertBackground(except: Element): () => void {
  if (typeof HTMLElement === "undefined" || !("inert" in HTMLElement.prototype)) return () => {};
  const changed: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (child === except || !(child instanceof HTMLElement) || child.inert) continue;
    child.inert = true;
    changed.push(child);
  }
  return () => {
    for (const element of changed) element.inert = false;
  };
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  side = "drawer",
  width = 460,
  headerAction,
  footer,
  busy = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The object the sheet is about. It is the panel's accessible name. */
  title: string;
  subtitle?: React.ReactNode;
  side?: SheetSide;
  /** Pixels: the drawer's width at `lg`, the widest the other shapes go. */
  width?: number;
  /** One control beside the title — rendered, never a component type. */
  headerAction?: React.ReactNode;
  /** Stays put while the body scrolls: the sheet's own Cancel / Done row. */
  footer?: React.ReactNode;
  /** Something the sheet asked the server is still in flight. */
  busy?: boolean;
  children: React.ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  // Escape reads the LATEST onClose out of a ref rather than closing over it,
  // because callers pass an inline arrow: depending on it would tear the sheet
  // down and set it up again on every render, and the sheet would snatch focus
  // back to its close button after every keystroke typed inside it.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // The portal host lives for exactly as long as the sheet is open. Creating
  // it in an effect also keeps the server render empty, which is what a closed
  // sheet renders anyway.
  useEffect(() => {
    if (!open) return;
    const element = document.createElement("div");
    element.setAttribute("data-sheet-root", "");
    document.body.appendChild(element);
    setHost(element);
    return () => {
      setHost(null);
      element.remove();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !host) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const undoInert = inertBackground(host);
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      undoInert();
      // A server action can re-render the trigger away while the sheet is up;
      // focusing a node that is no longer in the document would silently drop
      // focus to <body>, which is worse than leaving it where it is.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open, host]);

  if (!open || !host) return null;

  // A sheet that reaches the bottom edge of the screen owes the home indicator
  // its padding; one floating in the middle of the screen does not.
  const floating = side === "center" || side === "top";
  const grabber = side === "drawer" || side === "modal";

  return createPortal(
    <div
      className={OUTER[side]}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-busy={busy || undefined}
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className={PANEL[side]} style={{ "--sheet-w": `${width}px` } as React.CSSProperties}>
        {grabber ? (
          <div className="flex justify-center pt-2 lg:hidden">
            <span className="h-1 w-10 rounded-full bg-foreground/20" />
          </div>
        ) : null}
        <div className="flex flex-none items-start gap-3 border-b px-4 py-3 lg:px-5 lg:py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-panel font-semibold leading-tight">{title}</p>
            {subtitle ? <p className="mt-0.5 text-list leading-snug text-muted-foreground">{subtitle}</p> : null}
          </div>
          {headerAction ? <div className="flex-none">{headerAction}</div> : null}
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground lg:h-10 lg:w-10"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div
          className={
            "flex-1 overflow-y-auto px-4 py-4 lg:px-5 " +
            (floating || footer ? "" : "pb-[calc(env(safe-area-inset-bottom)+16px)]")
          }
        >
          {children}
        </div>
        {footer ? (
          <div
            className={
              "flex-none border-t px-4 py-3 lg:px-5 " +
              (floating ? "" : "pb-[calc(env(safe-area-inset-bottom)+12px)]")
            }
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    host,
  );
}
