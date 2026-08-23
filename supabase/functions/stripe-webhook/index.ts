// stripe-webhook — P4.1. Stripe's deliveries, turned into subscription status
// and ledger rows.
//
// AUTH. `verify_jwt = false`: Stripe cannot present a Supabase JWT. The proof
// of authenticity is the `stripe-signature` header, verified against
// STRIPE_WEBHOOK_SECRET with the raw body before anything is parsed. A request
// that fails that check gets 400 and is never looked at again.
//
// IDEMPOTENCY. Every delivery is inserted into `stripe_events` first, keyed by
// Stripe's event id, with `ignoreDuplicates` (PostgREST's ON CONFLICT DO
// NOTHING). The insert returning a row means *we* are the first to see this
// event; no row back means a duplicate, and we only re-process it if the
// original attempt never stamped `processed_at` (i.e. it failed). Processing
// then stamps `processed_at`, or records `error` and returns 500 so Stripe
// retries on its own exponential backoff — this function never loops.
//
// The service client is used throughout: `stripe_events` is service_role-only,
// and `subscriptions_guard()` allows a status change when `auth.uid()` is null.

import Stripe from "npm:stripe@17";
import { adminClient, type Client, json } from "../_shared/auth.ts";
import { optionalEnv } from "../_shared/env.ts";

// ---------------------------------------------------------------------------
// Narrow shapes for the bits of Stripe we read. Deliberately local rather than
// Stripe's own types: the fields below have moved between API versions and we
// want to read whichever spelling arrives without a compile-time argument.
// ---------------------------------------------------------------------------

type Ref = string | { id?: string } | null | undefined;

type StripeSession = {
  id: string;
  customer?: Ref;
  subscription?: Ref;
  payment_intent?: Ref;
  metadata?: Record<string, string> | null;
};

type StripeInvoice = {
  id?: string;
  customer?: Ref;
  subscription?: Ref;
  payment_intent?: Ref;
  charge?: Ref;
  amount_paid?: number | null;
  amount_due?: number | null;
  metadata?: Record<string, string> | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  // API 2025-x moved these under `parent` / `payments`.
  parent?: {
    subscription_details?: {
      subscription?: Ref;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  payments?: {
    data?: { payment?: { payment_intent?: Ref; charge?: Ref } | null }[] | null;
  } | null;
};

type StripeSubscription = {
  id: string;
  customer?: Ref;
  metadata?: Record<string, string> | null;
};

type StripeChargeObject = {
  id: string;
  payment_intent?: Ref;
  amount_refunded?: number | null;
  invoice?: Ref;
};

type SubscriptionRow = {
  id: string;
  status: string;
  amount_due_pence: number;
};

function idOf(ref: Ref): string | null {
  if (typeof ref === "string" && ref !== "") return ref;
  if (ref && typeof ref === "object" && typeof ref.id === "string") return ref.id;
  return null;
}

// ---------------------------------------------------------------------------
// Resolving "which of our subscriptions is this about?"
// ---------------------------------------------------------------------------

async function subscriptionById(admin: Client, id: string): Promise<SubscriptionRow | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("id, status, amount_due_pence")
    .eq("id", id)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

async function subscriptionByStripeId(admin: Client, stripeId: string): Promise<SubscriptionRow | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("id, status, amount_due_pence")
    .eq("stripe_subscription_id", stripeId)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

function invoiceMetadataSubscriptionId(inv: StripeInvoice): string | null {
  return inv.metadata?.subscription_id
    ?? inv.subscription_details?.metadata?.subscription_id
    ?? inv.parent?.subscription_details?.metadata?.subscription_id
    ?? null;
}

function invoiceStripeSubscriptionId(inv: StripeInvoice): string | null {
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription);
}

function invoicePaymentIds(inv: StripeInvoice): { intent: string | null; charge: string | null } {
  const first = inv.payments?.data?.[0]?.payment ?? null;
  return {
    intent: idOf(inv.payment_intent) ?? idOf(first?.payment_intent),
    charge: idOf(inv.charge) ?? idOf(first?.charge),
  };
}

async function resolveInvoiceSubscription(admin: Client, inv: StripeInvoice): Promise<SubscriptionRow | null> {
  const metaId = invoiceMetadataSubscriptionId(inv);
  if (metaId) {
    const byMeta = await subscriptionById(admin, metaId);
    if (byMeta) return byMeta;
  }
  const stripeSubId = invoiceStripeSubscriptionId(inv);
  if (stripeSubId) return await subscriptionByStripeId(admin, stripeSubId);
  return null;
}

// ---------------------------------------------------------------------------
// Handlers. Each throws on a condition worth retrying and returns a short
// description of what it did otherwise.
// ---------------------------------------------------------------------------

async function onCheckoutCompleted(admin: Client, session: StripeSession): Promise<string> {
  const subscriptionId = session.metadata?.subscription_id ?? null;
  if (!subscriptionId) return "ignored: session carries no subscription_id metadata";

  const sub = await subscriptionById(admin, subscriptionId);
  if (!sub) throw new Error(`checkout.session.completed: no subscription ${subscriptionId}`);

  const patch: Record<string, unknown> = {
    status: "active",
    stripe_checkout_session_id: session.id,
  };
  const customer = idOf(session.customer);
  if (customer) patch.stripe_customer_id = customer;
  const stripeSub = idOf(session.subscription);
  if (stripeSub) patch.stripe_subscription_id = stripeSub;

  const { error } = await admin.from("subscriptions").update(patch).eq("id", subscriptionId);
  if (error) throw new Error(`checkout.session.completed: ${error.message}`);
  return `subscription ${subscriptionId} active`;
}

async function onInvoicePaid(admin: Client, inv: StripeInvoice): Promise<string> {
  const sub = await resolveInvoiceSubscription(admin, inv);
  if (!sub) return "ignored: invoice does not match a known subscription";

  const amount = inv.amount_paid ?? 0;
  if (amount <= 0) return `ignored: invoice ${inv.id ?? "?"} paid 0`;

  const { intent, charge } = invoicePaymentIds(inv);

  // `payments` has a partial unique index on stripe_payment_intent_id, which
  // ON CONFLICT cannot infer, so the duplicate check is explicit. Two Stripe
  // deliveries of the same invoice must not double-credit the member.
  const dupe = admin.from("payments").select("id");
  const { data: existing } = intent
    ? await dupe.eq("stripe_payment_intent_id", intent).limit(1)
    : await dupe.eq("stripe_invoice_id", inv.id ?? "").eq("subscription_id", sub.id).limit(1);
  if ((existing ?? []).length > 0) return `already recorded for invoice ${inv.id ?? "?"}`;

  const { error } = await admin.from("payments").insert({
    booking_id: null,
    subscription_id: sub.id,
    amount_pence: amount,
    method: "card",
    source: "stripe",
    reference: inv.id ?? null,
    stripe_payment_intent_id: intent,
    stripe_invoice_id: inv.id ?? null,
    stripe_charge_id: charge,
  });
  if (error) {
    // 23505 = someone else won the race between the check and the insert.
    if (error.code === "23505") return `already recorded for invoice ${inv.id ?? "?"}`;
    throw new Error(`invoice.paid: ${error.message}`);
  }

  if (sub.status === "past_due") {
    await admin.from("subscriptions").update({ status: "active" }).eq("id", sub.id);
  }
  return `payment of ${amount}p recorded against ${sub.id}`;
}

async function onInvoiceFailed(admin: Client, inv: StripeInvoice): Promise<string> {
  const sub = await resolveInvoiceSubscription(admin, inv);
  if (!sub) return "ignored: invoice does not match a known subscription";
  if (sub.status === "cancelled" || sub.status === "completed") {
    return `ignored: ${sub.id} is ${sub.status}`;
  }
  const { error } = await admin.from("subscriptions").update({ status: "past_due" }).eq("id", sub.id);
  if (error) throw new Error(`invoice.payment_failed: ${error.message}`);
  return `subscription ${sub.id} past_due`;
}

async function onSubscriptionDeleted(admin: Client, s: StripeSubscription): Promise<string> {
  const sub = (s.metadata?.subscription_id ? await subscriptionById(admin, s.metadata.subscription_id) : null)
    ?? await subscriptionByStripeId(admin, s.id);
  if (!sub) return `ignored: no subscription for stripe id ${s.id}`;

  // Paid in full ⇒ the plan ran its course; still owing ⇒ it was cancelled.
  const { data: paidRows } = await admin
    .from("payments")
    .select("amount_pence, refunded_pence")
    .eq("subscription_id", sub.id);
  const paid = ((paidRows ?? []) as { amount_pence: number; refunded_pence: number }[])
    .reduce((t, p) => t + p.amount_pence - p.refunded_pence, 0);
  const status = paid >= sub.amount_due_pence ? "completed" : "cancelled";

  const { error } = await admin
    .from("subscriptions")
    .update({ status, cancel_reason: "stripe: customer.subscription.deleted" })
    .eq("id", sub.id);
  if (error) throw new Error(`customer.subscription.deleted: ${error.message}`);
  return `subscription ${sub.id} ${status}`;
}

async function onChargeRefunded(admin: Client, charge: StripeChargeObject): Promise<string> {
  const intent = idOf(charge.payment_intent);
  const find = admin.from("payments").select("id, amount_pence");
  const { data: rows } = intent
    ? await find.or(`stripe_charge_id.eq.${charge.id},stripe_payment_intent_id.eq.${intent}`).limit(1)
    : await find.eq("stripe_charge_id", charge.id).limit(1);
  const payment = ((rows ?? []) as { id: string; amount_pence: number }[])[0] ?? null;
  if (!payment) return `ignored: no payment for charge ${charge.id}`;

  // `payments_refund_within_amount` refuses a refund larger than the payment.
  const refunded = Math.min(charge.amount_refunded ?? 0, payment.amount_pence);
  const { error } = await admin
    .from("payments")
    .update({ refunded_pence: refunded, refunded_at: new Date().toISOString() })
    .eq("id", payment.id);
  if (error) throw new Error(`charge.refunded: ${error.message}`);
  return `payment ${payment.id} refunded ${refunded}p`;
}

async function process(admin: Client, event: Stripe.Event): Promise<string> {
  const object = event.data.object as unknown;
  switch (event.type) {
    case "checkout.session.completed":
      return await onCheckoutCompleted(admin, object as StripeSession);
    case "invoice.paid":
      return await onInvoicePaid(admin, object as StripeInvoice);
    case "invoice.payment_failed":
      return await onInvoiceFailed(admin, object as StripeInvoice);
    case "customer.subscription.deleted":
      return await onSubscriptionDeleted(admin, object as StripeSubscription);
    case "charge.refunded":
      return await onChargeRefunded(admin, object as StripeChargeObject);
    default:
      return `ignored: ${event.type} is not handled`;
  }
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secretKey = optionalEnv("STRIPE_SECRET_KEY");
  const webhookSecret = optionalEnv("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    return json({ error: "stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing stripe-signature" }, 400);

  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    return json({ error: `signature verification failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  const admin = adminClient();

  // Insert-first idempotency. A returned row means the insert happened.
  const { data: inserted, error: insertError } = await admin
    .from("stripe_events")
    .upsert(
      {
        id: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) return json({ error: `stripe_events: ${insertError.message}` }, 500);

  const isNew = ((inserted ?? []) as { id: string }[]).length > 0;
  if (!isNew) {
    const { data: prior } = await admin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    if ((prior as { processed_at: string | null } | null)?.processed_at) {
      return json({ received: true, duplicate: true, event: event.id });
    }
    // Seen before but never finished: fall through and try again.
  }

  try {
    const outcome = await process(admin, event);
    await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", event.id);
    return json({ received: true, event: event.id, type: event.type, outcome });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("stripe_events").update({ error: message.slice(0, 1000) }).eq("id", event.id);
    // 500 so Stripe retries on its own backoff; `processed_at` stays null.
    return json({ received: true, event: event.id, error: message }, 500);
  }
});
