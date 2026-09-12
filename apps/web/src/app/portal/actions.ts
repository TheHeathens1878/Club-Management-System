"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/utils";
import { createSumUpCheckout, recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { instantToLocal } from "@/lib/booking-time";
import { requestOrigin } from "@/lib/request-origin";

// Verify the booking belongs to the signed-in booker; returns the booking row.
async function ownedBooking(bookingId: string) {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." as const };
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id,booker_profile_id,starts_at,status,kind,total_pence,deposit_pence,resources(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.booker_profile_id !== session.userId) return { error: "Booking not found." as const };
  return { session, admin, booking };
}

/**
 * What the booker may pay now, decided here and not in the browser: the
 * deposit still owed, or the whole balance — capped at what is outstanding.
 * Until 2026-09-12 the amount came from the client, so a booker could pay
 * any figure of £1 or more and have it stamped "deposit paid".
 */
function amountDue(
  booking: { total_pence: number | null; deposit_pence: number | null },
  paidPence: number,
  purpose: "deposit" | "balance",
): number {
  const total = Number(booking.total_pence ?? 0);
  const deposit = Number(booking.deposit_pence ?? 0);
  const outstanding = Math.max(0, total - paidPence);
  if (purpose === "deposit") {
    const depositLeft = Math.max(0, deposit - paidPence);
    return total > 0 ? Math.min(depositLeft, outstanding) : depositLeft;
  }
  return outstanding;
}

// Create a SumUp checkout for a booking payment. The client mounts the SumUp
// card widget with the returned checkout id. `amountPence` is what the
// button showed; the server works the figure out for itself and refuses if
// the two disagree, so a stale page cannot pay a stale amount.
export async function createCheckoutForBooking(
  bookingId: string,
  amountPence: number,
  purpose: "deposit" | "balance",
  termsAccepted = false,
): Promise<{ checkoutId?: string; error?: string }> {
  const owned = await ownedBooking(bookingId);
  if ("error" in owned) return { error: owned.error };
  if (owned.booking.kind !== "hire") return { error: "Booking not found." };
  if (owned.booking.status === "cancelled") {
    return { error: "This booking has been cancelled, so there is nothing to pay. Contact the club if that is wrong." };
  }
  if (owned.booking.status !== "confirmed") {
    return { error: "Payment opens once the club has confirmed the booking." };
  }
  const { data: paidRows } = await owned.admin
    .from("payments")
    .select("amount_pence,refunded_pence")
    .eq("booking_id", bookingId);
  const paidPence = (paidRows ?? []).reduce(
    (acc, p) => acc + Number(p.amount_pence ?? 0) - Number(p.refunded_pence ?? 0),
    0,
  );
  const due = amountDue(owned.booking, paidPence, purpose);
  if (due <= 0) return { error: "Nothing is outstanding on this booking." };
  if (due !== amountPence) {
    return { error: "The amount due has changed since this page was opened. Please reload and try again." };
  }
  // SumUp's UK minimum card transaction is £1.00.
  if (amountPence < 100) return { error: "Card payments must be at least £1.00." };

  // Paying the deposit is what accepts the deposit terms, so the tick is
  // required here too (Adam, 2026-09-03). The moment is stamped when the
  // payment lands (lib/sumup), not here: an opened-then-abandoned checkout
  // accepted nothing.
  if (purpose === "deposit" && !termsAccepted) {
    return { error: "Please accept the deposit terms first." };
  }

  const roomName = owned.booking.resources?.name ?? "Function room";

  try {
    const checkout = await createSumUpCheckout({
      amountPence,
      reference: `${bookingId}:${purpose}:${Date.now()}`,
      description: `${purpose === "deposit" ? "Deposit" : "Balance"} — ${roomName} ${instantToLocal(owned.booking.starts_at).date}`,
      // The booker comes back from their bank to the host they are signed
      // in on — not the canonical address, where no session cookie waits.
      returnUrl: `${(await requestOrigin()) || getSiteUrl()}/portal/pay/return`,
    });
    return { checkoutId: checkout.id };
  } catch (e) {
    console.error("[portal] SumUp checkout creation failed:", e);
    return { error: "Could not start payment. Please try again." };
  }
}

// Called by the widget after a successful response. Verifies with SumUp and
// records the payment (idempotent).
export async function finalizeCheckout(checkoutId: string, bookingId: string): Promise<{ error?: string }> {
  const owned = await ownedBooking(bookingId);
  if ("error" in owned) return { error: owned.error };
  try {
    await recordSumUpPaymentIfPaid(checkoutId);
  } catch (e) {
    console.error("[portal] SumUp finalize failed:", e);
    return { error: "Payment verification failed. If you were charged, please contact us." };
  }
  revalidatePath("/portal");
  return {};
}

// The Phase 2 "mock payment" stand-in used to live here: a signed-in booker
// could record any amount against their own booking without paying it. It
// was removed on 2026-09-05 (Codex review, finding 2). A payment is recorded
// only by `recordSumUpPaymentIfPaid`, after SumUp has been asked.
