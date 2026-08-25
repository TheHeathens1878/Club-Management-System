import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, ClipboardCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";

/**
 * Training — the week's sessions and the term's attendance (spec §2).
 * `training_sessions()` scopes exactly as Matches does; each row's register
 * is the booking's existing attendance sheet.
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
  const [sessionsResult, termResult] = await Promise.all([
    supabase.rpc("training_sessions", {
      p_from: new Date(now - DAY_MS).toISOString(),
      p_to: new Date(now + 7 * DAY_MS).toISOString(),
    }),
    supabase.rpc("training_attendance_term"),
  ]);
  const sessions = (sessionsResult.data ?? []).filter((row) => inView(row.team_id));
  const term = (termResult.data ?? []).filter((row) => row.marked > 0 && inView(row.team_id));

  return (
    <>
      <PageHeader
        title="Training"
        subtitle={`${sessions.length} session${sessions.length === 1 ? "" : "s"} in the next seven days`}
        action={
          <span className="flex gap-2">
            <Link href="/pitches/book" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <CalendarPlus className="h-4 w-4" /> Book a pitch
            </Link>
            <Link href="/events/new" className={buttonVariants({ size: "sm" })}>
              New session
            </Link>
          </span>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sessions this week</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sessionsResult.error ? (
              <p className="px-5 py-4 text-sm text-destructive">
                Could not load the sessions: {sessionsResult.error.message}
              </p>
            ) : sessions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No training booked for the next seven days — “Book a pitch” reserves one, “New
                session” creates one without a pitch.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">When</th>
                      <th className="px-4 py-2 font-medium">Team</th>
                      <th className="px-4 py-2 font-medium">Booked by</th>
                      <th className="px-4 py-2 font-medium">Where</th>
                      <th className="px-4 py-2 font-medium">Coming</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((row) => (
                      <tr key={row.booking_id} className="border-b last:border-b-0 hover:bg-secondary/40">
                        <td className="px-4 py-3 align-top text-muted-foreground">
                          <span className="font-semibold">{formatEventDate(row.starts_at)}</span>
                          <br />
                          {formatEventTime(row.starts_at)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={row.event_id ? `/events/${row.event_id}` : `/teams/${row.team_id}`}
                            className="font-semibold hover:underline"
                          >
                            {row.team_name}
                          </Link>
                          {row.status === "pending" ? (
                            <span className="block text-xs text-amber-700">pitch awaiting confirmation</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">{row.booked_by}</td>
                        <td className="px-4 py-3 align-top">{row.pitch_name ?? "—"}</td>
                        <td className="px-4 py-3 align-top">
                          <Badge variant={row.accepted > 0 ? "success" : "muted"}>
                            {row.accepted}/{row.squad}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={`/pitches/${row.booking_id}`}
                            className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" /> Register
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Attendance this term</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {term.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No registers taken yet this season — each session&apos;s Register link is where
                they start.
              </p>
            ) : (
              term.map((row) => {
                const pct = Math.round((row.there / row.marked) * 100);
                const tone =
                  pct >= 75 ? "bg-emerald-600" : pct >= 55 ? "bg-amber-600" : "bg-destructive";
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
          </CardContent>
        </Card>
      </div>
    </>
  );
}
