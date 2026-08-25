/**
 * The nav, expressed as one table — regrouped 2026-08-25 to the Club CRM
 * design's own sections (spec §1): Club, Matchday, Pitches, Function room,
 * Money, Safeguarding, Settings. Items the design does not draw but the club
 * still needs (Manage pitches, Rooms, Groups, Media, Super users, My role)
 * keep their place in the nearest section rather than vanishing.
 *
 * The ME and PARENT views share the Club section, spelled out by Adam
 * (2026-08-25, second pass — this supersedes the morning's "Club Lobby, Team,
 * My Groups" shape; the third pass makes the same menu the ME view, the
 * default for every sign-in): Club Lobby, My groups, Messaging, Events,
 * Register a player. From there they part (Adam, 2026-08-25, evening): the ME view
 * is the person — Me (My Profile, Connected Adults, My Children), Finance (My
 * Subs), Settings (Comms preferences) — and the PARENT view is the child's
 * team: a Team section whose one entry, "Team page", goes through /my-team to
 * the scoped team (or /family to pick one). The person-level items are NOT
 * repeated in the parent menu; the switcher's "Me" is the way to them. Both
 * views keep Report a concern, and the lobby stays the landing page for both.
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
  LayoutDashboard,
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
  "me",
  "player",
  "parent",
  "coach",
  "admin",
  "function_room",
] as const satisfies readonly RoleView[];

/** The five views that belong to the football club rather than the room. */
const CLUB_VIEWS = ["me", "player", "parent", "coach", "admin"] as const satisfies readonly RoleView[];

/** The Club section the default ME view and the parent view share. */
const ME_VIEWS = ["me", "parent"] as const satisfies readonly RoleView[];

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
  // --- Club (the design's first section) -----------------------------------
  {
    href: "/lobby",
    label: "Club lobby",
    icon: Armchair,
    group: "Club",
    allowed: () => true,
    views: CLUB_VIEWS,
  },
  {
    // The me/parent copy of the messages entries sits first so that menu
    // reads Lobby → My groups → Messaging → Events → Register a player.
    href: "/messages?filter=groups",
    label: "My groups",
    icon: UsersRound,
    group: "Club",
    allowed: () => true,
    views: ME_VIEWS,
  },
  {
    href: "/messages",
    label: "Messaging",
    icon: MessageSquare,
    group: "Club",
    allowed: () => true,
    views: ME_VIEWS,
  },
  {
    // Adam's parent menu (2026-08-25, second pass): Events came back into the
    // parent's Club section after the morning's menu left it out. Same
    // destination as Matchday's entry; the page admits any signed-in person
    // and `my_events()` returns only their own diary, so no gate here either.
    href: "/events",
    label: "Events",
    icon: CalendarCheck,
    group: "Club",
    allowed: () => true,
    views: ME_VIEWS,
  },
  {
    // Registering somebody, and where the household's registrations stand —
    // not the admin queue at /registrations, which keeps its own entry below.
    // Adam, 2026-08-25: "change the name of registrations to register a
    // player", because that is the thing a member comes here to do.
    href: "/my-registrations",
    label: "Register a player",
    icon: ClipboardCheck,
    group: "Club",
    allowed: () => true,
    views: ME_VIEWS,
  },
  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    group: "Club",
    allowed: () => true,
    views: ["player", "coach", "admin", "function_room"],
  },

  // --- Referee (Adam, 2026-08-25: the referee's own view) ------------------
  {
    // The referees group, through the redirect that resolves it. The games are
    // posted there as claimable cards, so it is the whole of the hat.
    href: "/referee",
    label: "Referees group",
    icon: ClipboardList,
    group: "Referee",
    allowed: (c) => c.hasRefereeRole,
    views: ["referee"],
  },
  {
    // A referee's own diary: the games they have claimed appear as events on
    // the team they are refereeing, and this is the same member-facing list.
    href: "/messages",
    label: "Messaging",
    icon: MessageSquare,
    group: "Referee",
    allowed: () => true,
    views: ["referee"],
  },

  // --- Team (the parent and coach views' second section, Adam 2026-08-25) --
  {
    // One link: the team page. /my-team is a redirect that already knows the
    // answer — the switcher's team-scoped pick, or the only team the hat
    // covers — and otherwise sends a parent to /family and a coach to /teams
    // to choose. The gate is the union of the two views' own qualifiers.
    href: "/my-team",
    label: "Team page",
    icon: Shirt,
    group: "Team",
    allowed: (c) => c.isGuardian || c.hasParentRole || c.isTeamStaff || c.hasCoachRole,
    views: ["parent", "coach"],
  },
  {
    href: "/groups",
    label: "Groups",
    icon: UsersRound,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
    child: true,
  },
  {
    // Adam, 2026-08-25 evening: "On the coaches menu, there should be a link
    // to groups, just below messages." /groups is the admin directory (its
    // page bounces anyone else), so the coach gets the member-facing view —
    // their own groups in the messages list, the same door the Me menu opens.
    href: "/messages?filter=groups",
    label: "Groups",
    icon: UsersRound,
    group: "Club",
    allowed: () => true,
    views: ["coach"],
    child: true,
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
    // The admin's first screen: the club at a glance.
    href: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "Club",
    allowed: (c) => c.isClubAdmin || c.isCommittee,
    views: ["admin"],
  },
  {
    // Admin view only (Adam, 2026-08-25: "when I am selecting the coach role,
    // it shouldn't show the teams menu item") — a coach pick is team-scoped
    // and lands straight on that team's page, the same rule as parent/player.
    href: "/teams",
    label: "Teams",
    icon: Users,
    group: "Club",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["admin"],
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
  {
    // The form itself, as a shortcut under the queue that uses it.
    href: "/registrations/form",
    label: "Registration form",
    icon: ClipboardList,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
    child: true,
  },

  // --- Matchday (the design's own section) ---------------------------------
  {
    // The coach/admin desk: every fixture with pitch and reply state.
    href: "/matches",
    label: "Matches",
    icon: Shirt,
    group: "Matchday",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["coach", "admin"],
  },
  {
    // The member-facing diary with accept/decline — the design places it in
    // Matchday for players and parents; coaches work from Matches/Training.
    href: "/events",
    label: "Events",
    icon: CalendarCheck,
    group: "Matchday",
    allowed: (c) =>
      c.hasPlayerMembership || c.isGuardian || c.hasParentRole || c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    // Adam's parent menu has no Events entry — a parent's diary lives on the
    // child's team page and the lobby.
    views: ["player", "coach", "admin"],
  },
  {
    href: "/training",
    label: "Training",
    icon: CalendarCheck,
    group: "Matchday",
    allowed: (c) => c.isTeamStaff || c.isCommittee || c.isClubAdmin,
    views: ["coach", "admin"],
  },
  {
    href: "/social",
    label: "Social",
    icon: CalendarDays,
    group: "Matchday",
    allowed: () => true,
    views: ["player", "coach", "admin"],
  },

  // --- Pitches (a different diary entirely from the function room) ---------
  {
    // Adam, 2026-08-25: "Parents don't need to see pitch calendars" — the
    // parent view drops the whole Pitches section (their child's times live
    // on the team page and in Events).
    href: "/pitches/calendar",
    label: "Pitch calendar",
    icon: CalendarDays,
    group: "Pitches",
    allowed: (c) =>
      c.isTeamStaff || c.isGuardian || c.hasPlayerMembership || c.isCommittee || c.isClubAdmin,
    views: ["player", "coach", "admin"],
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
    href: "/pitches",
    label: "Allocate fixtures",
    icon: LandPlot,
    group: "Pitches",
    allowed: (c) => c.isCommittee,
    views: ["admin"],
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
    // The clashes report: what the diary's overlap rule cannot untangle by
    // itself — refused Full-Time reschedules, a team booked in two places,
    // fixtures out of step with their booking, home fixtures with no pitch.
    href: "/pitches/clashes",
    label: "Clashes",
    icon: ShieldAlert,
    group: "Pitches",
    allowed: (c) => c.isClubAdmin || c.isCommittee,
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
    // The room's own contacts book (Adam, 2026-08-25) — hire contacts kept
    // out of the members database, so this is where the desk finds them.
    href: "/room-bookings/contacts",
    label: "Hire contacts",
    icon: Contact,
    group: "Function room",
    allowed: (c) => c.isStaff,
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

  // --- Money ---------------------------------------------------------------
  {
    href: "/subs",
    label: "Subs",
    icon: Receipt,
    group: "Money",
    allowed: (c) => c.isCommittee,
    views: ["admin"],
  },
  {
    // Not in the coach view (Adam, 2026-08-25 evening: "remove Money - My
    // subs and Comms preference as they sit under Me").
    href: "/my-subs",
    label: "My subs",
    icon: Wallet,
    group: "Money",
    allowed: () => true,
    views: ["player", "admin"],
  },

  // --- Me (the ME view only — Adam, 2026-08-25 evening: the parent menu
  // drops the person-level items; they belong to the Me view) ---------------
  {
    href: "/profile",
    label: "My Profile",
    icon: UserCircle,
    group: "Me",
    allowed: () => true,
    views: ["me"],
  },
  {
    // The adults in the caller's household without a login of their own —
    // added at /join or on this page, read back through my_household().
    href: "/connected-adults",
    label: "Connected Adults",
    icon: Contact,
    group: "Me",
    allowed: () => true,
    views: ["me"],
  },
  {
    href: "/family",
    label: "My Children",
    icon: Baby,
    group: "Me",
    allowed: (c) => c.isGuardian || c.hasParentRole,
    views: ["me"],
  },

  // --- Finance (the Me view's name for their own money) --------------------
  {
    href: "/my-subs",
    label: "My Subs",
    icon: Wallet,
    group: "Finance",
    allowed: () => true,
    views: ["me"],
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
    // Not in the parent or coach views (Adam, 2026-08-25 evening) — a
    // person-level setting, so the Me view carries it.
    href: "/settings/comms",
    label: "Comms preferences",
    icon: Mail,
    group: "Settings",
    allowed: () => true,
    views: ["me", "player", "admin"],
  },

  // --- You -----------------------------------------------------------------
  {
    // The me and parent views switch hats in the sidebar dropdown; the tiles
    // page stays for everyone else. SG-3's "Report a concern" above remains in
    // EVERY view, me and parent included — that entry never thins.
    href: "/welcome",
    label: "My role",
    icon: UserCircle,
    group: "You",
    allowed: () => true,
    views: ["player", "coach", "admin", "function_room"],
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
