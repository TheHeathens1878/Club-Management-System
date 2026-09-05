import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { CommandPalette, SearchTrigger } from "@/components/command-palette";
import { HeaderTools } from "@/components/header-tools";
import { MobileHeader } from "@/components/mobile-header";
import { MobileTabBar, type MobileTabItem } from "@/components/mobile-tab-bar";
import { NotificationPrompt } from "@/components/notification-prompt";
import { RoleSwitcher } from "@/components/role-switcher";
import { SidebarNav, type SidebarDestination } from "@/components/sidebar-nav";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import {
  DESTINATIONS,
  allHrefs,
  contextLabel,
  itemsFor,
  linkHref,
  paletteEntries,
  sectionsOf,
  type NavBadge,
} from "@/lib/destinations";
import { loadNavCounts, NO_NAV_COUNTS } from "@/lib/nav-counts";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { getCurrentPersonId } from "@/lib/person";
import { resolveRoleView, roleSwitcherProps } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in shell (P7.2): five destinations — Home · Calendar · Messages
 * · Club · Me — as the desktop sidebar's five rows and the phone's five tabs,
 * the same five in the same order for everybody.
 *
 * The menu is built from the person's CAPABILITIES, read from the database
 * under their own RLS: an item whose capability is false is never rendered.
 * There is no longer a per-hat menu to switch between. The hat — the
 * `club.role_view` cookie the pages still read to decide what they OFFER —
 * is set by the link that opens a page (see /context) and named in the
 * header, so the reader always knows which one is on.
 *
 * Each page keeps its own guard. This is a menu, not an authorisation layer.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  // Bookers have no access to the staff area — send them to their portal
  if (isBooker(session.profile?.role)) redirect("/portal");

  const name = session.profile?.full_name || session.email || "User";
  const capabilities = await getCapabilities();
  const storedView = await getStoredRoleView();
  const view = resolveRoleView(storedView, capabilities);

  // Five independent questions, asked together: this shell renders on every
  // navigation, so its cost is the app's floor.
  //   · scope — the team the current hat is narrowed to (validated cookie).
  //   · counts — what is waiting behind Approvals and Registrations; only
  //     asked for a club administrator, zero for everyone else.
  //   · unread messages — the Messages tab's number (my_unread_message_count).
  //   · unread notifications — the bell.
  //   · personId — who the browser would be registering a device for.
  const supabase = await createClient();
  const [scope, counts, unreadMessages, unreadNotifications, personId] = await Promise.all([
    view ? getTeamScope(view, capabilities) : null,
    capabilities.isClubAdmin ? loadNavCounts(true) : NO_NAV_COUNTS,
    supabase.rpc("my_unread_message_count").then(({ data }) => data ?? 0),
    loadUnreadNotificationCount(),
    getCurrentPersonId(),
  ]);
  const current = { view, teamId: scope?.id ?? null };
  const badges: Record<NavBadge, number> = {
    approvals: counts.approvals + counts.registrations,
    registrations: counts.registrations,
    messages: unreadMessages,
  };
  const badgeFor = (key: NavBadge | undefined, itemLevel = false): number | undefined => {
    if (!key) return undefined;
    // The Club tab wears both queues added together; the rows wear their own.
    const n = itemLevel && key === "approvals" ? counts.approvals : badges[key];
    return n > 0 ? n : undefined;
  };

  const switcher = view ? roleSwitcherProps(capabilities, view, scope?.id ?? null) : null;
  const context = contextLabel(view, scope);

  const sidebar: SidebarDestination[] = DESTINATIONS.map((d) => {
    const Icon = d.icon;
    return {
      key: d.key,
      href: d.href,
      label: d.label,
      icon: <Icon className="h-[18px] w-[18px]" aria-hidden />,
      badge: badgeFor(d.badge),
      sections: sectionsOf(itemsFor(d.key, capabilities)).map((section) => ({
        section: section.section,
        items: section.items.map((item) => {
          const ItemIcon = item.icon;
          return {
            href: linkHref(item, current),
            label: item.label,
            icon: <ItemIcon className="h-4 w-4" aria-hidden />,
            badge: badgeFor(item.badge, true),
          };
        }),
      })),
    };
  });
  // Every href the menu can navigate to, so the highlight goes to the best
  // match and only that one (/pitches/calendar must not also light /pitches).
  const hrefs = allHrefs(capabilities);

  const tabs: MobileTabItem[] = DESTINATIONS.map((d) => {
    const Icon = d.icon;
    return {
      href: d.href,
      label: d.label,
      icon: <Icon className="h-[21px] w-[21px]" aria-hidden />,
      match: d.match,
      badge: badgeFor(d.badge),
    };
  });

  // `min-h-[100dvh]`, not `min-h-screen`: `vh` is the viewport with the URL bar
  // hidden, so on a phone a `min-h-screen` shell is taller than the screen
  // actually showing, and every page inherits a stray scroll of exactly the
  // bar's height (Adam, 2026-09-01).
  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <NotificationPrompt personId={personId} />

      {/* Global search — ⌘K anywhere, plus the sidebar and phone triggers. */}
      <CommandPalette pages={paletteEntries(capabilities, current)} />

      {/* The ink rail (crest design): dark sidebar against paper content.
          On a phone the rail does not exist at all: the MobileHeader and the
          tab bar are the shell. */}
      <aside className="theme-ink hidden w-full shrink-0 border-b border-border bg-background text-foreground lg:block lg:w-[240px] lg:border-b-0 lg:border-r">
        <div className="flex gap-2 p-3 lg:h-full lg:flex-col lg:p-4">
          <div className="hidden items-center gap-2.5 border-b border-border pb-3 lg:mb-1 lg:flex">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/crest.png"
              alt=""
              className="h-[30px] w-auto shrink-0 [filter:drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.9))_drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.6))]"
            />
            <div className="min-w-0">
              <p className="font-display text-[12.5px] font-semibold uppercase leading-tight tracking-wide">
                AoM Sports Club
              </p>
              <p className="truncate text-[11px] text-foreground/55">{name}</p>
            </div>
          </div>

          {/* Global search (⌘K) — one field for pages, people, teams, events. */}
          <SearchTrigger variant="sidebar" />

          {/* Notifications bell. */}
          <HeaderTools />

          <SidebarNav destinations={sidebar} hrefs={hrefs} />

          <div className="lg:mt-auto lg:space-y-2">
            {/* The hat, named — and the explicit way to change it when a page
                could mean two things. Most people never need it: the Club
                rows put the right hat on as they open. */}
            {switcher ? (
              <div className="hidden lg:block">
                <RoleSwitcher options={switcher.options} current={switcher.current} />
              </div>
            ) : null}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) +
                  " w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                }
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <MobileHeader
        name={name}
        context={context}
        switcher={switcher ? { options: switcher.options, current: switcher.current } : null}
        unread={unreadNotifications}
      />

      {/* Bottom padding clears the fixed tab bar (plus the home indicator's
          safe area) so nothing ends underneath it — measured from the bar
          itself via `--tab-bar-h` (globals.css). */}
      <main className="flex-1 overflow-x-clip bg-background pb-[calc(var(--tab-bar-h)+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      <MobileTabBar tabs={tabs} />
    </div>
  );
}
