# push-fanout (P5.5)

One inserted `messages` row → one push per active participant, enqueued through
`enqueue_message` so `comms-dispatch` delivers it and `outbound_messages` records
it.

**Trigger:** a Supabase **Database Webhook** on `public.messages`, event
`INSERT`, method POST to

    https://<project-ref>.supabase.co/functions/v1/push-fanout

with an HTTP header `x-webhook-secret: <the WEBHOOK_SECRET value>`. Not a cron
job — the point is that it fires the moment the message lands.

**`verify_jwt = false`** — a Database Webhook cannot present a Supabase JWT. The
shared secret is compared timing-safely; the service-role key itself is also
accepted (byte for byte, never by reading its `role` claim — with JWT
verification off, a claim is unproven text) so a delivery can be replayed by
hand. If `WEBHOOK_SECRET` is not set, every request is 401 — the endpoint never
falls open.

## What reaches the lock screen

Per the P5.1 spec §6:

- **title** = sender's display name · conversation title (or a type label:
  Direct message / Group / Team / Announcement).
- **body** = the message text, truncated to 140 characters — **unless
  `conversation_has_minor(conversation_id)` is true**, in which case it is
  literally `New message`. A lock screen is not a participant, so for anything
  involving a child the reader has to open the app, where RLS applies. The
  database decides this, not the function.
- `data` carries `{ entity: 'conversations', entity_id: <conversation id> }`
  (set by `comms-dispatch` from the `outbound_messages` row) so the app can deep
  link.

## Who is skipped

- the sender;
- anyone who has left (`left_at is not null`);
- anyone muted (`muted_until` in the future);
- anyone with the push channel turned off in `comms_preferences`.

That last check is explicit: the category is `transactional` (a chat message
must not be lost to a marketing opt-out, and suppression must still win), and
`enqueue_message` skips the preference check for transactional — so the
per-person push opt-out the spec requires is applied here before enqueueing.

## Secrets

    supabase secrets set WEBHOOK_SECRET=<a long random string>

The same value goes in the Database Webhook's `x-webhook-secret` header.
