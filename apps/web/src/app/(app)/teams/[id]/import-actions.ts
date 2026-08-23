"use server";

/**
 * The manual import fallback (PLAN.md P2.4, §3 Q2: "always keep a manual
 * paste/CSV fallback working").
 *
 * Full-Time is an unofficial integration behind Cloudflare. When the nightly
 * Edge Function is blocked — or simply not deployed yet — a club secretary
 * must still be able to get a season's fixtures in. Two ways in, one
 * destination: both tabs end at `import_fixtures()`, the SECURITY DEFINER
 * function that owns the reconcile rule, so a manual import upserts by
 * `(team_id, external_ref)` exactly as the scheduled one does. Reschedules
 * become updates, absent rows are not cancellations, and hand-entered
 * (`source = 'manual'`) fixtures are never touched.
 *
 * Parsing stays on the server: the parser, the cross-origin fetch and the
 * Cloudflare classification must not reach the browser bundle.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildFixturesUrl,
  classifyResponse,
  fetchFullTimePage,
  fixturesForTeam,
  FullTimeUrlError,
  parseCsvFixtures,
  parseFixturesPage,
  parseFullTimeUrl,
  RateLimiter,
  type FullTimeIds,
  type TeamFixture,
} from "@club/fulltime";
import type { Json } from "@club/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { formatBookingDateShort } from "@/lib/booking-time";

/** Preview tables confirm a shape, they are not a way to read a season. */
const PREVIEW_LIMIT = 30;
/** A CSV pasted into a textarea; anything larger belongs in the importer. */
const MAX_CSV_BYTES = 512 * 1024;

/** Shared with the Edge Function: the payload `import_fixtures()` expects. */
export type ImportFixturePayload = {
  externalRef: string;
  kickoffAt: string;
  opponent: string;
  isHome: boolean;
  competition: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
};

export type ManualPreviewRow = {
  externalRef: string;
  dateLabel: string;
  timeLabel: string;
  isHome: boolean;
  opponent: string;
  competition: string;
  status: string;
};

export type ManualPreview = {
  ok: boolean;
  /** Safe to show the admin; empty when there is nothing to say. */
  message: string;
  fetchedUrl?: string;
  httpStatus?: number;
  ftTeamName?: string;
  rows?: ManualPreviewRow[];
  matchedCount?: number;
  /** Exactly what "Import these N fixtures" will send. */
  payload?: ImportFixturePayload[];
  warnings?: string[];
  /** Every team name the parser saw — the "no fixtures matched" fix. */
  teamNames?: string[];
};

export type ManualImportResult = {
  error?: string;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  runId?: number;
};

export type EdgeFunctionResult = {
  ok: boolean;
  status?: number;
  /** The function's JSON body, pretty-printed, or its raw text. */
  body?: string;
  message?: string;
};

const CHALLENGE_MESSAGE =
  "Full-Time is currently blocking automated access (Cloudflare) — try again in a few minutes, or paste the fixtures as CSV instead.";

/** One process-wide limiter, shared with the link preview's intent. */
const limiter = new RateLimiter();

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

function toPayload(fixtures: TeamFixture[]): ImportFixturePayload[] {
  return fixtures.map((fixture) => ({
    externalRef: fixture.externalRef,
    kickoffAt: fixture.kickoffAt,
    opponent: fixture.opponent,
    isHome: fixture.isHome,
    competition: fixture.competition ?? null,
    status: fixture.status,
    homeScore: fixture.homeScore ?? null,
    awayScore: fixture.awayScore ?? null,
    venue: fixture.venue ?? null,
  }));
}

function toRows(fixtures: TeamFixture[]): ManualPreviewRow[] {
  return fixtures.slice(0, PREVIEW_LIMIT).map((fixture) => ({
    externalRef: fixture.externalRef,
    dateLabel: formatBookingDateShort(fixture.date),
    timeLabel: fixture.time ?? "—",
    isHome: fixture.isHome,
    opponent: fixture.opponent,
    competition: fixture.competition ?? "—",
    status: fixture.status,
  }));
}

/** The Full-Time name to match on: what the link stores, else the club's own. */
async function resolveTeamName(
  teamId: string,
  override: string | undefined,
): Promise<{ teamName: string; ftTeamName: string } | null> {
  const admin = createAdminClient();
  const [{ data: team }, { data: link }] = await Promise.all([
    admin.from("teams").select("id,name").eq("id", teamId).maybeSingle(),
    admin.from("team_fulltime_links").select("ft_team_name").eq("team_id", teamId).maybeSingle(),
  ]);
  if (!team) return null;
  const ftTeamName = (override ?? "").trim() || link?.ft_team_name || team.name;
  return { teamName: team.name, ftTeamName };
}

/**
 * Paste a Full-Time URL, fetch it here, and show what would be imported.
 *
 * A bad URL, a Cloudflare challenge and a 404 are outcomes with a message, not
 * exceptions: every one of them has an answer the admin can act on.
 */
export async function previewManualUrl(
  teamId: string,
  url: string,
  ftTeamNameOverride?: string,
): Promise<ManualPreview> {
  await requireCommittee();

  const names = await resolveTeamName(teamId, ftTeamNameOverride);
  if (names === null) return { ok: false, message: "That team no longer exists." };

  let ids: FullTimeIds;
  try {
    ids = parseFullTimeUrl(url);
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof FullTimeUrlError
          ? cause.message
          : "That does not look like a Full-Time URL.",
    };
  }
  if (!ids.leagueId) {
    return {
      ok: false,
      message:
        "That Full-Time link has no league in it — open the league or division fixtures page and copy that address instead.",
    };
  }

  const fetchedUrl = buildFixturesUrl(ids);
  await limiter.wait();
  const response = await fetchFullTimePage(fetchedUrl);
  const outcome = classifyResponse(response.status, response.html);

  if (outcome === "challenge") {
    return { ok: false, message: CHALLENGE_MESSAGE, fetchedUrl, httpStatus: response.status };
  }
  if (outcome !== "ok") {
    return {
      ok: false,
      message: response.error
        ? `Could not reach Full-Time: ${response.error}`
        : `Full-Time returned HTTP ${response.status} for that page — check the league, season and division in the URL.`,
      fetchedUrl,
      httpStatus: response.status,
    };
  }

  const parsed = parseFixturesPage(response.html);
  const matched = fixturesForTeam(parsed, names.ftTeamName);

  return {
    ok: true,
    message:
      matched.length === 0
        ? `No fixtures on that page are ${names.ftTeamName}'s — check the name matches Full-Time's exactly.`
        : "",
    fetchedUrl,
    httpStatus: response.status,
    ftTeamName: names.ftTeamName,
    rows: toRows(matched),
    matchedCount: matched.length,
    payload: toPayload(matched),
    warnings: parsed.warnings.slice(0, 10),
  };
}

/**
 * Paste a CSV — the one Full-Time exports, or one typed by hand — and show
 * what would be imported. Columns are found by header name, so the order does
 * not matter and unreadable lines are reported rather than silently dropped.
 */
export async function previewManualCsv(
  teamId: string,
  csv: string,
  ftTeamNameOverride?: string,
): Promise<ManualPreview> {
  await requireCommittee();

  const names = await resolveTeamName(teamId, ftTeamNameOverride);
  if (names === null) return { ok: false, message: "That team no longer exists." };
  if (csv.trim() === "") return { ok: false, message: "Paste some CSV first." };
  if (csv.length > MAX_CSV_BYTES) {
    return { ok: false, message: "That CSV is too large to paste — split it by season." };
  }

  const parsed = parseCsvFixtures(csv);
  const matched = fixturesForTeam(parsed, names.ftTeamName);
  const teamNames = new Set<string>();
  for (const fixture of parsed.fixtures) {
    teamNames.add(fixture.homeTeam);
    teamNames.add(fixture.awayTeam);
  }

  return {
    ok: parsed.fixtures.length > 0,
    message:
      parsed.fixtures.length === 0
        ? "No fixture rows could be read from that CSV."
        : matched.length === 0
          ? `No rows name ${names.ftTeamName} — the home and away columns must match the team's Full-Time name exactly.`
          : "",
    ftTeamName: names.ftTeamName,
    rows: toRows(matched),
    matchedCount: matched.length,
    payload: toPayload(matched),
    warnings: parsed.warnings.slice(0, 10),
    teamNames: [...teamNames].sort((a, b) => a.localeCompare(b, "en-GB")),
  };
}

/**
 * Import a previewed set of fixtures.
 *
 * The payload comes back from the preview rather than being re-fetched: a
 * second Full-Time request is a second chance at a Cloudflare challenge, and
 * the admin has just been shown exactly these rows. `import_fixtures()`
 * validates every element and is the only thing that decides what an import
 * means.
 */
export async function runManualImport(
  teamId: string,
  input: {
    trigger: "manual_url" | "manual_csv";
    sourceUrl?: string | null;
    fixtures: ImportFixturePayload[];
    warnings?: string[];
  },
): Promise<ManualImportResult> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  if (input.fixtures.length === 0) return { error: "There is nothing to import." };

  const { data: season } = await admin
    .from("seasons")
    .select("id,name")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) {
    return {
      error:
        "No season is marked as the current one. Open Teams → Seasons and set the current season before importing.",
    };
  }

  const { data, error } = await admin.rpc("import_fixtures", {
    p_team_id: teamId,
    p_season_id: season.id,
    p_fixtures: input.fixtures as unknown as Json,
    p_trigger: input.trigger,
    p_source_url: input.sourceUrl ?? undefined,
    p_warnings: (input.warnings ?? []) as unknown as Json,
  });
  if (error) return { error: error.message };

  const result = data?.[0];
  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "import",
    entity: "fixtures",
    entityId: teamId,
    detail: {
      trigger: input.trigger,
      source_url: input.sourceUrl ?? null,
      season_id: season.id,
      submitted: input.fixtures.length,
      inserted: result?.inserted ?? 0,
      updated: result?.updated ?? 0,
      unchanged: result?.unchanged ?? 0,
    },
  });

  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
  revalidatePath("/pitches");

  return {
    inserted: result?.inserted ?? 0,
    updated: result?.updated ?? 0,
    unchanged: result?.unchanged ?? 0,
    runId: result?.run_id ?? undefined,
  };
}

/**
 * Run the scheduled importer for one team, now.
 *
 * The Edge Function is the same code the nightly cron runs, so this is a
 * genuine dry run of the scheduled path rather than a second implementation of
 * it. The service key never leaves the server. The function may not be
 * deployed yet — that is a message, not a crash.
 */
export async function triggerScheduledImport(teamId: string): Promise<EdgeFunctionResult> {
  await requireCommittee();

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return { ok: false, message: "Supabase is not configured on this server." };
  }

  const endpoint = `${base.replace(/\/+$/, "")}/functions/v1/fulltime-import`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ team_id: teamId }),
      cache: "no-store",
    });
  } catch (cause) {
    return {
      ok: false,
      message: `Could not reach the fulltime-import function: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  }

  const text = await response.text();
  let body = text;
  try {
    body = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON — an HTML error page or an empty body. Show it as it came.
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body,
      message:
        response.status === 404
          ? "The fulltime-import Edge Function is not deployed yet — use the manual import above until it is (`supabase functions deploy fulltime-import`)."
          : `The fulltime-import function returned HTTP ${response.status}.`,
    };
  }

  revalidatePath(`/teams/${teamId}`);
  return { ok: true, status: response.status, body };
}
