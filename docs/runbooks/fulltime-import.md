# FA Full-Time fixtures import — running it from a club PC

`fulltime.thefa.com` sits behind Cloudflare, which serves cloud/datacenter IPs
(Vercel, Supabase Edge Functions) a bot challenge instead of the page. From a
normal home or office broadband connection the same page loads fine (verified
2026-08-23: 202 KB fixtures page with rows vs a 3 KB challenge from the cloud).

So the scheduled `fulltime-import` Edge Function will mostly report
"Cloudflare challenge" on prod, and the teams screen's preview says the same.
That is expected. Two routes work:

## A. Run the importer from a club PC (recommended)

Same code path as the Edge Function — same team links, same parser, same
`import_fixtures()` rule, same failure log on the team page — just executed
where Cloudflare lets it through.

1. One-off setup on the PC: clone the repo, install Node 24, run `pnpm install`
   (PowerShell: `$env:PATH = "$env:APPDATA\npm;$env:PATH"`), and make sure the
   repo-root `.env` holds `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (git-ignored; the service key is a secret — this
   PC must be one an administrator controls).
2. Save each team's Full-Time link on the team page (Teams → team → Full-Time).
   The preview will show the Cloudflare notice; the link still saves because
   the league, season and division are read from the URL.
3. Import:
   ```
   cd C:\Projects\Club-Management-System\apps\web
   node scripts\fulltime-local-import.mjs            # every enabled team link
   node scripts\fulltime-local-import.mjs --team <team uuid>
   node scripts\fulltime-local-import.mjs --dry-run  # fetch + parse only
   ```
   The result per team appears in the import log on the team page exactly as a
   scheduled run would.
4. Nightly: Windows Task Scheduler → Create Basic Task → Daily 06:00 → Start a
   program: `node`, arguments `scripts\fulltime-local-import.mjs`, start in
   `C:\Projects\Club-Management-System\apps\web`.

## B. Manual import

Teams → team → Import fixtures → paste the fixtures (CSV/table copied from
Full-Time). Good for a one-off; tedious for a season.

## Why not a proxy / scraping service?

It would work, but it adds a paid third party and a secret for a page the club
secretary's own laptop can fetch for free. Revisit if nobody can run route A.
