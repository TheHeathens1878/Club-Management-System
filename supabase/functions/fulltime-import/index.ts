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

import { createClient } from "npm:@supabase/supabase-js@2";
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function isAuthorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  // A user JWT: must be a club_admin (has_role runs as that user).
  const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
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

async function importTarget(admin: ReturnType<typeof createClient>, t: Target, trigger: string) {
  const { url, parse } = sourceFor(t);
  const res = await fetchViaPgNet(admin, url);
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
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const onlyTeam: string | undefined = body?.team_id;

  const { data: targets, error } = await admin.rpc("fulltime_import_targets");
  if (error) return json({ error: error.message }, 500);
  const list = (targets as Target[]).filter((t) => !onlyTeam || t.team_id === onlyTeam);

  const limiter = new RateLimiter(DEFAULT_MIN_INTERVAL_MS);
  const results = [];
  for (const t of list) {
    await limiter.wait();
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
