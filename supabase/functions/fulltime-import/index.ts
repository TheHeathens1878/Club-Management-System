// fulltime-import — P2.4 scheduled FA Full-Time importer.
//
// Runs nightly (pg_cron → pg_net, see 20260823150000_fulltime_import.sql) and on
// demand (`POST { "team_id": "<uuid>" }`). For each enabled team link it
// fetches the team's Full-Time **widget** (`/js/cs1.html?cs=<lrcode>` — the
// team's fixtures and results for the season) or, for a link saved without a
// widget code, the fixtures page; classifies the response; parses fixtures
// for the team; and hands the result to the database's `import_fixtures()` —
// the one place the reconcile rule lives. Failures and Cloudflare challenges
// are recorded with `record_fixture_import_failure()`, never retried in a
// tight loop.
//
// The HTTP request itself is made by Postgres (pg_net) through
// `fulltime_http_get` / `fulltime_http_result`: Cloudflare fingerprints the
// TLS client and refuses Deno's fetch() where it lets libcurl through
// (verified 2026-08-23; see 20260824190000_fulltime_pgnet_fetch.sql).
//
// Auth: the function accepts the service-role key (cron) or a club_admin's JWT
// (manual trigger from the teams screen). Everything else is 401.

import { adminClient, json, requireServiceRole, userClient, type Client } from "../_shared/auth.ts";
import {
  buildFixturesUrl,
  fetchViaPgNet,
  fixturesForTeam,
  parseFixturesPage,
  parseFullTimeUrl,
  parseWidgetHtml,
  widgetTeamName,
  widgetUrl,
  RateLimiter,
  DEFAULT_MIN_INTERVAL_MS,
  type ParsedPage,
} from "../_shared/fulltime/index.ts";

type Target = {
  team_id: string;
  team_name: string;
  season_id: string;
  source_url: string;
  league_id: string | null;
  ft_season_id: string | null;
  division_id: string | null;
  fixture_group_key: string | null;
  ft_team_id: string | null;
  ft_team_name: string;
  widget_code: string | null;
};

async function isAuthorised(req: Request): Promise<boolean> {
  // The scheduler (pg_cron → invoke_edge_function) presents the service-role
  // key; `requireServiceRole` also accepts the gateway-verified service JWT.
  if (requireServiceRole(req)) return true;
  // A user JWT: must be a club_admin (is_club_admin runs as that user).
  const asUser = userClient(req);
  if (!asUser) return false;
  const { data, error } = await asUser.rpc("is_club_admin");
  return !error && data === true;
}

/** Where to fetch for a target and how to read what comes back. */
function sourceFor(t: Target): { url: string; parse: (html: string) => ParsedPage } {
  if (t.widget_code) {
    return { url: widgetUrl(t.widget_code), parse: parseWidgetHtml };
  }
  const ids = parseFullTimeUrl(t.source_url);
  const url = buildFixturesUrl(
    {
      leagueId: t.league_id || ids.leagueId,
      seasonId: t.ft_season_id || ids.seasonId,
      divisionId: t.division_id ?? ids.divisionId,
      fixtureGroupKey: t.fixture_group_key ?? ids.fixtureGroupKey,
    },
    { teamId: t.ft_team_id ?? undefined },
  );
  return { url, parse: (html) => parseFixturesPage(html) };
}

/**
 * The nightly run is reached *through* pg_net, and pg_net serves its queue in
 * serial batches — a fetch queued from here would wait for the invocation
 * itself to finish. So the scheduler prefetches first (`fulltime_prefetch()`,
 * 03:12 UTC) and this picks the response up; any other caller fetches live.
 */
const limiter = new RateLimiter(DEFAULT_MIN_INTERVAL_MS);

async function fetchFor(admin: Client, t: Target, url: string) {
  const { data } = await admin.rpc("fulltime_prefetched", { p_team_id: t.team_id });
  const pre = (Array.isArray(data) ? data[0] : data) as { request_id: number; url: string } | undefined;
  if (pre) {
    // A page-URL prefetch is the division page without `selectedTeam`; the
    // team filter after parsing makes that equivalent.
    const res = await fetchViaPgNet(admin, pre.url, { requestId: pre.request_id, timeoutMs: 10_000 });
    if (res.status !== 0) return res;
  }
  await limiter.wait();
  return fetchViaPgNet(admin, url);
}

async function importTarget(admin: Client, t: Target, trigger: string) {
  const { url: wanted, parse } = sourceFor(t);
  const res = await fetchFor(admin, t, wanted);
  const url = res.url;
  if (res.classification !== "ok") {
    await admin.rpc("record_fixture_import_failure", {
      p_team_id: t.team_id,
      p_trigger: trigger,
      p_status: res.classification === "challenge" ? "challenge" : "error",
      p_source_url: url,
      p_error:
        res.classification === "challenge"
          ? "Cloudflare challenge served instead of the page"
          : res.error ?? `HTTP ${res.status}`,
    });
    return { team: t.team_name, status: res.classification };
  }
  const parsed = parse(res.html);
  // A widget is the team's own, so the team name it proves beats whatever was
  // typed when the link was saved.
  const teamName = (t.widget_code && widgetTeamName(parsed.fixtures)) || t.ft_team_name;
  const mine = fixturesForTeam(parsed, teamName);
  const warnings = [...parsed.warnings];
  if (parsed.fixtures.length > 0 && mine.length === 0) {
    warnings.push(`None of the ${parsed.fixtures.length} fixtures involve "${teamName}".`);
  }
  const payload = mine.map((f) => ({
    externalRef: f.externalRef,
    kickoffAt: f.kickoffAt,
    opponent: f.opponent,
    isHome: f.isHome,
    competition: f.competition ?? null,
    status: f.status,
    homeScore: f.homeScore ?? null,
    awayScore: f.awayScore ?? null,
    venue: f.venue ?? null,
  }));
  const { data, error } = await admin.rpc("import_fixtures", {
    p_team_id: t.team_id,
    p_season_id: t.season_id,
    p_fixtures: payload,
    p_trigger: trigger,
    p_source_url: url,
    p_warnings: warnings,
  });
  if (error) {
    await admin.rpc("record_fixture_import_failure", {
      p_team_id: t.team_id,
      p_trigger: trigger,
      p_status: "error",
      p_source_url: url,
      p_error: error.message,
    });
    return { team: t.team_name, status: "error", error: error.message };
  }
  return { team: t.team_name, status: "ok", result: data, warnings: warnings.length };
}

Deno.serve(async (req) => {
  if (!(await isAuthorised(req))) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const onlyTeam: string | undefined = body?.team_id;

  const { data: targets, error } = await admin.rpc("fulltime_import_targets");
  if (error) return json({ error: error.message }, 500);
  const list = (targets as Target[]).filter((t) => !onlyTeam || t.team_id === onlyTeam);

  const results = [];
  for (const t of list) {
    const trigger = onlyTeam ? (t.widget_code ? "manual_widget" : "manual_url") : "scheduled";
    try {
      results.push(await importTarget(admin, t, trigger));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.rpc("record_fixture_import_failure", {
        p_team_id: t.team_id, p_trigger: trigger, p_status: "error", p_source_url: t.source_url, p_error: msg,
      });
      results.push({ team: t.team_name, status: "error", error: msg });
    }
  }
  return json({ ran: results.length, results });
});
