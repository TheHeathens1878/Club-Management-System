/**
 * "Which hat am I wearing?" — the vocabulary of the login tiles and of the
 * hard-scoped menu that follows from them.
 *
 * Two separate questions live in this pair of modules and they must not be
 * confused:
 *
 *   · CAPABILITIES — what the database will actually let this person do. Every
 *     one of them is the database's own answer, read through the user-scoped
 *     client under RLS (see `@/lib/capabilities`).
 *   · The chosen VIEW — which of the club's six kinds of user this person is
 *     looking at the app as, kept in the `club.role_view` cookie.
 *
 * The rule the club owner set, and the one this module exists to enforce: a
 * view is only ever offered to somebody who QUALIFIES for it. There is no
 * "look at a view you do not hold", no banner asking to be approved, and no
 * unioning of two views' menus. Someone with three hats gets three tiles and
 * picks one; the menu is then that view's and nothing else's.
 *
 * No schema change: the preference is a cookie. This module is deliberately
 * free of server-only imports so the client-side tiles can share the cookie
 * name and the labels.
 */

import type { UserRole } from "@/lib/types";

export const ROLE_VIEW_COOKIE = "club.role_view";
/**
 * Historical: the middleware's first-visit nudge to /welcome set this once.
 * The nudge is gone (owner ruling 1 — a first sign-in lands in the Me view on
 * the lobby, not on a role picker); `setRoleView` still writes the cookie so a
 * stale one keeps meaning "has chosen".
 */
export const ROLE_VIEW_PROMPTED_COOKIE = "club.role_view_prompted";
/**
 * The optional team a coach/parent/player view is narrowed to (Adam,
 * 2026-08-25: "Coach – U14 Mavericks", "Parent – U18 Cobras"). Meaningless for
 * admin and function_room, and cleared whenever the view changes to one of
 * those. A separate cookie so `club.role_view` keeps its shape and everything
 * that reads it — the middleware included — is untouched.
 */
export const TEAM_SCOPE_COOKIE = "club.team_scope";

/**
 * The six kinds of user the club recognises, in tile order. "Me" is not a hat
 * at all — it is the person themselves (profile, household, subs, lobby), held
 * by anyone the club has linked to a person record, and it is the view a fresh
 * sign-in lands in.
 */
export const ROLE_VIEWS = [
  "me",
  "player",
  "parent",
  "coach",
  "referee",
  "admin",
  "function_room",
] as const;
export type RoleView = (typeof ROLE_VIEWS)[number];

export const ROLE_VIEW_LABELS: Record<RoleView, string> = {
  me: "Me",
  player: "Player",
  parent: "Parent or guardian",
  coach: "Coach or manager",
  referee: "Referee",
  admin: "Club admin",
  function_room: "Function room",
};

export const ROLE_VIEW_BLURBS: Record<RoleView, string> = {
  me: "Your profile, your family, your subs and the club lobby.",
  player: "Your teams and when you are playing.",
  parent: "Your children, their teams and their fixtures.",
  coach: "Your teams, pitch bookings and the waiting list.",
  referee: "The games that need a referee, and the ones you have taken.",
  admin: "Running the club — people, teams, approvals and money.",
  function_room: "The function room diary, the bar and the rooms.",
};

/**
 * Where each view lands. Picking a tile goes straight here; so does a signed-in
 * hit on `/`. Adam, 2026-08-25: the lobby is the club's front door — players
 * and parents land there; admins land on the overview. A TEAM-SCOPED parent or
 * player pick overrides this and goes to that team's page (see `setRoleView`).
 */
export const ROLE_VIEW_HOME: Record<RoleView, string> = {
  me: "/lobby",
  player: "/lobby",
  parent: "/lobby",
  coach: "/teams",
  // The referees group IS the referee's screen (Adam, 2026-08-25) — the games
  // are posted there and claimed there. /referee resolves it and goes.
  referee: "/referee",
  admin: "/overview",
  function_room: "/room-bookings",
};

export function isRoleView(value: string | null | undefined): value is RoleView {
  return !!value && (ROLE_VIEWS as readonly string[]).includes(value);
}

/** A team one of the caller's hats applies to, as `my_capabilities()` names it. */
export type TeamRef = {
  id: string;
  name: string;
  /** parent_teams only: which of the caller's children the hat is for. */
  children?: string[];
};

export type Capabilities = {
  personId: string | null;
  /** `profiles.role` — the legacy app role the existing pages are gated on. */
  appRole: UserRole;
  isSuperUser: boolean;
  isCommittee: boolean;
  isStaff: boolean;
  isBarManager: boolean;
  /** `person_roles` answers, not `profiles.role`. */
  isClubAdmin: boolean;
  isSafeguardingLead: boolean;
  hasCoachRole: boolean;
  hasParentRole: boolean;
  /** `person_roles.referee` — an approved referee, who may claim a game. */
  hasRefereeRole: boolean;
  /** coach / assistant_coach / manager on any team. */
  isTeamStaff: boolean;
  /** A live `player` team membership. */
  hasPlayerMembership: boolean;
  /** A live guardianship over at least one child. */
  isGuardian: boolean;
  hasWaitingListAccess: boolean;
  /** The teams behind each hat, for the role-switcher's team-scoped options. */
  staffTeams: TeamRef[];
  playerTeams: TeamRef[];
  parentTeams: TeamRef[];
};

/**
 * Does the person actually hold what the view claims?
 *
 * Unlike the earlier draft of this module, a `false` here is final: the view is
 * not offered, not selectable, and not honoured if a stale cookie names it.
 */
export function qualifiesForView(view: RoleView, c: Capabilities): boolean {
  switch (view) {
    case "me":
      // Not a hat: anyone the club has linked to a person record is somebody.
      // An unlinked sign-in still gets the navForUnlinked() menu instead.
      return c.personId !== null;
    case "player":
      return c.hasPlayerMembership;
    case "parent":
      return c.isGuardian || c.hasParentRole;
    case "coach":
      return c.isTeamStaff || c.hasCoachRole;
    case "referee":
      return c.hasRefereeRole;
    case "admin":
      return c.isClubAdmin || c.isCommittee;
    case "function_room":
      return c.isStaff || c.isBarManager;
  }
}

/**
 * Precedence when nothing has been chosen, or when a cookie names a view the
 * person does not hold: ME first (Adam, 2026-08-25 — the Me view is the
 * default when you log in, and the lobby is its main page; the switcher is
 * where the wider hats live). The hat order after it only matters for someone
 * with no person record of their own — function-room staff keep their diary as
 * the fallback when they hold no club hat. Distinct from {@link ROLE_VIEWS},
 * which is the order the tiles are drawn in.
 */
const VIEW_PRECEDENCE = [
  "me",
  "parent",
  "player",
  "coach",
  "referee",
  "admin",
  "function_room",
] as const;

/** Every view this person holds, in tile order. */
export function qualifiedViews(c: Capabilities): RoleView[] {
  return ROLE_VIEWS.filter((view) => qualifiesForView(view, c));
}

/**
 * What to show someone who has not chosen, or whose choice no longer stands.
 * Null means the account is not linked to anything the club recognises yet.
 */
export function defaultRoleView(c: Capabilities): RoleView | null {
  for (const view of VIEW_PRECEDENCE) {
    if (qualifiesForView(view, c)) return view;
  }
  return null;
}

/**
 * The view to render for a stored preference: the stored one when it still
 * stands, otherwise the widest one they do hold. Never a view they do not.
 */
export function resolveRoleView(stored: RoleView | null, c: Capabilities): RoleView | null {
  if (stored && qualifiesForView(stored, c)) return stored;
  return defaultRoleView(c);
}

// ---------------------------------------------------------------------------
// The "Viewing as" dropdown — role–team combinations (Adam, 2026-08-25)
// ---------------------------------------------------------------------------

/** One line of the dropdown. `value` round-trips through the switcher action. */
export type RoleViewOption = {
  view: RoleView;
  teamId: string | null;
  label: string;
  value: string;
  /** The two lines the design's panel draws: "Coach" over "U14 Mavericks". */
  role: string;
  scope: string;
};

/** The design's short role words — "Club admin", not "Club admin view". */
const ROLE_WORDS: Record<RoleView, string> = {
  me: "Me",
  player: "Player",
  parent: "Parent",
  coach: "Coach",
  referee: "Referee",
  admin: "Club admin",
  function_room: "Function room",
};

export function serializeViewOption(view: RoleView, teamId: string | null): string {
  return teamId ? `${view}:${teamId}` : view;
}

export function parseViewOption(value: string): { view: RoleView; teamId: string | null } | null {
  const [view, teamId] = value.split(":", 2);
  if (!isRoleView(view)) return null;
  return { view, teamId: teamId || null };
}

/** The team list a view's scope must come from. Empty for admin/function_room. */
export function teamsForView(view: RoleView, c: Capabilities): TeamRef[] {
  switch (view) {
    case "coach":
      return c.staffTeams;
    case "parent":
      return c.parentTeams;
    case "player":
      return c.playerTeams;
    default:
      return [];
  }
}

/**
 * Every line of the dropdown, in the order Adam described: the club-wide hats
 * first, then the team-scoped ones grouped BY TEAM (Coach – Mavericks,
 * Parent – Mavericks, Coach – Cobras, Parent – Cobras), so a person thinks
 * "which team am I dealing with" rather than "which of my roles". A hat whose
 * view is qualified but has no team yet falls back to its plain label.
 */
export function roleViewOptions(c: Capabilities): RoleViewOption[] {
  const options: RoleViewOption[] = [];
  const add = (view: RoleView, team: TeamRef | null, label: string) =>
    options.push({
      view,
      teamId: team?.id ?? null,
      label,
      value: serializeViewOption(view, team?.id ?? null),
      role: ROLE_WORDS[view],
      scope:
        team?.name ??
        (view === "function_room"
          ? "The room and the bar"
          : view === "me"
            ? "Just you"
            : view === "referee"
              ? "Games to referee"
              : "Whole club"),
    });

  // The person themselves first — the default view, and the way back to it
  // from any hat. Function Room goes LAST (Adam, 2026-08-25: "Function Room
  // should always be at the bottom of the dropdown") — see the end.
  if (qualifiesForView("me", c)) add("me", null, "Me");
  if (qualifiesForView("admin", c)) add("admin", null, "Club Admin");
  // The referee hat is club-wide and has no team scope: the games come to
  // them in the group, from every team.
  if (qualifiesForView("referee", c)) add("referee", null, "Referee");

  // Group by team: every team any hat touches, alphabetically, with the hats
  // for that team in coach → parent → player order.
  const teamNames = new Map<string, string>();
  for (const team of [...c.staffTeams, ...c.parentTeams, ...c.playerTeams]) {
    teamNames.set(team.id, team.name);
  }
  const byName = Array.from(teamNames.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const staffIds = new Set(c.staffTeams.map((team) => team.id));
  const parentIds = new Set(c.parentTeams.map((team) => team.id));
  const playerIds = new Set(c.playerTeams.map((team) => team.id));

  for (const [id, name] of byName) {
    if (qualifiesForView("coach", c) && staffIds.has(id)) add("coach", { id, name }, `Coach – ${name}`);
    if (qualifiesForView("parent", c) && parentIds.has(id)) add("parent", { id, name }, `Parent – ${name}`);
    if (qualifiesForView("player", c) && playerIds.has(id)) add("player", { id, name }, `Player – ${name}`);
  }

  // Qualified hats with no team to pin to yet keep their coarse entry.
  if (qualifiesForView("coach", c) && c.staffTeams.length === 0) add("coach", null, ROLE_VIEW_LABELS.coach);
  if (qualifiesForView("parent", c) && c.parentTeams.length === 0) add("parent", null, ROLE_VIEW_LABELS.parent);
  if (qualifiesForView("player", c) && c.playerTeams.length === 0) add("player", null, ROLE_VIEW_LABELS.player);

  // The room is not a club hat — it props up the bottom of the list.
  if (qualifiesForView("function_room", c)) add("function_room", null, "Function Room");

  return options;
}

/**
 * The props the sidebar hands to `<RoleSwitcher/>`, computed in one place so
 * the layout stays a consumer. `current` falls back to the plain view when the
 * stored team no longer matches a held option (child moved teams, coach role
 * ended) — never to an option the person does not hold.
 */
export function roleSwitcherProps(
  c: Capabilities,
  view: RoleView,
  teamScope: string | null,
): {
  options: { value: string; label: string; role: string; scope: string }[];
  current: string;
} {
  const options = roleViewOptions(c);
  const scoped = serializeViewOption(view, teamScope);
  const current = options.some((option) => option.value === scoped)
    ? scoped
    : options.find((option) => option.view === view)?.value ?? serializeViewOption(view, null);
  return {
    options: options.map(({ value, label, role, scope }) => ({ value, label, role, scope })),
    current,
  };
}

/**
 * What the switcher's live region says while a pick is on its way to the
 * server.
 *
 * Adam, 2026-09-01: the panel now confirms and closes itself, which means
 * there is a moment between the tap and the new view arriving. On screen that
 * moment is a greyed row with a spinner; to a screen reader it was nothing at
 * all, so it gets words. `stalled` is the refusal case — `setRoleView` writes
 * nothing and redirects nowhere when the database no longer backs the view, so
 * there is no answer coming and "one moment" would be a lie.
 */
export function roleSwitchAnnouncement(pendingLabel: string | null, stalled: boolean): string {
  if (!pendingLabel) return "";
  if (stalled) {
    return "That is taking longer than it should. Try again, or close this and check the role at the top of the screen.";
  }
  return `Switching to ${pendingLabel}. One moment.`;
}
