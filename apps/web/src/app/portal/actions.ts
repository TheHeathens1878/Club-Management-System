"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/utils";
import { createSumUpCheckout, recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { instantToLocal } from "@/lib/booking-time";

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
  termsAccepted = false,
): Promise<{ checkoutId?: string; error?: string }> {
  if (!amountPence || amountPence <= 0) return { error: "Invalid amount." };
  // SumUp's UK minimum card transaction is £1.00.
  if (amountPence < 100) return { error: "Card payments must be at least £1.00." };
  const owned = await ownedBooking(bookingId);
  if ("error" in owned) return { error: owned.error };

  // Paying the deposit is what accepts the deposit terms, so the tick is
  // required here too and the moment is stamped once (Adam, 2026-09-03).
  if (purpose === "deposit") {
    if (!termsAccepted) return { error: "Please accept the deposit terms first." };
    const admin = createAdminClient();
    await admin
      .from("bookings")
      .update({ deposit_terms_accepted_at: new Date().toISOString() })
      .eq("id", bookingId)
      .is("deposit_terms_accepted_at", null);
  }

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

// The Phase 2 "mock payment" stand-in used to live here: a signed-in booker
// could record any amount against their own booking without paying it. It
// was removed on 2026-09-05 (Codex review, finding 2). A payment is recorded
// only by `recordSumUpPaymentIfPaid`, after SumUp has been asked.
