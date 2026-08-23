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
 *   · The chosen VIEW — which of the club's five kinds of user this person is
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
/** Set once by the middleware so the first-visit nudge to /welcome happens once. */
export const ROLE_VIEW_PROMPTED_COOKIE = "club.role_view_prompted";

/** The five kinds of user the club recognises, in tile order. */
export const ROLE_VIEWS = ["player", "parent", "coach", "admin", "function_room"] as const;
export type RoleView = (typeof ROLE_VIEWS)[number];

export const ROLE_VIEW_LABELS: Record<RoleView, string> = {
  player: "Player",
  parent: "Parent or guardian",
  coach: "Coach or manager",
  admin: "Club admin",
  function_room: "Function room",
};

export const ROLE_VIEW_BLURBS: Record<RoleView, string> = {
  player: "Your teams and when you are playing.",
  parent: "Your children, their teams and their fixtures.",
  coach: "Your teams, pitch bookings and the waiting list.",
  admin: "Running the club — people, teams, approvals and money.",
  function_room: "The function room diary, the bar and the rooms.",
};

/**
 * Where each view lands. Picking a tile goes straight here; so does a signed-in
 * hit on `/`.
 */
export const ROLE_VIEW_HOME: Record<RoleView, string> = {
  player: "/my-teams",
  parent: "/family",
  coach: "/teams",
  admin: "/teams",
  function_room: "/room-bookings",
};

export function isRoleView(value: string | null | undefined): value is RoleView {
  return !!value && (ROLE_VIEWS as readonly string[]).includes(value);
}

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
  /** coach / assistant_coach / manager on any team. */
  isTeamStaff: boolean;
  /** A live `player` team membership. */
  hasPlayerMembership: boolean;
  /** A live guardianship over at least one child. */
  isGuardian: boolean;
  hasWaitingListAccess: boolean;
};

/**
 * Does the person actually hold what the view claims?
 *
 * Unlike the earlier draft of this module, a `false` here is final: the view is
 * not offered, not selectable, and not honoured if a stale cookie names it.
 */
export function qualifiesForView(view: RoleView, c: Capabilities): boolean {
  switch (view) {
    case "player":
      return c.hasPlayerMembership;
    case "parent":
      return c.isGuardian || c.hasParentRole;
    case "coach":
      return c.isTeamStaff || c.hasCoachRole;
    case "admin":
      return c.isClubAdmin || c.isCommittee;
    case "function_room":
      return c.isStaff || c.isBarManager;
  }
}

/**
 * Precedence when nothing has been chosen, or when a cookie names a view the
 * person does not hold: the widest hat first. Distinct from {@link ROLE_VIEWS},
 * which is the order the tiles are drawn in.
 */
const VIEW_PRECEDENCE = ["admin", "function_room", "coach", "parent", "player"] as const;

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
