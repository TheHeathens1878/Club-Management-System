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
  CreditCard,
  Images,
  Landmark,
  LandPlot,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageSquare,
  Receipt,
  Settings,
  Settings2,
  ShieldAlert,
  Shirt,
  UserCheck,
  UserCircle,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { Capabilities, RoleView } from "@/lib/role-view";

const ALL_VIEWS = [
  "me",
  "player",
  "parent",
  "coach",
  "referee",
  "admin",
  "function_room",
] as const satisfies readonly RoleView[];

/** The views that belong to the football club rather than the room. */
const CLUB_VIEWS = ["me", "player", "parent", "coach", "referee", "admin"] as const satisfies readonly RoleView[];

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
  /**
   * Which waiting-count to draw beside the label (Adam, 2026-09-02: "in
   * approvals and registrations, there should be a number icon showing how
   * many are waiting").
   *
   * A KEY, not a number: this table is a static description of the menu and
   * is imported by client components, so it cannot hold a value that has to be
   * read from the database. The layout counts and the link draws; this only
   * says which entries have something worth counting.
   */
  badge?: NavBadge;
};

/** The counts a nav entry can carry. */
export type NavBadge = "approvals" | "registrations";

export const NAV: readonly NavEntry[] = [
  // --- You (2026-09-04 audit; supersedes the numbered "Membership Flow") ---
  // The five numbered labels — "My Profile (1)" … "Register Players (5)" —
  // are replaced by a real checklist page: /getting-started reads what is
  // actually done (profile, children, adults, registrations, membership) and
  // points at the next step, which is what the baked-in numbers never could.
  // The step pages themselves stay routable; the ones a member returns to
  // (profile, family, registering) keep menu rows under plain names, and the
  // add-adults / add-children screens are reached from the checklist and the
  // family page rather than clogging the menu.
  {
    href: "/getting-started",
    label: "Getting started",
    icon: ClipboardCheck,
    group: "You",
    allowed: () => true,
    views: ["me"],
  },
  {
    href: "/profile",
    label: "My profile",
    icon: UserCircle,
    group: "You",
    allowed: () => true,
    views: ["me"],
  },
  {
    // The family tree, with the add-a-child and add-an-adult doors on it.
    href: "/family-linking",
    label: "My family",
    icon: UsersRound,
    group: "You",
    allowed: () => true,
    views: ["me"],
  },
  {
    // Register whoever plays — yourself, a connected adult or a child.
    href: "/my-registrations",
    label: "Register a player",
    icon: ClipboardCheck,
    group: "You",
    allowed: () => true,
    views: ["me"],
  },
  {
    // The me view's copy of "My role" lives in its You group at the top; the
    // bottom entry carries every other view (group() only merges neighbours).
    href: "/welcome",
    label: "My role",
    icon: UserCircle,
    group: "You",
    allowed: () => true,
    views: ["me"],
  },

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
    // player", because that is the thing a member comes here to do. The ME
    // view carries it as step 4 of the Membership Flow instead.
    href: "/my-registrations",
    label: "Register a player",
    icon: ClipboardCheck,
    group: "Club",
    allowed: () => true,
    views: ["parent"],
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

  // --- Team (the parent and coach views' second section, Adam 2026-08-25).
  // Placed AFTER the coach's Club entries so the coach sidebar prints one
  // CLUB heading, not two — group() only merges consecutive rows.
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
    href: "/approvals",
    label: "Approvals",
    icon: UserCheck,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
    badge: "approvals",
  },
  {
    href: "/registrations",
    label: "Registrations",
    icon: ClipboardCheck,
    group: "Club",
    allowed: (c) => c.isClubAdmin,
    views: ["admin"],
    badge: "registrations",
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
    // child's team page and the lobby. The referee carries it because their
    // phone tab bar always did (mobile-nav.ts), and a menu should not know
    // less than the tab bar.
    views: ["player", "coach", "referee", "admin"],
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
  {
    // The grounds those pitches are on: addresses, arrival notes, and the
    // coaches' group each one fills for itself (20260901180000/190000).
    href: "/venues",
    label: "Venues",
    icon: MapPin,
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
  // One money door per hat (the 2026-09-04 navigation audit): the admin gets
  // the finance section, a member gets their own payments and card. The
  // Stripe-era /subs and /my-subs screens are superseded by /finance and
  // /my-payments and no longer earn menu rows — the routes still answer for
  // anyone with an old bookmark.
  {
    // The finance section (Adam, 2026-09-04): membership numbers, fees,
    // charges, the ledger, reports, Xero. Gated on the dedicated finance
    // role (club_admin holds it implicitly — is_finance() in the DB).
    href: "/finance",
    label: "Finance",
    icon: Landmark,
    group: "Money",
    allowed: (c) => c.hasFinanceRole,
    views: ["admin"],
  },

  // --- Finance (a member's own money) --------------------------------------
  {
    // The household's charges and payments, live, with Pay now (SumUp).
    href: "/my-payments",
    label: "My payments",
    icon: Receipt,
    group: "Finance",
    allowed: () => true,
    views: ["me", "player"],
  },
  {
    // The electronic membership card — 00002A and the household under it.
    // Scoped by hat on the page itself (Adam, 2026-09-04): me/parent see
    // their own household, the coach view adds their squads' cards.
    href: "/membership-card",
    label: "Membership card",
    icon: CreditCard,
    group: "Finance",
    allowed: () => true,
    views: ["me", "player", "parent", "coach"],
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
    // Every view carries it (2026-09-04 audit): /welcome is the only page
    // where a member can ask to become a coach or a referee, and the me and
    // parent views — the default for every sign-in — had no way to reach it.
    // The me view's copy sits in its You group at the top of the menu.
    href: "/welcome",
    label: "My role",
    icon: UserCircle,
    group: "You",
    allowed: () => true,
    views: ["player", "parent", "coach", "referee", "admin", "function_room"],
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
