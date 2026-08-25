# Edge Functions

Deno / TypeScript, deployed with `supabase functions deploy <name>`. Every
function is registered in `supabase/config.toml` under `[functions.<name>]`.

House rules, all inherited from `fulltime-import`:

- `Deno.serve`, `npm:@supabase/supabase-js@2`, JSON in and JSON out.
- The database owns the rules. A function fetches, formats and calls an RPC; it
  never re-implements a guard, a consent filter or an eligibility check that
  the migrations already express.
- Where a function needs to act *as the caller* (consent, RLS, participant
  scoping) it builds a user-scoped client from the caller's JWT, even though it
  also holds the service key. Holding the service key is not authorisation.
- **Never retry in a tight loop.** A scheduled job attempts each item once and
  records the outcome; the next run picks up what is still outstanding. Where an
  external system has its own retry (Stripe), we let it do the retrying.
- A missing feature secret is reported as data (503, or a `failed` row that
  names the secret), not thrown. A scheduled job that dies on a config problem
  disappears into the logs.

## The functions

| Function | `verify_jwt` | Trigger | What it does |
|---|---|---|---|
| `fulltime-import` | `true` | cron `15 3 * * *` + manual POST | P2.4 FA Full-Time fixture import. |
| `stripe-webhook` | **`false`** | Stripe webhook endpoint | P4.1. Verifies the signature, records the delivery in `stripe_events`, applies it to `subscriptions` / `payments`. |
| `stripe-checkout` | `true` | the app, as the payer | P4.1. Creates a Checkout Session for a pending subscription; returns `{ url }`. |
| `arrears-reminders` | `true` | cron `0 9 * * 2` | P4.2. Tiered subs chasing (14 / 30 / 60 days), one send per tier ever. |
| `safeguarding-nudges` | `true` | cron `30 6 * * *` | P4.3. Certification expiry 90/30/7, the compliance report, the SG-1 nightly check. |
| `comms-dispatch` | `true` | cron `*/5 * * * *` | P4.4. Drains `queued_messages()` to Resend / Twilio / Expo. |
| `media-quarantine` | `true` | cron `*/10 * * * *` | P4.5. Moves flagged objects to `quarantine/…` so live signed URLs break. |
| `media-signed-url` | `true` | the app, as a member | P4.5. Consent-filtered signed URLs, TTL ≤ 900s. |
| `push-fanout` | **`false`** | Database Webhook on `messages` INSERT | P5.5. One push per active, unmuted participant; body withheld when the conversation has a minor. |
| `id-docs-purge` | `true` | cron `20 5 * * *` | Destroys identity documents three years after upload: removes the object, then stamps `purged_at` and nulls the path. The row survives. |

`verify_jwt = false` is only for the two callers that cannot present a Supabase
JWT: Stripe (proved by `stripe-signature`) and the Database Webhook (proved by
`x-webhook-secret`). Both check their own credential before doing anything.

The scheduled functions accept **only** the service-role key
(`requireServiceRole`), so `verify_jwt = true` plus that check means the
scheduler is the only possible caller.

## Suggested schedules — for a follow-up migration

None of these are scheduled yet. Add them the way P2.4 did, through
`public.invoke_edge_function()` (which reads the project URL and service-role
key from Vault and skips quietly if either is unset):

```sql
select cron.schedule('comms-dispatch',      '*/5 * * * *',  $cron$ select public.invoke_edge_function('comms-dispatch')      $cron$);
select cron.schedule('media-quarantine',    '*/10 * * * *', $cron$ select public.invoke_edge_function('media-quarantine')    $cron$);
select cron.schedule('safeguarding-nudges', '30 6 * * *',   $cron$ select public.invoke_edge_function('safeguarding-nudges') $cron$);
select cron.schedule('arrears-reminders',   '0 9 * * 2',    $cron$ select public.invoke_edge_function('arrears-reminders')   $cron$);
```

Times are UTC. The reasoning:

- **comms-dispatch every 5 minutes** — the delivery lag anyone actually feels.
  Batch 100 is 1,200 messages an hour, far beyond club volume, and the response
  reports `more_likely: true` when a batch fills so a backlog is visible.
- **media-quarantine every 10 minutes** — consent withdrawal is immediate at
  query level already; this bounds how long an *already-issued* 15-minute signed
  URL can outlive it. It is a no-op when nothing is flagged.
- **safeguarding-nudges 06:30 daily** — in the lead's inbox at the start of the
  day, after the previous day's data has settled. Run it before the arrears job
  so a safeguarding backlog is never behind a subs backlog.
- **arrears-reminders 09:00 Tuesdays** — weekly is enough for a debt chase, a
  fixed weekday is predictable for the treasurer, and mid-morning midweek is
  when a payment link actually gets clicked.

`stripe-webhook`, `stripe-checkout`, `media-signed-url` and `push-fanout` are
event- or request-driven and are never scheduled.

## Secrets

Platform-provided (do not set): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

```
supabase secrets set STRIPE_SECRET_KEY=sk_test_...          # stripe-checkout, stripe-webhook
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...        # stripe-webhook
supabase secrets set PUBLIC_SITE_URL=https://...            # stripe-checkout return URLs
supabase secrets set AZURE_TENANT_ID=... AZURE_CLIENT_ID=... AZURE_CLIENT_SECRET=... MAIL_FROM=...   # comms-dispatch (email via Microsoft Graph; same values as the web app)
supabase secrets set COMMS_FROM_EMAIL="AoM Sports Club <noreply@example.org>"
supabase secrets set TWILIO_ACCOUNT_SID=AC...               # comms-dispatch (sms)
supabase secrets set TWILIO_AUTH_TOKEN=...
supabase secrets set TWILIO_FROM=+447700900000
supabase secrets set EXPO_ACCESS_TOKEN=...                  # optional, comms-dispatch (push)
supabase secrets set WEBHOOK_SECRET=<long random string>    # push-fanout; also the Database Webhook header
```

Nothing above belongs in the repo. Stripe stays in test mode until P4.1 is
signed off.

## Also needed

`comms-dispatch` and `push-fanout` need the `push_tokens` table. The migration
draft is `20260823240000_push_tokens.sql` (scratchpad) — rehearse it on a branch
before deploying the push path.

## `_shared`

`_shared/env.ts`, `_shared/auth.ts` and `_shared/comms.ts` are the helpers every
function here uses. `_shared/fulltime/` is a synced copy of `packages/fulltime`
— see `_shared/README.md`.
