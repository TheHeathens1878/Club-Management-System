"use client";

/**
 * The top bar (P7.5, the three-noun navigation): ink on paper across the top
 * of every screen, at every width.
 *
 *   crest · club name          Diary  People  Clubhouse  Money        Inbox  Messages  ⌕  [role ▾ ◯]
 *
 * The crest is a button: it opens the DRAWER — running the club (set up
 * once, changed rarely) and you (profile, family, preferences, help), then
 * the way out. The nouns and the utilities are `NavLink`s, so the highlight
 * goes to the best match and only that one. On a phone the nouns move to the
 * tab bar and the utilities into the drawer; the bar keeps the crest, the
 * search and the person.
 *
 * "Viewing as" is the same control the sidebar used to carry, re-drawn as the
 * design's header popover: role over scope, the person's avatar, and a panel
 * of two-line options with a tick on the active row. It runs on
 * `useRoleSwitcher`, so the row goes pending and the panel closes only when
 * the new hat arrives in `current` — a confirmation, not a guess.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Loader2, Lock, LogOut, Menu, X } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { SearchTrigger } from "@/components/command-palette";
import { NavLink } from "@/components/nav-link";
import type { RoleSwitcherOption } from "@/components/role-switcher";
import { useRoleSwitcher } from "@/components/use-role-switcher";
import { roleSwitchAnnouncement } from "@/lib/role-view";

export type TopBarDoor = {
  key: string;
  href: string;
  label: string;
  /** Pre-rendered icon element (a server layout cannot hand a component to a client one). */
  icon: React.ReactNode;
  badge?: number;
};

export type DrawerRow = {
  href: string;
  label: string;
  detail?: string;
  icon: React.ReactNode;
  /** Admin-only row: the small lock glyph. */
  lock?: boolean;
  /** The one row drawn in crest orange — Report a concern. */
  hot?: boolean;
  badge?: number;
};

export type DrawerSection = { section: string; rows: DrawerRow[] };

export function AppTopBar({
  clubName,
  name,
  photoUrl,
  context,
  nouns,
  utilities,
  hrefs,
  drawer,
  switcher,
}: {
  clubName: string;
  /** The signed-in person's name, for the avatar and the drawer's sign-out row. */
  name: string;
  photoUrl?: string | null;
  /** The hat's plain label — "Coaching · U14 Mavericks" — or null when the person is simply themselves. */
  context: string | null;
  nouns: TopBarDoor[];
  utilities: TopBarDoor[];
  /** Every href in the menu, for NavLink's best-match highlight. */
  hrefs: string[];
  drawer: DrawerSection[];
  switcher: { options: RoleSwitcherOption[]; current: string } | null;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // A navigation closes the drawer; so does Escape.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <>
      <header className="theme-ink sticky top-0 z-30 flex h-[var(--mobile-header-h)] items-center gap-3 border-b border-border bg-background px-4 text-foreground lg:gap-4 lg:px-[18px]">
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls="crest-drawer"
          aria-label={drawerOpen ? "Close the menu" : "Open the menu"}
          className="flex min-w-0 flex-none items-center gap-2.5 rounded-md py-1 pr-1 text-left hover:bg-secondary/60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/crest.png"
            alt=""
            className="h-[32px] w-auto shrink-0 [filter:drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.9))_drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.6))]"
          />
          <span className="min-w-0">
            <span className="font-display block truncate text-[13.5px] font-semibold uppercase leading-tight tracking-wide">
              {clubName}
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-foreground/55">
              {context ?? name}
            </span>
          </span>
          <Menu className="ml-1 h-4 w-4 flex-none opacity-60" aria-hidden />
        </button>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          {nouns.map((door) => (
            <NavLink key={door.key} href={door.href} hrefs={hrefs} badge={door.badge}>
              {door.icon} {door.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex flex-none items-center gap-1">
          <div className="hidden items-center gap-1 lg:flex">
            {utilities.map((door) => (
              <NavLink key={door.key} href={door.href} hrefs={hrefs} badge={door.badge}>
                {door.icon} {door.label}
              </NavLink>
            ))}
          </div>
          <SearchTrigger variant="icon" />
          {switcher ? (
            <HeaderRoleSwitcher
              options={switcher.options}
              current={switcher.current}
              name={name}
              photoUrl={photoUrl}
            />
          ) : (
            <Avatar name={name} photoUrl={photoUrl} size="sm" className="ml-1" />
          )}
        </div>
      </header>

      {drawerOpen ? (
        <div className="relative z-40">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-x-0 bottom-0 top-[var(--mobile-header-h)] cursor-default bg-[hsl(20_18%_7%/0.35)]"
          />
          <div
            id="crest-drawer"
            role="dialog"
            aria-label="Menu"
            className="absolute left-3 top-1.5 w-[292px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-card shadow-[0_12px_34px_hsl(20_18%_7%/0.24)] lg:left-[18px]"
          >
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5">
              <div className="min-w-0">
                <p className="font-display text-[13px] font-semibold uppercase leading-none tracking-[0.08em]">
                  {drawer.some((section) => section.section === "Running the club") ? "Running the club" : "Menu"}
                </p>
                <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                  Set up once, changed rarely. Out of the way of the daily work.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close the menu"
                className="-mr-1 inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* The nouns and utilities have no bar row on a phone: they live here. */}
            <div className="lg:hidden">
              <p className="font-display px-4 pb-1 pt-3 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Go to
              </p>
              {[...nouns, ...utilities].map((door) => (
                <Link
                  key={door.key}
                  href={door.href}
                  className="flex min-h-[44px] items-center gap-3 border-t border-border/60 px-4 py-2 text-[13.5px] hover:bg-secondary/60"
                >
                  <span className="flex-none text-foreground">{door.icon}</span>
                  <span className="flex-1">{door.label}</span>
                  {door.badge ? (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                      {door.badge > 99 ? "99+" : door.badge}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>

            <div className="max-h-[calc(100dvh-var(--mobile-header-h)-160px)] overflow-y-auto">
              {drawer.map((section) => (
                <div key={section.section}>
                  <p className="font-display px-4 pb-1 pt-3 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {section.section}
                  </p>
                  {section.rows.map((row) => (
                    <Link
                      key={`${row.href}|${row.label}`}
                      href={row.href}
                      className={
                        "flex items-start gap-3 border-t border-border/60 px-4 py-3 hover:bg-secondary/60 " +
                        (row.hot ? "bg-primary/5" : "")
                      }
                    >
                      <span className={"mt-px flex-none " + (row.hot ? "text-primary" : "text-foreground")}>
                        {row.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={
                            "block text-[13.5px] leading-tight " + (row.hot ? "font-semibold text-primary" : "")
                          }
                        >
                          {row.label}
                        </span>
                        {row.detail ? (
                          <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
                            {row.detail}
                          </span>
                        ) : null}
                      </span>
                      {row.badge ? (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                          {row.badge > 99 ? "99+" : row.badge}
                        </span>
                      ) : null}
                      {row.lock ? <Lock className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" aria-label="Admin only" /> : null}
                    </Link>
                  ))}
                </div>
              ))}
              <form action="/auth/signout" method="post" className="border-t border-border/60">
                <button
                  type="submit"
                  className="flex w-full items-start gap-3 px-4 py-3 text-left text-muted-foreground hover:bg-secondary/60"
                >
                  <LogOut className="mt-px h-4 w-4 flex-none" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] leading-tight">Sign out</span>
                    <span className="mt-1 block truncate text-[11.5px] leading-snug">{name}</span>
                  </span>
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * "Viewing as", in the header. The trigger is the role over its scope with
 * the person's avatar; the panel lists every hat the database backs, with
 * the active one ticked. One option renders as a plain, unclickable trigger —
 * nothing to switch to.
 */
function HeaderRoleSwitcher({
  options,
  current,
  name,
  photoUrl,
}: {
  options: RoleSwitcherOption[];
  current: string;
  name: string;
  photoUrl?: string | null;
}) {
  const { open, pending, stalled, busy, openPanel, dismiss, choose, triggerRef, panelRef } =
    useRoleSwitcher(current);

  // A click anywhere else closes the panel. Escape is the hook's.
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
    <div className="relative ml-1 flex items-center border-l border-border pl-2 lg:ml-2 lg:pl-3">
      <button
        ref={triggerRef}
        type="button"
        disabled={single}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Viewing as ${active.role}${active.scope ? `, ${active.scope}` : ""}`}
        onClick={() => (open ? dismiss() : openPanel())}
        className={
          "flex min-h-[44px] items-center gap-2.5 rounded-md py-1 pl-1 pr-1 text-left " +
          (single ? "" : "cursor-pointer hover:bg-secondary/60 ") +
          (busy ? "opacity-60" : "")
        }
      >
        <span className="hidden min-w-0 text-right sm:block">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">{active.role}</span>
          <span className="block truncate text-[10.5px] leading-tight text-accent">{active.scope}</span>
        </span>
        <Avatar name={name} photoUrl={photoUrl} size="sm" />
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Switch role"
          aria-busy={busy}
          className="absolute right-0 top-full z-50 mt-2 w-[312px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[0_12px_34px_hsl(20_18%_7%/0.24)]"
          style={{ colorScheme: "light" }}
        >
          <div className="border-b px-4 py-3.5">
            <p className="font-display text-[13px] font-semibold uppercase leading-none tracking-[0.08em]">
              Viewing as
            </p>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              Each role gets its own rooms. Pick the hat you are wearing.
            </p>
          </div>
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
                  "flex w-full items-center gap-3 border-t border-border/60 px-4 py-3 text-left " +
                  (isActive || isPending ? "bg-primary/[0.06]" : "hover:bg-secondary/60") +
                  (busy && !isPending ? " opacity-50" : "")
                }
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      "block truncate text-[13.5px] leading-tight " +
                      (isActive || isPending ? "font-semibold" : "font-medium")
                    }
                  >
                    {option.role}
                  </span>
                  <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">
                    {isPending && !stalled ? "Switching…" : option.scope}
                  </span>
                </span>
                {isPending && !stalled ? (
                  <Loader2 className="h-4 w-4 flex-none animate-spin text-primary" />
                ) : isActive ? (
                  <Check className="h-4 w-4 flex-none text-primary" />
                ) : null}
              </button>
            );
          })}
          <p
            role="status"
            aria-live="polite"
            className={
              announcement
                ? "border-t border-border/60 px-4 py-2 text-[11px] leading-snug " +
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
