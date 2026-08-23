# stripe-checkout (P4.1)

Creates a Stripe Checkout Session for a pending subscription and returns its
URL.

**Trigger:** the web/mobile app.

    POST /functions/v1/stripe-checkout
    Authorization: Bearer <the member's JWT>
    { "subscription_id": "<uuid>" }

    → 200 { "url": "https://checkout.stripe.com/...", "session_id": "cs_..." }

**`verify_jwt = true`.** Authorisation is done with a *user-scoped* client: the
subscription must be readable by the caller under RLS **and** the caller must be
its `payer_person_id` (a `club_admin` may also start one). The subscription must
be `pending`; anything else is 409.

## Behaviour

- `billing = 'one_off'` → Checkout `mode: 'payment'`, with
  `invoice_creation.enabled = true` so Stripe emits `invoice.paid` and
  `stripe-webhook` can write the `payments` ledger row. Without it a one-off
  purchase would activate the subscription and never record the money.
- `billing = 'monthly' | 'annual'` → `mode: 'subscription'` against the plan's
  recurring price (`month` / `year`).
- If the plan has no `stripe_price_id`, the product and price are created on the
  fly (GBP, `unit_amount = amount_pence`) and both ids are written back to
  `subscription_plans` with the service client.
- `metadata.subscription_id` is set on the session, and mirrored onto
  `subscription_data` / `payment_intent_data` / the generated invoice, so every
  later webhook resolves back to our row without guessing.

`instalments` on a monthly plan is not yet expressed in Stripe — the
subscription runs until cancelled. Capping it at N instalments needs either a
schedule or a cancellation job; noted for follow-up.

## Secrets

    supabase secrets set STRIPE_SECRET_KEY=sk_test_...
    supabase secrets set PUBLIC_SITE_URL=https://<the web app>   # success/cancel URLs, defaults to http://localhost:3000
