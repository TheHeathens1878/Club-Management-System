import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { formatSlot, kindLabel, statusLabel, statusVariant } from "@/lib/pitch-booking";
import { loadPitchBooking, loadPitches } from "@/lib/pitch-booking-data";
import { ChevronLeft } from "lucide-react";

import { EditBookingForm } from "./edit-form";

/**
 * `/pitches/[bookingId]/edit` — moving a pending pitch booking.
 *
 * There is no role check here beyond being signed in, and that is deliberate:
 * `loadPitchBooking()` reads through the caller's own client, so a booking the
 * caller may not see simply is not there and the page 404s. Whether the change
 * is allowed is `bookings_team_guard()`'s decision, not this page's.
 */
export default async function EditPitchBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { bookingId } = await params;
  const [booking, pitches] = await Promise.all([loadPitchBooking(bookingId), loadPitches()]);
  if (!booking) notFound();

  const editable = booking.status === "pending" && (booking.kind === "training" || booking.kind === "block");

  return (
    <>
      <PageHeader
        title="Edit pitch booking"
        subtitle={`${formatSlot(booking)} · ${booking.resourceName}`}
        action={
          <Link href="/pitches/mine" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="h-4 w-4" /> My pitch bookings
          </Link>
        }
      />
      <div className="max-w-3xl space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(booking.status)}>{statusLabel(booking.status)}</Badge>
          <Badge variant="muted">{kindLabel(booking.kind)}</Badge>
          {booking.teamName && <Badge variant="outline">{booking.teamName}</Badge>}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{booking.label ?? booking.teamName ?? "Pitch booking"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Time, pitch and label. The new slot is checked against everything else on that pitch
              before it is saved, and the database refuses an overlap regardless.
            </p>
          </CardHeader>
          <CardContent>
            {editable ? (
              <EditBookingForm booking={booking} pitches={pitches} />
            ) : (
              <div className="space-y-3 py-4">
                <p className="text-sm text-muted-foreground">
                  {booking.status === "cancelled"
                    ? "This booking is cancelled, so there is nothing to change."
                    : booking.status === "confirmed"
                      ? "This booking is confirmed. A confirmed slot is the club's diary — cancel it and book again, or ask a club administrator to move it."
                      : "This booking is not one the pitch screens manage. Fixtures are allocated on Pitches."}
                </p>
                <Link
                  href="/pitches/mine"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Back to my bookings
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
