/**
 * Waiting list vocabulary shared by the public form and the admin desk (P3.4).
 *
 * Pure data and pure functions only — this module is imported by client
 * components, so nothing here may reach for cookies, the service key or any
 * other server-only API.
 *
 * The age group / school year mapping and the season cut-off are carried over
 * from the pitch-booking app so an entry submitted before the cutover and one
 * submitted after land in the same cohort.
 */

import type { Database } from "@club/db";

export type WaitingListStatus = Database["public"]["Enums"]["waiting_list_status"];

/** Declaration order of the enum — Postgres sorts by it, so does the desk. */
export const WAITING_LIST_STATUSES: readonly WaitingListStatus[] = [
  "pending",
  "contacted",
  "trialling",
  "accepted",
  "rejected",
  "withdrawn",
  "uncontactable",
] as const;

/** The statuses the desk shows by default: someone still has work to do. */
export const ACTIVE_STATUSES: readonly WaitingListStatus[] = [
  "pending",
  "contacted",
  "trialling",
] as const;

export const STATUS_LABELS: Record<WaitingListStatus, string> = {
  pending: "Pending",
  contacted: "Contacted",
  trialling: "Trialling",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  uncontactable: "Uncontactable",
};

type BadgeVariant = "default" | "success" | "warning" | "muted" | "destructive" | "outline";

export function statusVariant(status: WaitingListStatus): BadgeVariant {
  switch (status) {
    case "pending":
      return "warning";
    case "contacted":
    case "trialling":
      return "default";
    case "accepted":
      return "success";
    case "rejected":
    case "uncontactable":
      return "destructive";
    case "withdrawn":
      return "muted";
  }
}

export function isWaitingListStatus(value: string): value is WaitingListStatus {
  return (WAITING_LIST_STATUSES as readonly string[]).includes(value);
}

export const SCHOOL_YEAR_TO_AGE_GROUP: Record<string, string> = {
  Reception: "U05",
  "Year 1": "U06",
  "Year 2": "U07",
  "Year 3": "U08",
  "Year 4": "U09",
  "Year 5": "U10",
  "Year 6": "U11",
  "Year 7": "U12",
  "Year 8": "U13",
  "Year 9": "U14",
  "Year 10": "U15",
  "Year 11": "U16",
  "Year 12": "U17",
  "Year 13": "U18",
};

export const SCHOOL_YEARS: readonly string[] = Object.keys(SCHOOL_YEAR_TO_AGE_GROUP);

export const AGE_GROUP_TO_SCHOOL_YEAR: Record<string, string> = Object.fromEntries(
  Object.entries(SCHOOL_YEAR_TO_AGE_GROUP).map(([year, group]) => [group, year]),
);

/**
 * The age group a date of birth falls into for the current season.
 *
 * Two different boundaries, deliberately:
 *
 *   · The CLUB SEASON runs 1 July to 30 June (Adam, 2026-08-25), so from
 *     1 July everyone is computed against the season about to be played —
 *     matching the summer rollover that bumps every team's age group. Using
 *     1 September here was the bug that classed a U14 as U13 all August.
 *   · The BIRTH COHORT cutoff stays 31 August — that is the FA's rule for
 *     which cohort a child belongs to, and it is not the club's to move.
 */
export function ageGroupFromDob(dob: Date, now: Date = new Date()): string {
  const seasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const cohortYear = dob.getMonth() >= 8 ? dob.getFullYear() : dob.getFullYear() - 1;
  const n = seasonYear - cohortYear;
  if (n < 5) return "U05";
  if (n > 18) return "U18";
  return `U${String(n).padStart(2, "0")}`;
}

/** Age groups sort U05 … U18 then anything else alphabetically. */
export function ageGroupSortKey(ageGroup: string): string {
  const digits = /^U(\d{1,2})$/.exec(ageGroup)?.[1];
  return digits ? `0${digits.padStart(2, "0")}` : `1${ageGroup}`;
}

/**
 * What the club says when no age group is ticked "open for new entries"
 * (Adam, 2026-08-25). One sentence, plainly — the public form, /recruitment
 * and the /join wizard all say exactly this, and none of them offers a
 * waiting list alongside it.
 *
 * `waiting_list_open_age_groups()` is the only source of truth for whether
 * that is the case. There is no separate "we run a waiting list" flag.
 */
export const NO_WAITING_LIST_MESSAGE = "We aren't operating a waiting list at the moment.";

/** The open age group names from `waiting_list_open_age_groups()`, U05 … U18. */
export function sortedOpenAgeGroups(
  rows: readonly { age_group: string }[] | null | undefined,
): string[] {
  const names = new Set<string>();
  for (const row of rows ?? []) {
    const name = row.age_group?.trim();
    if (name) names.add(name);
  }
  return Array.from(names).sort((a, b) => ageGroupSortKey(a).localeCompare(ageGroupSortKey(b)));
}

/** The desk's one-line answer to "which age groups are open?" */
export function openAgeGroupsSummary(open: readonly string[]): string {
  if (open.length === 0) {
    return `No age group is open for new entries, so the public pages say: ${NO_WAITING_LIST_MESSAGE}`;
  }
  return `Open for new entries: ${open.join(", ")}.`;
}

export const TEAM_PREFERENCE_LABELS: Record<string, string> = {
  MIXED: "Happy to play in a mixed team",
  GIRLS_ONLY: "Girls only team preferred",
};

/**
 * `submit_waiting_list_entry()` raises its refusals as
 * `waiting list: <reason>`. Show the reason, not the prefix.
 */
export function tidyRpcMessage(message: string): string {
  const stripped = message.replace(/^waiting list:\s*/i, "").trim();
  if (!stripped) return "Sorry, we could not save your details. Please try again.";
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
