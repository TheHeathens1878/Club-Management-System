"use client";

/**
 * "Viewing as" on a phone — a bottom sheet, because six hats don't fit a menu
 * bar (the design's own words). Two triggers share it:
 *
 *   · `role-line` — the accent role line in the mobile header ("Club admin ⇅"),
 *   · `tile` — the More screen's Viewing-as tile (eyebrow, role, scope + how
 *     many other hats, chevrons).
 *
 * The sheet itself is the design's artboard: dim overlay, grab handle,
 * "Viewing as" over the hard-scope explainer, one row per hat — icon tile,
 * role over scope, tick on the active row — and a Cancel button. Selecting
 * calls the same `switchRoleView` action as the sidebar dropdown; everything is
 * re-validated server-side before the cookie is written.
 *
 * Adam, 2026-09-01: "when you click on a club (viewing as) it should confirm
 * and auto-close the popup down rather than you having to click off." The
 * header's sheet lives in the persistent layout, so switching used to leave it
 * sitting open — and with the body still scroll-locked — on top of the view it
 * had just changed. The chosen row now takes the tick and a spinner while the
 * round-trip runs, and `useRoleSwitcher` closes the sheet the moment the new
 * hat comes back down in `current`; see that hook for why the action's own
 * promise is not the signal to close on.
 *
 * One option renders the trigger inert — nothing to switch to.
 */

import { useEffect } from "react";
import {
  Baby,
  Check,
  ChevronsUpDown,
  DoorOpen,
  Loader2,
  Megaphone,
  ShieldCheck,
  Shirt,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import type { RoleSwitcherOption } from "@/components/role-switcher";
import { useRoleSwitcher } from "@/components/use-role-switcher";
import { roleSwitchAnnouncement } from "@/lib/role-view";

/** The design keys the row icon off the KIND of hat, not the team. */
const VIEW_ICONS: Record<string, LucideIcon> = {
  me: UserCircle,
  admin: ShieldCheck,
  coach: Megaphone, // the design asks for a whistle; lucide has none
  parent: Baby,
  player: Shirt,
  function_room: DoorOpen,
};

function viewOf(value: string): string {
  return value.split(":", 1)[0] ?? value;
}

export function RoleSwitcherSheet({
  options,
  current,
  trigger,
}: {
  options: RoleSwitcherOption[];
  current: string;
  trigger: "role-line" | "tile";
}) {
  const { open, pending, stalled, busy, openPanel, dismiss, choose, triggerRef, panelRef } =
    useRoleSwitcher(current);

  useEffect(() => {
    if (!open) return;
    // The page behind the sheet should not scroll under a thumb.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const active = options.find((option) => option.value === current) ?? options[0];
  if (!active) return null;
  const single = options.length <= 1;
  const pendingOption = pending ? options.find((option) => option.value === pending) : undefined;
  const announcement = roleSwitchAnnouncement(
    pendingOption ? `${pendingOption.role}${pendingOption.scope ? `, ${pendingOption.scope}` : ""}` : null,
    stalled,
  );

  const triggerNode =
    trigger === "role-line" ? (
      <button
        ref={triggerRef}
        type="button"
        disabled={single}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? dismiss() : openPanel())}
        className={
          "flex min-h-[28px] items-center gap-1 text-left text-[11.5px] leading-tight text-accent " +
          (busy ? "opacity-60" : "")
        }
      >
        <span className="truncate">
          {active.role}
          {active.scope ? ` · ${active.scope}` : ""}
        </span>
        {!single && <ChevronsUpDown className="h-3 w-3 flex-none opacity-80" />}
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        disabled={single}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? dismiss() : openPanel())}
        className={
          "flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/15 px-3.5 py-3 text-left " +
          (busy ? "opacity-60" : "")
        }
      >
        <span className="min-w-0 flex-1">
          <span className="font-display block text-[9px] font-medium uppercase tracking-[0.16em] text-accent">
            Viewing as
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold leading-tight">
            {active.role}
          </span>
          <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">
            {active.scope}
            {options.length > 1
              ? ` · ${options.length - 1} other ${options.length === 2 ? "role" : "roles"}`
              : ""}
          </span>
        </span>
        {!single && (
          <ChevronsUpDown className="h-4 w-4 flex-none text-muted-foreground" />
        )}
      </button>
    );

  return (
    <>
      {triggerNode}
      {open ? (
        <div
          ref={panelRef}
          className="fixed inset-0 z-50 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Viewing as"
          aria-busy={busy}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 bg-black/45"
          />
          <div className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 text-card-foreground shadow-2xl">
            <div className="flex justify-center pb-3">
              <span className="h-1 w-10 rounded-full bg-foreground/20" />
            </div>
            <div className="border-b border-border px-5 pb-3">
              <p className="text-base font-semibold leading-tight">Viewing as</p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                Each role shows its own menu. Nothing is combined, so pick the hat
                you are wearing right now.
              </p>
            </div>
            {options.map((option) => {
              const isActive = option.value === current;
              const isPending = option.value === pending;
              const Icon = VIEW_ICONS[viewOf(option.value)] ?? UserCircle;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(option.value)}
                  className={
                    "flex w-full items-center gap-3 border-t border-border/60 px-5 py-3.5 text-left first-of-type:border-t-0 " +
                    (isActive || isPending ? "bg-accent/10" : "active:bg-secondary/60") +
                    (busy && !isPending ? " opacity-50" : "")
                  }
                >
                  <span
                    className={
                      "inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg " +
                      (isActive || isPending
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary text-secondary-foreground")
                    }
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        "block truncate text-sm leading-tight " +
                        (isActive || isPending ? "font-semibold" : "font-normal")
                      }
                    >
                      {option.role}
                    </span>
                    <span className="block truncate text-xs leading-tight text-muted-foreground">
                      {isPending && !stalled ? "Switching…" : option.scope}
                    </span>
                  </span>
                  {isPending && !stalled ? (
                    <Loader2 className="h-5 w-5 flex-none animate-spin text-accent" />
                  ) : isActive ? (
                    <Check className="h-5 w-5 flex-none text-accent" />
                  ) : null}
                </button>
              );
            })}
            {/* The greyed row is not enough on its own — say what is happening. */}
            <p
              role="status"
              aria-live="polite"
              className={
                announcement
                  ? "px-5 pt-3 text-[12px] leading-snug " +
                    (stalled ? "text-destructive" : "text-muted-foreground")
                  : "sr-only"
              }
            >
              {announcement}
            </p>
            <div className="px-5 pt-4">
              <button
                type="button"
                onClick={dismiss}
                className="w-full rounded-lg border border-border py-3.5 text-center text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
