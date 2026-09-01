/**
 * The five-slot tab bar (Club CRM mobile design): on a phone the sidebar
 * becomes a five-item tab bar with everything else behind More. The design
 * draws the admin bar (Lobby · Messages · Teams · Diary · More) and the Me bar
 * (Lobby · Messages · Children · Events · More); the parent bar swaps Children
 * for Team (Adam, 2026-08-25 evening: the parent menu is the child's team, and
 * the person-level items live in the Me view); the other views follow the
 * same rule — the view's own front doors, More always last.
 *
 * Both of nav.ts's gates apply here too: the view names the slots, and each
 * slot's `allowed` mirrors the destination page's guard, so a tab is never
 * offered to someone the page would bounce. A slot that fails its gate
 * collapses and the bar simply has fewer tabs — the grid adapts.
 *
 * `match` lists the pathname prefixes the tab lights up for. No tab href
 * carries a query string (active-state matching is by pathname); anything that
 * needs one — "Pending requests", "My groups" — lives behind More instead.
 */

import {
  Armchair,
  Baby,
  ClipboardList,
  Beer,
  CalendarCheck,
  CalendarDays,
  Contact,
  MessageSquare,
  ShieldAlert,
  Shirt,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { NavGroup } from "@/lib/nav";
import type { Capabilities, RoleView } from "@/lib/role-view";

export type MobileTabEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pathname prefixes that count as "on this tab". */
  match: string[];
  allowed: (c: Capabilities) => boolean;
};

const LOBBY: MobileTabEntry = {
  href: "/lobby",
  label: "Lobby",
  icon: Armchair,
  match: ["/lobby"],
  allowed: () => true,
};

const MESSAGES: MobileTabEntry = {
  href: "/messages",
  label: "Messages",
  icon: MessageSquare,
  // The groups directory is the same surface on a phone.
  match: ["/messages", "/groups"],
  allowed: () => true,
};

/** Coach/admin slot 4 — the design labels the member diary "Diary". */
const DIARY: MobileTabEntry = {
  href: "/events",
  label: "Diary",
  icon: CalendarCheck,
  match: ["/events"],
  allowed: () => true,
};

/** The same destination under its member-facing name (player/parent/me). */
const EVENTS: MobileTabEntry = { ...DIARY, label: "Events" };

const TEAMS: MobileTabEntry = {
  href: "/teams",
  label: "Teams",
  icon: Users,
  match: ["/teams"],
  allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
};

const MY_TEAMS: MobileTabEntry = {
  href: "/my-teams",
  label: "My teams",
  icon: Shirt,
  match: ["/my-teams", "/my-team", "/teams"],
  allowed: (c) => c.hasPlayerMembership,
};

const CHILDREN: MobileTabEntry = {
  href: "/family",
  label: "Children",
  icon: Baby,
  match: ["/family", "/teams"],
  allowed: (c) => c.isGuardian || c.hasParentRole,
};

/** The parent view's slot 3: the sidebar's "Team page", via the same redirect. */
const MY_TEAM: MobileTabEntry = {
  href: "/my-team",
  label: "Team",
  icon: Shirt,
  match: ["/my-team", "/teams"],
  allowed: (c) => c.isGuardian || c.hasParentRole,
};

const ROOM_DIARY: MobileTabEntry = {
  href: "/room-bookings",
  label: "Bookings",
  icon: CalendarDays,
  match: ["/room-bookings"],
  allowed: (c) => c.isStaff,
};

const HIRE_CONTACTS: MobileTabEntry = {
  href: "/room-bookings/contacts",
  label: "Contacts",
  icon: Contact,
  match: ["/room-bookings/contacts"],
  allowed: (c) => c.isStaff,
};

const BAR: MobileTabEntry = {
  href: "/bar",
  label: "Bar",
  icon: Beer,
  match: ["/bar"],
  allowed: (c) => c.isBarManager,
};

/** The referee's board: the group where games are posted and claimed. */
const REFEREE_GROUP: MobileTabEntry = {
  href: "/referee",
  label: "Games",
  icon: ClipboardList,
  match: ["/referee"],
  allowed: (c) => c.hasRefereeRole,
};

/** The unlinked sign-in's two truths (navForUnlinked), as tabs. */
const REPORT: MobileTabEntry = {
  href: "/safeguarding/report",
  label: "Report",
  icon: ShieldAlert,
  match: ["/safeguarding/report"],
  allowed: () => true,
};

const MY_ROLE: MobileTabEntry = {
  href: "/welcome",
  label: "My role",
  icon: UserCircle,
  match: ["/welcome"],
  allowed: () => true,
};

/**
 * The bar's first four slots for a view; the layout appends More itself.
 * Order matters — earlier tabs win a `match` tie (Contacts sits inside
 * /room-bookings, so it is listed before the diary for the tie to land right…
 * except pathname prefix ties are resolved longest-first in the tab bar, so
 * declaration order here stays the design's).
 */
export function mobileTabsFor(view: RoleView | null, c: Capabilities): MobileTabEntry[] {
  const slots = (() => {
    switch (view) {
      case "admin":
      case "coach":
        return [LOBBY, MESSAGES, TEAMS, DIARY];
      case "player":
        return [LOBBY, MESSAGES, MY_TEAMS, EVENTS];
      case "parent":
        return [LOBBY, MESSAGES, MY_TEAM, EVENTS];
      case "referee":
        // The referee's phone: the games board first (Adam, 2026-08-25).
        return [REFEREE_GROUP, MESSAGES, LOBBY, EVENTS];
      case "me":
        return [LOBBY, MESSAGES, CHILDREN, EVENTS];
      case "function_room":
        return [ROOM_DIARY, HIRE_CONTACTS, BAR];
      case null:
        return [REPORT, MY_ROLE];
    }
  })();
  return slots.filter((tab) => tab.allowed(c));
}

// ---------------------------------------------------------------------------
// The More screen's list
// ---------------------------------------------------------------------------

/** Pulled out of the list and drawn as its own accent card (SG-3). */
export const MORE_REPORT_HREF = "/safeguarding/report";

/**
 * Menu groups the More screen keeps WHOLE, tab bar or no tab bar.
 *
 * Adam, 2026-09-01: "on mobile in the 'Me' view, the membership flow should
 * include children even though it's also in the menu bar." The Membership Flow
 * is a numbered sequence — My Profile (1), Connect Adults (2), Connect
 * Children (3), Family Linking (4), Register Players (5) — and step 3 is
 * `/family`, which is also the Me view's Children tab. The plain de-duplication
 * below was therefore deleting a step out of the MIDDLE of the flow and leaving
 * a phone showing 1, 2, 4, 5: the one place that tells a new member what to do
 * next was silently skipping the children.
 *
 * A step of a numbered flow is not a duplicate of a tab. The tab is a shortcut
 * to a screen; the step is the flow saying where the children come in — and
 * the screens themselves already cover them (`/family` is the guardianships,
 * "Register Players" registers a child through `registrations_guardian_insert`,
 * "My Subs" shows a child's subs under `subscriptions_self_read`). Nothing here
 * widens what a guardian may read or write; it only stops the menu hiding it.
 */
const WHOLE_GROUPS: readonly string[] = ["Membership Flow"];

/**
 * The More screen's cards: the view's own menu, minus whatever the tab bar
 * already carries and minus the entries the screen draws elsewhere. Query-string
 * variants of a tab's route go too — "My groups" (`/messages?filter=groups`) is
 * the Messages tab's surface with a filter on it, not a second destination.
 */
export function moreScreenGroups(
  groups: readonly NavGroup[],
  tabHrefs: ReadonlySet<string>,
): NavGroup[] {
  return groups
    .map((group) => ({
      group: group.group,
      items: group.items.filter((item) => {
        if (item.href === MORE_REPORT_HREF) return false;
        if (WHOLE_GROUPS.includes(group.group)) return true;
        const base = item.href.split("?", 1)[0] ?? item.href;
        return !tabHrefs.has(base);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
