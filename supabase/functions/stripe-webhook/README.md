# stripe-webhook (P4.1)

Stripe's webhook endpoint. Verifies the signature, records the delivery in
`stripe_events`, and applies the event to `subscriptions` / `payments`.

**Trigger:** Stripe. Add the endpoint in the Stripe dashboard (test mode first):

    https://<project-ref>.supabase.co/functions/v1/stripe-webhook

**`verify_jwt = false`** — Stripe cannot present a Supabase JWT. Authenticity is
the `stripe-signature` header, checked against `STRIPE_WEBHOOK_SECRET` over the
raw body before anything else happens.

## Events handled

| Event | Effect |
|---|---|
| `checkout.session.completed` | `subscriptions` ← `stripe_customer_id`, `stripe_subscription_id`, `stripe_checkout_session_id`, `status = 'active'`. The subscription is found from `session.metadata.subscription_id`, which `stripe-checkout` sets. |
| `invoice.paid` | inserts a `payments` row (`subscription_id`, `amount_pence`, `method = 'card'`, `source = 'stripe'`, `stripe_payment_intent_id`, `stripe_invoice_id`, `stripe_charge_id`); flips `past_due` back to `active`. |
| `invoice.payment_failed` | `status = 'past_due'` (never on an already cancelled/completed subscription). |
| `customer.subscription.deleted` | `status = 'completed'` if the ledger covers `amount_due_pence`, otherwise `'cancelled'`. |
| `charge.refunded` | `refunded_pence` / `refunded_at` on the matching payment, capped at the payment amount by `payments_refund_within_amount`. |

Anything else is recorded and ignored.

## Idempotency and retries

The delivery is upserted into `stripe_events` with `ignoreDuplicates` (ON
CONFLICT DO NOTHING) and `.select()`: a returned row means this instance is the
first to see the event. A duplicate whose `processed_at` is already stamped
returns `200 { duplicate: true }` and does no work; a duplicate that never
finished is retried. Success stamps `processed_at`; failure records `error`,
leaves `processed_at` null and returns 500 so **Stripe** retries on its own
exponential backoff. The function never retries in a loop of its own.

`payments` has a *partial* unique index on `stripe_payment_intent_id`, which
`ON CONFLICT` cannot infer, so the duplicate-payment check is an explicit
select plus a 23505 catch on the insert.

## Secrets

    supabase secrets set STRIPE_SECRET_KEY=sk_test_...
    supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are provided
by the platform. Without the two Stripe secrets the function returns 503 and
does nothing.
