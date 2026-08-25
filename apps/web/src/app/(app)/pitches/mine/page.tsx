import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getStoredRoleView } from "@/lib/capabilities";
import { loadPitchBookingAccess, loadPitchBookings } from "@/lib/pitch-booking-data";
import { CalendarPlus } from "lucide-react";

import { MyPitchBookings } from "./mine-panel";

/**
 * `/pitches/mine` — the coach's own diary (gap 3, deliverable 3).
 *
 * There is no "whose bookings are these" filter in the query on purpose.
 * `bookings_team_staff_read` returns a coach exactly their own teams' pitch
 * bookings and nothing else, and `bookings_staff_read` returns an
 * administrator everything — so the database answers "mine", and the app does
 * not get a second, possibly different, opinion.
 */
export default async function MyPitchBookingsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const access = await loadPitchBookingAccess();
  const committee = isCommittee(session.profile?.role);
  // The Coach tile scopes the data: an administrator coaching a team sees only
  // their own teams bookings here while in that view (Adam, 2026-08-24).
  const coachView = (await getStoredRoleView()) === "coach";
  const asAdmin = access.isAdmin && !coachView;
  if (!access.isAdmin && !committee && access.staffTeamIds.length === 0) {
    redirect("/room-bookings");
  }

  const { items, error } = await loadPitchBookings({
    kinds: ["training", "block"],
    statuses: ["pending", "confirmed"],
    upcomingOnly: true,
    ...(asAdmin ? {} : { teamIds: access.staffTeamIds }),
  });

  return (
    <>
      <PageHeader
        title={asAdmin ? "Pitch bookings" : "My pitch bookings"}
        subtitle={
          asAdmin
            ? "Every upcoming training and block booking across the club"
            : "Training and other pitch use for the teams you run"
        }
        action={
          <Link href="/pitches/book" className={buttonVariants({ size: "sm" })}>
            <CalendarPlus className="h-4 w-4" /> Book a pitch
          </Link>
        }
      />
      <div className="space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>Upcoming</CardTitle>
            <p className="text-sm text-muted-foreground">
              Anything still to come, pending or confirmed. Pending bookings can be moved; a
              confirmed one can be cancelled, and a club administrator can move it. Fixtures are
              not listed here — they are allocated on{" "}
              <Link href="/pitches" className="underline underline-offset-2">
                Pitches
              </Link>
              .
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {error ? (
              <p className="text-sm text-destructive">Could not load your pitch bookings: {error}</p>
            ) : (
              <MyPitchBookings items={items} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
