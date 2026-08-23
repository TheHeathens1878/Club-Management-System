"use client";

import { useTransition } from "react";
import { Baby, Building2, Megaphone, ShieldCheck, Shirt, type LucideIcon } from "lucide-react";

import { ROLE_VIEW_BLURBS, ROLE_VIEW_COOKIE, ROLE_VIEW_LABELS, type RoleView } from "@/lib/role-view";

import { setRoleView } from "./actions";

/**
 * The tiles.
 *
 * Only views the person QUALIFIES for reach this component — the page works
 * that out from the database before rendering — so there is nothing here to
 * grey out, nothing to ask for, and no explaining why a tile is unavailable.
 * Picking one stores the view and lands on that view's own home screen.
 */

const ICONS: Record<RoleView, LucideIcon> = {
  player: Shirt,
  parent: Baby,
  coach: Megaphone,
  admin: ShieldCheck,
  function_room: Building2,
};

export function RoleTiles({
  views,
  current,
}: {
  views: RoleView[];
  current: RoleView | null;
}) {
  const [pending, startTransition] = useTransition();

  function choose(view: RoleView) {
    // The cookie is what the layout reads; localStorage is kept in step so a
    // client-side reader sees the same answer. Neither grants anything.
    try {
      window.localStorage.setItem(ROLE_VIEW_COOKIE, view);
    } catch {
      // Private mode, or storage disabled. The cookie is the source of truth.
    }
    startTransition(() => {
      void setRoleView(view);
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {views.map((view) => {
        const Icon = ICONS[view];
        const active = current === view;
        return (
          <button
            key={view}
            type="button"
            onClick={() => choose(view)}
            disabled={pending}
            aria-current={active ? "true" : undefined}
            className={
              "rounded-xl border p-5 text-left transition disabled:opacity-60 " +
              (active
                ? "border-primary bg-primary/5 shadow-sm"
                : "bg-card hover:border-primary/40 hover:bg-secondary")
            }
          >
            <Icon className={"h-6 w-6 " + (active ? "text-primary" : "text-muted-foreground")} />
            <p className="mt-3 font-semibold">{ROLE_VIEW_LABELS[view]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ROLE_VIEW_BLURBS[view]}</p>
            {active ? (
              <p className="mt-2 text-xs font-medium text-primary">Currently showing</p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
