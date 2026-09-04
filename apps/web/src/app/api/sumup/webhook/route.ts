import { NextResponse } from "next/server";
import { recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { recordSumUpChargePaymentIfPaid } from "@/lib/sumup-finance";

// SumUp posts an event when a checkout's status changes. We re-fetch the
// checkout server-side and record the payment idempotently. Booking checkouts
// carry a `<bookingId>:…` reference, finance checkouts a `charge:<id>:…` one —
// each recorder ignores the other's references, so both are simply tried.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const b = body as Record<string, unknown>;
    const payload = (b.payload ?? b.data ?? {}) as Record<string, unknown>;
    const id = b.id ?? b.checkout_id ?? payload.id ?? payload.checkout_id;
    if (id) {
      const charge = await recordSumUpChargePaymentIfPaid(String(id));
      if (!charge.chargeId) await recordSumUpPaymentIfPaid(String(id));
    }
  } catch (e) {
    console.error("[sumup] webhook error", e);
  }
  // Always 200 so SumUp doesn't retry indefinitely
  return NextResponse.json({ received: true });
}
