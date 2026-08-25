"use client";

/**
 * "Viewing as" — the design's own control (Adam's screenshot, 2026-08-25): an
 * accent chip carrying the current role over its scope with a chevron, opening
 * a dark SWITCH ROLE panel of two-line options — role bold, scope muted, a
 * tick on the active row.
 *
 *   Club admin / Whole club ✓
 *   Coach / U14 Mavericks
 *   Parent / U14 Mavericks
 *   …
 *
 * Renders the WHOLE control (label, chip, panel) — the sidebar places
 * `<RoleSwitcher {...roleSwitcherProps(capabilities, view, scope?.id ?? null)}/>`
 * bare, with no chip of its own. Colours ride the theme tokens, so inside the
 * ink rail it takes the crest palette without bespoke styling.
 *
 * Selecting calls `switchRoleView`, which re-validates against the database's
 * own answers before writing the cookies and landing on the view's home. One
 * option renders as a plain, unclickable chip — nothing to switch to.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { switchRoleView } from "@/app/(app)/welcome/actions";

export type RoleSwitcherOption = {
  value: string;
  label: string;
  role: string;
  scope: string;
};

export function RoleSwitcher({
  options,
  current,
}: {
  options: RoleSwitcherOption[];
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const [switching, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Escape, closes the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = options.find((option) => option.value === current) ?? options[0];
  if (!active) return null;
  const single = options.length <= 1;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={single || switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          "w-full rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-left " +
          (single ? "" : "cursor-pointer transition hover:bg-accent/25 ") +
          (switching ? "opacity-60" : "")
        }
      >
        <span className="font-display block text-[9px] font-medium uppercase tracking-[0.16em] text-accent">
          Viewing as
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight">
              {active.role}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {active.scope}
            </span>
          </span>
          {!single ? (
            <ChevronsUpDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          ) : null}
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Switch role"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
        >
          <p className="font-display border-b border-border px-3 pb-2 pt-2.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Switch role
          </p>
          {options.map((option) => {
            const isActive = option.value === current;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={switching}
                onClick={() => {
                  setOpen(false);
                  if (option.value === current) return;
                  startTransition(() => {
                    void switchRoleView(option.value);
                  });
                }}
                className={
                  "flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left last:border-b-0 " +
                  (isActive ? "bg-accent/15" : "hover:bg-secondary/60")
                }
              >
                <span className="min-w-0">
                  <span
                    className={
                      "block truncate text-[13px] leading-tight " +
                      (isActive ? "font-semibold" : "font-medium")
                    }
                  >
                    {option.role}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                    {option.scope}
                  </span>
                </span>
                {isActive ? <Check className="h-4 w-4 flex-none text-accent" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
