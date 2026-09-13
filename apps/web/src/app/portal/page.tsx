import { redirect } from "next/navigation";
import { extrasSummary } from "@/lib/booking-extras";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { depositRuleFrom, hireTermsSummary, sumHirePaid, sumSecurityPaid } from "@/lib/hire-terms";
import { getSettings } from "@/lib/settings";
import { AcceptQuoteButton } from "./accept-quote-button";
import { isSumUpConfigured, recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { PayButton } from "./pay-button";
import { PaymentPendingBanner } from "./payment-pending-banner";
import { formatBookingDate, instantsToLocalWindow } from "@/lib/booking-time";

export const metadata = { title: "Your bookings" };

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

  // Claim the bookings made in this person's name before they had an account:
  // the rows imported from the old room app, and anything the desk typed in
  // for them. Those carry the email but no profile id, so until 2026-09-12 a
  // hirer who signed in saw an empty portal and could not pay online. Hires
  // only, matched on the address case-insensitively, linked once and for good.
  if (session.email) {
    await admin
      .from("bookings")
      .update({ booker_profile_id: session.userId })
      .is("booker_profile_id", null)
      .eq("kind", "hire")
      // `_` and `%` are wildcards to ilike; an address is a literal.
      .ilike("booker_email", session.email.replace(/[\\%_]/g, "\\$&"));
  }

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
  const termsSummary = hireTermsSummary(depositRuleFrom(await getSettings()));

  // Payments for all of this booker's bookings
  const ids = list.map((b) => b.id);
  // Net of refunds: a refunded deposit is owed again. The hire (deposit and
  // balance) and the security deposit are counted apart — the security
  // deposit is held, not earned, and never pays for the room.
  const paidByBooking = new Map<string, { hire: number; security: number }>();
  if (ids.length > 0) {
    const { data: payments } = await admin
      .from("payments")
      .select("booking_id,amount_pence,refunded_pence,purpose")
      .in("booking_id", ids);
    for (const id of ids) {
      const rows = (payments ?? []).filter((p) => p.booking_id === id);
      paidByBooking.set(id, { hire: sumHirePaid(rows), security: sumSecurityPaid(rows) });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your bookings</h1>
        <p className="text-sm text-muted-foreground">
          View your bookings and pay your deposit, your balance and any security deposit.
        </p>
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
            const paidBoth = paidByBooking.get(b.id) ?? { hire: 0, security: 0 };
            const paid = paidBoth.hire;
            const outstanding = Math.max(0, total - paid);
            const depositRemaining = Math.max(0, deposit - paid);
            const securityDeposit = b.security_deposit_pence ?? 0;
            const securityRemaining = Math.max(0, securityDeposit - paidBoth.security);
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
                        : status === "quoted"
                          ? "Quoted — waiting for you"
                          : status}
                  </span>
                </div>

                {extrasSummary(b.selected_extras) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Extras: {extrasSummary(b.selected_extras)}
                  </p>
                )}
                {securityDeposit > 0 && !confirmed && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A refundable {formatCurrency(securityDeposit)} security deposit applies to this
                    booking, due two weeks before the event and returned after it if all is well.
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

                    {/* How paying works, for this booking (Adam, 2026-09-13):
                        the non-refundable deposit first, which secures the
                        room; then the balance plus any refundable security
                        deposit, two weeks before. */}
                    <ol className="mt-3 space-y-1.5 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <li className="flex gap-2">
                        <span className={depositRemaining === 0 ? "font-semibold text-green-700" : "font-semibold text-amber-700"}>1.</span>
                        <span>
                          {deposit > 0 ? (
                            depositRemaining === 0 ? (
                              <>Your non-refundable deposit of {formatCurrency(deposit)} has been received — the room is secured for you.</>
                            ) : (
                              <>
                                A <strong>non-refundable</strong> deposit of {formatCurrency(depositRemaining)} secures the room
                                {b.deposit_due_date ? <> — due by <strong>{formatBookingDate(b.deposit_due_date)}</strong></> : null}.
                                The booking is confirmed subject to it.
                              </>
                            )
                          ) : (
                            <>No deposit is required for this booking.</>
                          )}
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className={outstanding === 0 && securityRemaining === 0 ? "font-semibold text-green-700" : "font-semibold"}>2.</span>
                        <span>
                          {outstanding === 0 && securityRemaining === 0 ? (
                            <>The balance{securityDeposit > 0 ? " and the security deposit have" : " has"} been paid.</>
                          ) : (
                            <>
                              The balance of {formatCurrency(Math.max(0, total - Math.max(paid, deposit)))}
                              {securityDeposit > 0 ? (
                                <>, plus a <strong>refundable</strong> security deposit of {formatCurrency(securityDeposit)} (returned after the event if all is well),</>
                              ) : null}{" "}
                              is due {b.balance_due_date ? <>by <strong>{formatBookingDate(b.balance_due_date)}</strong>, </> : null}
                              at least two weeks before your event.
                            </>
                          )}
                        </span>
                      </li>
                    </ol>

                    {outstanding > 0 || securityRemaining > 0 ? (
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
                        {outstanding > 0 && (
                          <PayButton
                            bookingId={b.id}
                            amountPence={outstanding}
                            label={depositRemaining > 0 ? (depositRemaining < outstanding ? "Pay in full" : "Pay deposit") : "Pay balance"}
                            variant={depositRemaining > 0 && depositRemaining < outstanding ? "outline" : "default"}
                            purpose={depositRemaining > 0 && depositRemaining >= outstanding ? "deposit" : "balance"}
                            sumupEnabled={sumupEnabled}
                          />
                        )}
                        {securityRemaining > 0 && (
                          <PayButton
                            bookingId={b.id}
                            amountPence={securityRemaining}
                            label="Pay security deposit"
                            variant={depositRemaining > 0 ? "outline" : "default"}
                            purpose="security_deposit"
                            sumupEnabled={sumupEnabled}
                          />
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm font-medium text-green-700">
                        Paid in full{securityDeposit > 0 ? ", security deposit held" : ""} — thank you.
                      </p>
                    )}
                  </>
                )}

                {confirmed && b.total_pence === null && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    We&apos;ll confirm the cost with you shortly; you&apos;ll be able to pay here once it is set.
                  </p>
                )}
                {confirmed && b.total_pence === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">No payment is required for this booking.</p>
                )}

                {status === "pending" && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    We&apos;ll confirm your booking and the total cost soon. You&apos;ll be able to pay here once confirmed.
                  </p>
                )}

                {/* A quote waits on the booker (2026-09-13). The date is not
                    held by a quote; accepting it confirms the booking subject
                    to the deposit, and the deposit is what secures the room. */}
                {status === "quoted" && (
                  <div className="mt-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-900">
                      {total > 0 ? `The club has quoted ${formatCurrency(total)} for this booking.` : "The club has sent you a quote for this booking."}
                    </p>
                    <p className="text-xs text-amber-900/80">
                      The date is <strong>not held</strong> by a quote. To go ahead, accept it below: the booking is then
                      confirmed subject to the deposit, and you can pay the deposit straight away.{" "}
                      {termsSummary}
                    </p>
                    {total > 0 ? (
                      <AcceptQuoteButton bookingId={b.id} totalPence={total} />
                    ) : (
                      <p className="text-xs text-amber-900/80">The quote has no price on it yet — please contact the club.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
