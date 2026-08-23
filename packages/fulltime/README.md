# @club/fulltime

Isolated parser + fetcher for **FA Full-Time** (`fulltime.thefa.com`).

PLAN.md §3 Q2 treats Full-Time as an *unofficial* integration: the FA publishes
no API, so fixtures are read by parsing public Full-Time pages. The rule that
follows from that is the reason this package exists as its own workspace
package:

> isolate the parser, monitor for breakage, and always keep a manual paste/CSV
> fallback working.

So: everything that knows anything about Full-Time's HTML lives here, behind a
small typed surface; nothing here touches the database, and nothing here makes
a network request during tests. When the FA changes their markup, only this
package changes — and `parseCsvFixtures` keeps the importer usable in the
meantime.

## What is in here

| Module | Purpose |
| --- | --- |
| `src/url.ts` | `parseFullTimeUrl` / `buildFixturesUrl` / `buildResultsUrl` — pull league, season, division, competition, fixture-group and team identifiers out of any Full-Time URL an admin might paste, and rebuild canonical ones. |
| `src/html.ts` | A deliberately small, tolerant HTML reader (tables, rows, cells, `<select>` options, entity decoding). No dependency: Full-Time's markup is simple, and a real DOM parser would be a much larger surface to keep working. |
| `src/parse.ts` | `parseFixturesPage` — seasons, teams and fixture rows from a fixtures/results/league/team page. Unparseable rows become `warnings`, never exceptions. |
| `src/time.ts` | `dd/mm/yy` + `HH:MM` Europe/London wall clock to an ISO UTC instant, DST-correct via `Intl` offset probing (the approach used by `apps/web/src/lib/booking-time.ts`). |
| `src/fetch.ts` | `fetchFullTimePage`, `classifyResponse`, `RateLimiter` — polite fetching that recognises a Cloudflare challenge instead of parsing it as a page. |
| `src/team.ts` | `fixturesForTeam` / `normaliseTeamName` — pick one team's fixtures out of a whole division. |
| `src/ref.ts` | `stableExternalRef` — the upsert key P2.4 needs. |
| `src/csv.ts` | `parseCsvFixtures` — the manual fallback. |

## Recorded page snapshots

`test/fixtures/` holds real pages fetched on 2026-08-23 (public pages, no
authentication, no personal data):

| File | What it is |
| --- | --- |
| `ft-league.html` | `index.html?league=314585552` — season `<select>`, plus one real result in a `div.fixture-results-table`. |
| `ft-fixtures.html` | `fixtures.html` for a division, fetched off-season, so it has the full filter form and **no** fixture rows. |
| `ft-team.html` | `displayTeam.html?id=607526097` — the same result in a `div.results-table`, with a date/time cell. |
| `ft-results.html` | A Cloudflare "Just a moment..." interstitial, kept as the challenge fixture. |
| `synthetic-fixtures.html` | **Hand-written**, not fetched — a fixtures table covering the shapes the live off-season pages could not give us. |

Re-record a snapshot by saving the raw response body over the file and running
`pnpm --filter @club/fulltime test`; a failure is the breakage monitor working.

## Rate limiting and Cloudflare

Full-Time sits behind Cloudflare and starts serving an interstitial (HTTP 403,
or 200 with `<title>Just a moment...`) after a handful of quick requests.
`classifyResponse` returns `"challenge"` for those so a caller can stop, back
off, and tell the admin rather than importing an empty fixture list. Space
requests at least `DEFAULT_MIN_INTERVAL_MS` (5s) apart with `RateLimiter`.
