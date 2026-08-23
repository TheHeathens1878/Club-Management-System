/**
 * "Which hat am I wearing?" — the vocabulary of the first-login role tiles
 * (gap 4) and of the nav that follows from them.
 *
 * Two separate questions live in this pair of modules and they must not be
 * confused:
 *
 *   · CAPABILITIES — what the database will actually let this person do. Every
 *     one of them is the database's own answer, read through the user-scoped
 *     client under RLS (see `@/lib/capabilities`). Nothing in the nav may be
 *     shown unless the matching capability is true, whatever view was chosen.
 *   · The chosen VIEW — a presentation preference kept in the `club.role_view`
 *     cookie. It only ever *narrows* what is shown. Choosing "Club admin"
 *     grants nothing; it asks for the admin grouping, and the layout puts an
 *     "ask to be approved" banner over the top when the capabilities do not
 *     back the choice.
 *
 * No schema change: the preference is a cookie, as gap 4 specifies. This
 * module is deliberately free of server-only imports so the client-side tiles
 * can share the cookie name and the labels.
 */

import type { UserRole } from "@/lib/types";

export const ROLE_VIEW_COOKIE = "club.role_view";
/** Set once by the middleware so the first-visit nudge to /welcome happens once. */
export const ROLE_VIEW_PROMPTED_COOKIE = "club.role_view_prompted";

export const ROLE_VIEWS = ["player", "parent", "coach", "admin"] as const;
export type RoleView = (typeof ROLE_VIEWS)[number];

export const ROLE_VIEW_LABELS: Record<RoleView, string> = {
  player: "Player",
  parent: "Parent or guardian",
  coach: "Coach or manager",
  admin: "Club admin",
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
 * A view the person does not qualify for is still selectable — they may be
 * waiting on an approval — but the layout says so, and the capability gates
 * still hide every item they have no right to.
 */
export function qualifiesForView(view: RoleView, c: Capabilities): boolean {
  switch (view) {
    case "player":
      return c.hasPlayerMembership;
    case "parent":
      return c.isGuardian || c.hasParentRole;
    case "coach":
      return c.isTeamStaff || c.hasCoachRole || c.isCommittee;
    case "admin":
      return c.isClubAdmin || c.isCommittee;
  }
}

/** What to show someone who has never chosen: the widest view they qualify for. */
export function defaultRoleView(c: Capabilities): RoleView {
  if (qualifiesForView("admin", c)) return "admin";
  if (qualifiesForView("coach", c)) return "coach";
  if (qualifiesForView("parent", c)) return "parent";
  return "player";
}
