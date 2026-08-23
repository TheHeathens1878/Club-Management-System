// stripe-checkout — P4.1. Turns a pending `subscriptions` row into a Stripe
// Checkout Session and hands back the URL.
//
// AUTH. `verify_jwt = true`, and the authorisation that matters is done with a
// *user-scoped* client: the caller must be able to read the subscription under
// RLS, and must be its payer (or a club_admin). The service client is only
// used afterwards, to write Stripe product/price ids back onto the plan —
// something the payer must not be able to do directly.
//
// The session carries `metadata.subscription_id` (and the same on the
// subscription/payment-intent behind it) so `stripe-webhook` can tie every
// later event back to our row without guessing.

import Stripe from "npm:stripe@17";
import {
  adminClient,
  callerPersonId,
  json,
  readJson,
  userClient,
} from "../_shared/auth.ts";
import { optionalEnv, siteUrl } from "../_shared/env.ts";

type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  amount_pence: number;
  billing: "one_off" | "monthly" | "annual";
  instalments: number | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  active: boolean;
};

type SubscriptionRow = {
  id: string;
  plan_id: string;
  person_id: string;
  payer_person_id: string;
  status: string;
  amount_due_pence: number;
  stripe_customer_id: string | null;
};

/** Creates the Stripe product/price for a plan the first time it is sold. */
async function ensurePrice(
  stripe: Stripe,
  admin: ReturnType<typeof adminClient>,
  plan: PlanRow,
): Promise<string> {
  if (plan.stripe_price_id) return plan.stripe_price_id;

  let productId = plan.stripe_product_id;
  if (!productId) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description ?? undefined,
      metadata: { plan_id: plan.id },
    });
    productId = product.id;
  }

  const recurring: Stripe.PriceCreateParams.Recurring | undefined = plan.billing === "monthly"
    ? { interval: "month" }
    : plan.billing === "annual"
    ? { interval: "year" }
    : undefined;

  const price = await stripe.prices.create({
    product: productId,
    currency: "gbp",
    unit_amount: plan.amount_pence,
    ...(recurring ? { recurring } : {}),
    metadata: { plan_id: plan.id },
  });

  const { error } = await admin
    .from("subscription_plans")
    .update({ stripe_product_id: productId, stripe_price_id: price.id })
    .eq("id", plan.id);
  if (error) throw new Error(`could not record the Stripe price on the plan: ${error.message}`);

  return price.id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secretKey = optionalEnv("STRIPE_SECRET_KEY");
  if (!secretKey) return json({ error: "stripe is not configured (STRIPE_SECRET_KEY)" }, 503);

  const asUser = userClient(req);
  if (!asUser) return json({ error: "unauthorised" }, 401);

  const body = await readJson(req);
  const subscriptionId = typeof body.subscription_id === "string" ? body.subscription_id : null;
  if (!subscriptionId) return json({ error: "subscription_id is required" }, 400);

  // Read as the caller: RLS decides whether this subscription exists for them.
  const { data: subData, error: subError } = await asUser
    .from("subscriptions")
    .select("id, plan_id, person_id, payer_person_id, status, amount_due_pence, stripe_customer_id")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (subError) return json({ error: subError.message }, 400);
  const sub = subData as SubscriptionRow | null;
  if (!sub) return json({ error: "no such subscription" }, 404);

  const personId = await callerPersonId(asUser);
  if (personId !== sub.payer_person_id) {
    const { data: isAdmin } = await asUser.rpc("is_club_admin");
    if (isAdmin !== true) return json({ error: "only the payer may start a checkout" }, 403);
  }

  if (sub.status !== "pending") {
    return json({ error: `subscription is ${sub.status}, not pending` }, 409);
  }

  const admin = adminClient();
  const { data: planData, error: planError } = await admin
    .from("subscription_plans")
    .select("id, name, description, amount_pence, billing, instalments, stripe_product_id, stripe_price_id, active")
    .eq("id", sub.plan_id)
    .maybeSingle();
  if (planError) return json({ error: planError.message }, 500);
  const plan = planData as PlanRow | null;
  if (!plan) return json({ error: "the subscription's plan is missing" }, 500);
  if (!plan.active) return json({ error: "that plan is no longer on sale" }, 409);

  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });

  let priceId: string;
  try {
    priceId = await ensurePrice(stripe, admin, plan);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  const { data: payer } = await admin
    .from("people")
    .select("email")
    .eq("id", sub.payer_person_id)
    .maybeSingle();
  const payerEmail = (payer as { email: string | null } | null)?.email ?? null;

  const mode: Stripe.Checkout.SessionCreateParams.Mode = plan.billing === "one_off"
    ? "payment"
    : "subscription";
  const base = siteUrl();

  const params: Stripe.Checkout.SessionCreateParams = {
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: sub.id,
    metadata: { subscription_id: sub.id },
    success_url: `${base}/account/subscriptions/${sub.id}?checkout=success`,
    cancel_url: `${base}/account/subscriptions/${sub.id}?checkout=cancelled`,
  };
  if (sub.stripe_customer_id) {
    params.customer = sub.stripe_customer_id;
  } else if (payerEmail) {
    params.customer_email = payerEmail;
  }
  if (mode === "subscription") {
    params.subscription_data = { metadata: { subscription_id: sub.id } };
  } else {
    // An invoice is what makes `invoice.paid` fire in payment mode, and
    // `invoice.paid` is what writes the ledger row.
    params.invoice_creation = { enabled: true, invoice_data: { metadata: { subscription_id: sub.id } } };
    params.payment_intent_data = { metadata: { subscription_id: sub.id } };
  }

  try {
    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) return json({ error: "Stripe returned a session with no URL" }, 502);
    return json({ url: session.url, session_id: session.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
