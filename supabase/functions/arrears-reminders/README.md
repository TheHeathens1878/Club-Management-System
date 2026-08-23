# arrears-reminders (P4.2)

Scheduled escalation of unpaid subs. Reads `subscription_arrears`, works out
which tier each debt has reached, and enqueues one reminder email per
(subscription, tier) through `enqueue_message`.

**Trigger:** `pg_cron` → `public.invoke_edge_function('arrears-reminders')`.
Suggested schedule **`0 9 * * 2`** (Tuesdays, 09:00 UTC) — weekly is enough for
a debt chase, and a fixed weekday keeps it predictable for the treasurer.

**`verify_jwt = true`** — the scheduler presents the service-role key, and
`requireServiceRole` accepts nothing else.

## Tiers

| Tier | Default age | Setting | Tone | Template |
|---|---|---|---|---|
| 1 | ≥ 14 days | `arrears.tier1_days` | gentle | `arrears_tier1` |
| 2 | ≥ 30 days | `arrears.tier2_days` | firm | `arrears_tier2` |
| 3 | ≥ 60 days | `arrears.tier3_days` | final | `arrears_tier3` |

Age is `subscription_arrears.days_since_start`. Only the highest tier reached is
sent on a run. Rows are restricted to `outstanding_pence > 0` and status
`active` or `past_due` (a `pending` subscription has not been checked out, so it
is not yet a debt).

## Idempotency

`outbound_messages` *is* the ledger of sends: before enqueueing, the function
looks for a row with `entity = 'subscriptions'`, `entity_id = <subscription>`,
`template = 'arrears_tierN'` and status `queued` or `sent`. A tier is therefore
never sent twice, across re-runs and overlapping invocations.

`dry_run`, `suppressed` and `skipped_preference` rows deliberately do **not**
count as a send, so turning dry-run off does not swallow the first reminder.

## Opt-out and dry run

Category is `reminder`, so `comms_preferences` opt-outs are honoured and
`comms_suppressions` always wins — both inside `enqueue_message`. Platform-wide
dry run is the `comms.dry_run` site setting; this function does not need to know
about it.

## Settings, not secrets

No function-specific secrets. Optional `site_settings` keys:
`arrears.tier1_days`, `arrears.tier2_days`, `arrears.tier3_days`,
`comms.dry_run`.
