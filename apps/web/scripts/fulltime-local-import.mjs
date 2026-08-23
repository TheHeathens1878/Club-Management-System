#!/usr/bin/env node
/**
 * FA Full-Time importer that runs from a club PC — the fallback.
 *
 * The nightly import normally runs in the cloud (supabase/functions/fulltime-import,
 * fetching through pg_net — see 20260824190000_fulltime_pgnet_fetch.sql). This
 * script is the same import — same targets, same parser, same `import_fixtures()`
 * RPC and the same failure recording — executed from an ordinary home/office
 * connection with a plain HTTP client, for the day Cloudflare changes its mind
 * about pg_net. Widget links fetch the widget; page links fetch the page.
 *
 * Usage (from the repo root; Node 22.18+ or 24 — it imports the TypeScript
 * package directly):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node apps/web/scripts/fulltime-local-import.mjs [--team <uuid>] [--dry-run]
 *
 * Both variables are read from the repo-root .env as a fallback (git-ignored).
 * --dry-run fetches and parses but writes nothing.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFixturesUrl,
  classifyResponse,
  DEFAULT_MIN_INTERVAL_MS,
  fetchFullTimePage,
  fixturesForTeam,
  parseFixturesPage,
  parseFullTimeUrl,
  parseWidgetHtml,
  RateLimiter,
  matchClubTeam,
  widgetCodesFrom,
  widgetTeamName,
  widgetUrl,
} from "../../../packages/fulltime/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

function envFromDotenv(name) {
  try {
    const line = readFileSync(resolve(repoRoot, ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || envFromDotenv("NEXT_PUBLIC_SUPABASE_URL");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || envFromDotenv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or repo-root .env)");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const teamFlag = args.indexOf("--team");
const onlyTeam = teamFlag >= 0 ? args[teamFlag + 1] : undefined;
const triggerFor = (t) => (onlyTeam ? (t.widget_code ? "manual_widget" : "manual_url") : "scheduled");

const admin = createClient(url, key, { auth: { persistSession: false } });

async function recordFailure(t, status, sourceUrl, error) {
  if (dryRun) return;
  await admin.rpc("record_fixture_import_failure", {
    p_team_id: t.team_id,
    p_trigger: triggerFor(t),
    p_status: status,
    p_source_url: sourceUrl,
    p_error: error,
  });
}

function sourceFor(t) {
  if (t.widget_code) return { url: widgetUrl(t.widget_code), parse: parseWidgetHtml };
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

async function importTarget(t) {
  const { url: pageUrl, parse } = sourceFor(t);
  const res = await fetchFullTimePage(pageUrl);
  const cls = classifyResponse(res.status, res.html);
  if (cls !== "ok") {
    const msg = cls === "challenge" ? "Cloudflare challenge served instead of the page" : `HTTP ${res.status}`;
    await recordFailure(t, cls === "challenge" ? "challenge" : "error", pageUrl, msg);
    return { team: t.team_name, status: cls, error: msg };
  }
  const parsed = parse(res.html);
  // Mirror the Edge Function: the saved name decides which side is ours; the
  // widget-proved name only fills in when it corroborates it.
  const detected = t.widget_code ? widgetTeamName(parsed.fixtures) : undefined;
  let teamName = t.ft_team_name;
  let mine = fixturesForTeam(parsed, teamName);
  if (mine.length === 0 && detected && matchClubTeam(detected, [t.ft_team_name])) {
    teamName = detected;
    mine = fixturesForTeam(parsed, teamName);
  }
  if (parsed.fixtures.length > 0 && mine.length === 0 && detected) {
    const msg = `This widget appears to belong to "${detected}", not "${t.ft_team_name}" — check the pasted snippet.`;
    await recordFailure(t, "error", pageUrl, msg);
    return { team: t.team_name, status: "error", error: msg };
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
  if (dryRun) {
    return { team: t.team_name, status: "dry-run", fixtures: payload.length, warnings: parsed.warnings.length };
  }
  const { data, error } = await admin.rpc("import_fixtures", {
    p_team_id: t.team_id,
    p_season_id: t.season_id,
    p_fixtures: payload,
    p_trigger: triggerFor(t),
    p_source_url: pageUrl,
    p_warnings: parsed.warnings,
  });
  if (error) {
    await recordFailure(t, "error", pageUrl, error.message);
    return { team: t.team_name, status: "error", error: error.message };
  }
  return { team: t.team_name, status: "ok", result: data, warnings: parsed.warnings.length };
}

const { data: targets, error } = await admin.rpc("fulltime_import_targets");
if (error) {
  console.error(`fulltime_import_targets: ${error.message}`);
  process.exit(1);
}
const list = (targets ?? []).filter((t) => !onlyTeam || t.team_id === onlyTeam);
console.log(`${list.length} team link(s) to import${dryRun ? " (dry run)" : ""}`);

const limiter = new RateLimiter(DEFAULT_MIN_INTERVAL_MS);
let failed = 0;
for (const t of list) {
  await limiter.wait();
  try {
    const r = await importTarget(t);
    if (r.status !== "ok" && r.status !== "dry-run") failed += 1;
    console.log(`  ${t.team_name}: ${r.status}${r.error ? ` — ${r.error}` : ""}${r.result ? ` ${JSON.stringify(r.result)}` : ""}${r.fixtures !== undefined ? ` fixtures=${r.fixtures}` : ""}`);
  } catch (e) {
    failed += 1;
    const msg = e instanceof Error ? e.message : String(e);
    await recordFailure(t, "error", t.source_url, msg);
    console.log(`  ${t.team_name}: error — ${msg}`);
  }
}

// Club-wide widgets feed every active team without its own link (mirrors the
// Edge Function; see supabase/functions/fulltime-import).
async function importClub() {
  const { data: settings } = await admin
    .from("site_settings")
    .select("key,value")
    .in("key", ["fulltime_club_fixtures_code", "fulltime_club_results_code"]);
  const codes = (settings ?? []).flatMap((s) => widgetCodesFrom(s.value).map((code) => ({ key: s.key, code })));
  if (codes.length === 0) return;

  const pages = [];
  const pageWarnings = [];
  let sourceUrl = "";
  for (const s of codes) {
    const url = widgetUrl(s.code);
    if (s.key.includes("fixtures") || sourceUrl === "") sourceUrl = url;
    await limiter.wait();
    const res = await fetchFullTimePage(url);
    if (classifyResponse(res.status, res.html) !== "ok") {
      console.log(`  club ${s.key}: HTTP ${res.status}`);
      failed += 1;
      continue;
    }
    const page = parseWidgetHtml(res.html);
    pages.push(page);
    pageWarnings.push(...page.warnings);
  }
  if (pages.length === 0) return;

  const byRef = new Map();
  for (const page of pages) {
    for (const f of page.fixtures) {
      const seen = byRef.get(f.externalRef);
      if (!seen || f.homeScore !== undefined || f.status !== "scheduled") byRef.set(f.externalRef, f);
    }
  }
  const fixtures = [...byRef.values()];

  const [{ data: teamRows }, { data: season }, { data: clubNameRow }] = await Promise.all([
    admin.from("teams").select("id,name").eq("active", true),
    admin.from("seasons").select("id").eq("is_current", true).limit(1).maybeSingle(),
    admin.from("site_settings").select("value").eq("key", "fulltime_club_name").maybeSingle(),
  ]);
  const clubPrefix = (clubNameRow?.value ?? "").trim();
  if (clubPrefix === "") {
    console.log("  club: site_settings fulltime_club_name is not set");
    failed += 1;
    return;
  }
  if (!season) {
    console.log("  club: no current season set");
    failed += 1;
    return;
  }
  const linked = new Set((targets ?? []).map((t) => t.team_id));
  const teams = (teamRows ?? []).filter((t) => !linked.has(t.id) && (!onlyTeam || t.id === onlyTeam));
  const names = teams.map((t) => t.name);

  for (const team of teams) {
    const mine = fixtures.flatMap((f) => {
      const isHome = matchClubTeam(f.homeTeam, names, clubPrefix) === team.name;
      const isAway = matchClubTeam(f.awayTeam, names, clubPrefix) === team.name;
      if (!isHome && !isAway) return [];
      return [{ ...f, isHome, opponent: isHome ? f.awayTeam : f.homeTeam }];
    });
    if (mine.length === 0) continue;
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
    if (dryRun) {
      console.log(`  ${team.name} (club feed): dry-run fixtures=${payload.length}`);
      continue;
    }
    const { data, error: importError } = await admin.rpc("import_fixtures", {
      p_team_id: team.id,
      p_season_id: season.id,
      p_fixtures: payload,
      p_trigger: onlyTeam ? "manual_widget" : "scheduled",
      p_source_url: sourceUrl,
      p_warnings: pageWarnings,
    });
    if (importError) {
      failed += 1;
      console.log(`  ${team.name} (club feed): error — ${importError.message}`);
    } else {
      console.log(`  ${team.name} (club feed): ok ${JSON.stringify(data)}`);
    }
  }
}

await importClub();
process.exit(failed > 0 ? 1 : 0);
