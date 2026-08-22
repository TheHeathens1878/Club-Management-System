import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, Clock, CalendarDays, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("room_bookings")
    .select("id, room_id, date, start_time, end_time, booker_name, booker_email, occasion, status, amount_pence, payment_status")
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  const { data: room } = await admin
    .from("function_rooms")
    .select("name")
    .eq("id", booking.room_id)
    .maybeSingle();

  const shortRef = booking.id.slice(0, 8).toUpperCase();

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 py-12 px-4">
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border bg-card p-8 shadow-sm text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">Booking Request Received</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reference: <span className="font-mono font-semibold text-foreground">#{shortRef}</span>
          </p>

          <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-left space-y-3">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Room</p>
                <p className="text-sm font-medium">{room?.name ?? "Function Room"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="text-sm font-medium">{formatDate(String(booking.date))}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Time</p>
                <p className="text-sm font-medium">
                  {String(booking.start_time).slice(0, 5)} – {String(booking.end_time).slice(0, 5)}
                </p>
              </div>
            </div>
            {booking.occasion && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground text-xs flex items-center justify-center">🎉</span>
                <div>
                  <p className="text-xs text-muted-foreground">Occasion</p>
                  <p className="text-sm font-medium">{booking.occasion}</p>
                </div>
              </div>
            )}
            {booking.amount_pence && (
              <div className="border-t pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Estimated total</span>
                  <span className="font-semibold">{formatCurrency(booking.amount_pence)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Payment will be arranged upon confirmation.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg bg-primary/5 border border-primary/20 p-4">
            <p className="text-sm text-foreground">
              Your booking request has been received. We&apos;ll be in touch at{" "}
              <span className="font-semibold">{booking.booker_email}</span> to confirm availability and next steps.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-2">
            <Link
              href="/book"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Make another booking
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              Return to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
