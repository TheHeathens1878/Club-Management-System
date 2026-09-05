import { NextResponse } from "next/server";
import { recordSumUpPaymentIfPaid } from "@/lib/sumup";
import { recordSumUpChargePaymentIfPaid } from "@/lib/sumup-finance";

// SumUp posts an event when a checkout's status changes. We re-fetch the
// checkout server-side and record the payment idempotently. Booking checkouts
// carry a `<bookingId>:…` reference, finance checkouts a `charge:<id>:…` one —
// each recorder ignores the other's references, so both are simply tried.
//
// THE STATUS CODE IS THE CONTRACT. 200 tells SumUp "we have it, stop"; a 5xx
// tells it "try again later". Before 2026-09-05 this route answered 200 to
// everything, including a database insert that failed, so a transient outage
// at the wrong moment turned a taken payment into a silently missing ledger
// row (Codex review, finding 6). Now a recorder that could not write — as
// opposed to one that had nothing to write — is answered 500, and SumUp
// redelivers. Recording is keyed by checkout id, so a redelivery of something
// that DID land is a no-op.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const b = body as Record<string, unknown>;
    const payload = (b.payload ?? b.data ?? {}) as Record<string, unknown>;
    const id = b.id ?? b.checkout_id ?? payload.id ?? payload.checkout_id;
    if (id) {
      const charge = await recordSumUpChargePaymentIfPaid(String(id));
      if (charge.failed) return NextResponse.json({ error: "not recorded" }, { status: 500 });
      if (!charge.chargeId) {
        const booking = await recordSumUpPaymentIfPaid(String(id));
        if (booking.failed) return NextResponse.json({ error: "not recorded" }, { status: 500 });
      }
    }
  } catch (e) {
    console.error("[sumup] webhook error", e);
    return NextResponse.json({ error: "webhook error" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
