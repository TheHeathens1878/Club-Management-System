import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CalendarPlus, LineChart } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { londonToday } from "@/lib/booking-time";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";
import {
  sessionNextAction,
  trainingWeekDays,
  trainingWeekRows,
  type TrainingWeekSession,
  type TrainingWeekTeam,
} from "@/lib/training-week";

import { TrainingGrid } from "./training-grid";
import { loadMarkedSessions, type SessionMeta } from "./training-reads";

/**
 * `/training` — the week, for somebody standing on a pitch with a phone.
 *
 *   1. THE BAR — the session the coach is about to take, in a sentence
 *      ("Tonight 18:00 · U14 Mavericks · Banky Lane 1 · 11 of 14 coming"), and
 *      the one button that does it: **Take the register**, in a sheet, here.
 *      It used to be two navigations away.
 *   2. THE WEEK — a row per team, a column per day for the next seven, every
 *      session on its card with its hour, its pitch, who is coming and whether
 *      the register has been taken. An empty evening's `+` books a pitch with
 *      the team and the date already in it.
 *   3. FOLDED BENEATH — attendance this term, which is a report, not a job.
 *
 * `training_sessions()` scopes itself to the teams this caller staffs (or all
 * of them, for an administrator), and the chosen hat narrows it again exactly
 * as Matches does. The register gate is the one `/pitches/[bookingId]` applies
 * — `(staff || admin) && !isMemberView(view)` — computed here and passed in, so
 * a parent who is also a coach gets a week without registers while the parent
 * hat is on.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Training" };

const DAY_MS = 86_400_000;

export default async function TrainingPage() {
  const capabilities = await getCapabilities();
  if (!capabilities.isTeamStaff && !capabilities.isClubAdmin && !capabilities.isCommittee) {
    redirect("/events");
  }

  // The chosen hat scopes the page, exactly as Matches does (Adam,
  // 2026-08-25): coach view → the coach's own teams, narrowed further by a
  // team-scoped switcher pick.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const coachTeamIds =
    view === "coach" ? new Set(capabilities.staffTeams.map((team) => team.id)) : null;
  const inView = (teamId: string): boolean =>
    scope ? teamId === scope.id : coachTeamIds ? coachTeamIds.has(teamId) : true;

  const supabase = await createClient();
  const now = Date.now();
  const [sessionsResult, termResult, teamsResult] = await Promise.all([
    supabase.rpc("training_sessions", {
      p_from: new Date(now - DAY_MS).toISOString(),
      p_to: new Date(now + 7 * DAY_MS).toISOString(),
    }),
    supabase.rpc("training_attendance_term"),
    supabase.from("teams").select("id,name,age_group").eq("active", true).order("name"),
  ]);
  const sessions = (sessionsResult.data ?? []).filter((row) => inView(row.team_id));
  const term = (termResult.data ?? []).filter((row) => row.marked > 0 && inView(row.team_id));

  // Who may mark a register at all. `loadSessionRegister` asks the database
  // the same question again per booking when a sheet opens; this decides which
  // door the grid draws.
  const canMark = (capabilities.isTeamStaff || capabilities.isClubAdmin) && !isMemberView(view);

  // Has anybody been marked yet? `training_sessions()` carries no such flag,
  // so the whole week's answer comes back in one query beside it.
  const marked = await loadMarkedSessions(sessions.map((row) => row.booking_id));

  const weekSessions: TrainingWeekSession[] = sessions.map((row) => ({
    bookingId: row.booking_id,
    eventId: row.event_id,
    teamId: row.team_id,
    teamName: row.team_name,
    startsAt: row.starts_at,
    pitchName: row.pitch_name,
    status: row.status,
    accepted: row.accepted,
    declined: row.declined,
    squad: row.squad,
    marked: marked.has(row.booking_id),
  }));

  // The rows: every team with a session this week, plus the coach's own teams
  // whether or not they train — an empty row is where "when could we train?"
  // gets answered.
  const staffTeamIds = new Set(capabilities.staffTeams.map((team) => team.id));
  const playing = new Set(weekSessions.map((session) => session.teamId));
  const teams: TrainingWeekTeam[] = (teamsResult.data ?? [])
    .filter((team) => inView(team.id) && (playing.has(team.id) || staffTeamIds.has(team.id)))
    .map((team) => ({ id: team.id, name: team.name, ageGroup: team.age_group }));

  const today = londonToday();
  const days = trainingWeekDays(today);
  const rows = trainingWeekRows(weekSessions, teams, days);
  const next = sessionNextAction(weekSessions, today);
  const meta: Record<string, SessionMeta> = Object.fromEntries(
    sessions.map((row) => [row.booking_id, { bookedBy: row.booked_by, status: row.status }]),
  );

  const average =
    term.length === 0
      ? null
      : Math.round(
          (term.reduce((sum, row) => sum + row.there, 0) /
            term.reduce((sum, row) => sum + row.marked, 0)) *
            100,
        );
  const termSummary =
    term.length === 0
      ? "No registers taken yet this season"
      : `${term.length} team${term.length === 1 ? "" : "s"} · ${average}% average`;

  return (
    <>
      <PageHeader
        title="Training"
        subtitle={`${weekSessions.length} session${weekSessions.length === 1 ? "" : "s"} in the next seven days`}
        action={
          <span className="flex gap-2">
            <Link href="/pitches/book" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Book a pitch
            </Link>
            <Link href="/events/new" className={buttonVariants({ size: "sm" })}>
              New session
            </Link>
          </span>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {sessionsResult.error ? (
          <Callout tone="danger" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
            Could not load the sessions: {sessionsResult.error.message}
          </Callout>
        ) : null}

        <TrainingGrid
          rows={rows}
          days={days}
          today={today}
          next={next}
          meta={meta}
          canMark={canMark}
        />

        <div className="space-y-2 pt-2">
          <FoldCard
            icon={<LineChart className="h-4 w-4" aria-hidden />}
            title="Attendance this term"
            summary={termSummary}
          >
            <div className="space-y-4">
              {term.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No registers taken yet this season — a session&apos;s card is where they start.
                </p>
              ) : (
                term.map((row) => {
                  const pct = Math.round((row.there / row.marked) * 100);
                  const tone =
                    pct >= 75 ? "bg-success" : pct >= 55 ? "bg-warning" : "bg-destructive";
                  return (
                    <div key={row.team_id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{row.team_name}</span>
                        <span className="font-semibold">{pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
              <p className="text-xs text-muted-foreground">
                Of everyone marked on a register this season, the share who were there (arriving
                late still counts as trained).
              </p>
            </div>
          </FoldCard>
        </div>
      </div>
    </>
  );
}
