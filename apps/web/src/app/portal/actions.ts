"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailBrandColor } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/template-engine";
import { sendEmail } from "@/lib/email";
import { formatCurrency, getSiteUrl } from "@/lib/utils";
import { createSumUpCheckout, recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { formatBookingDate, instantToLocal } from "@/lib/booking-time";
import type { BookingPaymentStatus } from "@/lib/booking-types";

// Verify the booking belongs to the signed-in booker; returns the booking row.
async function ownedBooking(bookingId: string) {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." as const };
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id,booker_profile_id,starts_at,resources(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.booker_profile_id !== session.userId) return { error: "Booking not found." as const };
  return { session, admin, booking };
}

// Create a SumUp checkout for a booking payment. The client mounts the SumUp
// card widget with the returned checkout id.
export async function createCheckoutForBooking(
  bookingId: string,
  amountPence: number,
  purpose: "deposit" | "balance",
): Promise<{ checkoutId?: string; error?: string }> {
  if (!amountPence || amountPence <= 0) return { error: "Invalid amount." };
  // SumUp's UK minimum card transaction is £1.00.
  if (amountPence < 100) return { error: "Card payments must be at least £1.00." };
  const owned = await ownedBooking(bookingId);
  if ("error" in owned) return { error: owned.error };

  const roomName = owned.booking.resources?.name ?? "Function room";

  try {
    const checkout = await createSumUpCheckout({
      amountPence,
      reference: `${bookingId}:${purpose}:${Date.now()}`,
      description: `${purpose === "deposit" ? "Deposit" : "Balance"} — ${roomName} ${instantToLocal(owned.booking.starts_at).date}`,
      returnUrl: `${getSiteUrl()}/portal/pay/return`,
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

// PHASE 2 STAND-IN for SumUp. Records a payment against the booker's own
// booking and emails a confirmation. Replaced by a real SumUp checkout in
// Phase 3. Verifies the booking belongs to the signed-in booker.
export async function payBookingMock(
  bookingId: string,
  amountPence: number,
): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  if (!amountPence || amountPence <= 0) return { error: "Invalid amount." };

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id,booker_profile_id,booker_name,booker_email,starts_at,total_pence,resources(name)")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.booker_profile_id !== session.userId) {
    return { error: "Booking not found." };
  }

  const { error: insertErr } = await admin.from("payments").insert({
    booking_id: bookingId,
    amount_pence: amountPence,
    paid_at: new Date().toISOString(),
    method: "sumup",
    source: "sumup",
    sumup_txn_code: `MOCK-${Date.now()}`,
    authorised_by_name: null,
    note: "Paid online via portal",
  });
  if (insertErr) return { error: "Payment could not be recorded." };

  // Recompute payment_status from the full payment history
  const [{ data: totalsRow }, { data: payments }] = await Promise.all([
    admin.from("bookings").select("total_pence,deposit_pence").eq("id", bookingId).maybeSingle(),
    admin.from("payments").select("amount_pence").eq("booking_id", bookingId),
  ]);
  const totalPence = totalsRow?.total_pence ?? 0;
  const depositPence = totalsRow?.deposit_pence ?? 0;
  const paidPence = (payments ?? []).reduce((acc, p) => acc + p.amount_pence, 0);
  let status: BookingPaymentStatus = "unpaid";
  if (totalPence > 0 && paidPence >= totalPence) status = "paid";
  else if (paidPence > 0 && (depositPence === 0 || paidPence >= depositPence)) status = "deposit_paid";
  else if (paidPence > 0) status = "deposit_paid";
  await admin.from("bookings").update({ payment_status: status }).eq("id", bookingId);

  // Confirmation email to the booker
  if (booking.booker_email) {
    (async () => {
      try {
        const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
        const roomName = booking.resources?.name ?? "Function room";
        const tpl = await renderEmailTemplate("payment_received", {
          name: booking.booker_name,
          room_name: roomName,
          booking_date: formatBookingDate(instantToLocal(booking.starts_at).date),
          amount_paid: formatCurrency(amountPence),
          total_paid: formatCurrency(paidPence),
          outstanding: totalPence > 0 ? formatCurrency(Math.max(0, totalPence - paidPence)) : "—",
          payment_method: "Card (online)",
        }, brandColor);
        await sendEmail({ to: booking.booker_email, ...tpl });
      } catch (e) {
        console.error("[portal] Payment email failed:", e);
      }
    })();
  }

  revalidatePath("/portal");
  return {};
}
