/**
 * The five places the app goes (P7.2, 2026-09-05): Home · Calendar · Messages
 * · Club · Me. The same five on the desktop sidebar, the phone tab bar and
 * the native app, in the same order, always.
 *
 * This replaces the per-hat menus of nav.ts and mobile-nav.ts. Those showed
 * ONE role view at a time — a parent who also coached switched hats to see
 * the other half of their week. Here the menu is the union of what the person
 * may reach, and the CONTEXT is carried on the link instead: "Your child ·
 * U12s" and "Coaching · U14s" open the same team page wearing different
 * hats, through /context, which writes the same cookies the switcher does.
 *
 * TWO GATES, AS BEFORE. `allowed(capabilities)` mirrors the destination
 * page's own guard, so the menu never offers a page that would bounce the
 * reader. There is no second gate any more — no view filter — because the
 * context is now something a link sets, not something the menu is scoped to.
 * Nothing here widens access: the pages keep their guards and the database
 * keeps its policies. A menu is not an authorisation layer.
 *
 * ONE HOME PER TASK. Every route the old menus reached appears exactly once
 * below (the test pins it), under the destination a person would look in
 * first. Secondary screens live inside their destination rather than growing
 * the primary five.
 */

import {
  Beer,
  BellRing,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  DoorOpen,
  Home,
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

export type DestinationKey = "home" | "calendar" | "messages" | "club" | "me";

/** The counts a destination or an item can carry beside its label. */
export type NavBadge = "approvals" | "registrations" | "messages";

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
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pathname prefixes that count as "inside" this destination. */
  match: string[];
  keywords: string[];
  /** The one count the tab itself wears. */
  badge?: NavBadge;
};

export const DESTINATIONS: readonly Destination[] = [
  {
    key: "home",
    href: "/lobby",
    label: "Home",
    icon: Home,
    match: ["/lobby"],
    keywords: ["home", "lobby", "noticeboard", "what needs my attention", "start"],
  },
  {
    key: "calendar",
    href: "/events",
    label: "Calendar",
    icon: CalendarDays,
    match: ["/events", "/pitches/calendar", "/pitches/book", "/pitches/mine", "/matches", "/training", "/social"],
    keywords: ["calendar", "events", "fixtures", "matches", "next match", "training", "availability", "diary"],
  },
  {
    key: "messages",
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    match: ["/messages", "/groups"],
    keywords: ["messages", "chat", "message coach", "groups", "announcements"],
    badge: "messages",
  },
  {
    key: "club",
    href: "/club",
    label: "Club",
    icon: Users,
    match: [
      "/club",
      "/teams",
      "/my-teams",
      "/my-team",
      "/referee",
      "/overview",
      "/people",
      "/approvals",
      "/registrations",
      "/waiting-list",
      "/pitches",
      "/venues",
      "/room-bookings",
      "/bar",
      "/finance",
      "/safeguarding",
      "/media",
      "/settings",
      "/super-users",
      "/email-templates",
      "/subs",
    ],
    keywords: ["club", "teams", "people", "admin", "administration", "manage"],
    badge: "approvals",
  },
  {
    key: "me",
    href: "/me",
    label: "Me",
    icon: UserCircle,
    match: [
      "/me",
      "/profile",
      "/family",
      "/family-linking",
      "/connected-adults",
      "/my-registrations",
      "/my-payments",
      "/my-subs",
      "/membership-card",
      "/getting-started",
      "/welcome",
      "/settings/comms",
      "/notifications",
      "/complete-profile",
      "/safeguarding/report",
    ],
    keywords: ["me", "profile", "account", "family", "children", "membership", "payments", "subs"],
  },
];

export function destination(key: DestinationKey): Destination {
  return DESTINATIONS.find((d) => d.key === key)!;
}

/**
 * Which destination a pathname is inside — the LONGEST matching prefix wins,
 * so /settings/comms lights Me while /settings lights Club, and
 * /pitches/calendar lights Calendar while /pitches lights Club. Null for a
 * route no destination claims (a detail page reached from search).
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
// The items behind each destination
// ---------------------------------------------------------------------------

const CALENDAR_ITEMS: readonly NavItem[] = [
  {
    href: "/events",
    label: "Your calendar",
    icon: CalendarCheck,
    section: "Your diary",
    detail: "Matches, training and socials for everyone in your household — accept or decline",
    allowed: anyone,
    keywords: ["events", "fixtures", "next match", "availability", "respond", "accept", "decline", "training"],
  },
  {
    href: "/pitches/calendar",
    label: "Pitch calendar",
    icon: LandPlot,
    section: "Your diary",
    detail: "Which pitch, which team, all weekend",
    allowed: (c) => c.isTeamStaff || c.isGuardian || c.hasPlayerMembership || c.isCommittee || c.isClubAdmin,
    keywords: ["pitch", "pitches", "where are we playing"],
  },
  {
    href: "/social",
    label: "Social events",
    icon: CalendarDays,
    section: "Your diary",
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
  {
    href: "/groups",
    label: "Groups directory",
    icon: UsersRound,
    section: "Administration",
    detail: "Every group at the club and who is in it",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    keywords: ["groups directory", "manage groups"],
  },
];

const CLUB_ADMIN_ITEMS: readonly NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    section: "Club administration",
    detail: "The club at a glance",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["overview", "dashboard"],
  },
  {
    href: "/teams",
    label: "Teams",
    icon: Users,
    section: "Club administration",
    detail: "Every team, squad and season",
    allowed: staffOrAdmin,
    context: { view: "admin" },
    keywords: ["teams", "squads"],
  },
  {
    href: "/people",
    label: "People",
    icon: Contact,
    section: "Club administration",
    detail: "The members database",
    allowed: (c) => c.isCommittee,
    context: { view: "admin" },
    keywords: ["people", "members", "member record", "find a person"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: UserCheck,
    section: "Club administration",
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
    section: "Club administration",
    detail: "Review and approve player registrations",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    badge: "registrations",
    keywords: ["registrations", "review registration", "approve registration"],
  },
  {
    href: "/registrations/form",
    label: "Registration form",
    icon: ClipboardList,
    section: "Club administration",
    allowed: (c) => c.isClubAdmin,
    context: { view: "admin" },
    keywords: ["registration form", "form builder"],
  },
  {
    href: "/waiting-list/manage",
    label: "Waiting list",
    icon: ClipboardList,
    section: "Club administration",
    allowed: (c) => c.isClubAdmin || c.hasWaitingListAccess,
    keywords: ["waiting list", "trialists"],
  },
  {
    href: "/venues",
    label: "Venues",
    icon: MapPin,
    section: "Club administration",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["venues", "grounds", "addresses"],
  },
  {
    href: "/safeguarding",
    label: "Safeguarding",
    icon: ShieldCheck,
    section: "Club administration",
    detail: "Concerns and oversight",
    allowed: (c) => c.isSafeguardingLead || c.isCommittee,
    context: { view: "admin" },
    keywords: ["safeguarding", "concerns", "welfare"],
  },
  {
    href: "/media",
    label: "Media",
    icon: Images,
    section: "Club administration",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["media", "photos", "albums"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    section: "Club administration",
    allowed: (c) => c.isSuperUser,
    context: { view: "admin" },
    keywords: ["settings", "club settings"],
  },
  {
    href: "/super-users",
    label: "Super users",
    icon: ShieldCheck,
    section: "Club administration",
    allowed: (c) => c.isSuperUser,
    context: { view: "admin" },
    keywords: ["super users", "admin accounts"],
  },
  {
    href: "/email-templates",
    label: "Email templates",
    icon: Mail,
    section: "Club administration",
    allowed: (c) => c.isCommittee,
    context: { view: "admin" },
    keywords: ["email templates"],
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
    href: "/pitches/manage",
    label: "Manage pitches",
    icon: Settings2,
    section: "Pitches",
    allowed: admin,
    context: { view: "admin" },
    keywords: ["manage pitches"],
  },
  {
    href: "/room-bookings",
    label: "Room bookings",
    icon: CalendarDays,
    section: "Function room",
    detail: "The function room diary",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    keywords: ["room bookings", "function room", "booking", "find a booking", "hire"],
  },
  {
    href: "/room-bookings?status=pending&view=list",
    label: "Pending requests",
    icon: Clock,
    section: "Function room",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    keywords: ["pending bookings", "booking requests"],
  },
  {
    href: "/room-bookings/rooms",
    label: "Rooms",
    icon: DoorOpen,
    section: "Function room",
    allowed: (c) => c.isCommittee,
    context: { view: "function_room" },
    keywords: ["rooms", "room prices"],
  },
  {
    href: "/room-bookings/contacts",
    label: "Hire contacts",
    icon: Contact,
    section: "Function room",
    allowed: (c) => c.isStaff,
    context: { view: "function_room" },
    keywords: ["hire contacts", "hirers"],
  },
  {
    href: "/bar",
    label: "Bar",
    icon: Beer,
    section: "Function room",
    allowed: (c) => c.isBarManager,
    context: { view: "function_room" },
    keywords: ["bar", "rota", "stock"],
  },
  {
    href: "/finance",
    label: "Finance",
    icon: Landmark,
    section: "Money",
    detail: "Membership numbers, fees, charges, the ledger, Xero",
    allowed: (c) => c.hasFinanceRole,
    context: { view: "admin" },
    keywords: ["finance", "treasurer", "fees", "charges", "ledger", "xero", "income"],
  },
];

const ME_ITEMS: readonly NavItem[] = [
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
    href: "/my-payments",
    label: "My payments",
    icon: Receipt,
    section: "Membership",
    detail: "Subs and charges for your household — pay online",
    allowed: anyone,
    keywords: ["pay subs", "subs", "payments", "pay", "membership fee", "outstanding", "owed", "card"],
  },
  {
    href: "/membership-card",
    label: "Membership card",
    icon: CreditCard,
    section: "Membership",
    allowed: anyone,
    keywords: ["membership card", "member number", "card"],
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: BellRing,
    section: "Preferences",
    allowed: anyone,
    keywords: ["notifications", "alerts"],
  },
  {
    href: "/settings/comms",
    label: "Comms preferences",
    icon: Mail,
    section: "Preferences",
    detail: "How the club may contact you",
    allowed: anyone,
    keywords: ["comms", "email preferences", "unsubscribe", "contact preferences"],
  },
  {
    href: "/welcome",
    label: "My role",
    icon: Megaphone,
    section: "Preferences",
    detail: "Ask to coach or referee; see your requests",
    allowed: anyone,
    keywords: ["my role", "become a coach", "become a referee", "role request"],
  },
  {
    href: "/safeguarding/report",
    label: "Report a concern",
    icon: ShieldAlert,
    section: "Help",
    detail: "Raise a safeguarding concern — anyone can",
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
 * The Club destination's first section is the person's OWN teams, one row per
 * hat per team, each opening the team page in that hat. This is where the
 * old role switcher's team-scoped picks went: a row, not a mode.
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
 * The items a destination holds for THIS person: the static rows whose gate
 * passes, plus the team rows their hats generate. Order is the order drawn.
 */
export function itemsFor(key: DestinationKey, c: Capabilities): NavItem[] {
  switch (key) {
    case "home":
      return [];
    case "calendar":
      return CALENDAR_ITEMS.filter((item) => item.allowed(c)).map((item) =>
        item.section === "Coaching" && !item.context ? { ...item, context: coachContext(c) } : item,
      );
    case "messages":
      return MESSAGES_ITEMS.filter((item) => item.allowed(c));
    case "club":
      return [
        ...teamItems(c),
        ...CLUB_ADMIN_ITEMS.filter((item) => item.allowed(c)).map((item) =>
          // A coach who is not an administrator opens Teams and the waiting
          // list as a coach, not as an admin they are not.
          item.context?.view === "admin" && coachOnly(c) ? { ...item, context: coachContext(c) } : item,
        ),
      ];
    case "me":
      return ME_ITEMS.filter((item) => item.allowed(c));
  }
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
 * Everything the palette can offer this person: the five destinations, then
 * every item they may reach, each with its section and everyday words.
 */
export type PaletteEntry = { label: string; href: string; group: string; keywords: string[] };

export function paletteEntries(c: Capabilities, current: CurrentContext): PaletteEntry[] {
  const out: PaletteEntry[] = DESTINATIONS.map((d) => ({
    label: d.label,
    href: d.href,
    group: "Go to",
    keywords: d.keywords,
  }));
  for (const d of DESTINATIONS) {
    for (const item of itemsFor(d.key, c)) {
      out.push({
        label: item.label,
        href: linkHref(item, current),
        group: `${d.label} · ${item.section}`,
        keywords: item.keywords ?? [],
      });
    }
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

/** The whole menu, flattened — what the sidebar highlights against. */
export function allHrefs(c: Capabilities): string[] {
  return DESTINATIONS.flatMap((d) => [d.href, ...itemsFor(d.key, c).map((item) => item.href)]);
}
