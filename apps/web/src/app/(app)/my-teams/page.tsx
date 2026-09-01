import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Shirt, Users } from "lucide-react";

import type { Database, Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { getCurrentPersonId } from "@/lib/person";
import { loadPitchCalendar, todayForCalendar } from "@/lib/pitch-calendar-data";
import {
  dayHeadingLong,
  entryTouchesTeams,
  type CalendarEntry,
} from "@/lib/pitch-calendar";
import { createClient } from "@/lib/supabase/server";

/**
 * "My teams" — the player's own screen, and the parent's shortcut to the same
 * thing for a child.
 *
 * The scope is the point. A young player needs to see the teams they are
 * attached to and when those teams are next out, and nothing else: no squad
 * lists, no other age groups, no club diary. Everything here is therefore
 * keyed on the caller's own `current_person_id()` and, when they guard
 * children, on `my_children()` — both of which the database answers, not this
 * page.
 *
 *   · `team_memberships_self_read` returns the caller's own rows;
 *     `team_memberships_guardian_read` returns their children's. There is no
 *     read here that a non-guardian could widen.
 *   · The fixtures come from `pitch_calendar()` — SECURITY DEFINER, gated on
 *     `can_view_pitch_calendar()`, carrying no booker PII — and are then
 *     narrowed to the teams above, so a parent sees their child's Saturday
 *     rather than the club's.
 *
 * No date of birth is rendered. A child who is a minor gets a badge saying so,
 * which is the only fact this screen needs from their DOB.
 */

export const dynamic = "force-dynamic";

/** How far ahead "next up" looks. */
const UPCOMING_DAYS = 30;
const UPCOMING_LIMIT = 5;

type TeamRole = Database["public"]["Enums"]["team_role"];

const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Team manager",
};

function teamRoleLabel(role: string): string {
  return role in TEAM_ROLE_LABELS ? TEAM_ROLE_LABELS[role as TeamRole] : role;
}

type MembershipRow = {
  team_id: string;
  role: TeamRole;
  shirt_number: number | null;
};

type TeamLine = {
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  role: string;
  shirtNumber: number | null;
};

type Subject = {
  personId: string;
  name: string;
  /** null for the signed-in person; the relationship for a guarded child. */
  relationship: string | null;
  isMinor: boolean;
  teams: TeamLine[];
};

/** `my_children().teams` is jsonb built by the function; read it defensively. */
function parseChildTeams(value: Json | null | undefined): { team_id: string; team_name: string; role: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { team_id: string; team_name: string; role: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json | undefined>;
    const id = record["team_id"];
    const name = record["team_name"];
    const role = record["role"];
    if (typeof id !== "string" || typeof name !== "string") continue;
    out.push({ team_id: id, team_name: name, role: typeof role === "string" ? role : "player" });
  }
  return out;
}

export default async function MyTeamsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const personId = await getCurrentPersonId();

  const [childrenResult, ownResult] = await Promise.all([
    supabase.rpc("my_children"),
    personId
      ? supabase
          .from("team_memberships")
          .select("team_id,role,shirt_number")
          .eq("person_id", personId)
          .is("left_at", null)
      : Promise.resolve({ data: [] as MembershipRow[], error: null }),
  ]);

  const children = childrenResult.data ?? [];
  const childIds = children.map((child) => child.person_id);

  // The children's own membership rows, for the shirt number `my_children()`
  // does not carry. `team_memberships_guardian_read` is what returns them.
  const childMemberships = new Map<string, MembershipRow[]>();
  if (childIds.length > 0) {
    const { data } = await supabase
      .from("team_memberships")
      .select("person_id,team_id,role,shirt_number")
      .in("person_id", childIds)
      .is("left_at", null);
    for (const row of data ?? []) {
      const list = childMemberships.get(row.person_id);
      const membership: MembershipRow = {
        team_id: row.team_id,
        role: row.role,
        shirt_number: row.shirt_number,
      };
      if (list) list.push(membership);
      else childMemberships.set(row.person_id, [membership]);
    }
  }

  // Names for every team involved. `teams_read` is `using (true)` for
  // authenticated, so this resolves without widening anything.
  const wantedTeamIds = new Set<string>();
  for (const row of ownResult.data ?? []) wantedTeamIds.add(row.team_id);
  for (const list of childMemberships.values()) {
    for (const row of list) wantedTeamIds.add(row.team_id);
  }
  for (const child of children) {
    for (const team of parseChildTeams(child.teams)) wantedTeamIds.add(team.team_id);
  }

  const teamNames = new Map<string, { name: string; ageGroup: string | null }>();
  if (wantedTeamIds.size > 0) {
    const { data } = await supabase
      .from("teams")
      .select("id,name,age_group")
      .in("id", Array.from(wantedTeamIds));
    for (const row of data ?? []) {
      teamNames.set(row.id, { name: row.name, ageGroup: row.age_group });
    }
  }

  function toLines(rows: MembershipRow[], fallbackNames?: Map<string, string>): TeamLine[] {
    return rows
      .map((row) => {
        const team = teamNames.get(row.team_id);
        return {
          teamId: row.team_id,
          teamName: team?.name ?? fallbackNames?.get(row.team_id) ?? "Team",
          ageGroup: team?.ageGroup ?? null,
          role: row.role,
          shirtNumber: row.shirt_number,
        } satisfies TeamLine;
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }

  const subjects: Subject[] = [];

  const ownTeams = toLines((ownResult.data ?? []) as MembershipRow[]);
  if (personId && ownTeams.length > 0) {
    subjects.push({
      personId,
      name: session.profile?.full_name || "You",
      relationship: null,
      isMinor: false,
      teams: ownTeams,
    });
  }

  for (const child of children) {
    const rows = childMemberships.get(child.person_id) ?? [];
    const fromRpc = parseChildTeams(child.teams);
    const fallback = new Map(fromRpc.map((team) => [team.team_id, team.team_name] as const));
    // `my_children()` is the authority on which teams a child is in; the
    // membership rows only fill in the shirt number, and a team the rows do
    // not cover still appears.
    const byTeam = new Map(rows.map((row) => [row.team_id, row] as const));
    const merged: MembershipRow[] = fromRpc.map((team) => {
      const row = byTeam.get(team.team_id);
      return {
        team_id: team.team_id,
        role: (row?.role ?? team.role) as TeamRole,
        shirt_number: row?.shirt_number ?? null,
      };
    });
    subjects.push({
      personId: child.person_id,
      name: `${child.preferred_name || child.first_name} ${child.last_name}`.trim(),
      relationship: child.relationship,
      isMinor: child.is_minor,
      teams: toLines(merged, fallback),
    });
  }

  // "Viewing as Player – O45 Men" (or a parent's team pick) narrows the page
  // to that team; a stale scope silently widens back to everything.
  const capabilities = await getCapabilities();
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const scopedSubjects = scope
    ? subjects
        .map((subject) => ({
          ...subject,
          teams: subject.teams.filter((team) => team.teamId === scope.id),
        }))
        .filter((subject) => subject.teams.length > 0)
    : subjects;

  const myTeamIds = new Set(
    scopedSubjects.flatMap((subject) => subject.teams.map((team) => team.teamId)),
  );

  // Next up: the club's pitch diary, narrowed to exactly these teams.
  let upcoming: CalendarEntry[] = [];
  let calendarError: string | null = null;
  if (myTeamIds.size > 0) {
    const from = new Date();
    const to = new Date(from.getTime() + UPCOMING_DAYS * 86_400_000);
    const calendar = await loadPitchCalendar(from.toISOString(), to.toISOString());
    calendarError = calendar.error;
    upcoming = calendar.entries
      .filter((entry) => entryTouchesTeams(entry, myTeamIds))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, UPCOMING_LIMIT);
  }

  const today = todayForCalendar();

  return (
    <>
      <PageHeader
        title="My teams"
        subtitle="The teams you are attached to, and when they are next out"
        action={
          <Link
            href="/pitches/calendar"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <CalendarDays className="h-4 w-4" /> Pitch calendar
          </Link>
        }
      />

      <div className="space-y-6 p-4 lg:p-6">
        {childrenResult.error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {childrenResult.error.message}
          </p>
        ) : null}

        {scopedSubjects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No teams yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The club has not put you — or anyone you look after — in a squad yet. Once a team is
                recorded against your name it appears here, with its fixtures and training.
              </p>
              <p className="text-sm text-muted-foreground">
                Joining a team happens on the club&apos;s registration form, not in the app. If you
                think this is wrong, speak to the club.
              </p>
            </CardContent>
          </Card>
        ) : (
          scopedSubjects.map((subject) => (
            <Card key={subject.personId}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {subject.name}
                  {subject.relationship ? (
                    <Badge variant="outline">{subject.relationship}</Badge>
                  ) : null}
                  {subject.isMinor ? <Badge variant="muted">Minor</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {subject.teams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No team recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {subject.teams.map((team) => (
                      <li
                        key={`${subject.personId}-${team.teamId}`}
                        className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{team.teamName}</span>
                        {team.ageGroup ? (
                          <Badge variant="outline">{team.ageGroup}</Badge>
                        ) : null}
                        <Badge variant="muted">{teamRoleLabel(team.role)}</Badge>
                        {team.shirtNumber !== null ? (
                          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                            <Shirt className="h-3.5 w-3.5" /> No. {team.shirtNumber}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))
        )}

        {myTeamIds.size > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Next up{" "}
                <span className="font-normal text-muted-foreground">
                  · the next {UPCOMING_DAYS} days
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {calendarError ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {calendarError}
                </p>
              ) : null}

              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing booked for these teams in the next {UPCOMING_DAYS} days.
                </p>
              ) : (
                <ul className="space-y-2">
                  {upcoming.map((entry) => (
                    <li key={entry.bookingId}>
                      {/* One card on a phone — day and time, then what and
                          where underneath; the desktop line is unchanged
                          (`lg:contents` dissolves the mobile wrapper). */}
                      <Link
                        href={`/pitches/${entry.bookingId}`}
                        className="flex min-h-[44px] flex-col gap-1 rounded-md border bg-card px-3 py-2.5 text-sm transition hover:border-primary/40 hover:bg-secondary lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-2 lg:gap-y-1 lg:py-2"
                      >
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 lg:contents">
                          <span className="font-medium">
                            {entry.date === today ? "Today" : dayHeadingLong(entry.date)}
                          </span>
                          <span className="text-muted-foreground">
                            {entry.startTime}–{entry.endTime}
                          </span>
                          <span>{entry.label}</span>
                          {entry.teamName ? (
                            <Badge variant="outline">{entry.teamName}</Badge>
                          ) : null}
                          {entry.status === "pending" ? (
                            <Badge variant="warning">Asked for</Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground lg:ml-auto">
                          {entry.resourceName}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                href="/pitches/calendar"
                className="inline-flex min-h-[44px] items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground lg:min-h-0"
              >
                See the whole pitch calendar
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
