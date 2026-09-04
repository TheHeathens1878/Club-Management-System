import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSumUpCheckout,
  isSumUpConfigured,
  sumupApi,
  sumupMerchantCode,
  type SumUpCheckout,
} from "@/lib/sumup";

// SumUp for the finance section — server-only. Never import from client
// components.
//
// Charges (membership fees, subs instalments, fines) are collected three ways:
//   1. A hosted-widget checkout the member completes themselves.
//   2. The same checkout with purpose SETUP_RECURRING_PAYMENT, which also
//      stores the card against a SumUp customer — the payment mandate.
//   3. A server-side charge of the stored card (monthly collections, and
//      pre-authorised fines where the mandate says covers_fines).
//
// The checkout_reference for every finance checkout is `charge:<chargeId>:<ts>`
// — recordSumUpChargePaymentIfPaid() parses it back. Bookings keep their own
// `<bookingId>:<purpose>:<ts>` scheme in sumup.ts.

export { isSumUpConfigured };

export type SumUpInstrument = {
  token: string;
  active: boolean;
  type: string;
  card?: { last_4_digits?: string; type?: string };
};

// A SumUp customer per billing account, deterministic id so retries are safe.
export function sumupCustomerIdFor(accountId: string): string {
  return `acct-${accountId}`;
}

export async function ensureSumUpCustomer(accountId: string, details?: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): Promise<string> {
  const customerId = sumupCustomerIdFor(accountId);
  const existing = await sumupApi(`/v0.1/customers/${encodeURIComponent(customerId)}`);
  if (existing.ok) return customerId;
  const res = await sumupApi(`/v0.1/customers`, {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      personal_details: details
        ? { first_name: details.firstName, last_name: details.lastName, email: details.email }
        : undefined,
    }),
  });
  if (!res.ok) throw new Error(`SumUp customer creation failed (${res.status}): ${await res.text()}`);
  return customerId;
}

// A checkout for a charge. When `saveCard` is set the checkout doubles as the
// mandate setup: SumUp stores the card against the customer and later
// collections use the stored instrument.
export async function createChargeCheckout(params: {
  chargeId: string;
  amountPence: number;
  description?: string;
  returnUrl?: string;
  saveCard?: { customerId: string };
}): Promise<SumUpCheckout> {
  const res = await sumupApi(`/v0.1/checkouts`, {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: `charge:${params.chargeId}:${Date.now()}`,
      amount: Number((params.amountPence / 100).toFixed(2)),
      currency: "GBP",
      merchant_code: sumupMerchantCode(),
      description: params.description,
      redirect_url: params.returnUrl,
      ...(params.saveCard
        ? { purpose: "SETUP_RECURRING_PAYMENT", customer_id: params.saveCard.customerId }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`SumUp charge checkout failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function listCustomerInstruments(customerId: string): Promise<SumUpInstrument[]> {
  const res = await sumupApi(
    `/v0.1/customers/${encodeURIComponent(customerId)}/payment-instruments`,
  );
  if (!res.ok) return [];
  return res.json();
}

export async function deactivateInstrument(customerId: string, token: string): Promise<boolean> {
  const res = await sumupApi(
    `/v0.1/customers/${encodeURIComponent(customerId)}/payment-instruments/${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  return res.ok;
}

// Server-side collection from the stored card: create a checkout bound to the
// customer, then complete it with the stored instrument's token.
export async function chargeStoredCard(params: {
  chargeId: string;
  amountPence: number;
  description?: string;
  customerId: string;
  token: string;
}): Promise<SumUpCheckout> {
  const created = await sumupApi(`/v0.1/checkouts`, {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: `charge:${params.chargeId}:${Date.now()}`,
      amount: Number((params.amountPence / 100).toFixed(2)),
      currency: "GBP",
      merchant_code: sumupMerchantCode(),
      description: params.description,
      customer_id: params.customerId,
    }),
  });
  if (!created.ok) {
    throw new Error(`SumUp stored-card checkout failed (${created.status}): ${await created.text()}`);
  }
  const checkout: SumUpCheckout = await created.json();
  const completed = await sumupApi(`/v0.1/checkouts/${encodeURIComponent(checkout.id)}`, {
    method: "PUT",
    body: JSON.stringify({ payment_type: "card", token: params.token }),
  });
  if (!completed.ok) {
    throw new Error(`SumUp stored-card completion failed (${completed.status}): ${await completed.text()}`);
  }
  return completed.json();
}

// Transactions listed straight from SumUp — the other side of the
// reconciliation report.
export type SumUpTransaction = {
  id: string;
  transaction_code: string;
  amount: number;
  currency: string;
  timestamp: string;
  status: string;
  payment_type?: string;
  type?: string;
};

export async function listSumUpTransactions(params: {
  oldestTime?: string;
  newestTime?: string;
  limit?: number;
}): Promise<SumUpTransaction[]> {
  const qs = new URLSearchParams();
  if (params.oldestTime) qs.set("oldest_time", params.oldestTime);
  if (params.newestTime) qs.set("newest_time", params.newestTime);
  qs.set("limit", String(params.limit ?? 200));
  const res = await sumupApi(`/v0.1/me/transactions/history?${qs.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.items ?? []) as SumUpTransaction[];
}

// Idempotently record a paid finance checkout in the ledger. Safe to call from
// the widget finalize action, the webhook and the cron — the unique index on
// payments.sumup_checkout_id means at most one row can ever land.
export async function recordSumUpChargePaymentIfPaid(
  checkoutId: string,
): Promise<{ recorded: boolean; present: boolean; status?: string; chargeId?: string }> {
  const checkout = await getSumUpCheckout(checkoutId);
  if (!checkout) return { recorded: false, present: false };

  const txnSuccessful = (checkout.transactions ?? []).some(
    (t) => (t.status ?? "").toUpperCase() === "SUCCESSFUL",
  );
  const isPaid = checkout.status === "PAID" || txnSuccessful;
  if (!isPaid) return { recorded: false, present: false, status: checkout.status };

  const ref = String(checkout.checkout_reference ?? "");
  if (!ref.startsWith("charge:")) return { recorded: false, present: false, status: checkout.status };
  const chargeId = ref.split(":")[1];
  if (!chargeId) return { recorded: false, present: false, status: checkout.status };

  const admin = createAdminClient();
  const amountPence = Math.round(Number(checkout.amount || 0) * 100);
  const txnCode = checkout.transaction_code || checkout.transactions?.[0]?.transaction_code || null;

  const { error: insertErr } = await admin.from("payments").insert({
    charge_id: chargeId,
    amount_pence: amountPence,
    paid_at: new Date().toISOString(),
    method: "sumup",
    source: "sumup",
    sumup_checkout_id: checkoutId,
    sumup_txn_code: txnCode,
    note: "Paid online (SumUp)",
  });
  if (insertErr) {
    // 23505 on the sumup_checkout_id unique index = already recorded. Fine.
    if (insertErr.code === "23505") return { recorded: false, present: true, status: checkout.status, chargeId };
    console.error("[sumup-finance] failed to insert payment", insertErr);
    return { recorded: false, present: false, status: checkout.status, chargeId };
  }

  // A SETUP_RECURRING_PAYMENT checkout also stored the card: activate the
  // mandate with what SumUp now knows about the instrument.
  if (checkout.purpose === "SETUP_RECURRING_PAYMENT" && checkout.customer_id) {
    try {
      const instruments = await listCustomerInstruments(checkout.customer_id);
      const active = instruments.find((i) => i.active);
      const { data: charge } = await admin
        .from("charges")
        .select("account_id")
        .eq("id", chargeId)
        .maybeSingle();
      if (charge) {
        await admin
          .from("payment_mandates")
          .update({
            status: "active",
            sumup_checkout_id: checkoutId,
            card_last4: active?.card?.last_4_digits ?? null,
            card_type: active?.card?.type ?? null,
            consented_at: new Date().toISOString(),
          })
          .eq("account_id", charge.account_id)
          .eq("status", "pending");
      }
    } catch (e) {
      console.error("[sumup-finance] mandate activation failed:", e);
    }
  }

  return { recorded: true, present: true, status: checkout.status, chargeId };
}
