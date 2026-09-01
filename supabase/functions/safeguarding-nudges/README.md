# safeguarding-nudges

The nightly safeguarding sweep. One job:

1. **SG-1 nightly check** — `sg1_nightly_check()`. If non-empty, one
   `sg1_nightly_check` email per lead per day, **conversation ids only**.

It used to run two more, both retired on 2026-08-26 with the rest of the in-app
SG-6 tier (SAFEGUARDING.md SG-6): the certification expiry nudges at 90 / 30 / 7
days, and the daily compliance report. DBS checks, safeguarding and coaching
qualifications are held on the FA Clubs Portal, so the club stopped maintaining
those records here and nudging about them was noise.
`due_certification_nudges()`, `mark_certification_nudged()` and
`compliance_report()` remain in the database; nothing calls them.

**Trigger:** `pg_cron` → `public.invoke_edge_function('safeguarding-nudges')`.
Suggested schedule **`30 6 * * *`** (06:30 UTC daily) — early enough to be in
the lead's inbox at the start of the day, late enough that yesterday's data has
settled.

**`verify_jwt = true`**, and `requireServiceRole` accepts only the service-role
key. The RPC it depends on is granted to `service_role` alone.

## SG-7

Nothing this function sends carries narrative, a concern body, or a message
body. The SG-1 mail is a list of conversation ids. The lead follows the id into
the audited accessor.

Lead mail is category `transactional` — a safeguarding notice is not something
a lead may opt out of.

## Idempotency

- The daily digest: one row per lead per day in `outbound_messages`
  (`entity_id = 'sg1:<date>:<lead person id>'`), checked before enqueueing, so
  re-running the function on the same day sends nothing twice.

## Secrets

None of its own. Delivery credentials belong to `comms-dispatch`.
