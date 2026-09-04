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

// The me view's slot 3: the family tree, with the add-a-child and
// add-an-adult doors on it (2026-09-04 audit — supersedes the Children tab
// so the phone and the sidebar name the same screen "My family"). Open to
// everyone: the page itself welcomes a member with nobody connected yet.
const FAMILY: MobileTabEntry = {
  href: "/family-linking",
  label: "Family",
  icon: Baby,
  match: ["/family-linking", "/family", "/connected-adults", "/teams"],
  allowed: () => true,
};

/** The coach's slot 3: their own team page, as the coach sidebar has it —
 * the /teams directory is deliberately not in the coach menu. */
const COACH_TEAM: MobileTabEntry = {
  href: "/my-team",
  label: "Team",
  icon: Shirt,
  match: ["/my-team", "/teams"],
  allowed: (c) => c.isTeamStaff || c.hasCoachRole,
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
        return [LOBBY, MESSAGES, TEAMS, DIARY];
      case "coach":
        // The coach's tab is their own team, matching the coach sidebar —
        // the /teams directory tab was the one page that menu hides
        // (2026-09-04 audit).
        return [LOBBY, MESSAGES, COACH_TEAM, DIARY];
      case "player":
        return [LOBBY, MESSAGES, MY_TEAMS, EVENTS];
      case "parent":
        return [LOBBY, MESSAGES, MY_TEAM, EVENTS];
      case "referee":
        // The referee's phone: the games board first (Adam, 2026-08-25).
        return [REFEREE_GROUP, MESSAGES, LOBBY, EVENTS];
      case "me":
        return [LOBBY, MESSAGES, FAMILY, EVENTS];
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
 * The More screen's cards: the view's own menu, minus whatever the tab bar
 * already carries and minus the entries the screen draws elsewhere.
 *
 * A row is a duplicate of a tab only when it opens the SAME destination: an
 * exact href match, or the query-less twin of a tab's base. A row that adds a
 * query — "My groups" (`/messages?filter=groups`), "Pending requests"
 * (`/room-bookings?status=…`) — is a different destination wearing the tab's
 * path, and the 2026-09-04 audit found the old base-only rule silently
 * deleting those from the phone entirely. (The numbered "Membership Flow"
 * WHOLE_GROUPS exemption this function once carried went with the numbers:
 * /getting-started is a page, not a menu shape, so nothing needs keeping
 * whole any more.)
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
        if (tabHrefs.has(item.href)) return false;
        const base = item.href.split("?", 1)[0] ?? item.href;
        const hasQuery = item.href.includes("?");
        return hasQuery || !tabHrefs.has(base);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
