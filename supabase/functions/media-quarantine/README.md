# media-quarantine (P4.5, SG-5)

Moves the storage object behind every `media_items` row flagged
`needs_quarantine` to `quarantine/<old path>`, then calls
`media_quarantined(id, new_path)`.

**Why the move matters:** withdrawing consent is already immediate at query
level — `media_item_showable()` excludes the item from every gallery and export
the moment the flag is set. But a signed URL minted minutes earlier is a bearer
token against a *path*, and the database cannot revoke it. Changing the path
breaks the signature, so the link in someone's browser history dies too. The row
keeps pointing at the file (SG-8: no hard deletes).

**Trigger:** `pg_cron` → `public.invoke_edge_function('media-quarantine')`.
Suggested schedule **`*/10 * * * *`** (every 10 minutes). Consent withdrawal is
time-sensitive; ten minutes is the outer bound on how long an already-issued
15-minute URL can outlive it, and the job is a no-op when nothing is flagged.

**`verify_jwt = true`**, service-role key only. `media_quarantined()` is granted
to `service_role` alone and `authenticated` has no SELECT on `media_items`.

## Self-healing

If the object moves but the RPC then fails, the item stays flagged with the old
path. The next run's move fails (no source), the function probes the target with
a 60-second signed URL, finds the object already there, and calls
`media_quarantined()` again. An item flagged while already under `quarantine/`
just has its flag cleared.

Batch 200 per run; `more_likely: true` in the response when the batch filled.

## Secrets

None of its own.
