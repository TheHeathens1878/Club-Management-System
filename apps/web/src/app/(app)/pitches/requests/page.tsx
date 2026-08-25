import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import type { BookingStatus } from "@/lib/pitch-booking";
import { loadPitchBookings } from "@/lib/pitch-booking-data";
import { CalendarPlus } from "lucide-react";

import { PendingRequests, UpcomingBookings } from "./requests-panel";

/**
 * `/pitches/requests` — the club administrator's desk (gap 3, deliverable 2).
 *
 * Two gates, both required. `isCommittee` keeps the screen out of the staff
 * area's ordinary traffic; `is_club_admin()` is the database's own answer and
 * the one that matches `bookings_staff_update`, the policy that actually lets
 * a confirmation through. A committee sign-in that had somehow lost its
 * club_admin role would be shown the door here rather than a desk whose every
 * button fails.
 */

/** The filter the second card offers over every upcoming pitch booking. */
const FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

function isFilterValue(value: string | undefined): value is FilterValue {
  return FILTERS.some((f) => f.value === value);
}

export default async function PitchRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");
  if (!(await isClubAdmin())) redirect("/pitches");

  const { status } = await searchParams;
  const filter: FilterValue = isFilterValue(status) ? status : "all";
  const statuses: BookingStatus[] =
    filter === "all" ? ["pending", "confirmed", "cancelled"] : [filter];

  const [pendingResult, upcomingResult] = await Promise.all([
    loadPitchBookings({
      kinds: ["training", "block"],
      statuses: ["pending"],
      upcomingOnly: true,
    }),
    loadPitchBookings({ statuses, upcomingOnly: true }),
  ]);

  return (
    <>
      <PageHeader
        title="Pitch requests"
        subtitle="Confirm or decline what the club's coaches have asked for"
        action={
          <Link href="/pitches/book" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <CalendarPlus className="h-4 w-4" /> Book a pitch
          </Link>
        }
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Waiting for a decision</CardTitle>
            <p className="text-sm text-muted-foreground">
              Training and block bookings a coach has requested. Confirming brings the slot under
              the pitch&apos;s overlap constraint for the first time, so it can still be refused if
              something took the pitch in the meantime. Declining cancels the booking and keeps the
              reason on the record.
            </p>
          </CardHeader>
          <CardContent>
            {pendingResult.error ? (
              <p className="text-sm text-destructive">
                Could not load the requests: {pendingResult.error}
              </p>
            ) : (
              <PendingRequests items={pendingResult.items} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Everything upcoming</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every pitch booking still to come — fixtures and maintenance included — so a
                  clash can be found and cleared from one place.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {FILTERS.map((option) => (
                  <Link
                    key={option.value}
                    href={`/pitches/requests?status=${option.value}`}
                    className={buttonVariants({
                      variant: option.value === filter ? "default" : "outline",
                      size: "sm",
                    })}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingResult.error ? (
              <p className="text-sm text-destructive">
                Could not load the pitch diary: {upcomingResult.error}
              </p>
            ) : (
              <UpcomingBookings items={upcomingResult.items} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
