import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, Clock, CalendarDays, Building2 } from "lucide-react";
import { formatBookingDate, instantsToLocalWindow } from "@/lib/booking-time";

export const metadata = { title: "Booking" };

export const dynamic = "force-dynamic";

// This page is public — the hirer has just submitted the form and is not
// signed in — and the id in the address is the whole key to it. A uuid is not
// guessable, but the page used to print the hirer's full email address to
// whoever held the link (Codex review, finding 8). It now shows enough for
// the hirer to recognise their own address and no more: "a•••@example.com".
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, resource_id, starts_at, ends_at, booker_name, booker_email, occasion, status, total_pence, payment_status")
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  const { data: room } = await admin
    .from("resources")
    .select("name")
    .eq("id", booking.resource_id)
    .maybeSingle();

  const shortRef = booking.id.slice(0, 8).toUpperCase();
  const isEnquiry = booking.status === "enquiry";

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 py-12 px-4">
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border bg-card p-8 shadow-sm text-center">
          <div className="mb-4 flex justify-center">
            <div
              className={
                "flex h-16 w-16 items-center justify-center rounded-full " +
                (isEnquiry ? "bg-amber-100" : "bg-emerald-100")
              }
            >
              {isEnquiry ? (
                <Clock className="h-8 w-8 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              )}
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            {isEnquiry ? "Enquiry Sent" : "Booking Request Received"}
          </h1>
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
                <p className="text-sm font-medium">{formatBookingDate(window.date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Time</p>
                <p className="text-sm font-medium">
                  {window.startTime} – {window.endTime}
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
            {booking.total_pence !== null && (
              <div className="border-t pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Estimated total</span>
                  <span className="font-semibold">{formatCurrency(booking.total_pence)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Payment will be arranged upon confirmation.</p>
              </div>
            )}
          </div>

          {isEnquiry ? (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-left">
              <p className="text-sm font-semibold text-amber-900">
                The room is not held for you.
              </p>
              <p className="mt-1 text-sm text-amber-900">
                This is an enquiry only — the date stays open to other bookings until you confirm
                one with us. We&apos;ll reply at{" "}
                <span className="font-semibold">{maskEmail(booking.booker_email)}</span> with availability
                and prices.
              </p>
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-primary/5 border border-primary/20 p-4">
              <p className="text-sm text-foreground">
                Your booking request has been received. We&apos;ll be in touch at{" "}
                <span className="font-semibold">{maskEmail(booking.booker_email)}</span> to confirm availability and next steps.
              </p>
            </div>
          )}

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
