/**
 * The nav, expressed as one table (gap 4).
 *
 * Two independent gates decide whether a link is rendered:
 *
 *   1. `allowed(capabilities)` — what this person may actually reach. It
 *      mirrors the guard the destination page already applies, so the nav can
 *      never offer a page that would bounce them straight back out. This gate
 *      is absolute: no chosen view can turn it on.
 *   2. `views` — which of the four role views the item belongs to. This is
 *      presentation only. A club administrator looking at the Player view sees
 *      a player's nav; nothing has been taken away from them.
 *
 * Room and pitch are deliberately kept apart: "Room bookings" is the function
 * room diary and "Pitches" is the pitch allocation screen. They were adjacent
 * and unlabelled before, which is what the club owner was tripping over.
 */

import {
  Beer,
  Baby,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Inbox,
  ClipboardList,
  Clock,
  Contact,
  Images,
  LandPlot,
  Mail,
  MessageSquare,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCircle,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Capabilities, RoleView } from "@/lib/role-view";

const ALL_VIEWS = ["player", "parent", "coach", "admin"] as const satisfies readonly RoleView[];

export type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The group heading this item sits under. */
  group: string;
  /** Absolute capability gate — mirrors the destination page's own guard. */
  allowed: (c: Capabilities) => boolean;
  /** Which role views show it. */
  views: readonly RoleView[];
  /** Rendered indented, as a shortcut belonging to the entry above. */
  child?: boolean;
};

export const NAV: readonly NavEntry[] = [
  // --- Function room -------------------------------------------------------
  {
    href: "/room-bookings",
    label: "Room bookings",
    icon: CalendarDays,
    group: "Function room",
    allowed: (c) => c.isStaff,
    views: ["admin"],
  },
  {
    href: "/room-bookings?status=pending&view=list",
    label: "Pending requests",
    icon: Clock,
    group: "Function room",
    allowed: (c) => c.isStaff,
    views: ["admin"],
    child: true,
  },
  {
    href: "/bar",
    label: "Bar",
    icon: Beer,
    group: "Function room",
    allowed: (c) => c.isBarManager,
    views: ["admin"],
  },

  // --- Pitches (a different diary entirely from the function room) ---------
  {
    href: "/pitches/calendar",
    label: "Pitch calendar",
    icon: CalendarDays,
    group: "Pitches",
    allowed: (c) => c.isTeamStaff || c.isGuardian || c.hasPlayerMembership || c.isCommittee || c.isClubAdmin,
    views: ["player", "parent", "coach", "admin"],
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
    views: ["coach", "admin"],
  },

  // --- The club ------------------------------------------------------------
  {
    href: "/teams",
    label: "Teams",
    icon: Users,
    group: "Club",
    allowed: (c) => c.isCommittee,
    views: ALL_VIEWS,
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
    // Placeholder until gap 9 gives guardians a screen of their own; comms
    // preferences are the one child-related thing a guardian can set today.
    href: "/settings/comms",
    label: "Children",
    icon: Baby,
    group: "Club",
    allowed: (c) => c.isGuardian,
    views: ["parent"],
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

  // --- Messages ------------------------------------------------------------
  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    group: "Messages",
    allowed: () => true,
    views: ALL_VIEWS,
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
    views: ALL_VIEWS,
  },

  // --- Safeguarding --------------------------------------------------------
  {
    href: "/safeguarding",
    label: "Safeguarding",
    icon: ShieldAlert,
    group: "Safeguarding",
    allowed: (c) => c.isSafeguardingLead || c.isCommittee,
    views: ["coach", "admin"],
  },
  {
    // SG-3: reporting a concern is open to everyone, in every view.
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
    views: ALL_VIEWS,
  },

  // --- Settings ------------------------------------------------------------
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    group: "Settings",
    allowed: (c) => c.isSuperUser,
    views: ["admin"],
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
    views: ALL_VIEWS,
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

/** The items this person may reach, in this view, grouped in display order. */
export function navFor(view: RoleView, capabilities: Capabilities): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const entry of NAV) {
    if (!entry.views.includes(view)) continue;
    if (!entry.allowed(capabilities)) continue;
    const last = groups[groups.length - 1];
    if (last && last.group === entry.group) last.items.push(entry);
    else groups.push({ group: entry.group, items: [entry] });
  }
  return groups;
}
