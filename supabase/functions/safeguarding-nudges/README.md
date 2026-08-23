# safeguarding-nudges (P4.3, SG-6 tier 2)

The nightly safeguarding sweep. Three jobs, in order:

1. **Certification expiry** — `due_certification_nudges()` at 90 / 30 / 7 days.
   One email to the holder (`certification_expiry_90|30|7`), one to each
   safeguarding lead (`..._lead`), then `mark_certification_nudged()` so the
   tier is never re-sent. Marking happens **last**: a failure there means the
   nudge comes round again tomorrow, which is better than a nudge recorded but
   never sent.
2. **Compliance report** — `compliance_report()`, the "non-compliant and still
   assigned" list. If non-empty, one `compliance_report` email per lead per day.
3. **SG-1 nightly check** — `sg1_nightly_check()`. If non-empty, one
   `sg1_nightly_check` email per lead per day, **conversation ids only**.

**Trigger:** `pg_cron` → `public.invoke_edge_function('safeguarding-nudges')`.
Suggested schedule **`30 6 * * *`** (06:30 UTC daily) — early enough to be in
the lead's inbox at the start of the day, late enough that yesterday's data has
settled.

**`verify_jwt = true`**, and `requireServiceRole` accepts only the service-role
key. The three RPCs it depends on are granted to `service_role` alone.

## SG-7

Nothing this function sends carries narrative, a concern body, or a message
body. Compliance mail is team / person / role / status lines; the SG-1 mail is a
list of conversation ids. The lead follows the id into the audited accessor.

Lead mail is category `transactional` (a safeguarding notice is not something a
lead may opt out of); the holder's own expiry nudge is `reminder`.

## Idempotency

- Certification tiers: owned by `certification_nudges` in the database —
  `due_certification_nudges()` excludes anything already marked.
- The two daily digests: one row per lead per day in `outbound_messages`
  (`entity_id = '<date>:<lead person id>'`), checked before enqueueing, so
  re-running the function on the same day sends nothing twice.

## Secrets

None of its own. Delivery credentials belong to `comms-dispatch`.
