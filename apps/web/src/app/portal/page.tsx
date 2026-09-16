import { redirect } from "next/navigation";
import { CalendarDays, CalendarRange, ScrollText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { getSessionProfile } from "@/lib/auth";
import { extrasSummary } from "@/lib/booking-extras";
import {
  bookingMoney,
  bookingNextAction,
  paymentRail,
  type BookingFacts,
  type BookingNextActionInput,
} from "@/lib/booking-next-action";
import { formatBookingDate, formatBookingDateShort, instantsToLocalWindow } from "@/lib/booking-time";
import { depositRuleFrom, hireTermsSummary, type LedgerRow } from "@/lib/hire-terms";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSumUpConfigured, recordSumUpPaymentIfPaid } from "@/lib/sumup";

import { PortalBookings, type PortalBooking } from "./booking-sheet";
import { PaymentPendingBanner } from "./payment-pending-banner";

export const metadata = { title: "Your bookings" };

export const dynamic = "force-dynamic";

/**
 * `/portal` — the hirer's own page (P8.9). Hirers read this on a phone,
 * usually because they have had an email asking them for money, so the page
 * is: what this booking needs, what it costs, and the one button that pays
 * it. Everything else folds.
 *
 * The page works nothing out for itself. `bookingNextAction()` in the
 * booker's voice says what the booking needs and what a Pay button here would
 * charge; `paymentRail()` says where each of the three steps stands;
 * `bookingMoney()` says the figures. The desk's own screen asks the same
 * functions in the desk's voice, which is what stops the two sides of the
 * counter disagreeing about one booking.
 *
 * The status words, the "room is not held" wording, the SumUp flow, the £1
 * card minimum and the terms sentence are all unchanged — they are the club's
 * commercial commitments, not decoration.
 */

/** The status, said to the hirer, exactly as the portal has always said it. */
const STATUS: Record<string, { label: string; tone: PortalBooking["statusTone"] }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  pending: { label: "Awaiting confirmation", tone: "warning" },
  enquiry: { label: "Enquiry — room not held", tone: "warning" },
  quoted: { label: "Quoted — waiting for you", tone: "warning" },
};

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
  // `security_deposit_returned_at` joined the columns with the payment rail:
  // without it the page would tell a hirer their deposit is still being held
  // after the club had already sent it back.
  const { data: bookings } = await admin
    .from("bookings")
    .select("id,starts_at,ends_at,occasion,status,payment_status,total_pence,deposit_pence,deposit_due_date,balance_due_date,selected_extras,security_deposit_pence,security_deposit_returned_at,resources!inner(name,type)")
    .eq("booker_profile_id", session.userId)
    .eq("resources.type", "function_room")
    .order("starts_at", { ascending: true });

  const list = bookings ?? [];
  const termsSummary = hireTermsSummary(depositRuleFrom(await getSettings()));

  // Payments for all of this booker's bookings. The ledger rows go to the
  // helpers whole: they know that a refunded deposit is owed again, and that
  // the security deposit is held rather than earned and so never counts
  // towards the hire being paid.
  const ids = list.map((b) => b.id);
  const ledger = new Map<string, LedgerRow[]>();
  if (ids.length > 0) {
    const { data: payments } = await admin
      .from("payments")
      .select("booking_id,amount_pence,refunded_pence,purpose")
      .in("booking_id", ids);
    for (const id of ids) {
      ledger.set(id, (payments ?? []).filter((p) => p.booking_id === id));
    }
  }

  const now = new Date();
  const rows: PortalBooking[] = list.map((b) => {
    const window = instantsToLocalWindow(b.starts_at, b.ends_at);
    const facts: BookingFacts = {
      status: b.status,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      total_pence: b.total_pence,
      deposit_pence: b.deposit_pence,
      deposit_due_date: b.deposit_due_date,
      balance_due_date: b.balance_due_date,
      security_deposit_pence: b.security_deposit_pence,
      security_deposit_returned_at: b.security_deposit_returned_at,
      // The desk's own paperwork, which changes nothing on this side of the
      // counter: whether a chaser has gone out and whether the desk has
      // stamped an acceptance both leave the hirer with the same one thing to
      // do — accept the quote — so the portal does not read them.
      quote_accepted_at: null,
      chaser_sent_at: null,
      final_chaser_sent_at: null,
    };
    // A clash is the desk's problem: the hirer cannot see other people's
    // bookings and has nothing to do about one.
    const input: BookingNextActionInput = { booking: facts, payments: ledger.get(b.id) ?? [], clashes: [] };
    const money = bookingMoney(input);
    const status = STATUS[b.status] ?? { label: b.status, tone: "muted" as const };
    const priced = b.status === "confirmed" && money.totalPence > 0;

    return {
      id: b.id,
      roomName: b.resources?.name ?? "Function room",
      dateLabel: formatBookingDate(window.date),
      shortDateLabel: formatBookingDateShort(window.date),
      timeLabel: `${window.startTime}–${window.endTime}`,
      occasion: b.occasion ?? null,
      status: b.status,
      statusLabel: status.label,
      statusTone: status.tone,
      extras: extrasSummary(b.selected_extras) || null,
      roomNotHeld: b.status === "enquiry" || b.status === "quoted",
      termsSummary,
      action: bookingNextAction(input, { voice: "booker", now }),
      money,
      rail: paymentRail(input, now),
      priced,
      note:
        b.status === "confirmed" && b.total_pence === 0
          ? "No payment is required for this booking."
          : null,
    };
  });

  // One page, one object: the booking the hirer is here about is the next one
  // still to happen, and the rest fold beneath it.
  const nowIso = now.toISOString();
  const nextId = (list.find((b) => b.ends_at >= nowIso) ?? list[list.length - 1])?.id;
  const next = rows.filter((row) => row.id === nextId);
  const others = rows.filter((row) => row.id !== nextId);

  return (
    <div className="space-y-4">
      {pendingCheckoutId && <PaymentPendingBanner checkoutId={pendingCheckoutId} />}

      {paymentFailed && (
        <Callout tone="danger" title="Payment unsuccessful">
          Your card payment didn&apos;t go through and you have not been charged. Please try again
          below, or contact the club if the problem continues. (Card payments have a minimum of £1.)
        </Callout>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-5 w-5" aria-hidden />} title="You don't have any bookings yet.">
          When the club takes an enquiry, a request or a booking in your name, it appears here with
          everything you owe on it.
        </EmptyState>
      ) : (
        <PortalBookings bookings={next} sumupEnabled={sumupEnabled} />
      )}

      {rows.length > 0 && (
        <div className="space-y-2 pt-2">
          {others.length > 0 && (
            <FoldCard
              icon={<CalendarRange className="h-4 w-4" aria-hidden />}
              title="Your other bookings"
              summary={others.map((row) => `${row.shortDateLabel} · ${row.statusLabel}`).join(" · ")}
            >
              <PortalBookings bookings={others} sumupEnabled={sumupEnabled} />
            </FoldCard>
          )}
          <FoldCard
            icon={<ScrollText className="h-4 w-4" aria-hidden />}
            title="What you agreed"
            summary="The deposit, the balance and any security deposit — the club's terms in one paragraph"
          >
            <p className="text-sm text-muted-foreground">{termsSummary}</p>
          </FoldCard>
        </div>
      )}
    </div>
  );
}
