import { createAdminClient } from "@/lib/supabase/admin";
import {
  attemptDisposition,
  checkoutIsPaid,
  collectionReference,
  MIN_CARD_PENCE,
  outstandingPence,
} from "@/lib/collection";
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
// The checkout_reference for every finance checkout starts `charge:<chargeId>:`
// — a member's own checkout ends `:<ts>`, a stored-card collection
// `:auto:<attempt>` — and recordSumUpChargePaymentIfPaid() parses the id
// back. Bookings keep their own `<bookingId>:<purpose>:<ts>` scheme in
// sumup.ts.

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

// A checkout by id: null when SumUp has never heard of it, an exception when
// SumUp could not answer. The distinction matters below — "not found" is a
// fact about the checkout, "no answer" is not, and only the first may be
// acted on.
async function fetchCheckout(id: string): Promise<SumUpCheckout | null> {
  const res = await sumupApi(`/v0.1/checkouts/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SumUp checkout lookup failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Checkouts by our own reference — how an attempt whose id was never stored
// is found again.
async function listCheckoutsByReference(reference: string): Promise<SumUpCheckout[]> {
  const res = await sumupApi(`/v0.1/checkouts?checkout_reference=${encodeURIComponent(reference)}`);
  if (!res.ok) throw new Error(`SumUp checkout search failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as SumUpCheckout[]) : [];
}

export type CollectionOutcome =
  /** The card was charged just now and the payment is on the ledger. */
  | { outcome: "collected"; checkoutId: string; amountPence: number }
  /** An earlier attempt had already charged the card; it is now recorded. */
  | { outcome: "recovered"; checkoutId: string }
  /** Nothing is outstanding (paid, waived, void, or over-paid). */
  | { outcome: "settled" }
  /** Outstanding, but under SumUp's £1.00 minimum. */
  | { outcome: "below_minimum"; outstandingPence: number }
  /** Another run holds a recent, unfinished attempt on this charge. */
  | { outcome: "in_flight" }
  /** SumUp refused, or could not be asked; the card was not charged by us. */
  | { outcome: "failed"; reason: string; status?: string };

/**
 * Server-side collection of what is still owed on a charge from the account's
 * stored card. THE ONE DOOR for the nightly run and the treasurer's "collect
 * now" alike (Codex review 2026-09-05, findings 4 and 5).
 *
 * In order:
 *   1. Reconcile. Every `collection_attempts` row still `started` is looked up
 *      at SumUp (by checkout id, or by its reference when the run that made it
 *      died before storing the id). Paid → record it and stop: that IS the
 *      collection. Failed/expired → close it. Pending and recent → stop, it is
 *      somebody else's. Pending and old → abandon it; nobody will complete it.
 *      SumUp not answering → stop, and do not charge: a checkout whose fate is
 *      unknown might have been paid.
 *   2. Outstanding = amount less payments net of refunds, read from the
 *      ledger now, not the face value.
 *   3. Claim: insert the next attempt row. The unique (charge_id, attempt_no)
 *      makes two concurrent runs collide, and the loser leaves.
 *   4. Only then: create the checkout (deterministic reference), store its id
 *      on the attempt, complete it with the stored instrument, record.
 */
export async function collectChargeFromStoredCard(params: {
  chargeId: string;
  description?: string | null;
  customerId: string;
  token: string;
}): Promise<CollectionOutcome> {
  const admin = createAdminClient();
  const now = Date.now();

  async function finishAttempt(
    attemptId: string,
    status: "paid" | "failed" | "abandoned",
    detail: { sumupStatus?: string | null; error?: string | null; checkoutId?: string | null } = {},
  ) {
    await admin
      .from("collection_attempts")
      .update({
        status,
        finished_at: new Date().toISOString(),
        sumup_status: detail.sumupStatus ?? null,
        error: detail.error ?? null,
        ...(detail.checkoutId ? { sumup_checkout_id: detail.checkoutId } : {}),
      })
      .eq("id", attemptId);
  }

  // 1. Reconcile what was started and never finished.
  const { data: open, error: openErr } = await admin
    .from("collection_attempts")
    .select("id,attempt_no,checkout_reference,sumup_checkout_id,started_at")
    .eq("charge_id", params.chargeId)
    .eq("status", "started")
    .order("attempt_no");
  if (openErr) return { outcome: "failed", reason: `could not read collection attempts: ${openErr.message}` };

  for (const attempt of open ?? []) {
    let checkout: SumUpCheckout | null = null;
    try {
      if (attempt.sumup_checkout_id) {
        checkout = await fetchCheckout(attempt.sumup_checkout_id);
      } else {
        checkout = (await listCheckoutsByReference(attempt.checkout_reference))[0] ?? null;
      }
    } catch (e) {
      return {
        outcome: "failed",
        reason: `SumUp could not be asked about attempt ${attempt.attempt_no}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    // An id we stored that SumUp now denies knowing is not "no checkout" —
    // it is an answer we do not understand, and the safe reading of that is
    // to stop rather than to charge again.
    if (attempt.sumup_checkout_id && !checkout) {
      return { outcome: "failed", reason: `SumUp no longer returns checkout ${attempt.sumup_checkout_id} for attempt ${attempt.attempt_no}` };
    }

    const disposition = attemptDisposition({ checkout, startedAt: attempt.started_at, now });
    if (disposition === "paid") {
      const recorded = await recordSumUpChargePaymentIfPaid(checkout!.id);
      if (recorded.failed) return { outcome: "failed", reason: "the payment could not be written to the ledger" };
      await finishAttempt(attempt.id, "paid", { sumupStatus: checkout!.status, checkoutId: checkout!.id });
      return { outcome: "recovered", checkoutId: checkout!.id };
    }
    if (disposition === "in_flight") return { outcome: "in_flight" };
    await finishAttempt(attempt.id, disposition, {
      sumupStatus: checkout?.status ?? null,
      checkoutId: checkout?.id ?? null,
      error: disposition === "abandoned" ? "never completed; past the in-flight window" : null,
    });
  }

  // 2. What is owed, from the ledger, now.
  const { data: charge, error: chargeErr } = await admin
    .from("charges")
    .select("id,status,amount_pence,payments(amount_pence,refunded_pence)")
    .eq("id", params.chargeId)
    .maybeSingle();
  if (chargeErr || !charge) return { outcome: "failed", reason: chargeErr?.message ?? "charge not found" };
  if (charge.status !== "pending") return { outcome: "settled" };
  const outstanding = outstandingPence(charge.amount_pence, charge.payments ?? []);
  if (outstanding <= 0) return { outcome: "settled" };
  if (outstanding < MIN_CARD_PENCE) return { outcome: "below_minimum", outstandingPence: outstanding };

  // 3. Claim the attempt.
  const { data: last } = await admin
    .from("collection_attempts")
    .select("attempt_no")
    .eq("charge_id", params.chargeId)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attemptNo = (last?.attempt_no ?? 0) + 1;
  const reference = collectionReference(params.chargeId, attemptNo);
  const { data: claimed, error: claimErr } = await admin
    .from("collection_attempts")
    .insert({
      charge_id: params.chargeId,
      attempt_no: attemptNo,
      checkout_reference: reference,
      amount_pence: outstanding,
      status: "started",
    })
    .select("id")
    .single();
  if (claimErr || !claimed) {
    if (claimErr?.code === "23505") return { outcome: "in_flight" };
    return { outcome: "failed", reason: `could not claim the attempt: ${claimErr?.message ?? "no row"}` };
  }

  // 4. Ask SumUp.
  let checkout: SumUpCheckout;
  try {
    const created = await sumupApi(`/v0.1/checkouts`, {
      method: "POST",
      body: JSON.stringify({
        checkout_reference: reference,
        amount: Number((outstanding / 100).toFixed(2)),
        currency: "GBP",
        merchant_code: sumupMerchantCode(),
        description: params.description ?? undefined,
        customer_id: params.customerId,
      }),
    });
    if (!created.ok) {
      throw new Error(`SumUp stored-card checkout failed (${created.status}): ${await created.text()}`);
    }
    checkout = await created.json();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await finishAttempt(claimed.id, "failed", { error: reason });
    return { outcome: "failed", reason };
  }
  await admin.from("collection_attempts").update({ sumup_checkout_id: checkout.id }).eq("id", claimed.id);

  const completed = await sumupApi(`/v0.1/checkouts/${encodeURIComponent(checkout.id)}`, {
    method: "PUT",
    body: JSON.stringify({ payment_type: "card", token: params.token }),
  });
  let final: SumUpCheckout | null = null;
  let completionError: string | null = null;
  if (completed.ok) {
    final = await completed.json();
  } else {
    completionError = `SumUp stored-card completion failed (${completed.status}): ${await completed.text()}`;
    // The completion call failing is not the same as the card not being
    // charged. Ask once more before deciding; if SumUp cannot say, the
    // attempt stays open for the next run to reconcile.
    try {
      final = await fetchCheckout(checkout.id);
    } catch {
      return { outcome: "failed", reason: completionError };
    }
  }

  const recorded = await recordSumUpChargePaymentIfPaid(checkout.id);
  if (recorded.recorded || recorded.present) {
    await finishAttempt(claimed.id, "paid", { sumupStatus: final?.status ?? checkout.status });
    return { outcome: "collected", checkoutId: checkout.id, amountPence: outstanding };
  }
  if (recorded.failed) {
    // Paid at SumUp, not on the ledger. Leave the attempt open: the next
    // run's reconcile pass will record it, and nothing will charge again.
    return { outcome: "failed", reason: "the payment could not be written to the ledger", status: final?.status };
  }
  const status = final?.status ?? recorded.status ?? "unknown";
  await finishAttempt(claimed.id, "failed", { sumupStatus: status, error: completionError });
  return { outcome: "failed", reason: completionError ?? `checkout ended ${status}`, status };
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
//
// `failed` means SumUp says paid and the ledger write did not happen — the
// one answer a caller must not treat as "nothing to do". The webhook answers
// it with a 5xx so SumUp redelivers; the collector leaves its attempt open so
// the next run records it.
export async function recordSumUpChargePaymentIfPaid(
  checkoutId: string,
): Promise<{ recorded: boolean; present: boolean; status?: string; chargeId?: string; failed?: boolean }> {
  const checkout = await getSumUpCheckout(checkoutId);
  if (!checkout) return { recorded: false, present: false };

  if (!checkoutIsPaid(checkout)) return { recorded: false, present: false, status: checkout.status };

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
    return { recorded: false, present: false, status: checkout.status, chargeId, failed: true };
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
