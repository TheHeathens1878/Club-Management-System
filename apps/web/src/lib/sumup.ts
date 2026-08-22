import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailBrandColor } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/template-engine";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/utils";

// SumUp Online Payments — server-only. Never import from client components.
// Sandbox is selected by using sandbox credentials; the API host is the same.
const BASE = process.env.SUMUP_API_BASE || "https://api.sumup.com";
const API_KEY = process.env.SUMUP_API_KEY ?? "";        // sup_sk_... (preferred)
const CLIENT_ID = process.env.SUMUP_CLIENT_ID ?? "";    // OAuth fallback
const CLIENT_SECRET = process.env.SUMUP_CLIENT_SECRET ?? "";
const MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE ?? "";

export function isSumUpConfigured(): boolean {
  return !!(MERCHANT_CODE && (API_KEY || (CLIENT_ID && CLIENT_SECRET)));
}

let tokenCache: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 5000) return tokenCache.token;
  const res = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`SumUp token request failed (${res.status})`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  return tokenCache.token;
}

// A direct API key is used as the bearer token; OAuth credentials are exchanged first.
async function authHeader(): Promise<string> {
  if (API_KEY) return `Bearer ${API_KEY}`;
  return `Bearer ${await getToken()}`;
}

export type SumUpCheckout = {
  id: string;
  status: string; // PENDING | PAID | FAILED | EXPIRED
  amount: number;
  currency: string;
  checkout_reference: string;
  transaction_code?: string;
  transactions?: { transaction_code?: string; status?: string }[];
};

export async function createSumUpCheckout(params: {
  amountPence: number;
  reference: string;
  description?: string;
  returnUrl?: string;
}): Promise<SumUpCheckout> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/v0.1/checkouts`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      checkout_reference: params.reference,
      amount: Number((params.amountPence / 100).toFixed(2)),
      currency: "GBP",
      merchant_code: MERCHANT_CODE,
      description: params.description,
      redirect_url: params.returnUrl,
    }),
  });
  if (!res.ok) throw new Error(`SumUp checkout failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function getSumUpCheckout(id: string): Promise<SumUpCheckout | null> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/v0.1/checkouts/${encodeURIComponent(id)}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;
  return res.json();
}

// Idempotently record a paid SumUp checkout as a booking_payment, recompute the
// booking's payment_status and email the booker. Safe to call from the widget
// finalize action, the webhook, and the 3DS return route — only records once.
export async function recordSumUpPaymentIfPaid(
  checkoutId: string,
): Promise<{ recorded: boolean; present: boolean; status?: string }> {
  const checkout = await getSumUpCheckout(checkoutId);
  if (!checkout) {
    console.warn("[sumup] checkout not found", checkoutId);
    return { recorded: false, present: false };
  }

  // After 3DS the checkout status can briefly lag behind a SUCCESSFUL
  // transaction, so treat either signal as paid.
  const txnSuccessful = (checkout.transactions ?? []).some(
    (t) => (t.status ?? "").toUpperCase() === "SUCCESSFUL",
  );
  const isPaid = checkout.status === "PAID" || txnSuccessful;
  if (!isPaid) {
    console.log("[sumup] checkout not yet paid", checkoutId, "status=", checkout.status);
    return { recorded: false, present: false, status: checkout.status };
  }

  const admin = createAdminClient();

  // Idempotency — skip if we already stored this checkout
  const { data: existing } = await admin
    .from("booking_payments")
    .select("id")
    .eq("sumup_checkout_id", checkoutId)
    .maybeSingle();
  if (existing) return { recorded: false, present: true, status: checkout.status };

  const bookingId = String(checkout.checkout_reference || "").split(":")[0];
  if (!bookingId) return { recorded: false, present: false, status: checkout.status };

  const amountPence = Math.round(Number(checkout.amount || 0) * 100);
  const txnCode = checkout.transaction_code || checkout.transactions?.[0]?.transaction_code || null;

  const { error: insertErr } = await admin.from("booking_payments").insert({
    booking_id: bookingId,
    amount_pence: amountPence,
    paid_at: new Date().toISOString(),
    method: "sumup",
    source: "sumup",
    sumup_checkout_id: checkoutId,
    sumup_txn_code: txnCode,
    note: "Paid online (SumUp)",
  });
  if (insertErr) {
    console.error("[sumup] failed to insert booking_payment", insertErr);
    return { recorded: false, present: false, status: checkout.status };
  }

  // Recompute payment_status
  const [{ data: totalsRow }, { data: payments }] = await Promise.all([
    admin.from("room_bookings").select("total_pence,deposit_pence,amount_pence,booker_name,booker_email,date,function_rooms(name)").eq("id", bookingId).maybeSingle(),
    admin.from("booking_payments").select("amount_pence").eq("booking_id", bookingId),
  ]);
  const totalPence = Number(totalsRow?.total_pence ?? totalsRow?.amount_pence ?? 0);
  const depositPence = Number(totalsRow?.deposit_pence ?? 0);
  const paidPence = (payments ?? []).reduce((acc, p) => acc + Number(p.amount_pence ?? 0), 0);
  let status = "unpaid";
  if (totalPence > 0 && paidPence >= totalPence) status = "paid";
  else if (paidPence > 0 && (depositPence === 0 || paidPence >= depositPence)) status = "deposit_paid";
  else if (paidPence > 0) status = "deposit_paid";
  await admin.from("room_bookings").update({ payment_status: status }).eq("id", bookingId);

  // Confirmation email
  if (totalsRow?.booker_email) {
    try {
      const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
      const roomRow = totalsRow.function_rooms as { name?: string } | { name?: string }[] | null;
      const roomName = Array.isArray(roomRow) ? (roomRow[0]?.name ?? "Function room") : (roomRow?.name ?? "Function room");
      const tpl = await renderEmailTemplate("payment_received", {
        name: totalsRow.booker_name as string,
        room_name: roomName,
        booking_date: new Date(String(totalsRow.date) + "T12:00:00").toLocaleDateString("en-GB", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        }),
        amount_paid: formatCurrency(amountPence),
        total_paid: formatCurrency(paidPence),
        outstanding: totalPence > 0 ? formatCurrency(Math.max(0, totalPence - paidPence)) : "—",
        payment_method: "Card (online)",
      }, brandColor);
      await sendEmail({ to: totalsRow.booker_email as string, ...tpl });
    } catch (e) {
      console.error("[sumup] Payment email failed:", e);
    }
  }

  return { recorded: true, present: true, status: checkout.status };
}
