// fulltime-import — P2.4 scheduled FA Full-Time importer.
//
// Runs nightly (pg_cron → pg_net, see 20260823150000_fulltime_import.sql) and on
// demand (`POST { "team_id": "<uuid>" }`). For each enabled team link it
// fetches the team's Full-Time fixtures page through `@club/fulltime`, classifies
// the response, parses fixtures for the team, and hands the result to the
// database's `import_fixtures()` — the one place the reconcile rule lives.
// Failures and Cloudflare challenges are recorded with
// `record_fixture_import_failure()`, never retried in a tight loop.
//
// Auth: the function accepts the service-role key (cron) or a club_admin's JWT
// (manual trigger from the teams screen). Everything else is 401.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildFixturesUrl,
  classifyResponse,
  fetchFullTimePage,
  fixturesForTeam,
  parseFixturesPage,
  parseFullTimeUrl,
  RateLimiter,
  DEFAULT_MIN_INTERVAL_MS,
} from "../_shared/fulltime/index.ts";

type Target = {
  team_id: string;
  team_name: string;
  season_id: string;
  source_url: string;
  league_id: string;
  ft_season_id: string;
  division_id: string | null;
  fixture_group_key: string | null;
  ft_team_id: string | null;
  ft_team_name: string;
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

async function importTarget(admin: ReturnType<typeof createClient>, t: Target, trigger: string) {
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
  const res = await fetchFullTimePage(url);
  const cls = classifyResponse(res.status, res.html);
  if (cls !== "ok") {
    await admin.rpc("record_fixture_import_failure", {
      p_team_id: t.team_id,
      p_trigger: trigger,
      p_status: cls === "challenge" ? "challenge" : "error",
      p_source_url: url,
      p_error: cls === "challenge" ? "Cloudflare challenge served instead of the page" : `HTTP ${res.status}`,
    });
    return { team: t.team_name, status: cls };
  }
  const parsed = parseFixturesPage(res.html);
  const mine = fixturesForTeam(parsed, t.ft_team_name);
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
    p_warnings: parsed.warnings,
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
  return { team: t.team_name, status: "ok", result: data, warnings: parsed.warnings.length };
}

Deno.serve(async (req) => {
  if (!(await isAuthorised(req))) return json({ error: "unauthorised" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const onlyTeam: string | undefined = body?.team_id;
  const trigger = onlyTeam ? "manual_url" : "scheduled";

  const { data: targets, error } = await admin.rpc("fulltime_import_targets");
  if (error) return json({ error: error.message }, 500);
  const list = (targets as Target[]).filter((t) => !onlyTeam || t.team_id === onlyTeam);

  const limiter = new RateLimiter(DEFAULT_MIN_INTERVAL_MS);
  const results = [];
  for (const t of list) {
    await limiter.wait();
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
