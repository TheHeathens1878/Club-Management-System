import { NextResponse } from "next/server";
import { recordSumUpPaymentIfPaid } from "@/lib/sumup";

// 3DS / redirect return target. SumUp hits this both as a browser redirect
// (GET, with the booker's session) and as a server-to-server callback
// (POST from their backend, no session). Recording is idempotent and keyed by
// checkout id, so both paths are safe. This route is public in middleware.
//
// After a 3DS bank redirect, SumUp's API may briefly show PENDING before
// switching to PAID, so we retry a few times. FAILED/EXPIRED are terminal —
// stop immediately so the booker gets an error instead of an endless spinner.
type Outcome = "paid" | "failed" | "pending";

async function tryRecord(checkoutId: string): Promise<Outcome> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { recorded, present, status } = await recordSumUpPaymentIfPaid(checkoutId);
      if (recorded || present) return "paid";
      const s = (status ?? "").toUpperCase();
      if (s === "FAILED" || s === "EXPIRED") return "failed";
    } catch (e) {
      console.error("[sumup] return route attempt", attempt, e);
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1500));
  }
  return "pending";
}

// Pull the checkout id from the query string or, for POST callbacks, the body.
async function extractCheckoutId(req: Request, url: URL): Promise<string | null> {
  const fromQuery = url.searchParams.get("checkout_id") ?? url.searchParams.get("id");
  if (fromQuery) return fromQuery;
  if (req.method !== "POST") return null;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const payload = (b.payload ?? b.data ?? {}) as Record<string, unknown>;
      const id = b.id ?? b.checkout_id ?? payload.id ?? payload.checkout_id;
      return id ? String(id) : null;
    }
    const form = await req.formData().catch(() => null);
    if (form) {
      const id = form.get("checkout_id") ?? form.get("id");
      return id ? String(id) : null;
    }
  } catch (e) {
    console.error("[sumup] return route body parse failed", e);
  }
  return null;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const checkoutId = await extractCheckoutId(req, url);

  if (!checkoutId) {
    // Browser with nothing to record — just send them home.
    return req.method === "POST"
      ? NextResponse.json({ received: true })
      : NextResponse.redirect(`${origin}/portal`);
  }

  const outcome = await tryRecord(checkoutId);

  // SumUp's server POST doesn't follow redirects — just acknowledge it.
  if (req.method === "POST") {
    return NextResponse.json({ received: true, outcome });
  }

  // Browser GET: route to the right state.
  const dest =
    outcome === "paid" ? `${origin}/portal`
    : outcome === "failed" ? `${origin}/portal?payment_failed=1`
    : `${origin}/portal?payment_pending=${encodeURIComponent(checkoutId)}`;
  return NextResponse.redirect(dest);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
