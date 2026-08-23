import type { Enums } from "@club/db";

/**
 * Pure shaping for the "My club" screen. Kept free of React Native imports so
 * it can be unit-tested with vitest (lib/club.test.ts); the screen itself only
 * fetches and renders.
 */

/** `people` columns the screen selects through `profiles.person_id`. */
export interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
}

/** `profiles` row joined to its person. */
export interface ProfileRow {
  id: string;
  person_id: string;
  full_name: string | null;
  role: Enums<"user_role">;
  people: PersonRow | null;
}

/** `team_memberships` row joined to its team and season. */
export interface MembershipRow {
  id: string;
  role: Enums<"team_role">;
  shirt_number: number | null;
  joined_at: string;
  left_at: string | null;
  teams: { id: string; name: string; age_group: string | null } | null;
  seasons: { id: string; name: string; is_current: boolean } | null;
}

export interface TeamMembership {
  id: string;
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  seasonName: string | null;
  isCurrentSeason: boolean;
  role: Enums<"team_role">;
  shirtNumber: number | null;
}

const TEAM_ROLE_LABELS: Record<Enums<"team_role">, string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Manager",
};

export function teamRoleLabel(role: Enums<"team_role">): string {
  return TEAM_ROLE_LABELS[role] ?? role;
}

/**
 * What to call the signed-in person. Prefers the name they chose, falls back
 * through their legal name to the profile's free-text full_name.
 */
export function personDisplayName(profile: ProfileRow | null): string {
  const person = profile?.people;
  if (person) {
    const preferred = person.preferred_name?.trim();
    if (preferred) return preferred;
    const full = `${person.first_name} ${person.last_name}`.trim();
    if (full) return full;
  }
  const fromProfile = profile?.full_name?.trim();
  if (fromProfile) return fromProfile;
  return "Member";
}

/** A membership is live while it has not been ended. */
export function isLiveMembership(row: MembershipRow): boolean {
  return row.left_at === null;
}

/**
 * Live memberships only, current season first, then team name. Rows whose team
 * is not readable (RLS hid it, or it was deleted) are dropped rather than
 * rendered as a blank card.
 */
export function toTeamMemberships(rows: MembershipRow[]): TeamMembership[] {
  return rows
    .filter(isLiveMembership)
    .flatMap<TeamMembership>((row) => {
      const team = row.teams;
      if (!team) return [];
      return [
        {
          id: row.id,
          teamId: team.id,
          teamName: team.name,
          ageGroup: team.age_group,
          seasonName: row.seasons?.name ?? null,
          isCurrentSeason: row.seasons?.is_current ?? false,
          role: row.role,
          shirtNumber: row.shirt_number,
        },
      ];
    })
    .sort((a, b) => {
      if (a.isCurrentSeason !== b.isCurrentSeason) {
        return a.isCurrentSeason ? -1 : 1;
      }
      return a.teamName.localeCompare(b.teamName, "en-GB");
    });
}

/** Secondary line on a team card, e.g. "Player · #9 · 2026/27". */
export function describeMembership(membership: TeamMembership): string {
  const parts = [teamRoleLabel(membership.role)];
  if (membership.shirtNumber !== null) parts.push(`#${membership.shirtNumber}`);
  if (membership.seasonName) parts.push(membership.seasonName);
  return parts.join(" · ");
}

/** Turns a Supabase auth error into copy a club member can act on. */
export function authErrorMessage(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  const lowered = message.toLowerCase();

  if (lowered.includes("invalid login credentials")) {
    return "That email and password did not match. Try again, or use a magic link instead.";
  }
  if (lowered.includes("email not confirmed")) {
    return "Confirm your email address first — check your inbox for the link we sent.";
  }
  if (lowered.includes("signups not allowed") || lowered.includes("signup is disabled")) {
    return "Accounts are created by the club. Ask a club admin to invite you.";
  }
  if (lowered.includes("for security purposes") || lowered.includes("rate limit")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (lowered.includes("token has expired") || lowered.includes("expired")) {
    return "That link or code has expired. Request a new one.";
  }
  if (lowered.includes("network") || lowered.includes("fetch")) {
    return "No connection. Check your signal and try again.";
  }
  return message || "Something went wrong. Try again.";
}

/** Basic client-side email check; the server is still the authority. */
export function isProbablyEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Magic-link emails also carry a 6-digit code as a fallback to the deep link. */
export function normaliseOtpToken(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
