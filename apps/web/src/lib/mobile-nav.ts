/**
 * The five-slot tab bar (Club CRM mobile design): on a phone the sidebar
 * becomes a five-item tab bar with everything else behind More. The design
 * draws the admin bar (Lobby · Messages · Teams · Diary · More) and the parent
 * bar (Lobby · Messages · Children · Events · More); the other views follow the
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
