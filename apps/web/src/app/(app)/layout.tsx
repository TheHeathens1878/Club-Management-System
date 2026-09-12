import { redirect } from "next/navigation";

import { AppTopBar, type DrawerSection, type TopBarDoor } from "@/components/app-top-bar";
import { CommandPalette } from "@/components/command-palette";
import { MobileTabBar, type MobileTabItem } from "@/components/mobile-tab-bar";
import { NotificationPrompt } from "@/components/notification-prompt";
import { NounTabs, type NounTabGroup } from "@/components/noun-tabs";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import {
  allHrefs,
  contextLabel,
  destinationHref,
  destinationLabel,
  drawerItemsFor,
  itemsFor,
  linkHref,
  paletteEntries,
  sectionsOf,
  visibleDestinations,
  type NavBadge,
} from "@/lib/destinations";
import { loadNavCounts, NO_NAV_COUNTS } from "@/lib/nav-counts";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { getCurrentPersonId } from "@/lib/person";
import { resolveRoleView, roleSwitcherProps } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in shell (P7.5, the three-noun navigation — Adam's Claude
 * Design template of 2026-09-12): a top bar at every width carrying the
 * crest (which opens the drawer), the nouns — Diary · People · Clubhouse ·
 * Money — and the two utilities, Inbox and Messages; under it the active
 * noun's rows as tabs; on a phone the nouns become the tab bar.
 *
 * The menu is built from the person's CAPABILITIES, read from the database
 * under their own RLS: a door or a row whose capability is false is never
 * rendered. The hat — the `club.role_view` cookie the pages still read to
 * decide what they OFFER — is set by the link that opens a page (see
 * /context) and named in the header, so the reader always knows which one
 * is on.
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
  //   · unread messages — the Messages door's number (my_unread_message_count).
  //   · unread notifications — the Inbox door's number.
  //   · personId — who the browser would be registering a device for.
  const supabase = await createClient();
  const [scope, counts, unreadMessages, unreadNotifications, personId] = await Promise.all([
    view ? getTeamScope(view, capabilities) : null,
    capabilities.isClubAdmin || capabilities.isStaff
      ? loadNavCounts(capabilities.isClubAdmin, capabilities.isStaff)
      : NO_NAV_COUNTS,
    supabase.rpc("my_unread_message_count").then(({ data }) => data ?? 0),
    loadUnreadNotificationCount(),
    getCurrentPersonId(),
  ]);
  const current = { view, teamId: scope?.id ?? null };
  const badges: Record<NavBadge, number> = {
    // The People door wears both admin queues added together; the rows wear
    // their own. Clubhouse wears the room desk's waiting requests.
    approvals: counts.approvals + counts.registrations,
    registrations: counts.registrations,
    messages: unreadMessages,
    roomBookings: counts.roomBookings,
    notifications: unreadNotifications,
  };
  const badgeFor = (key: NavBadge | undefined, itemLevel = false): number | undefined => {
    if (!key) return undefined;
    const n = itemLevel && key === "approvals" ? counts.approvals : badges[key];
    return n > 0 ? n : undefined;
  };

  const switcher = view ? roleSwitcherProps(capabilities, view, scope?.id ?? null) : null;
  const context = contextLabel(view, scope);

  const doors = visibleDestinations(capabilities);
  const doorOf = (size: string) => (d: (typeof doors)[number]): TopBarDoor => {
    const Icon = d.icon;
    return {
      key: d.key,
      href: destinationHref(d, capabilities),
      label: destinationLabel(d, capabilities),
      icon: <Icon className={size} aria-hidden />,
      badge: badgeFor(d.badge),
    };
  };
  const nouns = doors.filter((d) => d.kind === "noun").map(doorOf("h-4 w-4"));
  const utilities = doors.filter((d) => d.kind === "utility").map(doorOf("h-4 w-4"));

  // The noun's rows as its tabs: Overview (the door itself) first, then every
  // item — unless the door already IS the first item, as Diary's calendar is.
  const groups: NounTabGroup[] = doors.map((d) => {
    const home = destinationHref(d, capabilities);
    const items = itemsFor(d.key, capabilities);
    const tabs = items.map((item) => ({
      href: linkHref(item, current),
      label: item.label,
      badge: badgeFor(item.badge, true),
    }));
    if (!items.some((item) => item.href === home)) tabs.unshift({ href: home, label: "Overview", badge: undefined });
    return { key: d.key, tabs };
  });

  const drawer: DrawerSection[] = sectionsOf(drawerItemsFor(capabilities)).map((section) => ({
    section: section.section,
    rows: section.items.map((item) => {
      const Icon = item.icon;
      return {
        href: linkHref(item, current),
        label: item.label,
        detail: item.detail,
        icon: <Icon className="h-4 w-4" aria-hidden />,
        lock: item.href === "/settings" || item.href === "/super-users",
        hot: item.href === "/safeguarding/report",
        badge: badgeFor(item.badge, true),
      };
    }),
  }));

  // Every href the menu can navigate to, so the highlight goes to the best
  // match and only that one (/pitches/calendar must not also light /pitches).
  const hrefs = allHrefs(capabilities);

  // The phone's tab bar: the nouns, then Inbox and Messages while five fit.
  // With four nouns Messages folds into Inbox — the Inbox tab then wears both
  // counts and lights on /messages too.
  const nounDoors = doors.filter((d) => d.kind === "noun");
  const inbox = doors.find((d) => d.key === "inbox")!;
  const messages = doors.find((d) => d.key === "messages")!;
  const foldMessages = nounDoors.length + 2 > 5;
  const tabOf = (d: (typeof doors)[number], extra: Partial<MobileTabItem> = {}): MobileTabItem => {
    const Icon = d.icon;
    return {
      href: destinationHref(d, capabilities),
      label: destinationLabel(d, capabilities),
      icon: <Icon className="h-[21px] w-[21px]" aria-hidden />,
      match: d.match,
      badge: badgeFor(d.badge),
      ...extra,
    };
  };
  const tabs: MobileTabItem[] = [
    ...nounDoors.map((d) => tabOf(d)),
    tabOf(inbox, {
      match: foldMessages ? [...inbox.match, ...messages.match] : inbox.match,
      badge: foldMessages
        ? badgeFor("notifications") || badgeFor("messages")
          ? (badgeFor("notifications") ?? 0) + (badgeFor("messages") ?? 0)
          : undefined
        : badgeFor("notifications"),
      moreFallback: true,
    }),
    ...(foldMessages ? [] : [tabOf(messages)]),
  ];

  // `min-h-[100dvh]`, not `min-h-screen`: `vh` is the viewport with the URL bar
  // hidden, so on a phone a `min-h-screen` shell is taller than the screen
  // actually showing, and every page inherits a stray scroll of exactly the
  // bar's height (Adam, 2026-09-01).
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <NotificationPrompt personId={personId} />

      {/* Global search — ⌘K anywhere, plus the top bar's magnifier. */}
      <CommandPalette pages={paletteEntries(capabilities, current)} />

      <AppTopBar
        clubName="AoM Sports Club"
        name={name}
        context={context}
        nouns={nouns}
        utilities={utilities}
        hrefs={hrefs}
        drawer={drawer}
        switcher={switcher ? { options: switcher.options, current: switcher.current } : null}
      />

      <NounTabs groups={groups} />

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
