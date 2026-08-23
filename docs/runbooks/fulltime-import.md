# FA Full-Time fixtures import

Fixtures and results come from each team's Full-Time **widget** — the
"add to your website" snippet Full-Time generates for a team. The import runs
nightly in the cloud; nothing needs to run on a club PC.

## Linking a team (once per season)

1. On fulltime.thefa.com open the team's league, pick the team, and choose
   **Add to your website** (the *team fixtures* widget). Copy the snippet — it
   looks like
   ```html
   <div id="lrep728576966" style="width: 350px;">Data loading....<a href="…">click here for U14 Division 2</a>…</div>
   <script …>var lrcode = '728576966'</script>
   <script … src="https://fulltime.thefa.com/client/api/cs1.js"></script>
   ```
2. In the app: Teams → the team → **FA Full-Time link**. Paste the snippet
   (the whole thing, or just the number from `var lrcode`), click
   **Test & preview**, check the fixtures and the team name it found, then
   **Save link**. **Import now** fetches straight away; otherwise the nightly
   run picks it up (03:12 UTC prefetch, 03:15 UTC import).
3. New season: generate the new snippet and paste it over the old one. The link
   updates in place; fixtures already imported are kept (they are keyed by
   Full-Time's own fixture id).

The widget carries fixtures *and* results, so scores arrive after matches the
same way. Reschedules and postponements become updates of the same fixture,
never duplicates. A Full-Time page address (league/division fixtures page)
still works as a link but carries no results; the panel says so and asks for
the snippet.

## How the fetch works (and why)

`fulltime.thefa.com` sits behind Cloudflare's bot wall, which fingerprints the
TLS client rather than the IP. Verified 2026-08-23 from the Supabase project:
Deno `fetch()` in an Edge Function gets HTTP 403 for every Full-Time URL,
while **pg_net** (libcurl, inside Postgres) gets HTTP 200 for both the widget
and the ordinary page — as long as the request carries a desktop browser
`User-Agent` *and* `Accept-Language: en-GB,en;q=0.9`. Without
`Accept-Language` it is 403 too.

So the fetch is made by the database: `fulltime_http_get(url)` issues the
request with those headers and returns a pg_net id; `fulltime_http_result(id)`
hands the body back. The Edge Function (`fulltime-import`) and the team page's
preview both go through those two functions (`fetchViaPgNet` in
`packages/fulltime`). Only a club admin or the service role may call them, only
`https://fulltime.thefa.com/` URLs are accepted, and only bodies fetched this
way can be read back.

## When it goes wrong

- Team page → the link card shows the last import status and error; the
  **Import log** below lists every run. A `challenge` status means Cloudflare
  refused pg_net too — try **Import now** later, or use the fallback below.
- `fixtures.import_failed` rows in `audit_log` are the admin alert.
- Fallback A — run the importer from a home/office connection:
  ```
  cd C:\Projects\Club-Management-System\apps\web
  node scripts\fulltime-local-import.mjs [--team <team uuid>] [--dry-run]
  ```
  (needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
  repo-root `.env`; Node 24). Same targets, parser and `import_fixtures()` as
  the cloud run, with a plain HTTP client.
- Fallback B — Teams → team → **Manual import** → paste the fixtures as CSV.
