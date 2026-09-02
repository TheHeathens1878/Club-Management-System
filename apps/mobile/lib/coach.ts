import type { Enums } from "@club/db";

import { clubDateTime } from "./format";

/**
 * The coach's half of the app (Adam, 2026-09-02: "I would want the coach
 * built in").
 *
 * Pure shaping only — no React Native imports — so vitest can exercise it
 * (lib/coach.test.ts). Everything on screen comes from three existing
 * server-side answers, each already scoped to the caller by the database:
 *
 *   · `my_capabilities()`     — which teams this person is staff of;
 *   · `matchday_fixtures()`   — their teams' games with reply counts;
 *   · `event_people()`        — one game's squad sheet, refused to outsiders.
 *
 * NOTHING HERE IS A NEW PERMISSION. The kick-off write goes through the
 * caller's own client and `fixtures_staff_update` decides, exactly as the web
 * fixture page's editor does; the register writes what
 * `booking_attendance_staff_write` allows and nothing else.
 */

export interface StaffTeam {
  id: string;
  name: string;
}

/** `my_capabilities()` returns jsonb; read `staff_teams` defensively. */
export function parseStaffTeams(capabilities: unknown): StaffTeam[] {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
  const value = (capabilities as Record<string, unknown>)["staff_teams"];
  if (!Array.isArray(value)) return [];
  const out: StaffTeam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] !== "string" || typeof record["name"] !== "string") continue;
    out.push({ id: record["id"], name: record["name"] });
  }
  return out;
}

/** One row of `matchday_fixtures()`, as the database returns it. */
export interface MatchdayRow {
  fixture_id: string;
  event_id: string | null;
  team_id: string;
  team_name: string;
  opponent: string;
  is_home: boolean;
  competition: string | null;
  kickoff_at: string;
  status: string;
  pitch_name: string | null;
  venue_text: string | null;
  allocated: boolean;
  accepted: number;
  declined: number;
  squad: number;
}

export interface CoachFixture {
  id: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  /** "v Sale United (H)" */
  title: string;
  /** "Sat 6 Sep · 10:30" — London wall clock. */
  when: string;
  kickoffAt: string;
  /** The pitch once allocated, the away ground, or the honest "Pitch TBC". */
  where: string;
  /** "8 in · 2 out · 5 no answer" */
  replies: string;
  /** Squad members who have not answered — the coach's chase list. */
  quiet: number;
}

export function fixtureTitle(row: Pick<MatchdayRow, "opponent" | "is_home">): string {
  return `v ${row.opponent} (${row.is_home ? "H" : "A"})`;
}

export function whereLine(
  row: Pick<MatchdayRow, "is_home" | "allocated" | "pitch_name" | "venue_text">,
): string {
  if (row.is_home) return row.allocated && row.pitch_name ? row.pitch_name : "Pitch TBC";
  return row.venue_text || "Away — ground TBC";
}

export function repliesLine(accepted: number, declined: number, squad: number): string {
  const quiet = Math.max(squad - accepted - declined, 0);
  const parts = [`${accepted} in`, `${declined} out`];
  if (quiet > 0) parts.push(`${quiet} no answer`);
  return parts.join(" · ");
}

/**
 * The coach's upcoming games: THEIR teams only, soonest first. An
 * administrator's `matchday_fixtures()` answers for the whole club, so the
 * staffed-team filter here is what keeps the Coach tab the coach's — the same
 * narrowing the web matches desk does for the coach hat.
 */
export function toCoachFixtures(
  rows: MatchdayRow[],
  staffTeamIds: ReadonlySet<string>,
): CoachFixture[] {
  return rows
    .filter((row) => staffTeamIds.has(row.team_id) && row.status === "scheduled")
    .map<CoachFixture>((row) => ({
      id: row.fixture_id,
      eventId: row.event_id,
      teamId: row.team_id,
      teamName: row.team_name,
      title: fixtureTitle(row),
      when: clubDateTime(row.kickoff_at),
      kickoffAt: row.kickoff_at,
      where: whereLine(row),
      replies: repliesLine(row.accepted, row.declined, row.squad),
      quiet: Math.max(row.squad - row.accepted - row.declined, 0),
    }))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
}

/** One row of `event_people()` — the squad sheet the database will show us. */
export interface EventPersonRow {
  person_id: string;
  full_name: string;
  team_role: string;
  is_organiser: boolean;
  response: string | null;
  note: string | null;
  response_stale: boolean;
}

export interface SquadEntry {
  personId: string;
  name: string;
  note: string | null;
  /** The answer predates a kickoff/venue change — worth re-asking. */
  stale: boolean;
}

export interface SquadSheet {
  yes: SquadEntry[];
  no: SquadEntry[];
  quiet: SquadEntry[];
  organisers: string[];
}

/** Players into in/out/no-answer, organisers named separately. */
export function toSquadSheet(rows: EventPersonRow[]): SquadSheet {
  const sheet: SquadSheet = { yes: [], no: [], quiet: [], organisers: [] };
  for (const row of rows) {
    if (row.is_organiser) {
      sheet.organisers.push(row.full_name);
      continue;
    }
    const entry: SquadEntry = {
      personId: row.person_id,
      name: row.full_name,
      note: row.note,
      stale: row.response_stale,
    };
    if (row.response === "accepted") sheet.yes.push(entry);
    else if (row.response === "declined") sheet.no.push(entry);
    else sheet.quiet.push(entry);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// The training register.

export const ATTENDANCE_OPTIONS: readonly Enums<"attendance_status">[] = [
  "present",
  "late",
  "absent",
];

export const ATTENDANCE_LABELS: Record<Enums<"attendance_status">, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
};

export interface RegisterRow {
  personId: string;
  name: string;
  status: Enums<"attendance_status"> | null;
}

/**
 * The register: every player of the session's teams, alphabetical, with
 * whatever has already been marked. Coaches and any second team sharing the
 * slot are not on it — a register is of players.
 */
export function toRegister(
  members: { person_id: string; role: string }[],
  names: Map<string, string>,
  marks: Map<string, Enums<"attendance_status">>,
): RegisterRow[] {
  const seen = new Set<string>();
  const rows: RegisterRow[] = [];
  for (const member of members) {
    if (member.role !== "player" || seen.has(member.person_id)) continue;
    seen.add(member.person_id);
    rows.push({
      personId: member.person_id,
      name: names.get(member.person_id) ?? "Unnamed",
      status: marks.get(member.person_id) ?? null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
