/**
 * Shared vocabulary for `account_requests` (gap 4) — the self-registration
 * follow-up queue that replaces the Neon app's /admin/approvals.
 *
 * Nothing here authorises anything. The insert is guarded by
 * `account_requests_self_insert` (person_id must be the caller's own), and a
 * decision is only ever made by `approve_account_request()` /
 * `reject_account_request()`, which check `is_club_admin()` themselves.
 */

import type { Database } from "@club/db";

export type AccountRequestStatus = Database["public"]["Enums"]["account_request_status"];

export const REQUESTED_ROLES = [
  "player",
  "parent",
  "coach",
  "assistant_coach",
  "manager",
  "referee",
] as const;
export type RequestedRole = (typeof REQUESTED_ROLES)[number];

/** The roles a coach/manager tile may ask for — all of them need a team. */
export const TEAM_STAFF_REQUEST_ROLES = ["coach", "assistant_coach", "manager"] as const;

/**
 * The club-wide roles: no team, because they are not a team's. A referee takes
 * games from every team in the club — which is why the Referees group is
 * club-wide — and a parent is a parent of a person, not of a squad.
 */
export const CLUB_WIDE_REQUEST_ROLES = ["parent", "referee"] as const;

export const REQUESTED_ROLE_LABELS: Record<RequestedRole, string> = {
  player: "Player",
  parent: "Parent or guardian",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Team manager",
  referee: "Referee",
};

export const STATUS_LABELS: Record<AccountRequestStatus, string> = {
  pending: "Waiting for a decision",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

export function statusVariant(
  status: AccountRequestStatus,
): "default" | "success" | "warning" | "muted" | "destructive" {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "warning";
    case "rejected":
      return "destructive";
    case "withdrawn":
      return "muted";
  }
}

export function isRequestedRole(value: string | null | undefined): value is RequestedRole {
  return !!value && (REQUESTED_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: string): string {
  return isRequestedRole(role) ? REQUESTED_ROLE_LABELS[role] : role;
}

/** `parent` is the one role the table lets through without a team. */
export function requiresTeam(role: RequestedRole): boolean {
  return role !== "parent";
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
