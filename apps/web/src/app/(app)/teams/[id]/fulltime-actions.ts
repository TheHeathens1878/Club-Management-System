"use server";

/**
 * The team ↔ FA Full-Time link (PLAN.md P2.3).
 *
 * Everything Full-Time-shaped lives in `@club/fulltime` and everything in this
 * file runs on the server: the parser, the fetcher and the club's Full-Time
 * identifiers must never reach the browser bundle, both because the fetch is
 * cross-origin and because a Cloudflare challenge has to be recognised and
 * reported rather than parsed as an empty fixture list.
 *
 * The flow the plan asks for is paste → parse → test-fetch → preview → save:
 * `previewFullTimeLink` does the first four and returns something a human can
 * confirm, `saveFullTimeLink` writes the row. Re-linking is an upsert on the
 * primary key, so a new season or a league change updates the link and leaves
 * the team's `fixtures` (keyed by `external_ref`) untouched.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildFixturesUrl,
  classifyResponse,
  fetchFullTimePage,
  fixturesForTeam,
  FullTimeUrlError,
  parseFixturesPage,
  parseFullTimeUrl,
  RateLimiter,
  teamNamesIn,
  type FullTimeIds,
} from "@club/fulltime";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { formatBookingDateShort } from "@/lib/booking-time";

/** Preview tables are for confirmation, not for reading a whole season. */
const PREVIEW_LIMIT = 30;

/**
 * One process-wide limiter. Full-Time challenges after a handful of quick
 * requests, and an admin clicking "Preview" twice is exactly that.
 */
const limiter = new RateLimiter();

const CHALLENGE_MESSAGE =
  "Full-Time blocks requests from cloud servers (Cloudflare), so the preview could not load here. The link itself is fine — save it, then import fixtures from a club PC with the Full-Time runner (docs/runbooks/fulltime-import.md) or paste the fixtures into the manual import.";

export type PreviewRow = {
  externalRef: string;
  /** Europe/London kick-off, already formatted for display. */
  dateLabel: string;
  timeLabel: string;
  isHome: boolean;
  opponent: string;
  competition: string;
  status: string;
};

export type PreviewSeason = { id: string; name: string; selected: boolean };

export type PreviewOutcome = "invalid_url" | "ok" | "challenge" | "not_found" | "error";

export type PreviewResult = {
  outcome: PreviewOutcome;
  /** Always safe to show to the admin; empty when there is nothing to add. */
  message: string;
  /** Present whenever the URL parsed, even if the fetch was blocked. */
  ids?: FullTimeIds;
  /** The canonical fixtures URL that was requested. */
  fetchedUrl?: string;
  httpStatus?: number;
  /** The name the fixtures were matched against. */
  ftTeamName?: string;
  rows?: PreviewRow[];
  /** How many fixtures matched in total, before the preview limit. */
  matchedCount?: number;
  /** The `selectedSeason` options Full-Time offered on the page. */
  seasons?: PreviewSeason[];
  /** Every team name the parser saw, so the admin can pick the right one. */
  teamNames?: string[];
  /** Rows the parser recognised but could not read — the breakage signal. */
  warnings?: string[];
};

export type SaveFullTimeLinkInput = {
  url: string;
  ids: FullTimeIds;
  ftTeamName: string;
  enabled: boolean;
};

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

function revalidateTeam(teamId: string) {
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
}

/**
 * The identifiers a link row needs, taken from the pasted URL and topped up
 * from whatever the preview resolved (Full-Time omits `selectedSeason` from
 * plenty of perfectly good links, but the column is NOT NULL).
 */
function mergeIds(fromUrl: FullTimeIds, fromPreview: FullTimeIds | undefined): FullTimeIds {
  if (!fromPreview) return fromUrl;
  const merged: FullTimeIds = { ...fromUrl };
  if (!merged.leagueId) merged.leagueId = fromPreview.leagueId;
  if (!merged.seasonId && fromPreview.seasonId) merged.seasonId = fromPreview.seasonId;
  if (!merged.divisionId && fromPreview.divisionId) merged.divisionId = fromPreview.divisionId;
  if (!merged.competitionId && fromPreview.competitionId) merged.competitionId = fromPreview.competitionId;
  if (!merged.fixtureGroupKey && fromPreview.fixtureGroupKey) {
    merged.fixtureGroupKey = fromPreview.fixtureGroupKey;
  }
  if (!merged.teamId && fromPreview.teamId) merged.teamId = fromPreview.teamId;
  return merged;
}

/**
 * Parse a pasted Full-Time URL, fetch the fixtures page it points at, and
 * return what one team's fixtures would look like.
 *
 * Never throws for anything the admin can fix: a bad URL, a Cloudflare
 * challenge and a 404 are all outcomes, not exceptions.
 */
export async function previewFullTimeLink(
  teamId: string,
  url: string,
  ftTeamNameOverride?: string,
): Promise<PreviewResult> {
  await requireCommittee();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("id,name").eq("id", teamId).maybeSingle();
  if (!team) return { outcome: "error", message: "That team no longer exists." };

  let ids: FullTimeIds;
  try {
    ids = parseFullTimeUrl(url);
  } catch (cause) {
    return {
      outcome: "invalid_url",
      message:
        cause instanceof FullTimeUrlError
          ? cause.message
          : "That does not look like a Full-Time URL.",
    };
  }

  if (!ids.leagueId) {
    return {
      outcome: "invalid_url",
      message:
        "That Full-Time link has a team but no league in it — open the league or division fixtures page and copy that address instead.",
      ids,
    };
  }

  const fetchedUrl = buildFixturesUrl(ids);
  await limiter.wait();
  const response = await fetchFullTimePage(fetchedUrl);
  const outcome = classifyResponse(response.status, response.html);

  if (outcome === "challenge") {
    return { outcome, message: CHALLENGE_MESSAGE, ids, fetchedUrl, httpStatus: response.status };
  }
  if (outcome === "not_found") {
    return {
      outcome,
      message: `Full-Time returned HTTP ${response.status} for that page — check the league, season and division in the URL.`,
      ids,
      fetchedUrl,
      httpStatus: response.status,
    };
  }
  if (outcome === "error") {
    return {
      outcome,
      message: response.error
        ? `Could not reach Full-Time: ${response.error}`
        : `Full-Time returned HTTP ${response.status}.`,
      ids,
      fetchedUrl,
      httpStatus: response.status,
    };
  }

  const parsed = parseFixturesPage(response.html);
  const ftTeamName = (ftTeamNameOverride ?? "").trim() || team.name;
  const matched = fixturesForTeam(parsed, ftTeamName);

  const rows: PreviewRow[] = matched.slice(0, PREVIEW_LIMIT).map((fixture) => ({
    externalRef: fixture.externalRef,
    dateLabel: formatBookingDateShort(fixture.date),
    timeLabel: fixture.time ?? "—",
    isHome: fixture.isHome,
    opponent: fixture.opponent,
    competition: fixture.competition ?? "—",
    status: fixture.status,
  }));

  // The page's own season options, so the admin can see which `selectedSeason`
  // the link will store and whether it is the one they meant.
  const seasons: PreviewSeason[] = parsed.seasons.map((s) => ({
    id: s.id,
    name: s.name,
    selected: s.selected,
  }));
  const pageSeason = parsed.seasons.find((s) => s.selected);
  const resolvedIds: FullTimeIds =
    ids.seasonId || !pageSeason ? ids : { ...ids, seasonId: pageSeason.id };

  return {
    outcome: "ok",
    message:
      matched.length === 0
        ? "No fixtures found for this team — check the team name matches Full-Time's."
        : "",
    ids: resolvedIds,
    fetchedUrl,
    httpStatus: response.status,
    ftTeamName,
    rows,
    matchedCount: matched.length,
    seasons,
    teamNames: teamNamesIn(parsed.fixtures),
    warnings: parsed.warnings.slice(0, 10),
  };
}

/**
 * Create or re-point a team's Full-Time link.
 *
 * An upsert on the primary key, so re-linking a team for a new season or a new
 * league updates the row in place and orphans nothing: `fixtures` are keyed by
 * `(team_id, external_ref)` and are never touched here.
 */
export async function saveFullTimeLink(
  teamId: string,
  input: SaveFullTimeLinkInput,
): Promise<{ error?: string }> {
  const session = await requireCommittee();

  // The URL is re-parsed server side; the identifiers the browser sent back
  // are only allowed to fill in blanks the URL itself did not carry.
  let fromUrl: FullTimeIds;
  try {
    fromUrl = parseFullTimeUrl(input.url);
  } catch (cause) {
    return {
      error:
        cause instanceof FullTimeUrlError
          ? cause.message
          : "That does not look like a Full-Time URL.",
    };
  }

  const ids = mergeIds(fromUrl, input.ids);
  if (!ids.leagueId) {
    return {
      error:
        "That Full-Time link has no league in it — open the league or division fixtures page and copy that address instead.",
    };
  }
  if (!ids.seasonId) {
    return {
      error:
        "That Full-Time link has no season in it — open the division's fixtures page for the season you want and copy that address, or run a preview first so the season can be read off the page.",
    };
  }

  // Store the canonical fixtures URL: the database requires an
  // `https://fulltime.thefa.com/…` value, and a pasted link may be missing a
  // scheme, carry `www.`, or point at a results/table page.
  const sourceUrl = buildFixturesUrl(ids);
  const ftTeamName = input.ftTeamName.trim() || null;

  const admin = createAdminClient();
  const { error } = await admin.from("team_fulltime_links").upsert(
    {
      team_id: teamId,
      source_url: sourceUrl,
      league_id: ids.leagueId,
      ft_season_id: ids.seasonId,
      division_id: ids.divisionId ?? null,
      fixture_group_key: ids.fixtureGroupKey ?? null,
      ft_team_id: ids.teamId ?? null,
      ft_team_name: ftTeamName,
      enabled: input.enabled,
      updated_by: session.userId,
    },
    { onConflict: "team_id" },
  );
  if (error) return { error: `Could not save the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "link",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: {
      source_url: sourceUrl,
      league_id: ids.leagueId,
      ft_season_id: ids.seasonId,
      division_id: ids.divisionId ?? null,
      ft_team_name: ftTeamName,
      enabled: input.enabled,
    },
  });

  revalidateTeam(teamId);
  return {};
}

/** Pause or resume the importer for one team without losing the identifiers. */
export async function setFullTimeLinkEnabled(
  teamId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const { error } = await admin
    .from("team_fulltime_links")
    .update({ enabled, updated_by: session.userId })
    .eq("team_id", teamId);
  if (error) return { error: `Could not update the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: enabled ? "enable" : "disable",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: { enabled },
  });

  revalidateTeam(teamId);
  return {};
}

/** Remove the link. Fixtures already imported are deliberately left alone. */
export async function removeFullTimeLink(teamId: string): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const { error } = await admin.from("team_fulltime_links").delete().eq("team_id", teamId);
  if (error) return { error: `Could not remove the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "unlink",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: {},
  });

  revalidateTeam(teamId);
  return {};
}
