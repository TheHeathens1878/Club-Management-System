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
 *
 * The panel used to shut the instant a row was clicked, which is the opposite
 * of the phone sheet's old fault and no better: it closed onto the view you
 * were leaving and left you watching the sidebar to work out whether anything
 * had happened. Both now run on `useRoleSwitcher` — the row goes pending, and
 * the panel closes only when the new hat arrives in `current`.
 */

import { useEffect } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { useRoleSwitcher } from "@/components/use-role-switcher";
import { roleSwitchAnnouncement } from "@/lib/role-view";

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
  const { open, pending, stalled, busy, openPanel, dismiss, choose, triggerRef, panelRef } =
    useRoleSwitcher(current);

  // A click anywhere else closes the panel. Escape is the hook's; it belongs
  // with the sheet's copy of the same rule.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, dismiss, panelRef, triggerRef]);

  const active = options.find((option) => option.value === current) ?? options[0];
  if (!active) return null;
  const single = options.length <= 1;
  const pendingOption = pending ? options.find((option) => option.value === pending) : undefined;
  const announcement = roleSwitchAnnouncement(
    pendingOption ? `${pendingOption.role}${pendingOption.scope ? `, ${pendingOption.scope}` : ""}` : null,
    stalled,
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={single}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? dismiss() : openPanel())}
        className={
          "w-full rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-left " +
          (single ? "" : "cursor-pointer transition hover:bg-accent/25 ") +
          (busy ? "opacity-60" : "")
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
          ref={panelRef}
          role="listbox"
          aria-label="Switch role"
          aria-busy={busy}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
        >
          <p className="font-display border-b border-border px-3 pb-2 pt-2.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Switch role
          </p>
          {options.map((option) => {
            const isActive = option.value === current;
            const isPending = option.value === pending;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={busy}
                onClick={() => choose(option.value)}
                className={
                  "flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left last:border-b-0 " +
                  (isActive || isPending ? "bg-accent/15" : "hover:bg-secondary/60") +
                  (busy && !isPending ? " opacity-50" : "")
                }
              >
                <span className="min-w-0">
                  <span
                    className={
                      "block truncate text-[13px] leading-tight " +
                      (isActive || isPending ? "font-semibold" : "font-medium")
                    }
                  >
                    {option.role}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                    {isPending && !stalled ? "Switching…" : option.scope}
                  </span>
                </span>
                {isPending && !stalled ? (
                  <Loader2 className="h-4 w-4 flex-none animate-spin text-accent" />
                ) : isActive ? (
                  <Check className="h-4 w-4 flex-none text-accent" />
                ) : null}
              </button>
            );
          })}
          {/* Announced, not just greyed — see roleSwitchAnnouncement. */}
          <p
            role="status"
            aria-live="polite"
            className={
              announcement
                ? "border-t border-border/50 px-3 py-2 text-[11px] leading-snug " +
                  (stalled ? "text-destructive" : "text-muted-foreground")
                : "sr-only"
            }
          >
            {announcement}
          </p>
        </div>
      ) : null}
    </div>
  );
}
