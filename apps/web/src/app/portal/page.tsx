import { redirect } from "next/navigation";
import { extrasSummary } from "@/lib/booking-extras";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { isSumUpConfigured, recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { PayButton } from "./pay-button";
import { PaymentPendingBanner } from "./payment-pending-banner";
import { formatBookingDate, instantsToLocalWindow } from "@/lib/booking-time";

export const dynamic = "force-dynamic";

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ payment_pending?: string; payment_failed?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const pendingCheckoutId = sp.payment_pending ?? null;
  const paymentFailed = sp.payment_failed === "1";

  // On each page load while payment_pending is set, try again to record the
  // payment in case the return route retries didn't catch it in time. Once the
  // payment is present, redirect to a clean URL so the banner disappears.
  // (redirect() throws, so it must run outside the try/catch.)
  let paymentPresent = false;
  if (pendingCheckoutId) {
    try {
      paymentPresent = (await recordSumUpPaymentIfPaid(pendingCheckoutId)).present;
    } catch { /* ignore */ }
  }
  if (paymentPresent) redirect("/portal");

  const sumupEnabled = isSumUpConfigured();
  const admin = createAdminClient();
  // Function-room hires only: pitch bookings (training a coach booked) also
  // carry the booker's profile id, but they are team business with no invoice
  // — they live on /pitches/mine, not in the hirer portal.
  const { data: bookings } = await admin
    .from("bookings")
    .select("id,starts_at,ends_at,occasion,status,payment_status,total_pence,deposit_pence,deposit_due_date,balance_due_date,selected_extras,security_deposit_pence,resources!inner(name,type)")
    .eq("booker_profile_id", session.userId)
    .eq("resources.type", "function_room")
    .order("starts_at", { ascending: true });

  const list = bookings ?? [];

  // Payments for all of this booker's bookings
  const ids = list.map((b) => b.id);
  const paidByBooking = new Map<string, number>();
  if (ids.length > 0) {
    const { data: payments } = await admin
      .from("payments")
      .select("booking_id,amount_pence")
      .in("booking_id", ids);
    for (const p of payments ?? []) {
      if (!p.booking_id) continue;
      paidByBooking.set(
        p.booking_id,
        (paidByBooking.get(p.booking_id) ?? 0) + p.amount_pence,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your bookings</h1>
        <p className="text-sm text-muted-foreground">View your bookings and pay your deposit or balance.</p>
      </div>

      {pendingCheckoutId && <PaymentPendingBanner checkoutId={pendingCheckoutId} />}

      {paymentFailed && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Payment unsuccessful</p>
          <p className="mt-0.5 text-xs">
            Your card payment didn&apos;t go through and you have not been charged. Please try again
            below, or contact the club if the problem continues. (Card payments have a minimum of £1.)
          </p>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">You don&apos;t have any bookings yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((b) => {
            const total = b.total_pence ?? 0;
            const deposit = b.deposit_pence ?? 0;
            const paid = paidByBooking.get(b.id) ?? 0;
            const outstanding = Math.max(0, total - paid);
            const depositRemaining = Math.max(0, deposit - paid);
            const status = b.status;
            const confirmed = status === "confirmed";
            const cancelled = status === "cancelled";
            const window = instantsToLocalWindow(b.starts_at, b.ends_at);

            return (
              <div key={b.id} className="rounded-lg border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{b.resources?.name ?? "Function room"}</h2>
                    <p className="text-sm text-muted-foreground">{formatBookingDate(window.date)}</p>
                    <p className="text-sm text-muted-foreground">
                      {window.startTime}–{window.endTime}
                      {b.occasion ? ` · ${b.occasion}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                    cancelled ? "bg-red-100 text-red-700"
                      : confirmed ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}>
                    {status === "pending"
                      ? "Awaiting confirmation"
                      : status === "enquiry"
                        ? "Enquiry — room not held"
                        : status}
                  </span>
                </div>

                {extrasSummary(b.selected_extras) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Extras: {extrasSummary(b.selected_extras)}
                  </p>
                )}
                {(b.security_deposit_pence ?? 0) > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A refundable £{((b.security_deposit_pence ?? 0) / 100).toFixed(0)} security
                    deposit applies (18th birthday), payable before the event.
                  </p>
                )}
                {status === "enquiry" && (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    This is an enquiry only — the room is <strong>not held</strong> for you, and
                    the date stays open to other bookings until the club confirms one with you.
                  </p>
                )}

                {confirmed && total > 0 && (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="font-semibold">{formatCurrency(total)}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="text-xs text-muted-foreground">Paid</p>
                        <p className="font-semibold text-green-700">{formatCurrency(paid)}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="text-xs text-muted-foreground">Outstanding</p>
                        <p className="font-semibold">{formatCurrency(outstanding)}</p>
                      </div>
                    </div>

                    {b.deposit_due_date && depositRemaining > 0 && (
                      <p className="mt-2 text-xs text-amber-700">
                        Deposit of {formatCurrency(deposit)} due by {formatBookingDate(b.deposit_due_date)}.
                      </p>
                    )}
                    {b.balance_due_date && outstanding > 0 && depositRemaining === 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Balance due by {formatBookingDate(b.balance_due_date)}.
                      </p>
                    )}

                    {outstanding > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {depositRemaining > 0 && depositRemaining < outstanding && (
                          <PayButton
                            bookingId={b.id}
                            amountPence={depositRemaining}
                            label="Pay deposit"
                            purpose="deposit"
                            sumupEnabled={sumupEnabled}
                          />
                        )}
                        <PayButton
                          bookingId={b.id}
                          amountPence={outstanding}
                          label={depositRemaining > 0 ? "Pay in full" : "Pay balance"}
                          variant={depositRemaining > 0 ? "outline" : "default"}
                          purpose="balance"
                          sumupEnabled={sumupEnabled}
                        />
                      </div>
                    ) : (
                      <p className="mt-4 text-sm font-medium text-green-700">Paid in full — thank you.</p>
                    )}
                  </>
                )}

                {confirmed && total === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">No payment is required for this booking.</p>
                )}

                {status === "pending" && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    We&apos;ll confirm your booking and the total cost soon. You&apos;ll be able to pay here once confirmed.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
