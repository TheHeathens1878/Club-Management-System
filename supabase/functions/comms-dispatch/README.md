# comms-dispatch (P4.4)

Drains `queued_messages()` (batch 100) and delivers each row through its
provider, then marks it `sent` or `failed`.

| Channel | Provider | Marked with |
|---|---|---|
| `email` | Resend REST (`POST https://api.resend.com/emails`) | provider `resend`, ref = Resend message id |
| `sms` | Twilio REST (`Accounts/<sid>/Messages.json`) | provider `twilio`, ref = message SID |
| `push` | Expo (`https://exp.host/--/api/v2/push/send`), tokens from `push_tokens` | provider `expo`, ref = first ticket id |
| `in_app` | none — the row *is* the message | provider `in_app` |

**Trigger:** `pg_cron` → `public.invoke_edge_function('comms-dispatch')`.
Suggested schedule **`*/5 * * * *`** (every 5 minutes). At batch 100 that is up
to 1,200 messages an hour, comfortably more than the club will ever send; the
response includes `more_likely: true` when the batch filled, so a backlog is
visible.

**`verify_jwt = true`** and `requireServiceRole` accepts only the service-role
key.

## Failure handling

Every row reaches a terminal state in the run that picks it up. There is no
retry loop and no sleep: `mark_message_failed` records why, and the row stays as
evidence. A **missing provider secret is data, not an exception** — those rows
are marked failed with a message naming the secret, the other channels still go
out, and the invocation returns 200.

Expo tokens that come back `DeviceNotRegistered` are deleted from `push_tokens`
so the next push is not wasted on them.

## Secrets

    supabase secrets set RESEND_API_KEY=re_...
    supabase secrets set COMMS_FROM_EMAIL="AoM Sports Club <noreply@example.org>"
    supabase secrets set TWILIO_ACCOUNT_SID=AC...
    supabase secrets set TWILIO_AUTH_TOKEN=...
    supabase secrets set TWILIO_FROM=+447700900000
    supabase secrets set EXPO_ACCESS_TOKEN=...        # optional; only if Expo push security is enabled

## Depends on a migration

`push_tokens(person_id, token, platform, updated_at)` — draft written to the
scratchpad as `20260823240000_push_tokens.sql`; it must be applied before the
push channel can deliver anything.
