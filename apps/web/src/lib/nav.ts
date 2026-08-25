/**
 * The nav, expressed as one table.
 *
 * Two independent gates decide whether a link is rendered:
 *
 *   1. `allowed(capabilities)` — what this person may actually reach. It
 *      mirrors the guard the destination page already applies, so the nav can
 *      never offer a page that would bounce them straight back out.
 *   2. `views` — which of the five role views the item belongs to. This is a
 *      HARD scope, not a preference: `navFor` shows the chosen view's items and
 *      nothing else. There is no unioning of two views, and a person wearing
 *      three hats switches between three separate menus rather than seeing one
 *      long one. Both gates must pass.
 *
 * "Notifications" is not in this table: the bell in `HeaderTools` is the
 * notifications entry, and it is rendered in every view because it carries the
 * unread count. Treat it as a row of this table that the layout happens to
 * draw itself.
 *
 * Room and pitch are deliberately kept apart: "Room bookings" is the function
 * room diary and "Pitches" is the pitch allocation screen.
 */

import {
  Armchair,
  Beer,
  Baby,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  DoorOpen,
  Inbox,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Contact,
  Images,
  LandPlot,
  Mail,
  MessageSquare,
  Receipt,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Shirt,
  UserCheck,
  UserCircle,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Capabilities, RoleView } from "@/lib/role-view";

const ALL_VIEWS = [
  "player",
  "parent",
  "coach",
  "admin",
  "function_room",
] as const satisfies readonly RoleView[];

/** The four views that belong to the football club rather than the room. */
const CLUB_VIEWS = ["player", "parent", "coach", "admin"] as const satisfies readonly RoleView[];

export type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The group heading this item sits under. */
  group: string;
  /** Absolute capability gate — mirrors the destination page's own guard. */
  allowed: (c: Capabilities) => boolean;
  /** Which role views show it. Nothing leaks across this line. */
  views: readonly RoleView[];
  /** Rendered indented, as a shortcut belonging to the entry above. */
  child?: boolean;
};

export const NAV: readonly NavEntry[] = [
  // --- The club ------------------------------------------------------------
  {
    // The design's front door: the club-wide noticeboard, results and the week.
    href: "/lobby",
    label: "Club lobby",
    icon: Armchair,
    group: "Club",
    allowed: () => true,
    views: CLUB_VIEWS,
  },
  {
    // A player's own screen: their teams, and when those teams are next out.
    href: "/my-teams",
    label: "My teams",
    icon: Shirt,
    group: "Club",
    allowed: (c) => c.hasPlayerMembership,
    views: ["player"],
  },
  {
    // The guardian's own screen — their children and those children's teams.
    href: "/family",
    label: "Children",
    icon: Baby,
    group: "Club",
    allowed: (c) => c.isGuardian || c.hasParentRole,
    views: ["parent"],
  },
  {
    // Matches, practices and socials with accept/decline — fed by my_events(),
    // so every view sees only its own teams' occasions.
    href: "/events",
    label: "Events",
    icon: CalendarCheck,
    group: "Club",
    allowed: (c) =>
      c.hasPlayerMembership || c.isGuardian || c.hasParentRole || c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: CLUB_VIEWS,
  },
  {
    href: "/teams",
    label: "Teams",
    icon: Users,
    group: "Club",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["coach", "admin"],
  },
  {
    href: "/people",
    label: "People",
    icon: Contact,
    group: "Club",
    allowed: (c) => c.isCommittee,
    views: ["admin"],
  },
  {
    href: "/waiting-list/manage",
    label: "Waiting list",
    icon: ClipboardList,
    group: "Club",
    allowed: (c) => c.isClubAdmin || c.hasWaitingListAccess,
    views: ["coach", "admin"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: UserCheck,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
  },
  {
    href: "/registrations",
    label: "Registrations",
    icon: ClipboardCheck,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
  },

  // --- Function room -------------------------------------------------------
  {
    href: "/room-bookings",
    label: "Room bookings",
    icon: CalendarDays,
    group: "Function room",
    allowed: (c) => c.isStaff,
    views: ["admin", "function_room"],
  },
  {
    href: "/room-bookings?status=pending&view=list",
    label: "Pending requests",
    icon: Clock,
    group: "Function room",
    allowed: (c) => c.isStaff,
    views: ["admin", "function_room"],
    child: true,
  },
  {
    // The rooms themselves, not the diary. The page's own guard is committee.
    href: "/room-bookings/rooms",
    label: "Rooms",
    icon: DoorOpen,
    group: "Function room",
    allowed: (c) => c.isCommittee,
    views: ["admin", "function_room"],
  },
  {
    href: "/bar",
    label: "Bar",
    icon: Beer,
    group: "Function room",
    allowed: (c) => c.isBarManager,
    views: ["admin", "function_room"],
  },

  // --- Pitches (a different diary entirely from the function room) ---------
  {
    href: "/pitches/calendar",
    label: "Pitch calendar",
    icon: CalendarDays,
    group: "Pitches",
    allowed: (c) =>
      c.isTeamStaff || c.isGuardian || c.hasPlayerMembership || c.isCommittee || c.isClubAdmin,
    views: CLUB_VIEWS,
  },
  {
    href: "/pitches/book",
    label: "Book a pitch",
    icon: CalendarPlus,
    group: "Pitches",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["coach", "admin"],
  },
  {
    href: "/pitches/mine",
    label: "Pitch bookings",
    icon: CalendarCheck,
    group: "Pitches",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["coach", "admin"],
  },
  {
    href: "/pitches/requests",
    label: "Pitch requests",
    icon: Inbox,
    group: "Pitches",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
  },
  {
    href: "/pitches",
    label: "Allocate fixtures",
    icon: LandPlot,
    group: "Pitches",
    allowed: (c) => c.isCommittee,
    views: ["admin"],
  },
  {
    href: "/pitches/manage",
    label: "Manage pitches",
    icon: Settings2,
    group: "Pitches",
    allowed: (c) => c.isClubAdmin || c.isCommittee,
    views: ["admin"],
  },

  // --- Messages ------------------------------------------------------------
  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    group: "Messages",
    allowed: () => true,
    views: ALL_VIEWS,
  },
  {
    href: "/groups",
    label: "Groups",
    icon: UsersRound,
    group: "Messages",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
    child: true,
  },

  // --- Subs ----------------------------------------------------------------
  {
    href: "/subs",
    label: "Subs",
    icon: Receipt,
    group: "Subs",
    allowed: (c) => c.isCommittee,
    views: ["admin"],
  },
  {
    href: "/my-subs",
    label: "My subs",
    icon: Wallet,
    group: "Subs",
    allowed: () => true,
    views: CLUB_VIEWS,
  },

  // --- Safeguarding --------------------------------------------------------
  {
    href: "/safeguarding",
    label: "Safeguarding",
    icon: ShieldAlert,
    group: "Safeguarding",
    allowed: (c) => c.isSafeguardingLead || c.isCommittee,
    views: ["admin"],
  },
  {
    // SG-3: reporting a concern is open to everyone, so it stays in every
    // view. It is not another role's screen — it is the one route a player, a
    // parent or a coach has to raise something, and a menu that hides it is a
    // menu that loses the report.
    href: "/safeguarding/report",
    label: "Report a concern",
    icon: ShieldAlert,
    group: "Safeguarding",
    allowed: () => true,
    views: ALL_VIEWS,
  },

  // --- Media ---------------------------------------------------------------
  {
    href: "/media",
    label: "Media",
    icon: Images,
    group: "Media",
    allowed: () => true,
    views: ["admin"],
  },

  // --- Settings ------------------------------------------------------------
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    group: "Settings",
    allowed: (c) => c.isSuperUser,
    views: ["admin", "function_room"],
  },
  {
    href: "/settings?tab=users",
    label: "Super users",
    icon: ShieldCheck,
    group: "Settings",
    allowed: (c) => c.isSuperUser,
    views: ["admin"],
  },
  {
    href: "/settings/comms",
    label: "Comms preferences",
    icon: Mail,
    group: "Settings",
    allowed: () => true,
    views: CLUB_VIEWS,
  },

  // --- You -----------------------------------------------------------------
  {
    href: "/welcome",
    label: "My role",
    icon: UserCircle,
    group: "You",
    allowed: () => true,
    views: ALL_VIEWS,
  },
];

export type NavGroup = { group: string; items: NavEntry[] };

function group(items: readonly NavEntry[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const entry of items) {
    const last = groups[groups.length - 1];
    if (last && last.group === entry.group) last.items.push(entry);
    else groups.push({ group: entry.group, items: [entry] });
  }
  return groups;
}

/** The items this person may reach, in this view, grouped in display order. */
export function navFor(view: RoleView, capabilities: Capabilities): NavGroup[] {
  return group(NAV.filter((entry) => entry.views.includes(view) && entry.allowed(capabilities)));
}

/**
 * The menu for a sign-in the club has not linked to anything yet: the two
 * things that are true of any signed-in person and nothing else. No tiles, no
 * teasers, nothing to ask for — attachment to a team happens on the
 * registration forms, not in here.
 */
export function navForUnlinked(): NavGroup[] {
  const wanted = new Set(["/safeguarding/report", "/welcome"]);
  return group(NAV.filter((entry) => wanted.has(entry.href)));
}
