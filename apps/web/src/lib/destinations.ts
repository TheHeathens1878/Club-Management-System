/**
 * The app's map (P7.5, the three-noun navigation — Adam's Claude Design
 * template of 2026-09-12): every screen has exactly ONE home, and the homes
 * are few.
 *
 *   · Four NOUNS across the top: Diary, People, Clubhouse and Money — the
 *     things a club is made of. A noun is a door and a set of rows; the rows
 *     are its tabs. Clubhouse (the building and the bar) shows only to staff;
 *     a member's People is "Family" and their Money is "What I owe".
 *   · Two UTILITIES on the right: Inbox (everything waiting on you, whichever
 *     noun it belongs to) and Messages. They are verbs — how work arrives, not
 *     where it lives — so they sit outside the nouns.
 *   · The DRAWER behind the crest: running the club (set up once, changed
 *     rarely, out of the way of the daily work) and you (profile, family,
 *     preferences, help), then the way out.
 *
 * Every entry names the CAPABILITY that must be true for it to show — the
 * same answer the destination page's own guard gives, so the menu never
 * offers a door that will not open. A row that switches hat carries its
 * `context` and goes through `/context`. Nothing here authorises anything:
 * each page keeps its own guard.
 *
 * ONE HOME PER TASK. Every route the old menus reached appears exactly once
 * below (the test pins it), under the noun a person would look in first.
 */

import {
  Beer,
  BellRing,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  DoorOpen,
  Images,
  Inbox,
  Landmark,
  LandPlot,
  LayoutDashboard,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
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
  type LucideIcon,
} from "lucide-react";

import type { Capabilities, RoleView, TeamRef } from "@/lib/role-view";

/** The four nouns and the two utilities — the six doors of the top bar. */
export type DestinationKey = "diary" | "people" | "clubhouse" | "money" | "inbox" | "messages";

/** The counts a destination or an item can carry beside its label. */
export type NavBadge = "approvals" | "registrations" | "messages" | "roomBookings" | "notifications";

/** The role and team a link opens in — the cookies /context writes. */
export type NavContext = { view: RoleView; teamId?: string };

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The heading the item sits under — on the hub page and in the sidebar. */
  section: string;
  /** One line under the label on the hub page. */
  detail?: string;
  /** Absolute capability gate — mirrors the destination page's own guard. */
  allowed: (c: Capabilities) => boolean;
  /** The hat the page is opened wearing. Absent = whatever hat is on. */
  context?: NavContext;
  /** Which waiting-count to draw beside the label. */
  badge?: NavBadge;
  /** Everyday words that find this item in search ("pay subs"). */
  keywords?: string[];
};

export type Destination = {
  key: DestinationKey;
  /** A noun sits across the top; a utility sits on the right. */
  kind: "noun" | "utility";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pathname prefixes that count as "inside" this destination. */
  match: string[];
  keywords: string[];
  /** The one count the door itself wears. */
  badge?: NavBadge;
  /** Who sees the door at all. Absent = everyone. */
  allowed?: (c: Capabilities) => boolean;
};

export const DESTINATIONS: readonly Destination[] = [
  {
    key: "diary",
    kind: "noun",
    href: "/events",
    label: "Diary",
    icon: CalendarDays,
    match: [
      "/events",
      "/pitches",
      "/venues",
      "/matches",
      "/training",
      "/social",
    ],
    keywords: ["diary", "calendar", "events", "fixtures", "matches", "next match", "training", "availability", "pitches"],
  },
  {
    key: "people",
    kind: "noun",
    href: "/club",
    label: "People",
    icon: Contact,
    match: [
      "/club",
      "/teams",
      "/my-teams",
      "/my-team",
      "/referee",
      "/people",
      "/approvals",
      "/registrations",
      "/waiting-list",
      "/safeguarding",
      "/family",
      "/family-linking",
      "/connected-adults",
      "/groups",
    ],
    keywords: ["people", "teams", "family", "children", "members", "contacts", "squads", "registrations"],
    badge: "approvals",
  },
  {
    key: "clubhouse",
    kind: "noun",
    href: "/room-bookings",
    label: "Clubhouse",
    icon: Beer,
    match: ["/room-bookings", "/bar"],
    keywords: ["clubhouse", "function room", "room bookings", "bar", "hire"],
    badge: "roomBookings",
    allowed: (c) => c.isStaff,
  },
  {
    key: "money",
    kind: "noun",
    href: "/finance",
    label: "Money",
    icon: Receipt,
    match: ["/finance", "/subs", "/my-payments", "/my-subs", "/membership-card"],
    keywords: ["money", "finance", "subs", "payments", "pay", "owed", "fees", "membership card"],
  },
  {
    key: "inbox",
    kind: "utility",
    href: "/lobby",
    label: "Inbox",
    icon: Inbox,
    match: ["/lobby", "/notifications", "/overview"],
    keywords: ["inbox", "home", "lobby", "noticeboard", "what needs my attention", "notifications", "start"],
    badge: "notifications",
  },
  {
    key: "messages",
    kind: "utility",
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    match: ["/messages"],
    keywords: ["messages", "chat", "message coach", "groups", "announcements"],
    badge: "messages",
  },
];

export function destination(key: DestinationKey): Destination {
  return DESTINATIONS.find((d) => d.key === key)!;
}

/** The doors THIS person sees, in order — nouns first, then the utilities. */
export function visibleDestinations(c: Capabilities): Destination[] {
  return DESTINATIONS.filter((d) => !d.allowed || d.allowed(c));
}

/**
 * The name a noun wears for this person. The design's own rule: People is
 * "My teams" to a coach who is nobody else, and "Family" to a parent or player
 * who is nobody else; Money is "What I owe" to anyone without the finance
 * role. Everybody else sees the plain noun.
 */
export function destinationLabel(d: Destination, c: Capabilities): string {
  if (d.key === "people") {
    if (admin(c) || c.isCommittee || c.isStaff) return "People";
    if (c.isTeamStaff || c.hasCoachRole) return "My teams";
    if (c.isGuardian || c.hasParentRole || c.hasPlayerMembership) return "Family";
    return "People";
  }
  if (d.key === "money") return c.hasFinanceRole ? "Money" : "What I owe";
  return d.label;
}

/**
 * Where a noun's door opens for this person: Money opens the finance section
 * for the treasurer and "My payments" for everyone else. Every other door is
 * one place for everybody.
 */
export function destinationHref(d: Destination, c: Capabilities): string {
  if (d.key === "money") return c.hasFinanceRole ? "/finance" : "/my-payments";
  return d.href;
}

/**
 * Which destination a pathname is inside — the LONGEST matching prefix wins,
 * so /pitches/calendar and /pitches both light Diary while /safeguarding/report
 * (the drawer's) still lights People. Null for a route no destination claims
 * (a detail page reached from search, or a drawer screen like /profile).
 */
export function activeDestination(pathname: string): DestinationKey | null {
  let best: DestinationKey | null = null;
  let bestLength = -1;
  for (const d of DESTINATIONS) {
    for (const prefix of d.match) {
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLength) {
        bestLength = prefix.length;
        best = d.key;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gates, named once so the hubs and the tests read the same word
// ---------------------------------------------------------------------------

const anyone = () => true;
const admin = (c: Capabilities) => c.isClubAdmin || c.isCommittee;
const staffOrAdmin = (c: Capabilities) => c.isTeamStaff || c.isCommittee || c.isClubAdmin;
const coachOnly = (c: Capabilities) => (c.isTeamStaff || c.hasCoachRole) && !admin(c);

/** The coaching context: the one team when there is one, else the bare hat. */
function coachContext(c: Capabilities): NavContext {
  if (admin(c)) return { view: "admin" };
  return c.staffTeams.length === 1 ? { view: "coach", teamId: c.staffTeams[0]!.id } : { view: "coach" };
}

// ---------------------------------------------------------------------------
// The items behind each door
// ---------------------------------------------------------------------------

const DIARY_ITEMS: readonly NavItem[] = [
  {
    href: "/events",
    label: "Your calendar",
    icon: CalendarCheck,
    section: "What's on",
    detail: "Matches, training and socials for everyone in your household — accept or decline",
    allowed: anyone,
    keywords: ["events", "fixtures", "next match", "availability", "respond", "accept", "decline", "training"],
  },
  {
    href: "/pitches/calendar",
    label: "Pitch calendar",
    icon: LandPlot,
    section: "What's on",
    detail: "Which pitch, which team, all weekend",
    allowed: (c) => c.isTeamStaff || c.isGuardian || c.hasPlayerMembership || c.isCommittee || c.isClubAdmin,
    keywords: ["pitch", "pitches", "where are we playing"],
  },
  {
    href: "/social",
    label: "Social events",
    icon: CalendarDays,
    section: "What's on",
    detail: "What's on at the clubhouse",
    allowed: anyone,
    keywords: ["social", "clubhouse", "events"],
  },
  {
    href: "/matches",
    label: "Matches desk",
    icon: Shirt,
    section: "Coaching",
    detail: "Every fixture with its pitch and who has replied",
    allowed: staffOrAdmin,
    keywords: ["matches", "desk", "who has replied", "chase"],
  },
  {
    href: "/training",
    label: "Training",
    icon: CalendarCheck,
    section: "Coaching",
    detail: "Sessions and registers — record attendance",
    allowed: staffOrAdmin,
    keywords: ["training", "register", "attendance", "record attendance"],
  },
  {
    href: "/pitches/book",
    label: "Book a pitch",
    icon: CalendarPlus,
    section: "Coaching",
    allowed: staffOrAdmin,
    keywords: ["book pitch", "pitch booking"],
  },
  {
    href: "/pitches/mine",
    label: "My pitch bookings",
    icon: CalendarCheck,
    section: "Coaching",
    allowed: staffOrAdmin,
    keywords: ["pitch bookings", "my bookings"],
  },
  {
    href: "/pitches",
    label: "Allocate fixtures",
    icon: LandPlot,
    section: "Pitches",
    detail: "Put each home fixture on a pitch",
    allowed: (c) => c.isCommittee,
    context: { view: "admin" },
    keywords: ["allocate", "pitch allocation", "fixtures"],
  },
  {
    href: "/pitches/requests",
    label: "Pitch requests",
    icon: Inbox,
    section: "Pitches",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    keywords: ["pitch requests"],
  },
  {
    href: "/pitches/clashes",
    label: "Clashes",
    icon: ShieldAlert,
    section: "Pitches",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["clashes", "double booked"],
  },
  {
    href: "/pitches/training",
    label: "Training blocks",
    icon: CalendarRange,
    section: "Pitches",
    detail: "Winter slots at the 3G venues, shared out between teams",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["winter training", "training allocation", "training blocks", "3g", "2g", "astro"],
  },
  {
    href: "/pitches/manage",
    label: "Manage pitches",
    icon: Settings2,
    section: "Pitches",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["manage pitches"],
  },
  {
    href: "/venues",
    label: "Venues",
    icon: MapPin,
    section: "Pitches",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["venues", "grounds", "addresses"],
  },
];

const MESSAGES_ITEMS: readonly NavItem[] = [
  {
    href: "/messages",
    label: "All messages",
    icon: MessageSquare,
    section: "Messages",
    allowed: anyone,
    keywords: ["inbox", "conversations"],
  },
  {
    href: "/messages?filter=groups",
    label: "My groups",
    icon: UsersRound,
    section: "Messages",
    detail: "Team rooms and the groups you belong to",
    allowed: anyone,
    keywords: ["groups", "team chat", "team room"],
  },
  {
    href: "/messages/new",
    label: "New message",
    icon: MessageSquarePlus,
    section: "Messages",
    detail: "Message a coach, a parent or a team",
    allowed: anyone,
    keywords: ["new message", "message coach", "message the coach", "write"],
  },
];

const PEOPLE_ITEMS: readonly NavItem[] = [
  {
    href: "/approvals",
    label: "Approvals",
    icon: UserCheck,
    section: "Waiting on you",
    detail: "Role requests and players leaving",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    badge: "approvals",
    keywords: ["approvals", "approve", "requests"],
  },
  {
    href: "/registrations",
    label: "Registrations",
    icon: ClipboardCheck,
    section: "Waiting on you",
    detail: "Review and approve player registrations",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    badge: "registrations",
    keywords: ["registrations", "review registration", "approve registration"],
  },
  {
    href: "/waiting-list/manage",
    label: "Waiting list",
    icon: ClipboardList,
    section: "Waiting on you",
    allowed: (c) => c.isClubAdmin || c.hasWaitingListAccess,
    keywords: ["waiting list", "trialists"],
  },
  {
    href: "/teams",
    label: "Teams",
    icon: Users,
    section: "Directory",
    detail: "Every team, squad and season",
    allowed: staffOrAdmin,
    context: { view: "admin" },
    keywords: ["teams", "squads"],
  },
  {
    href: "/people",
    label: "Contacts",
    icon: Contact,
    section: "Directory",
    detail: "The members database — players, guardians, coaches and committee",
    allowed: (c) => c.isCommittee,
    context: { view: "admin" },
    keywords: ["people", "members", "member record", "find a person", "contacts"],
  },
  {
    href: "/groups",
    label: "Groups directory",
    icon: UsersRound,
    section: "Directory",
    detail: "Every group at the club and who is in it",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    keywords: ["groups directory", "manage groups"],
  },
  {
    href: "/safeguarding",
    label: "Safeguarding",
    icon: ShieldCheck,
    section: "Protected",
    detail: "Concerns and oversight",
    allowed: (c) => c.isSafeguardingLead || c.isCommittee,
    context: { view: "admin" },
    keywords: ["safeguarding", "concerns", "welfare"],
  },
];

const CLUBHOUSE_ITEMS: readonly NavItem[] = [
  {
    href: "/room-bookings",
    label: "Room bookings",
    icon: CalendarDays,
    section: "Bookings",
    detail: "The function room diary",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    keywords: ["room bookings", "function room", "booking", "find a booking", "hire"],
  },
  {
    // `status=open` is the list's "Waiting" tab: pending requests AND
    // enquiries, both of which the desk owes an answer. The badge counts the
    // same rows (lib/nav-counts), so the number and the page agree.
    href: "/room-bookings?status=open&view=list",
    label: "Pending requests",
    icon: Clock,
    section: "Bookings",
    detail: "Requests and enquiries waiting for an answer",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    badge: "roomBookings",
    keywords: ["pending bookings", "booking requests", "enquiries", "waiting"],
  },
  {
    href: "/room-bookings/contacts",
    label: "Hire contacts",
    icon: Contact,
    section: "Bookings",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    keywords: ["hire contacts", "hirers"],
  },
  {
    href: "/room-bookings/rooms",
    label: "Rooms",
    icon: DoorOpen,
    section: "The building",
    allowed: (c) => c.isCommittee,
    context: { view: "function_room" },
    keywords: ["rooms", "room prices"],
  },
  {
    href: "/bar",
    label: "Bar",
    icon: Beer,
    section: "The building",
    allowed: (c) => c.isBarManager,
    context: { view: "function_room" },
    keywords: ["bar", "rota", "stock"],
  },
];

const MONEY_ITEMS: readonly NavItem[] = [
  {
    href: "/finance",
    label: "Finance",
    icon: Landmark,
    section: "The books",
    detail: "Membership numbers, fees, charges, the ledger, Xero",
    allowed: (c) => c.hasFinanceRole,
    context: { view: "admin" },
    keywords: ["finance", "treasurer", "fees", "charges", "ledger", "xero", "income"],
  },
  {
    href: "/my-payments",
    label: "My payments",
    icon: Receipt,
    section: "Yours",
    detail: "Subs and charges for your household — pay online",
    allowed: anyone,
    keywords: ["pay subs", "subs", "payments", "pay", "membership fee", "outstanding", "owed", "card"],
  },
  {
    href: "/membership-card",
    label: "Membership card",
    icon: CreditCard,
    section: "Yours",
    allowed: anyone,
    keywords: ["membership card", "member number", "card"],
  },
];

/**
 * The crest drawer. "Running the club" is set up once and changed rarely, so
 * it stays out of the way of the daily work; "You" is the person; "Help" is
 * for everyone, always. The sign-out is the drawer's last row, drawn by the
 * top bar itself (a form, not a link).
 */
const DRAWER_ITEMS: readonly NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    section: "Running the club",
    detail: "The club at a glance",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["overview", "dashboard"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    section: "Running the club",
    detail: "Club details, branding, payments and notifications",
    allowed: (c) => c.isSuperUser,
    context: { view: "admin" },
    keywords: ["settings", "club settings"],
  },
  {
    href: "/super-users",
    label: "Super users",
    icon: ShieldCheck,
    section: "Running the club",
    detail: "Who can see and change what",
    allowed: (c) => c.isSuperUser,
    context: { view: "admin" },
    keywords: ["super users", "admin accounts"],
  },
  {
    href: "/registrations/form",
    label: "Registration form",
    icon: ClipboardList,
    section: "Running the club",
    detail: "The questions a new player answers",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    keywords: ["registration form", "form builder"],
  },
  {
    href: "/email-templates",
    label: "Email templates",
    icon: Mail,
    section: "Running the club",
    detail: "Templates, senders and reply-to addresses",
    allowed: (c) => c.isCommittee,
    context: { view: "admin" },
    keywords: ["email templates", "comms templates"],
  },
  {
    href: "/media",
    label: "Media",
    icon: Images,
    section: "Running the club",
    detail: "Photos and albums",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["media", "photos", "albums"],
  },
  {
    href: "/getting-started",
    label: "Getting started",
    icon: ClipboardCheck,
    section: "You",
    detail: "The checklist — what the club still needs from you",
    allowed: anyone,
    keywords: ["getting started", "checklist", "set up", "join"],
  },
  {
    href: "/profile",
    label: "My profile",
    icon: UserCircle,
    section: "You",
    detail: "Your details and photo",
    allowed: anyone,
    keywords: ["profile", "my details", "update details", "address", "phone"],
  },
  {
    href: "/family-linking",
    label: "My family",
    icon: UsersRound,
    section: "You",
    detail: "Your children and the adults on your membership",
    allowed: anyone,
    keywords: ["family", "children", "child", "add child", "household", "family details", "update family"],
  },
  {
    href: "/my-registrations",
    label: "Register a player",
    icon: ClipboardCheck,
    section: "You",
    detail: "Yourself, a child or a connected adult",
    allowed: anyone,
    keywords: ["register", "registration", "register a player", "sign up a child"],
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: BellRing,
    section: "You",
    allowed: anyone,
    badge: "notifications",
    keywords: ["notifications", "alerts"],
  },
  {
    href: "/settings/comms",
    label: "Comms preferences",
    icon: Mail,
    section: "You",
    detail: "How the club may contact you",
    allowed: anyone,
    keywords: ["comms", "email preferences", "unsubscribe", "contact preferences"],
  },
  {
    href: "/welcome",
    label: "My role",
    icon: Megaphone,
    section: "You",
    detail: "Ask to coach or referee; see your requests",
    allowed: anyone,
    keywords: ["my role", "become a coach", "become a referee", "role request"],
  },
  {
    href: "/safeguarding/report",
    label: "Report a concern",
    icon: ShieldAlert,
    section: "Help",
    detail: "In every role, for everyone, always",
    allowed: anyone,
    keywords: ["report", "concern", "safeguarding", "welfare"],
  },
  {
    href: "/contact",
    label: "Contact the club",
    icon: Mail,
    section: "Help",
    allowed: anyone,
    keywords: ["contact", "help", "email the club"],
  },
];

/** "for Ben and Sam" — the children a parent's team row is about. */
function childrenLabel(team: TeamRef): string | undefined {
  const names = team.children ?? [];
  if (names.length === 0) return undefined;
  if (names.length === 1) return `for ${names[0]}`;
  return `for ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * People's first section is the person's OWN teams, one row per hat per team,
 * each opening the team page in that hat. This is where the old role
 * switcher's team-scoped picks went: a row, not a mode.
 */
function teamItems(c: Capabilities): NavItem[] {
  const items: NavItem[] = [];
  const seen = new Set<string>();
  const add = (item: NavItem) => {
    const key = `${item.href}|${item.context?.view ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const team of c.parentTeams) {
    add({
      href: `/teams/${team.id}`,
      label: `Your child · ${team.name}`,
      icon: Shirt,
      section: "Your teams",
      detail: childrenLabel(team),
      allowed: anyone,
      context: { view: "parent", teamId: team.id },
      keywords: ["my child", "child's team", team.name],
    });
  }
  for (const team of c.staffTeams) {
    add({
      href: `/teams/${team.id}`,
      label: `Coaching · ${team.name}`,
      icon: Megaphone,
      section: "Your teams",
      detail: "Squad, fixtures, lineups and the register",
      allowed: anyone,
      context: { view: "coach", teamId: team.id },
      keywords: ["coaching", "my team", "squad", team.name],
    });
  }
  for (const team of c.playerTeams) {
    add({
      href: `/teams/${team.id}`,
      label: `Playing · ${team.name}`,
      icon: Shirt,
      section: "Your teams",
      allowed: anyone,
      context: { view: "player", teamId: team.id },
      keywords: ["playing", "my team", team.name],
    });
  }
  if (c.hasPlayerMembership && c.playerTeams.length === 0) {
    add({
      href: "/my-teams",
      label: "My teams",
      icon: Shirt,
      section: "Your teams",
      allowed: anyone,
      context: { view: "player" },
      keywords: ["my teams"],
    });
  }
  if ((c.isGuardian || c.hasParentRole) && c.parentTeams.length === 0) {
    add({
      href: "/family",
      label: "Your children",
      icon: UsersRound,
      section: "Your teams",
      detail: "No team yet — register a child to see their team here",
      allowed: anyone,
      context: { view: "parent" },
      keywords: ["children"],
    });
  }
  if (c.hasRefereeRole) {
    add({
      href: "/referee",
      label: "Refereeing",
      icon: ClipboardList,
      section: "Your teams",
      detail: "Games that need a referee, and the ones you have taken",
      allowed: anyone,
      context: { view: "referee" },
      keywords: ["referee", "refereeing", "games to referee"],
    });
  }
  return items;
}

/**
 * The items a door holds for THIS person: the static rows whose gate passes,
 * plus the team rows their hats generate. Order is the order drawn.
 */
export function itemsFor(key: DestinationKey, c: Capabilities): NavItem[] {
  switch (key) {
    case "diary":
      return DIARY_ITEMS.filter((item) => item.allowed(c)).map((item) =>
        item.section === "Coaching" && !item.context ? { ...item, context: coachContext(c) } : item,
      );
    case "people":
      return [
        ...teamItems(c),
        ...PEOPLE_ITEMS.filter((item) => item.allowed(c)).map((item) =>
          // A coach who is not an administrator opens Teams and the waiting
          // list as a coach, not as an admin they are not.
          item.context?.view === "admin" && coachOnly(c) ? { ...item, context: coachContext(c) } : item,
        ),
      ];
    case "clubhouse":
      return CLUBHOUSE_ITEMS.filter((item) => item.allowed(c));
    case "money":
      return MONEY_ITEMS.filter((item) => item.allowed(c));
    case "inbox":
      return [];
    case "messages":
      return MESSAGES_ITEMS.filter((item) => item.allowed(c));
  }
}

/** The crest drawer's rows for this person, in the order drawn. */
export function drawerItemsFor(c: Capabilities): NavItem[] {
  return DRAWER_ITEMS.filter((item) => item.allowed(c));
}

export type NavSection = { section: string; items: NavItem[] };

/** Items grouped under their section headings, in first-seen order. */
export function sectionsOf(items: readonly NavItem[]): NavSection[] {
  const out: NavSection[] = [];
  for (const item of items) {
    const last = out.find((s) => s.section === item.section);
    if (last) last.items.push(item);
    else out.push({ section: item.section, items: [item] });
  }
  return out;
}

/** The current hat, as the layout resolves it, so a link that opens in the same hat goes straight there. */
export type CurrentContext = { view: RoleView | null; teamId: string | null };

/**
 * The href a menu row actually navigates to. A row with a context different
 * from the one already on goes through /context, which validates the hat
 * against the database, writes the cookies and continues to the page; a row
 * whose context is already the current one links straight through.
 */
export function linkHref(item: NavItem, current: CurrentContext): string {
  if (!item.context) return item.href;
  const sameView = item.context.view === current.view;
  const sameTeam = (item.context.teamId ?? null) === current.teamId;
  if (sameView && (item.context.teamId === undefined || sameTeam)) return item.href;
  return contextHref(item.context, item.href);
}

export function contextHref(context: NavContext, next: string): string {
  const params = new URLSearchParams({ view: context.view, next });
  if (context.teamId) params.set("team", context.teamId);
  return `/context?${params.toString()}`;
}

/**
 * Everything the palette can offer this person: the doors, then every item
 * they may reach behind them and in the drawer, each with its section and
 * everyday words.
 */
export type PaletteEntry = { label: string; href: string; group: string; keywords: string[] };

export function paletteEntries(c: Capabilities, current: CurrentContext): PaletteEntry[] {
  const doors = visibleDestinations(c);
  const out: PaletteEntry[] = doors.map((d) => ({
    label: destinationLabel(d, c),
    href: destinationHref(d, c),
    group: "Go to",
    keywords: d.keywords,
  }));
  for (const d of doors) {
    for (const item of itemsFor(d.key, c)) {
      out.push({
        label: item.label,
        href: linkHref(item, current),
        group: `${destinationLabel(d, c)} · ${item.section}`,
        keywords: item.keywords ?? [],
      });
    }
  }
  for (const item of drawerItemsFor(c)) {
    out.push({
      label: item.label,
      href: linkHref(item, current),
      group: item.section,
      keywords: item.keywords ?? [],
    });
  }
  return out;
}

/**
 * The context label the header prints — "Coaching · U14 Mavericks", "Your
 * child · U12 Cobras", "Club administration" — so the reader always knows
 * which hat the page in front of them is wearing.
 */
export function contextLabel(view: RoleView | null, team: TeamRef | null): string | null {
  switch (view) {
    case "coach":
      return team ? `Coaching · ${team.name}` : "Coaching";
    case "parent":
      return team ? `Your child · ${team.name}` : "Parent";
    case "player":
      return team ? `Playing · ${team.name}` : "Player";
    case "admin":
      return "Club administration";
    case "referee":
      return "Refereeing";
    case "function_room":
      return "Function room";
    case "me":
    case null:
      return null;
  }
}

/** The whole menu, flattened — what the top bar's highlight is measured against. */
export function allHrefs(c: Capabilities): string[] {
  const doors = visibleDestinations(c);
  return [
    ...doors.flatMap((d) => [destinationHref(d, c), ...itemsFor(d.key, c).map((item) => item.href)]),
    ...drawerItemsFor(c).map((item) => item.href),
  ];
}
