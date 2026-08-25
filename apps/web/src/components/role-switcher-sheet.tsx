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
 * One option renders the trigger inert — nothing to switch to.
 */

import { useEffect, useState, useTransition } from "react";
import {
  Baby,
  Check,
  ChevronsUpDown,
  DoorOpen,
  Megaphone,
  ShieldCheck,
  Shirt,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { switchRoleView } from "@/app/(app)/welcome/actions";
import type { RoleSwitcherOption } from "@/components/role-switcher";

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
  const [open, setOpen] = useState(false);
  const [switching, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    // The page behind the sheet should not scroll under a thumb.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const active = options.find((option) => option.value === current) ?? options[0];
  if (!active) return null;
  const single = options.length <= 1;

  const triggerNode =
    trigger === "role-line" ? (
      <button
        type="button"
        disabled={single || switching}
        onClick={() => setOpen(true)}
        className={
          "flex min-h-[28px] items-center gap-1 text-left text-[11.5px] leading-tight text-accent " +
          (switching ? "opacity-60" : "")
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
        type="button"
        disabled={single || switching}
        onClick={() => setOpen(true)}
        className={
          "flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/15 px-3.5 py-3 text-left " +
          (switching ? "opacity-60" : "")
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
          className="fixed inset-0 z-50 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Viewing as"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
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
              const Icon = VIEW_ICONS[viewOf(option.value)] ?? UserCircle;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={switching}
                  onClick={() => {
                    if (option.value === current) {
                      setOpen(false);
                      return;
                    }
                    startTransition(() => {
                      void switchRoleView(option.value);
                    });
                  }}
                  className={
                    "flex w-full items-center gap-3 border-t border-border/60 px-5 py-3.5 text-left first-of-type:border-t-0 " +
                    (isActive ? "bg-accent/10" : "active:bg-secondary/60")
                  }
                >
                  <span
                    className={
                      "inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg " +
                      (isActive
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
                        (isActive ? "font-semibold" : "font-normal")
                      }
                    >
                      {option.role}
                    </span>
                    <span className="block truncate text-xs leading-tight text-muted-foreground">
                      {option.scope}
                    </span>
                  </span>
                  {isActive && <Check className="h-5 w-5 flex-none text-accent" />}
                </button>
              );
            })}
            <div className="px-5 pt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
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
