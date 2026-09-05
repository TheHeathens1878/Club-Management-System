# _shared

## Helpers

| File | What it holds |
|---|---|
| `env.ts` | `optionalEnv` / `requireEnv` / `checkSecrets`, the platform constants, `siteUrl()`. Feature secrets are read lazily so a function can report "not configured" as data rather than failing to boot. |
| `auth.ts` | `json()`, `adminClient()`, `userClient(req)`, `requireServiceRole(req)` (verify_jwt = true only), `presentsServiceKey(req)`, `requireWebhookSecret(req)` (safe behind verify_jwt = false), `callerPersonId()`, `readJson()`, `settingInt()`. |
| `comms.ts` | `enqueue()` over P4.4's `enqueue_message`, `alreadySent()` for per-template idempotency, `safeguardingLeads()`, `pounds()`. |

`adminClient()` bypasses RLS; use it only for work the caller has already been
authorised for. Anywhere a consent, participant or RLS filter has to apply, use
`userClient(req)` — it refuses to build a client from the service-role key, so
"as the user" cannot silently become "as the service".

## fulltime

`fulltime/` is a verbatim copy of `packages/fulltime/src` so Edge Functions
(Deno) can import the parser without reaching outside `supabase/functions`.
Regenerate after changing the package:

    rm -rf supabase/functions/_shared/fulltime && cp -r packages/fulltime/src supabase/functions/_shared/fulltime

CI checks the copy is in sync (`scripts/check-shared-sync.sh`).
