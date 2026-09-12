import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailBrandColor, getRecipientEmails } from "@/lib/settings";
import { notifyRoomDesk } from "@/lib/room-desk-notify";
import { renderEmailTemplate } from "@/lib/template-engine";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/utils";
import { formatBookingDate, instantToLocal } from "@/lib/booking-time";
import type { BookingPaymentStatus } from "@/lib/booking-types";

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

// Authenticated fetch against the SumUp API — the one door for every module
// that talks to SumUp (bookings here, finance in sumup-finance.ts).
export async function sumupApi(path: string, init?: RequestInit): Promise<Response> {
  const auth = await authHeader();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function sumupMerchantCode(): string {
  return MERCHANT_CODE;
}

export type SumUpCheckout = {
  id: string;
  status: string; // PENDING | PAID | FAILED | EXPIRED
  amount: number;
  currency: string;
  checkout_reference: string;
  purpose?: string;
  customer_id?: string;
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

// A checkout by id: null when SumUp has never heard of it, an exception when
// SumUp could not answer. Until 2026-09-12 every non-OK answer was null, so a
// SumUp outage at the moment of a webhook read as "no such checkout" — the
// webhook answered 200, SumUp stopped redelivering, and a taken payment could
// go unrecorded. Now only a 404 is "not found"; the rest throws, and every
// caller that must not lose a payment turns the throw into a retry.
export async function getSumUpCheckout(id: string): Promise<SumUpCheckout | null> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/v0.1/checkouts/${encodeURIComponent(id)}`, {
    headers: { Authorization: auth },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SumUp checkout lookup failed (${res.status})`);
  return res.json();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Idempotently record a paid SumUp checkout as a payment, recompute the
// booking's payment_status and email the booker. Safe to call from the widget
// finalize action, the webhook, and the 3DS return route — only records once.
//
// `failed` is the one answer that is neither "recorded" nor "nothing to
// record": SumUp says paid and the ledger write did not happen. The webhook
// answers it with a 5xx so SumUp redelivers.
export async function recordSumUpPaymentIfPaid(
  checkoutId: string,
): Promise<{ recorded: boolean; present: boolean; status?: string; failed?: boolean }> {
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
    .from("payments")
    .select("id")
    .eq("sumup_checkout_id", checkoutId)
    .maybeSingle();
  if (existing) return { recorded: false, present: true, status: checkout.status };

  // The reference is `<bookingId>:<purpose>:<stamp>`, minted by this app. A
  // reference that is not that shape is not ours (a finance checkout, or
  // nonsense) and is nothing to record — not a 22P02 to retry for ever.
  const [bookingId = "", purpose = ""] = String(checkout.checkout_reference || "").split(":");
  if (!UUID_RE.test(bookingId)) return { recorded: false, present: false, status: checkout.status };
  if (checkout.currency && checkout.currency.toUpperCase() !== "GBP") {
    console.error("[sumup] checkout in an unexpected currency", checkoutId, checkout.currency);
    return { recorded: false, present: false, status: checkout.status, failed: true };
  }

  const amountPence = Math.round(Number(checkout.amount || 0) * 100);
  const txnCode = checkout.transaction_code || checkout.transactions?.[0]?.transaction_code || null;

  const { error: insertErr } = await admin.from("payments").insert({
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
    // 23505 on sumup_checkout_id: recorded by a concurrent caller. Fine.
    if (insertErr.code === "23505") return { recorded: false, present: true, status: checkout.status };
    console.error("[sumup] failed to insert payment", insertErr);
    return { recorded: false, present: false, status: checkout.status, failed: true };
  }

  // Paying the deposit is what accepts the deposit terms; the moment is the
  // payment landing, not the checkout being opened and perhaps abandoned.
  if (purpose === "deposit") {
    await admin
      .from("bookings")
      .update({ deposit_terms_accepted_at: new Date().toISOString() })
      .eq("id", bookingId)
      .is("deposit_terms_accepted_at", null);
  }

  // Recompute payment_status — net of refunds, which the ledger records on
  // the payment row and which used to be ignored here.
  const [{ data: totalsRow }, { data: payments }] = await Promise.all([
    admin.from("bookings").select("status,total_pence,deposit_pence,booker_name,booker_email,starts_at,resources(name)").eq("id", bookingId).maybeSingle(),
    admin.from("payments").select("amount_pence,refunded_pence").eq("booking_id", bookingId),
  ]);

  // The desk's bell: money has arrived (Adam, 2026-09-12).
  if (totalsRow) {
    await notifyRoomDesk(admin, {
      subject: `${formatCurrency(amountPence)} paid online — ${totalsRow.booker_name}, ${formatBookingDate(instantToLocal(totalsRow.starts_at).date)}`,
      body: `${totalsRow.resources?.name ?? "Function room"} · ${purpose === "deposit" ? "deposit" : "balance"} by card${
        totalsRow.status === "cancelled" ? " · ON A CANCELLED BOOKING" : ""
      }`,
      bookingId,
    });
  }

  // Money taken for a booking that is no longer live — the cron auto-cancelled
  // it for a missed deposit and the bank's confirmation arrived late, or the
  // desk cancelled while a card was mid-flight. The ledger row is right (the
  // card WAS charged); what must not happen is nobody noticing. Tell the desk.
  if (totalsRow?.status === "cancelled") {
    try {
      const desk = await getRecipientEmails("notify_booking_request").catch(() => []);
      if (desk.length > 0) {
        const when = formatBookingDate(instantToLocal(totalsRow.starts_at).date);
        await sendEmail({
          to: desk,
          subject: `Payment received on a CANCELLED booking — ${totalsRow.booker_name} (${when})`,
          html: `<p>${formatCurrency(amountPence)} has just been taken by card from ${totalsRow.booker_name} (${totalsRow.booker_email}) for ${totalsRow.resources?.name ?? "the function room"} on ${when} — but that booking is <strong>cancelled</strong>.</p><p>Either reinstate the booking (re-quote it from its page, then confirm) or arrange a refund through SumUp. Nothing has been done automatically.</p>`,
          text: `${formatCurrency(amountPence)} was taken by card from ${totalsRow.booker_name} (${totalsRow.booker_email}) for ${when}, but that booking is cancelled. Reinstate it or arrange a refund; nothing has been done automatically.`,
          template: "payment_on_cancelled_booking",
          entity: "bookings",
          entityId: bookingId,
        });
      }
    } catch (e) {
      console.error("[sumup] could not alert the desk to a payment on a cancelled booking", e);
    }
  }
  const totalPence = totalsRow?.total_pence ?? 0;
  const depositPence = totalsRow?.deposit_pence ?? 0;
  const paidPence = (payments ?? []).reduce((acc, p) => acc + p.amount_pence - (p.refunded_pence ?? 0), 0);
  let status: BookingPaymentStatus = "unpaid";
  if (totalPence > 0 && paidPence >= totalPence) status = "paid";
  else if (paidPence > 0 && (depositPence === 0 || paidPence >= depositPence)) status = "deposit_paid";
  else if (paidPence > 0) status = "deposit_paid";
  await admin.from("bookings").update({ payment_status: status }).eq("id", bookingId);

  // Confirmation email
  if (totalsRow?.booker_email) {
    try {
      const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
      const roomName = totalsRow.resources?.name ?? "Function room";
      const tpl = await renderEmailTemplate("payment_received", {
        name: totalsRow.booker_name,
        room_name: roomName,
        booking_date: formatBookingDate(instantToLocal(totalsRow.starts_at).date),
        amount_paid: formatCurrency(amountPence),
        total_paid: formatCurrency(paidPence),
        outstanding: totalPence > 0 ? formatCurrency(Math.max(0, totalPence - paidPence)) : "—",
        payment_method: "Card (online)",
      }, brandColor);
      await sendEmail({ to: totalsRow.booker_email, ...tpl });
    } catch (e) {
      console.error("[sumup] Payment email failed:", e);
    }
  }

  return { recorded: true, present: true, status: checkout.status };
}
