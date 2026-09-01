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

// ---------------------------------------------------------------------------
// Age bands — the one rule, stated once, computed from CALENDAR DATES
// ---------------------------------------------------------------------------
//
// THE RULE (Adam, 2026-08-26; the same arithmetic as
// `public.waiting_list_age_number()` and `public.fa_age_band()` in the
// database):
//
//   season year = the year the season STARTS. The club season runs 1 July to
//                 30 June (Adam, 2026-08-25), so a date in July–December is in
//                 the season of its own year and a date in January–June is in
//                 the season of the year before. Using 1 September here was
//                 the bug that classed a U14 as U13 all August.
//   cohort year = the year the player's FA birth cohort starts. The cohort
//                 cut-off is 31 August — a birthday on or after 1 September is
//                 in the cohort of its own year, one on or before 31 August is
//                 in the cohort of the year before. That is the FA's line, not
//                 the club's to move.
//   band        = season year − cohort year. Born 2014-09-01 → cohort 2014 →
//                 U12 for 2026/27. Born 2014-08-31 → cohort 2013 → U13.
//
// WHY EVERY FUNCTION BELOW TAKES A STRING (Adam, 2026-08-26: "be careful not
// to fall foul of UTC issues"). A date of birth is a CALENDAR DATE, not an
// instant. `new Date("2014-09-01")` is midnight UTC, which is 31 August in
// New York and 1 September in London — so `getMonth()` on it answers a
// different question depending on where the process happens to be running,
// and `getUTCMonth()` answers a different one again once somebody hands the
// function a Date built from a local timestamp. Subtracting two Dates to get
// an age is worse still: it is wrong by a day twice a year across a DST
// boundary. So: the band is derived from the yyyy-mm-dd STRING by integer
// arithmetic on its three fields, and "today" is likewise a yyyy-mm-dd string
// taken in Europe/London. No Date object appears in the calculation at all.

type DateParts = { year: number; month: number; day: number };

/** yyyy-mm-dd → its three fields, or null. Nothing is parsed as an instant. */
export function dateParts(value: string | null | undefined): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Today's calendar date in Europe/London, as yyyy-mm-dd.
 *
 * The club is in Cheshire and its season boundary is a local date; a server in
 * UTC (Vercel) and a browser anywhere else must agree about which day it is.
 * `en-CA` formats as yyyy-mm-dd, which is the whole reason it is used here.
 */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The season a calendar date belongs to, named by the year it starts. */
export function seasonStartYear(today: string = londonToday()): number | null {
  const parts = dateParts(today);
  if (!parts) return null;
  return parts.month >= 7 ? parts.year : parts.year - 1;
}

/**
 * The FA age band a date of birth falls into, as a plain number and NOT
 * clamped: 12 means U12, and 24 means an adult. Null when the date of birth is
 * not a calendar date the club can read.
 */
export function ageBandNumber(
  dob: string | null | undefined,
  today: string = londonToday(),
): number | null {
  const born = dateParts(dob);
  const seasonYear = seasonStartYear(today);
  if (!born || seasonYear === null) return null;
  const cohortYear = born.month >= 9 ? born.year : born.year - 1;
  return seasonYear - cohortYear;
}

/** "U12". Bands outside U05…U18 are clamped, as the waiting list has always. */
export function ageGroupFromDobString(
  dob: string | null | undefined,
  today: string = londonToday(),
): string | null {
  const n = ageBandNumber(dob, today);
  if (n === null) return null;
  if (n < 5) return "U05";
  if (n > 18) return "U18";
  return `U${String(n).padStart(2, "0")}`;
}

// There is deliberately no Date-shaped `ageGroupFromDob` any more. It took a
// Date and read `getMonth()` off it, which is the exact UTC trap described
// above; every caller now passes the yyyy-mm-dd string it already had.

/**
 * The band number a team's age group names — "U12" → 12, "U05" → 5 — and null
 * for anything that is not a U-band ("Open", "Senior", blank, unset). Exactly
 * `public.waiting_list_age_number()`'s regular expression, so the screen and
 * the database agree about what a team's age group means.
 */
export function teamAgeBandNumber(ageGroup: string | null | undefined): number | null {
  const match = /^U0*(\d{1,2})$/.exec((ageGroup ?? "").trim().toUpperCase());
  return match ? Number(match[1]) : null;
}

/**
 * The bands an age group NAMES, inclusive — because a team's age group is not
 * always one band. On production (checked 2026-08-26) nine of the club's 73
 * teams are not shaped like "U12":
 *
 *   "U05–U08"  U05 Wildcats — the club's only under-eights girls team
 *   "Open Age" six men's and women's open-age sides
 *   "Vets"     Vets O35 Women, Vets O45 Men's XI
 *
 * Reading only "U12" meant a five-year-old girl was offered no team at all.
 * A range may be written with a hyphen or an en dash, and may or may not
 * repeat the U — "U05–U08", "U05-U8", "U5 – U8" all mean the same thing.
 * Mirrors `public.age_group_band_range()`.
 */
export function teamAgeBandRange(
  ageGroup: string | null | undefined,
): { min: number; max: number } | null {
  const label = (ageGroup ?? "")
    .trim()
    .toUpperCase()
    // en dash, em dash, minus sign → hyphen, then close up the spaces
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s*-\s*/g, "-");
  if (!label) return null;

  const one = /^U0*(\d{1,2})$/.exec(label);
  if (one) return { min: Number(one[1]), max: Number(one[1]) };

  const span = /^U0*(\d{1,2})-U?0*(\d{1,2})$/.exec(label);
  if (span) {
    const a = Number(span[1]);
    const b = Number(span[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

/**
 * An age group that says, in words, that it is an adult side. Recognised
 * POSITIVELY: a blank or unrecognised label is not an adult team, it is a team
 * the club has not described, and a child must not be refused on the strength
 * of the club's silence. Mirrors `public.age_group_is_adult()`.
 */
export function ageGroupIsAdultTeam(ageGroup: string | null | undefined): boolean {
  const label = (ageGroup ?? "").trim().toUpperCase();
  if (!label) return false;
  return /(^|[^A-Z])(OPEN|SENIORS?|ADULTS?|VETS?|VETERANS?|O\d{2}|OVER[ -]?\d{2})([^A-Z]|$)/.test(
    label,
  );
}

/**
 * The bands a player may be registered into: their own, and the one ABOVE
 * (older) — Adam, 2026-08-26. Null when the date of birth is unknown, which
 * SG-0 treats as a minor the club cannot place.
 *
 * A player past U18 is an adult: no band applies and they belong in a team
 * whose age group is not a U-band at all ("Open", "Senior"). That case is
 * signalled by `youth: false`.
 */
export function eligibleAgeBands(
  dob: string | null | undefined,
  today: string = londonToday(),
): { youth: true; bands: [number, number] } | { youth: false } | null {
  const n = ageBandNumber(dob, today);
  if (n === null) return null;
  if (n > 18) return { youth: false };
  const own = Math.max(n, 5);
  return { youth: true, bands: [own, own + 1] };
}

/**
 * A player's sex as the club records it. Unknown is a real state — legacy
 * imports have no answer — and it is never quietly read as "male".
 */
export type PlayerSex = "male" | "female";

export function normalisePlayerSex(value: string | null | undefined): PlayerSex | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (trimmed === "male" || trimmed === "m" || trimmed === "boy") return "male";
  if (trimmed === "female" || trimmed === "f" || trimmed === "girl") return "female";
  return null;
}

/**
 * Adam, 2026-08-26: "Males cannot join female teams but females can join
 * males." So a girls' team admits a female player only; a boys' team and a
 * mixed team admit anyone. A team whose make-up the club has not recorded is
 * treated as mixed — that is what the column's absence means.
 *
 * An UNKNOWN player sex is refused a girls' team. That is the fail-closed
 * direction: the club cannot say the rule is satisfied, so it does not offer
 * the team.
 */
export function teamAdmitsSex(
  sex: PlayerSex | null,
  teamGender: string | null | undefined,
): boolean {
  const gender = (teamGender ?? "").trim().toLowerCase();
  if (gender === "girls" || gender === "female") return sex === "female";
  return true;
}

/** Age band and sex together — "may this player be offered this team?" */
export function teamOfferedToPlayer(
  team: { ageGroup: string | null; gender?: string | null },
  dob: string | null | undefined,
  sex: PlayerSex | null,
  today: string = londonToday(),
): boolean {
  if (!teamAdmitsSex(sex, team.gender)) return false;
  const eligible = eligibleAgeBands(dob, today);
  if (!eligible) return false;
  const range = teamAgeBandRange(team.ageGroup);
  // An adult belongs in a team that names no youth band at all.
  if (!eligible.youth) return range === null;
  // A youth belongs in a team whose age group covers their band or the one
  // above — a single band ("U12") or a range ("U05–U08"). A youth is NOT
  // offered a team whose age group the club has never recorded: the club has
  // not said what it is, and the screen would rather ask than guess.
  if (!range) return false;
  const covers = (n: number) => n >= range.min && n <= range.max;
  return covers(eligible.bands[0]) || covers(eligible.bands[1]);
}

/** "U12 or U13" — the sentence under a team picker that has been narrowed. */
export function eligibleBandsLabel(
  dob: string | null | undefined,
  today: string = londonToday(),
): string | null {
  const eligible = eligibleAgeBands(dob, today);
  if (!eligible) return null;
  if (!eligible.youth) return "an adult team";
  return eligible.bands.map((n) => `U${String(n).padStart(2, "0")}`).join(" or ");
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
