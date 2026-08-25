import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { todayLondon } from "@/lib/pitch-booking";
import { loadPitchBookingAccess, loadPitches } from "@/lib/pitch-booking-data";
import { getStoredRoleView } from "@/lib/capabilities";
import { ChevronLeft } from "lucide-react";

import { BookForm } from "./book-form";

/**
 * `/pitches/book` — the screen the cutover was missing (gap 3, deliverable 1).
 *
 * Who may be here is asked of the database, not of `profiles.role`: a coach
 * qualifies because `team_memberships` says they run a team, an administrator
 * because `is_club_admin()` says so. Committee sign-ins hold club_admin through
 * the profiles → person_roles sync, so `isCommittee` is only a fallback for
 * getting in — every write still meets the same RLS policies as a coach's.
 */
export default async function BookPitchPage({
  searchParams,
}: {
  searchParams: Promise<{
    team?: string;
    pitch?: string;
    date?: string;
    start?: string;
    end?: string;
  }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const {
    team: requestedTeam,
    pitch: requestedPitch,
    date: requestedDate,
    start: requestedStart,
    end: requestedEnd,
  } = await searchParams;
  const [access, pitches, roleView] = await Promise.all([
    loadPitchBookingAccess(),
    loadPitches(),
    getStoredRoleView(),
  ]);
  // In the Coach view even an administrator books for their own teams only.
  if (roleView === "coach" && access.isAdmin && access.staffTeamIds.length > 0) {
    access.teams = access.teams.filter((team) => access.staffTeamIds.includes(team.id));
  }
  const committee = isCommittee(session.profile?.role);

  if (!access.isAdmin && !committee && access.staffTeamIds.length === 0) {
    redirect("/room-bookings");
  }

  const defaultTeamId =
    requestedTeam && access.teams.some((t) => t.id === requestedTeam) ? requestedTeam : null;

  // Each team's home pitch, so the form can open on it. Only pitches this
  // caller can actually see are offered, so a home pitch that has been
  // deactivated simply leaves the select on "choose a pitch".
  const bookable = new Set(pitches.map((pitch) => pitch.id));
  const homePitchByTeam: Record<string, string> = {};
  for (const team of access.teams) {
    if (team.homeResourceId !== null && bookable.has(team.homeResourceId)) {
      homePitchByTeam[team.id] = team.homeResourceId;
    }
  }

  return (
    <>
      <PageHeader
        title="Book a pitch"
        subtitle="Ask for a training slot or another use of a pitch"
        action={
          <Link
            href="/pitches/mine"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4" /> My pitch bookings
          </Link>
        }
      />
      <div className="max-w-3xl space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>New pitch booking</CardTitle>
            <p className="text-sm text-muted-foreground">
              The slot is checked against everything already on that pitch — fixtures, other
              training, maintenance — before anything is written, and the database refuses an
              overlap even if two people ask at the same moment. Coaches&apos; requests arrive as
              pending; a club administrator confirms them on{" "}
              <Link href="/pitches/requests" className="underline underline-offset-2">
                Pitch requests
              </Link>
              .
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {access.teams.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                You are not listed as coach, assistant coach or manager of any team, so there is
                nothing to book for. Ask a club administrator to add you to the team.
              </p>
            ) : pitches.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pitches are set up yet. A club administrator adds them under Settings.
              </p>
            ) : (
              <BookForm
                teams={access.teams}
                pitches={pitches}
                isAdmin={access.isAdmin}
                defaultTeamId={defaultTeamId}
                homePitchByTeam={homePitchByTeam}
                today={todayLondon()}
                prefill={{
                  // A calendar slot click lands here with the slot it named.
                  pitchId:
                    requestedPitch && bookable.has(requestedPitch) ? requestedPitch : undefined,
                  date:
                    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
                      ? requestedDate
                      : undefined,
                  start:
                    requestedStart && /^\d{2}:\d{2}$/.test(requestedStart)
                      ? requestedStart
                      : undefined,
                  end:
                    requestedEnd && /^\d{2}:\d{2}$/.test(requestedEnd) ? requestedEnd : undefined,
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
